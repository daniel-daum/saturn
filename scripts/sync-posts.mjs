// pulls my bluesky posts from my pds and writes them into the static html.
// run with `mise run sync-posts`. no dependencies, node 18+.
//
// a page opts in with a pair of marker comments; everything between them is
// replaced on every run:
//
//     <!-- posts:all -->...<!-- /posts:all -->   every post
//     <!-- posts:3 -->...<!-- /posts:3 -->       the newest 3
//     <!-- posts:highlight -->...<!-- /posts:highlight -->   the newest one as
//                                                      a card (/, /blog/)
//
// my own top-level posts and my reposts are kept, newest first; replies are
// dropped. a repost shows the original post, the way bluesky does.
//
// my pds only holds my own records, so reposted posts, quoted posts and video
// thumbnails are looked up on bluesky's public api. that happens here, at sync
// time, never when a page loads. if it fails, they fall back to plain links.
//
// if the pds
// can't be reached, or comes back empty while the site still has posts, the
// script exits non-zero and touches nothing (--force allows the empty case).

import { readFile, writeFile } from "node:fs/promises";

const PDS = "https://pds.danieldaum.net";
const DID = "did:plc:e3z5gj5iyuwgqao562bo4bdf";
const HANDLE = "danieldaum.net";
const APPVIEW = "https://public.api.bsky.app";
const TZ = "America/Los_Angeles";

const PAGES = ["posts/index.html", "blog/index.html", "index.html"];

// ---------------------------------------------------------------------------
// data

async function fetchPosts() {
    const posts = (await listRecords("app.bsky.feed.post"))
        .filter((r) => typeof r.value?.text === "string" && !r.value.reply)
        .map((r) => ({ uri: r.uri, rkey: rkeyOf(r.uri), ...r.value }));

    const reposts = (await listRecords("app.bsky.feed.repost"))
        .filter((r) => typeof r.value?.subject?.uri === "string")
        .map((r) => ({ rkey: rkeyOf(r.uri), createdAt: r.value.createdAt, subjectUri: r.value.subject.uri }));

    const views = await fetchViews([...posts.map((p) => p.uri), ...reposts.map((r) => r.subjectUri)]);
    for (const post of posts) post.view = views.get(post.uri)?.embed;
    for (const repost of reposts) repost.subject = views.get(repost.subjectUri);

    return [...posts, ...reposts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function listRecords(collection) {
    const records = [];
    let cursor;
    do {
        const url = new URL("/xrpc/com.atproto.repo.listRecords", PDS);
        url.searchParams.set("repo", DID);
        url.searchParams.set("collection", collection);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`listRecords ${collection}: ${res.status} ${res.statusText}`);
        const page = await res.json();
        records.push(...page.records);
        cursor = page.records.length > 0 ? page.cursor : undefined;
    } while (cursor);
    return records;
}

function rkeyOf(uri) {
    return uri.split("/").pop();
}

// the appview's hydrated copy of each post: reposted and quoted post text,
// image and video thumbnails. getPosts takes 25 uris per call
async function fetchViews(uris) {
    const views = new Map();
    try {
        for (let i = 0; i < uris.length; i += 25) {
            const url = new URL("/xrpc/app.bsky.feed.getPosts", APPVIEW);
            for (const uri of uris.slice(i, i + 25)) url.searchParams.append("uris", uri);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`getPosts: ${res.status}`);
            for (const view of (await res.json()).posts) views.set(view.uri, view);
        }
    } catch (err) {
        console.warn(`appview lookup failed, reposts, quotes and videos will be plain links (${err.message})`);
    }
    return views;
}

// ---------------------------------------------------------------------------
// rendering

function renderItem(item) {
    return item.subjectUri ? renderRepost(item) : renderPost(item);
}

function renderPost(post) {
    const permalink = `/posts/#${post.rkey}`;
    const bsky = `https://bsky.app/profile/${HANDLE}/post/${post.rkey}`;
    const lines = [
        `<article class="post-item" id="${esc(post.rkey)}">`,
        `    <p class="post-item-meta">`,
        `        <a class="post-item-time" href="${permalink}"><time datetime="${esc(post.createdAt)}">${formatDate(post.createdAt)}</time></a>`,
        `        <a class="post-item-reply" href="${bsky}">reply on bluesky</a>`,
        `    </p>`,
    ];
    if (post.text.trim()) {
        lines.push(`    <p class="post-item-body">${renderText(post.text, post.facets)}</p>`);
    }
    lines.push(...renderEmbed(post.embed, post.view, DID, bsky).map((l) => `    ${l}`));
    lines.push(`</article>`);
    return lines.join("\n");
}

