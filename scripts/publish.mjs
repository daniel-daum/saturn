// publishes a finished post page: adds or updates its entry in feed.xml and
// its standard.site record on my pds, so atproto readers (leaflet, pckt, ...)
// can find and follow it. no dependencies, node 18+.
//
//   mise run publish now/sep-2026/index.html             feed + standard.site
//   mise run publish now/sep-2026/index.html --dry-run   show what would change
//
// the page is the source: its h1 is the title, the <time> in its header the
// date, the kicker (/now) the category, the meta description the summary,
// the banner photo the cover, and the <article> the feed content (classes
// dropped, urls made absolute, the header, likes and comments left out).
//
// running it again on the same page is safe. an existing feed entry keeps its
// published date and its summary (those are often hand-written); its title
// and content are replaced and `updated` moves to now, only if they changed.
// a post's record key comes from its date and path, so it always maps to the
// same record, and the page gets a <link rel="site.standard.document"> to it.
//
// publishing to standard.site needs ATPROTO_APP_PASSWORD (a bluesky app
// password). without it the feed is still updated, and a post whose record is
// already on the pds still gets its link tag; nothing is written to the pds.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const SITE = "https://danieldaum.net";
const PDS = "https://home.daum.dev";
const DID = "did:plc:e3z5gj5iyuwgqao562bo4bdf";
const TZ = "America/Los_Angeles";
const FEED = "feed.xml";
const MAX_BLOB = 1_000_000;
const ASSETS = "https://assets.danieldaum.net";
const COVER_RESIZE = "width=1600,quality=80,format=webp";

// the publication all my posts belong to. its key is fixed, so the old
// records on my pds stay the same ones
const PUBLICATION = {
    rkey: tid(Date.parse("2026-01-01T00:00:00Z") * 1000, 0),
    name: "daniel daum",
    description: "everything i write, in one place",
    icon: "assets/favicon/android-chrome-512x512.png",
};
const PUBLICATION_URI = `at://${DID}/site.standard.publication/${PUBLICATION.rkey}`;
const WELL_KNOWN = ".well-known/site.standard.publication";

// ---------------------------------------------------------------------------
// the page

