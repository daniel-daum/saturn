// publishes my long-form writing to atproto as standard.site records, so
// atproto readers (leaflet, pckt, ...) can find and follow it. metadata only:
// title, description, date, path, tags and the banner as a cover. the post
// itself stays here. run with `mise run sync-standard`, or the sync button.
//
// what gets published is the writing list on /blog/: every row except notes
// (#game, #movie, #show, #book, #album). each post's record key comes from its
// date, so the same post always maps to the same record and this script can
// write the <link rel="site.standard.document"> tag into the page itself.
//
// needs ATPROTO_APP_PASSWORD (a bluesky app password). without it the script
// says so and exits without doing anything.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const PDS = "https://pds.danieldaum.net";
const DID = "did:plc:e3z5gj5iyuwgqao562bo4bdf";
const SITE = "https://danieldaum.net";
const NOTE_TAGS = new Set(["game", "movie", "show", "book", "album"]);
const MAX_BLOB = 1_000_000;
const ASSETS = "https://assets.danieldaum.net";
const COVER_RESIZE = "width=1600,quality=80,format=webp";

const PUBLICATION = {
    rkey: tid(Date.parse("2026-01-01T00:00:00Z") * 1000, 0),
    name: "daniel daum",
    description: "everything i write, in one place",
    icon: "assets/favicon/android-chrome-512x512.png",
};
const PUBLICATION_URI = `at://${DID}/site.standard.publication/${PUBLICATION.rkey}`;

// ---------------------------------------------------------------------------
// what to publish

// rows of the writing list: <a class="archive-row" href> title, tag, date
async function readWritingList() {
    const html = await readFile("blog/index.html", "utf8");
    const rows = [...html.matchAll(/<a class="archive-row" href="([^"]+)">([\s\S]*?)<\/a>/g)];
    return rows
        .map(([, path, inner]) => ({
            path,
            title: decode(/<span class="archive-title">([\s\S]*?)<\/span>/.exec(inner)?.[1]?.trim() || ""),
            tag: /<span class="archive-tag">#([^<]+)<\/span>/.exec(inner)?.[1]?.trim() || "",
            date: /datetime="(\d{4}-\d{2}-\d{2})"/.exec(inner)?.[1] || "",
        }))
        .filter((row) => row.path.startsWith("/") && row.title && row.date && !NOTE_TAGS.has(row.tag));
}

// the page behind a row: its file, description and banner
async function readPage(path) {
    const file = `${path.replace(/^\//, "")}index.html`;
    const html = await readFile(file, "utf8");
    const description = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1];
    const banner = /class="post-banner[^"]*"[\s\S]*?<img[\s\S]*?src="([^"]+)"/.exec(html)?.[1];
    return { file, html, description: description && decode(description), banner };
}

// ---------------------------------------------------------------------------
// records

async function documentRecord(row, page, session) {
    const record = {
        $type: "site.standard.document",
        site: PUBLICATION_URI,
        path: row.path,
        title: row.title,
        publishedAt: `${row.date}T12:00:00.000Z`,
    };
    if (page.description) record.description = page.description;
    if (row.tag) record.tags = [row.tag];
    const cover = await coverBlob(page.banner, session);
    if (cover) record.coverImage = cover;
    return record;
}

// the banner, if it's under the 1MB limit. if it's bigger, a smaller copy
// from cloudflare's image resizing (the original on r2 is left alone)
async function coverBlob(url, session) {
    if (!url) return null;
    const candidates = [url];
    if (url.startsWith(`${ASSETS}/`)) {
        candidates.push(url.replace(`${ASSETS}/`, `${ASSETS}/cdn-cgi/image/${COVER_RESIZE}/`));
    }
    for (const candidate of candidates) {
        const res = await fetch(candidate);
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length <= MAX_BLOB) {
            return blob(bytes, res.headers.get("content-type") || "image/webp", session);
        }
    }
    console.warn(`  no cover: ${url} is over 1MB and couldn't be resized`);
    return null;
}

// a blob ref for these bytes. only uploads when the pds doesn't already have
// them: atproto blob ids are a hash of the bytes, worked out here first
async function blob(bytes, mimeType, session) {
    const ref = { $type: "blob", ref: { $link: cid(bytes) }, mimeType, size: bytes.length };
    session.blobs.push({ ref, bytes });
    return ref;
}

async function uploadBlobs(blobs, session) {
    for (const { ref, bytes } of blobs) {
        const res = await xrpc("com.atproto.repo.uploadBlob", session, bytes, ref.mimeType);
        const uploaded = (await res.json()).blob;
        if (uploaded.ref.$link !== ref.ref.$link) {
            throw new Error(`blob id mismatch for ${ref.ref.$link}`);
        }
        // the record carries whatever type the pds settled on
        ref.mimeType = uploaded.mimeType;
    }
}