// the original post inside a card. the reply link goes to the original
function renderRepost(repost) {
    const permalink = `/posts/#${repost.rkey}`;
    const href = postHref(repost.subjectUri);
    const subject = repost.subject;
    const lines = [
        `<article class="post-item post-item--repost" id="${esc(repost.rkey)}">`,
        `    <p class="post-item-meta">`,
        `        <span><span class="post-item-label">reposted</span> <a class="post-item-time" href="${permalink}"><time datetime="${esc(repost.createdAt)}">${formatDate(repost.createdAt)}</time></a></span>`,
        `        <a class="post-item-reply" href="${href}">reply on bluesky</a>`,
        `    </p>`,
    ];
    if (!subject || typeof subject.record?.text !== "string") {
        lines.push(`    <p class="post-item-note"><a href="${href}">reposted post &rarr; view on bluesky</a></p>`);
    } else {
        const author = subject.author?.displayName || subject.author?.handle || "";
        lines.push(
            `    <div class="post-item-repost">`,
            `        <p class="post-item-card-meta">${escText(author)} <span>@${escText(subject.author?.handle || "")}</span></p>`,
        );
        if (subject.record.text.trim()) {
            lines.push(`        <p class="post-item-body">${renderText(subject.record.text, subject.record.facets)}</p>`);
        }
        const did = subject.author?.did;
        lines.push(...renderEmbed(subject.record.embed, subject.embed, did, href).map((l) => `        ${l}`));
        lines.push(`    </div>`);
    }
    lines.push(`</article>`);
    return lines.join("\n");
}

// the newest post as a card, set apart from the lists around it. links to
// the post on /posts/
function renderHighlight(item) {
    const subject = item.subjectUri ? item.subject : null;
    const record = item.subjectUri ? subject?.record : item;
    const author = subject ? `${subject.author?.displayName || subject.author?.handle || ""}: ` : "";
    const extras = attachments(record?.embed);
    const text = record?.text?.trim() || extras.join(", ") || "view post";
    return [
        `<a class="post-card" href="/posts/#${esc(item.rkey)}">`,
        `    <span class="post-card-meta">`,
        `        <span>${item.subjectUri ? "&#8635; reposted" : "@" + HANDLE}</span>`,
        `        <time datetime="${esc(item.createdAt)}">${formatDate(item.createdAt)}</time>`,
        `    </span>`,
        `    <span class="post-card-text">${escText(author + text)}</span>`,
        extras.length ? `    <span class="post-card-extra">${escText(extras.join(" · "))}</span>` : null,
        `</a>`,
    ].filter((l) => l !== null).join("\n");
}

// "2 images", "video", "link", "quote"
function attachments(embed) {
    switch (embed?.$type) {
        case "app.bsky.embed.images": {
            const n = embed.images?.length || 0;
            return n ? [n === 1 ? "1 image" : `${n} images`] : [];
        }
        case "app.bsky.embed.video":
            return ["video"];
        case "app.bsky.embed.external":
            return ["link"];
        case "app.bsky.embed.record":
            return ["quote"];
        case "app.bsky.embed.recordWithMedia":
            return [...attachments(embed.media), "quote"];
        default:
            return [];
    }
}

// facets index the text by utf-8 byte offset, not by js string index
function renderText(text, facets = []) {
    const bytes = new TextEncoder().encode(text);
    const decode = (from, to) => new TextDecoder().decode(bytes.slice(from, to));
    const sorted = facets
        .filter((f) => f.index && f.features?.length)
        .sort((a, b) => a.index.byteStart - b.index.byteStart);

    let out = "";
    let pos = 0;
    for (const facet of sorted) {
        const { byteStart, byteEnd } = facet.index;
        if (byteStart < pos) continue;
        out += escText(decode(pos, byteStart));
        const label = escText(decode(byteStart, byteEnd));
        const href = facetHref(facet.features[0]);
        out += href ? `<a href="${esc(href)}">${label}</a>` : label;
        pos = byteEnd;
    }
    return out + escText(decode(pos));
}

function facetHref(feature) {
    switch (feature.$type) {
        case "app.bsky.richtext.facet#link":
            return /^https?:\/\//.test(feature.uri) ? feature.uri : null;
        case "app.bsky.richtext.facet#mention":
            return `https://bsky.app/profile/${feature.did}`;
        case "app.bsky.richtext.facet#tag":
            return `https://bsky.app/hashtag/${encodeURIComponent(feature.tag)}`;
        default:
            return null;
    }
}

// `view` is the appview's copy of the same embed, possibly missing. `did` is
// the post author's: only my own images come straight from my pds. a quote
// with media carries the media one level down, in both
function renderEmbed(embed, view, did, bsky) {
    if (!embed) return [];
    switch (embed.$type) {
        case "app.bsky.embed.images":
            return renderImages(embed.images, view?.images, did);
        case "app.bsky.embed.video":
            return renderVideo(embed, view, bsky);
        case "app.bsky.embed.external":
            return renderCard(embed.external);
        case "app.bsky.embed.record":
            return renderQuote(embed.record, view?.record);
        case "app.bsky.embed.recordWithMedia":
            return [
                ...renderEmbed(embed.media, view?.media, did, bsky),
                ...renderQuote(embed.record?.record, view?.record?.record),
            ];
        default:
            return [];
    }
}