async function readPost(arg) {
    const dir = arg.replace(/^\/+/, "").replace(/index\.html$/, "").replace(/\/*$/, "");
    if (!dir) throw new Error("give the post's page, e.g. now/sep-2026/index.html");
    const file = `${dir}/index.html`;
    const html = await readFile(file, "utf8");

    // commented-out markup (e.g. the template's optional banner) isn't the post
    const article = /<article>([\s\S]*?)<\/article>/.exec(html)?.[1]?.replace(/<!--[\s\S]*?-->/g, "");
    if (!article) throw new Error(`${file} has no <article>`);
    const header = /<header class="page-header[^"]*">([\s\S]*?)<\/header>/.exec(article)?.[1] ?? "";

    const post = {
        file,
        html,
        path: `/${dir}/`,
        title: text(/<h1>([\s\S]*?)<\/h1>/.exec(header)?.[1] ?? ""),
        date: /<time datetime="(\d{4}-\d{2}-\d{2})"/.exec(header)?.[1],
        category: text(/<p class="page-header-kicker">([\s\S]*?)<\/p>/.exec(header)?.[1] ?? "").replace(/^\//, ""),
        description: decode(/<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? ""),
        banner: banner(article),
        content: feedContent(article),
    };
    if (!post.title) throw new Error(`${file}: no <h1> in the post header`);
    if (!post.date) throw new Error(`${file}: no <time datetime="YYYY-MM-DD"> in the post header`);
    // left over from internal/template.html
    const leftover = ["ONE SENTENCE SUMMARY", "Post Title", "Section heading", "Body text."].find((t) => (article + post.description).includes(t));
    if (leftover) throw new Error(`${file}: still has the template's "${leftover}"`);
    return post;
}

// the banner photo, if the post has one: a single photo is a link
// (<a class="post-banner">), a row of them a <figure class="post-banner">.
// the cover is the first photo; only a linked one becomes the feed's figure,
// since a row's <figure> is already in the article body
function banner(article) {
    const m = /<(a|figure) class="post-banner[^"]*"[^>]*>([\s\S]*?)<\/\1>/.exec(article);
    const img = m && /<img\b([^>]*)>/.exec(m[2])?.[1];
    if (!img) return null;
    return { src: attr(img, "src"), alt: attr(img, "alt") ?? "", linked: m[1] === "a" };
}

// the article as feed html: banner as a figure, then the body. no header, no
// likes and comments, no classes, absolute urls, one block per line. <pre>
// keeps its whitespace
function feedContent(article) {
    const pres = [];
    let body = article
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<a class="post-banner[^"]*"[^>]*>[\s\S]*?<\/a>/, "")
        .replace(/<header class="page-header[^"]*">[\s\S]*?<\/header>/, "")
        .replace(/<section[^>]*\bpost-social\b[^>]*>[\s\S]*?<\/section>/, "")
        .replace(/<\/?section[^>]*>/g, "")
        .replace(/<pre\b[\s\S]*?<\/pre>/g, (pre) => `\u0000${pres.push(pre) - 1}\u0000`);

    body = cleanTags(body)
        .replace(/\s+/g, " ")
        .replace(/\s*(<(?:p|h[1-6]|ul|ol|li|div|figure|figcaption|blockquote|hr|table|tr|\u0000)\b)/g, "\n$1")
        .replace(/\s*(\u0000\d+\u0000)/g, "\n$1")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/ +(<\/(?:p|h[1-6]|li|figcaption|blockquote)>)/g, "$1")
        .replace(/(<(?:p|h[1-6]|li|figcaption|blockquote)\b[^>]*>) +/g, "$1")
        .replace(/(<\/(?:p|li|ul|ol|div|figure|figcaption|blockquote)>)\s+(?=<\/)/g, "$1")
        .replace(/(<figure>|<img\b[^>]*\/>)\s*(?=<img\b)/g, "$1\n")
        .replace(/\s+(<\/figure>)/g, "$1")
        .trim();
    body = body.replace(/\u0000(\d+)\u0000/g, (_, i) => cleanTags(pres[i]));

    const b = banner(article);
    const figure = b?.linked ? `<figure>\n<img src="${esc(absolute(b.src))}" alt="${esc(b.alt)}" /></figure>\n` : "";
    return figure + body;
}

// keeps only href, src, alt, title and datetime, makes them absolute, and
// unwraps the spans left with nothing on them (e.g. code highlighting)
function cleanTags(html) {
    return html
        .replace(/<([a-z][a-z0-9]*)\b([^>]*?)(\/?)>/gi, (_, tag, attrs, selfClose) => {
            const kept = [...attrs.matchAll(/([a-z-]+)\s*=\s*"([^"]*)"/gi)]
                .filter(([, name]) => ["href", "src", "alt", "title", "datetime"].includes(name.toLowerCase()))
                .map(([, name, value]) => ` ${name}="${["href", "src"].includes(name) ? absolute(value) : value}"`)
                .join("");
            return `<${tag}${kept}${selfClose ? " /" : ""}>`;
        })
        .replace(/<span>([\s\S]*?)<\/span>/g, "$1")
        .split(/(<\/?[a-z][^>]*>)/i)
        .map((part, i) => (i % 2 ? part : part.replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi, "&amp;").replace(/>/g, "&gt;")))
        .join("");
}

function absolute(url) {
    return /^\/(?!\/)/.test(url) ? SITE + url : url;
}

function attr(attrs, name) {
    const raw = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
    return raw === undefined ? undefined : decode(raw);
}

function text(html) {
    return decode(html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
}

// ---------------------------------------------------------------------------
// feed.xml

// entries inside <!-- --> (hidden ones) are left alone
function liveEntries(xml) {
    const comments = [...xml.matchAll(/<!--[\s\S]*?-->/g)].map((m) => [m.index, m.index + m[0].length]);
    return [...xml.matchAll(/[ \t]*<entry>[\s\S]*?<\/entry>\n?/g)]
        .filter((m) => !comments.some(([from, to]) => m.index >= from && m.index < to))
        .map((m) => ({
            start: m.index,
            end: m.index + m[0].length,
            xml: m[0],
            id: /<id>([^<]*)<\/id>/.exec(m[0])?.[1],
            link: /<link rel="alternate"[^>]*href="([^"]*)"/.exec(m[0])?.[1],
            published: /<published>([^<]*)<\/published>/.exec(m[0])?.[1],
            updated: /<updated>([^<]*)<\/updated>/.exec(m[0])?.[1],
        }));
}

// an entry's id never changes once it's out, even if it isn't the url
// written the way it would be today (e.g. no trailing slash)
function renderEntry(post, { id, published, updated, summary }) {
    const url = SITE + post.path;
    const lines = [
        `  <entry>`,
        `    <title>${xmlEsc(post.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${url}" />`,
        `    <id>${id ?? url}</id>`,
        `    <published>${published}</published>`,
        `    <updated>${updated}</updated>`,
        post.category ? `    <category term="${xmlEsc(post.category)}" />` : null,
        summary ? `    <summary type="text">${summary}</summary>` : null,
        `    <content type="html"><![CDATA[`,
        ...indent(post.content.replaceAll("]]>", "]]]]><![CDATA[>"), "      "),
        `    ]]></content>`,
        `  </entry>`,
    ];
    return lines.filter((l) => l !== null).join("\n") + "\n";
}

// indents each line, except inside <pre>, where it would change the code
function indent(html, by) {
    let inPre = false;
    return html.split("\n").map((line) => {
        const out = inPre ? line : by + line;
        const opens = (line.match(/<pre\b/g) || []).length;
        const closes = (line.match(/<\/pre>/g) || []).length;
        if (opens !== closes) inPre = opens > closes;
        return out;
    });
}

// the new feed, and what happened: "added", "updated" or "unchanged"
function updateFeed(xml, post, now) {
    const url = SITE + post.path;
    const entries = liveEntries(xml);
    const slash = (u) => (u ?? "").replace(/\/?$/, "/");
    const existing = entries.find((e) => slash(e.id) === url || slash(e.link) === url);

    let next;
    let result;
    if (existing) {
        const summary = /<summary type="text">([\s\S]*?)<\/summary>/.exec(existing.xml)?.[1];
        const same = renderEntry(post, { id: existing.id, published: existing.published, updated: existing.updated, summary });
        if (same === existing.xml.replace(/\n?$/, "\n")) return { xml, result: "unchanged" };
        const entry = renderEntry(post, { id: existing.id, published: existing.published, updated: now, summary });
        next = xml.slice(0, existing.start) + entry + xml.slice(existing.end);
        result = "updated";
    } else {
        const published = localTime(post.date, "09:00");
        const entry = renderEntry(post, { published, updated: published, summary: xmlEsc(post.description) }) + "\n";
        // newest first: before the first entry published earlier, else last
        const before = entries.find((e) => Date.parse(e.published) < Date.parse(published));
        const at = before ? before.start : xml.lastIndexOf("</feed>");
        next = xml.slice(0, at) + entry + xml.slice(at);
        result = "added";
    }

    // the feed's own <updated>: its newest entry's
    const newest = liveEntries(next)
        .map((e) => e.updated)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    next = next.replace(/(<icon>[^<]*<\/icon>\s*)<updated>[^<]*<\/updated>/, `$1<updated>${newest}</updated>`);
    return { xml: next, result };
}

// "2026-09-03", "09:00" -> 2026-09-03T09:00:00-07:00, in my timezone
function localTime(date, time) {
    const guess = new Date(`${date}T${time}:00Z`);
    const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
        .formatToParts(guess)
        .find((p) => p.type === "timeZoneName").value;
    const offset = name === "GMT" ? "+00:00" : name.replace("GMT", "");
    return `${date}T${time}:00${offset}`;
}

function nowLocal() {
    const d = new Date();
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
            timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).formatToParts(d).map((p) => [p.type, p.value]),
    );
    return localTime(`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`);
}

// ---------------------------------------------------------------------------
// standard.site

async function documentRecord(post, session) {
    const record = {
        $type: "site.standard.document",
        site: PUBLICATION_URI,
        path: post.path,
        title: post.title,
        publishedAt: `${post.date}T12:00:00.000Z`,
    };
    if (post.description) record.description = post.description;
    if (post.category) record.tags = [post.category];
    const cover = await coverBlob(post.banner?.src, session);
    if (cover) record.coverImage = cover;
    return record;
}

function documentKey(post) {
    return tid(Date.parse(`${post.date}T12:00:00Z`) * 1000, clockIdFor(post.path));
}

// the banner, if it's under the 1MB limit. if it's bigger, a smaller copy
// from cloudflare's image resizing (the original on r2 is left alone)
async function coverBlob(url, session) {
    if (!url) return null;
    const candidates = [absolute(url)];
    if (candidates[0].startsWith(`${ASSETS}/`)) {
        candidates.push(candidates[0].replace(`${ASSETS}/`, `${ASSETS}/cdn-cgi/image/${COVER_RESIZE}/`));
    }
    for (const candidate of candidates) {
        const res = await fetch(candidate);
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length <= MAX_BLOB) return blob(bytes, res.headers.get("content-type") || "image/webp", session);
    }
    console.warn(`  no cover: ${url} is over 1MB and couldn't be resized`);
    return null;
}

// a blob ref for these bytes. uploaded only if the record changes: atproto
// blob ids are a hash of the bytes, worked out here first
function blob(bytes, mimeType, session) {
    const ref = { $type: "blob", ref: { $link: cid(bytes) }, mimeType, size: bytes.length };
    session.blobs.push({ ref, bytes });
    return ref;
}

async function getRecord(collection, rkey) {
    const url = new URL("/xrpc/com.atproto.repo.getRecord", PDS);
    url.searchParams.set("repo", DID);
    url.searchParams.set("collection", collection);
    url.searchParams.set("rkey", rkey);
    const res = await fetch(url);
    return res.ok ? (await res.json()).value : null;
}

// create or update a record, only when it differs from what's there. the
// pds may settle on another mime type for a blob, so blobs compare by id
async function putIfChanged(collection, rkey, record, session) {
    const existing = await getRecord(collection, rkey);
    const blobsMatch = (a, b) => canonical(withoutMime(a)) === canonical(withoutMime(b));
    if (existing && blobsMatch(existing, record)) {
        session.blobs.length = 0;
        return false;
    }
    if (session.dryRun) {
        session.blobs.length = 0;
        return true;
    }
    for (const { ref, bytes } of session.blobs) {
        const res = await xrpc("com.atproto.repo.uploadBlob", session, bytes, ref.mimeType);
        const uploaded = (await res.json()).blob;
        if (uploaded.ref.$link !== ref.ref.$link) throw new Error(`blob id mismatch for ${ref.ref.$link}`);
        ref.mimeType = uploaded.mimeType;
    }
    session.blobs.length = 0;
    await xrpc("com.atproto.repo.putRecord", session, { repo: DID, collection, rkey, record });
    return true;
}

function withoutMime(value) {
    if (Array.isArray(value)) return value.map(withoutMime);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (!(k === "mimeType" && value.$type === "blob")) out[k] = withoutMime(v);
        }
        return out;
    }
    return value;
}

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

// keeps two posts on the same day apart
function clockIdFor(path) {
    return createHash("sha256").update(path).digest().readUInt16BE(0) & 1023;
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
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&rarr;/g, "→")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// run

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
    console.error("usage: mise run publish <page>/index.html [--dry-run]");
    process.exit(1);
}

const post = await readPost(target);
console.log(`${post.title} (${post.path}, ${post.date}${post.category ? `, #${post.category}` : ""})`);

// feed
const feed = await readFile(FEED, "utf8");
const { xml, result } = updateFeed(feed, post, nowLocal());
if (dryRun) {
    const entry = liveEntries(xml).find((e) => e.link === SITE + post.path);
    console.log(`\nfeed: would be ${result}`);
    if (result !== "unchanged") console.log(entry.xml);
} else {
    if (xml !== feed) await writeFile(FEED, xml);
    console.log(`feed: ${result}`);
}

// standard.site. without a password nothing is written to the pds, but a
// record that's already there and up to date still gets its local half: the
// .well-known file and the page's link tag
const canWrite = Boolean(process.env.ATPROTO_APP_PASSWORD);
const session = canWrite && !dryRun ? { ...(await login()), dryRun } : { blobs: [], dryRun: true };
const would = dryRun ? "would be " : "";

const icon = await readFile(PUBLICATION.icon);
const publication = {
    $type: "site.standard.publication",
    url: SITE,
    name: PUBLICATION.name,
    description: PUBLICATION.description,
    icon: blob(icon, "image/png", session),
};
const publicationChanged = await putIfChanged("site.standard.publication", PUBLICATION.rkey, publication, session);
if (publicationChanged) console.log(`standard.site: publication record ${canWrite || dryRun ? `${would}updated` : "differs from the pds"}`);
const publicationLive = !publicationChanged || (canWrite && !dryRun) || dryRun;

// the other half of the publication's proof: the domain points back at it
const wellKnown = await readFile(WELL_KNOWN, "utf8").catch(() => "");
if (publicationLive && wellKnown !== PUBLICATION_URI) {
    if (!dryRun) await writeFile(WELL_KNOWN, PUBLICATION_URI);
    console.log(`standard.site: ${WELL_KNOWN} ${would}written`);
}

const rkey = documentKey(post);
const uri = `at://${DID}/site.standard.document/${rkey}`;
const record = await documentRecord(post, session);
const changed = await putIfChanged("site.standard.document", rkey, record, session);
if (changed && !canWrite && !dryRun) {
    console.log(`standard.site: ${uri} is missing or out of date on the pds. set ATPROTO_APP_PASSWORD to publish it`);
    process.exit(0);
}
console.log(`standard.site: ${uri} ${changed ? (dryRun ? "would be published" : "published") : "unchanged"}`);
if (dryRun && changed) console.log(JSON.stringify(record, null, 2));

const html = withLinkTag(post.html, uri);
if (html !== post.html) {
    if (!dryRun) await writeFile(post.file, html);
    console.log(`page: ${dryRun ? "would get" : "added"} its <link rel="site.standard.document">`);
}