// create or update a record, only when it differs from what's there
async function putIfChanged(collection, rkey, record, session) {
    const url = new URL("/xrpc/com.atproto.repo.getRecord", PDS);
    url.searchParams.set("repo", DID);
    url.searchParams.set("collection", collection);
    url.searchParams.set("rkey", rkey);
    const res = await fetch(url);
    const existing = res.ok ? (await res.json()).value : null;
    if (existing && canonical(existing) === canonical(record)) {
        session.blobs.length = 0;
        return false;
    }
    await uploadBlobs(session.blobs, session);
    session.blobs.length = 0;
    await xrpc("com.atproto.repo.putRecord", session, { repo: DID, collection, rkey, record });
    return true;
}

// ---------------------------------------------------------------------------
// the page side

// <link rel="site.standard.document"> in the page's <head>, added or fixed
function withLinkTag(html, uri) {
    const tag = `<link rel="site.standard.document" href="${uri}" />`;
    if (/<link rel="site\.standard\.document"[^>]*>/.test(html)) {
        return html.replace(/<link rel="site\.standard\.document"[^>]*>/, tag);
    }
    return html.replace(/\n([ \t]*)<\/head>/, (_, indent) => `\n${indent}    ${tag}\n${indent}</head>`);
}

// ---------------------------------------------------------------------------
// atproto plumbing

async function login() {
    const res = await fetch(new URL("/xrpc/com.atproto.server.createSession", PDS), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: DID, password: process.env.ATPROTO_APP_PASSWORD }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    return { jwt: (await res.json()).accessJwt, blobs: [] };
}

async function xrpc(method, session, body, contentType = "application/json") {
    const res = await fetch(new URL(`/xrpc/${method}`, PDS), {
        method: "POST",
        headers: { "content-type": contentType, authorization: `Bearer ${session.jwt}` },
        body: contentType === "application/json" ? JSON.stringify(body) : body,
    });
    if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
    return res;
}

// a record key: microseconds since 1970 and a 10-bit clock id, as 13 base32
// characters. same inputs, same key
function tid(micros, clockId) {
    const alphabet = "234567abcdefghijklmnopqrstuvwxyz";
    let n = (BigInt(micros) << 10n) | BigInt(clockId & 1023);
    let out = "";
    for (let i = 0; i < 13; i++) {
        out = alphabet[Number(n & 31n)] + out;
        n >>= 5n;
    }
    return out;
}

// cidv1, raw codec, sha2-256, base32: how atproto names blobs
function cid(bytes) {
    const digest = createHash("sha256").update(bytes).digest();
    const raw = Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]);
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    let bits = 0;
    let value = 0;
    let out = "b";
    for (const byte of raw) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
    return out;
}

// json with sorted keys, so two records compare equal whatever their key order
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function decode(s) {
    return s
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&mdash;/g, "—")
        .replace(/&amp;/g, "&");
}

// keeps two posts on the same day apart
function clockIdFor(path) {
    return createHash("sha256").update(path).digest().readUInt16BE(0) & 1023;
}

// ---------------------------------------------------------------------------
// run

if (!process.env.ATPROTO_APP_PASSWORD) {
    console.log("standard.site: ATPROTO_APP_PASSWORD isn't set, skipping");
    process.exit(0);
}

const session = await login();

const icon = await readFile(PUBLICATION.icon);
const publication = {
    $type: "site.standard.publication",
    url: SITE,
    name: PUBLICATION.name,
    description: PUBLICATION.description,
    icon: await blob(icon, "image/png", session),
};
if (await putIfChanged("site.standard.publication", PUBLICATION.rkey, publication, session)) {
    console.log("updated the publication record");
}

// the other half of the publication's proof: the domain points back at it
const wellKnown = ".well-known/site.standard.publication";
const currentWellKnown = await readFile(wellKnown, "utf8").catch(() => "");
if (currentWellKnown !== PUBLICATION_URI) {
    await writeFile(wellKnown, PUBLICATION_URI);
    console.log(`updated ${wellKnown}`);
}

const rows = await readWritingList();
for (const row of rows) {
    const page = await readPage(row.path);
    const rkey = tid(Date.parse(`${row.date}T12:00:00Z`) * 1000, clockIdFor(row.path));
    const uri = `at://${DID}/site.standard.document/${rkey}`;
    const record = await documentRecord(row, page, session);
    const changed = await putIfChanged("site.standard.document", rkey, record, session);
    const html = withLinkTag(page.html, uri);
    if (html !== page.html) await writeFile(page.file, html);
    console.log(`${changed ? "published" : "unchanged"} ${row.path}`);
}
console.log(`standard.site: ${rows.length} post${rows.length === 1 ? "" : "s"}`);