// one image keeps its shape; two or more go in a cropped grid, like bluesky.
// someone else's images come from bluesky's cdn, via the appview
function renderImages(images = [], views = [], did) {
    const imgs = images
        .map((img, i) => ({ img, src: did === DID ? img.image?.ref?.$link && blobUrl(img.image.ref.$link) : views[i]?.thumb }))
        .filter(({ src }) => typeof src === "string" && /^https:\/\//.test(src))
        .map(({ img, src }) => `<img src="${esc(src)}" alt="${esc(img.alt || "")}"${sizeAttrs(img.aspectRatio)} loading="lazy" />`);
    if (imgs.length === 0) return [];
    const cls = imgs.length === 1 ? "post-item-media" : "post-item-media post-item-media--grid";
    return [`<div class="${cls}">`, ...imgs.map((i) => `    ${i}`), `</div>`];
}

// the pds can't serve range requests, so safari won't play video from it.
// show bluesky's thumbnail and send people there to watch
function renderVideo(embed, view, bsky) {
    const thumb = view?.thumbnail;
    if (!thumb || !/^https:\/\//.test(thumb)) {
        return [`<p class="post-item-note"><a href="${bsky}">video &rarr; watch on bluesky</a></p>`];
    }
    const alt = embed.alt ? `${embed.alt} (video, plays on bluesky)` : "video, plays on bluesky";
    return [
        `<a class="post-item-video" href="${bsky}">`,
        `    <img src="${esc(thumb)}" alt="${esc(alt)}"${sizeAttrs(embed.aspectRatio)} loading="lazy" />`,
        `</a>`,
    ];
}

function sizeAttrs(ratio) {
    return ratio?.width && ratio?.height ? ` width="${ratio.width}" height="${ratio.height}"` : "";
}

function renderCard(external) {
    if (!external?.uri || !/^https?:\/\//.test(external.uri)) return [];
    const domain = new URL(external.uri).hostname.replace(/^www\./, "");
    return [
        `<a class="post-item-card" href="${esc(external.uri)}">`,
        `    <span class="post-item-card-title">${escText(external.title || domain)}</span>`,
        external.description ? `    <span class="post-item-card-desc">${escText(external.description)}</span>` : null,
        `    <span class="post-item-card-meta">${escText(domain)}</span>`,
        `</a>`,
    ].filter((l) => l !== null);
}

// with the appview's copy, the quoted text shows as a card
function renderQuote(ref, view) {
    const href = postHref(ref?.uri);
    if (!href) return [];
    const text = view?.$type === "app.bsky.embed.record#viewRecord" ? view.value?.text : null;
    if (typeof text !== "string") {
        return [`<p class="post-item-note"><a href="${href}">quoting &rarr;</a></p>`];
    }
    const author = view.author?.displayName || view.author?.handle || "";
    return [
        `<a class="post-item-card post-item-quote" href="${href}">`,
        `    <span class="post-item-card-meta">${escText(author)} <span>@${escText(view.author?.handle || "")}</span></span>`,
        `    <span class="post-item-quote-text">${escText(text)}</span>`,
        `</a>`,
    ];
}

// at://did/app.bsky.feed.post/rkey -> https://bsky.app/profile/did/post/rkey
function postHref(uri) {
    const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri || "");
    return match ? `https://bsky.app/profile/${match[1]}/post/${match[2]}` : null;
}

function blobUrl(cid) {
    const url = new URL("/xrpc/com.atproto.sync.getBlob", PDS);
    url.searchParams.set("did", DID);
    url.searchParams.set("cid", cid);
    return url.toString();
}

// 8 Oct 2026, 1:42 pm
function formatDate(iso) {
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${day}, ${time}`;
}

function escText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />");
}

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// writing

const MARKER = /^([ \t]*)<!-- posts:(all|highlight|\d+) -->[\s\S]*?<!-- \/posts:\2 -->/gm;

function fill(html, posts) {
    return html.replace(MARKER, (_, indent, mode) => {
        let body;
        if (posts.length === 0) {
            body = `<p class="meta">no posts yet</p>`;
        } else if (mode === "highlight") {
            body = renderHighlight(posts[0]);
        } else {
            body = (mode === "all" ? posts : posts.slice(0, Number(mode))).map(renderItem).join("\n\n");
        }
        const indented = body.replace(/^(?=.)/gm, indent);
        return `${indent}<!-- posts:${mode} -->\n${indented}\n${indent}<!-- /posts:${mode} -->`;
    });
}

const posts = await fetchPosts();
const pages = await Promise.all(PAGES.map((page) => readFile(page, "utf8")));

// an empty pds while the site still has posts looks like a reset pds, not
// a deliberate wipe. refuse unless told otherwise
if (posts.length === 0 && !process.argv.includes("--force") && pages.some((html) => html.includes('class="post-item'))) {
    console.error("the pds has no posts but the site does. nothing changed.");
    console.error("if you really deleted everything: mise run sync-posts -- --force");
    process.exit(1);
}

for (const [i, page] of PAGES.entries()) {
    const before = pages[i];
    const after = fill(before, posts);
    if (after !== before) {
        await writeFile(page, after);
        console.log(`updated ${page}`);
    }
}
console.log(`${posts.length} post${posts.length === 1 ? "" : "s"}`);
