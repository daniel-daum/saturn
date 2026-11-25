// my bluesky posts on the site: the newest 3 on /, the newest one as a card
// on /blog/, all of them on /posts/. my posts and reposts, newest first,
// replies dropped. which posts exist comes from my pds; bluesky's appview
// fills in what the pds doesn't hold (reposted and quoted text, image
// thumbnails on bluesky's cdn). nothing here runs in the browser.
//
// the pages never wait on my pds. the posts come from cloudflare's cache;
// once they're FRESH seconds old the next visitor still gets the cached copy
// and a refresh runs after the response is sent. only an empty cache waits,
// and never more than WAIT ms: past that the page goes out with its fallback
// text and the refresh carries on in the background for the next visitor.
// see README "posts"

const PDS = "https://home.daum.dev";
const DID = "did:plc:e3z5gj5iyuwgqao562bo4bdf";
const HANDLE = "daum.dev";
const APPVIEW = "https://public.api.bsky.app";
const TZ = "America/Los_Angeles";

const FRESH = 300; // seconds
const WAIT = 800; // ms, empty cache only
const FETCH_TIMEOUT = 8000; // ms, the background refresh
const CACHE_KEY = "/__posts/v2"; // bump when the cached data's shape changes

// the pages that show posts, and the only ones that ever cause a pds fetch.
// each also needs its path in /_routes.json
export const POST_PAGES = new Set(["/", "/blog/", "/posts/"]);

// fills each [data-posts] on the page: "highlight" (the newest, as a card),
// "all", or a number. what's inside it is the fallback, kept if the pds
// can't be read
export async function withPosts(context) {
    const { request } = context;

    // the file never changes, so a 304 would show stale posts
    const fresh = new Request(request);
    fresh.headers.delete("If-None-Match");
    fresh.headers.delete("If-Modified-Since");
    const response = await context.next(fresh);
    if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

    let items = null;
    try {
        items = await cachedItems(context);
    } catch {}
    if (items === null) return response;

    const page = new HTMLRewriter()
        .on("[data-posts]", {
            element(el) {
                el.setInnerContent(render(items, el.getAttribute("data-posts")), { html: true });
            },
        })
        .transform(response);

    const out = new Response(page.body, page);
    out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    out.headers.delete("ETag");
    return out;
}

function render(items, mode) {
    if (items.length === 0) return `<p class="meta">nothing posted yet.</p>`;
    if (mode === "highlight") return renderHighlight(items[0]);
    const shown = mode === "all" ? items : items.slice(0, Number(mode) || 3);
    return shown.map(renderItem).join("\n");
}

// ---------------------------------------------------------------------------
// cache

// every post, or null for the fallback
async function cachedItems(context) {
    const cache = caches.default;
    const key = new Request(new URL(CACHE_KEY, context.request.url));
    const hit = await cache.match(key);
    const age = hit ? (Date.now() - Number(hit.headers.get("X-Fetched-At"))) / 1000 : Infinity;
    if (hit && age < FRESH) return hit.json();

    const refresh = loadItems(AbortSignal.timeout(FETCH_TIMEOUT)).then(async (items) => {
        // kept a day so a pds outage serves old posts, not the fallback
        const stored = new Response(JSON.stringify(items), {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=86400",
                "X-Fetched-At": String(Date.now()),
            },
        });
        await cache.put(key, stored);
        return items;
    });
    context.waitUntil(refresh.catch(() => {}));

    if (hit) return hit.json();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), WAIT));
    return Promise.race([refresh.catch(() => null), timeout]);
}

// ---------------------------------------------------------------------------
// data

// every post and repost, newest first, each with the appview's copy of the
// post (`view`, missing if the appview failed). throws if the pds can't be read
async function loadItems(signal) {
    const [posts, reposts] = await Promise.all([
        listRecords("app.bsky.feed.post", signal),
        listRecords("app.bsky.feed.repost", signal),
    ]);

    const items = [
        ...posts
            .filter((r) => typeof r.value?.text === "string" && !r.value.reply)
            .map((r) => ({ rkey: rkeyOf(r.uri), uri: r.uri, createdAt: r.value.createdAt, record: r.value })),
        ...reposts
            .filter((r) => typeof r.value?.subject?.uri === "string")
            .map((r) => ({ rkey: rkeyOf(r.uri), uri: r.value.subject.uri, createdAt: r.value.createdAt, repost: true })),
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const views = await getPosts(items.map((i) => i.uri), signal);
    for (const item of items) item.view = views.get(item.uri);
    return items;
}

async function listRecords(collection, signal) {
    const records = [];
    let cursor;
    do {
        const url = new URL("/xrpc/com.atproto.repo.listRecords", PDS);
        url.searchParams.set("repo", DID);
        url.searchParams.set("collection", collection);
        url.searchParams.set("limit", "100");
        if (cursor) url.searchParams.set("cursor", cursor);
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`listRecords ${collection}: ${res.status}`);
        const page = await res.json();
        records.push(...(page.records ?? []));
        cursor = page.records?.length ? page.cursor : undefined;
    } while (cursor);
    return records;
}

// the appview's hydrated copy of each post, by uri, 25 per call. whatever
// it returned before failing
async function getPosts(uris, signal) {
    const views = new Map();
    try {
        for (let i = 0; i < uris.length; i += 25) {
            const url = new URL("/xrpc/app.bsky.feed.getPosts", APPVIEW);
            for (const uri of uris.slice(i, i + 25)) url.searchParams.append("uris", uri);
            const res = await fetch(url, { signal });
            if (!res.ok) break;
            for (const view of (await res.json()).posts ?? []) views.set(view.uri, view);
        }
    } catch {}
    return views;
}

function rkeyOf(uri) {
    return uri.split("/").pop();
}

// ---------------------------------------------------------------------------
// rendering

// one post on / or /posts/. the time is its permalink on /posts/; replying
// happens on bluesky. a repost shows the original in a panel
function renderItem(item) {
    const { view } = item;
    const href = postHref(item.uri);
    const lines = [
        `<article class="post-item${item.repost ? " post-item--repost" : ""}" id="${esc(item.rkey)}">`,
        `    <p class="post-item-meta">`,
        `        <span>${item.repost ? `<span class="post-item-label">reposted</span> ` : ""}<a class="post-item-time" href="/posts/#${esc(item.rkey)}"><time datetime="${esc(item.createdAt)}">${formatDate(item.createdAt)}</time></a></span>`,
        `        <a class="post-item-reply" href="${href}">reply on bluesky</a>`,
        `    </p>`,
    ];

    if (!item.repost) {
        lines.push(...body(item.record, view, href));
    } else if (typeof view?.record?.text !== "string") {
        lines.push(`    <p class="post-item-note"><a href="${href}">reposted post &rarr; view on bluesky</a></p>`);
    } else {
        lines.push(
            `    <div class="post-item-repost">`,
            `        <p class="post-item-card-meta">${author(view.author)}</p>`,
            ...body(view.record, view, href).map((l) => `    ${l}`),
            `    </div>`,
        );
    }

    lines.push(`</article>`);
    return lines.join("\n");
}

// the newest post on /blog/: a small card, text only, linking to it on /posts/
function renderHighlight(item) {
    const record = item.repost ? item.view?.record : item.record;
    const who = item.repost ? `${item.view?.author?.displayName || item.view?.author?.handle || ""}: ` : "";
    const extras = attachments(item.view?.embed);
    const text = record?.text?.trim() || extras.join(", ") || "view post";
    return [
        `<a class="post-card" href="/posts/#${esc(item.rkey)}">`,
        `    <span class="post-card-meta">`,
        `        <span>${item.repost ? "&#8635; reposted" : "@" + HANDLE}</span>`,
        `        <time datetime="${esc(item.createdAt)}">${formatDate(item.createdAt)}</time>`,
        `    </span>`,
        `    <span class="post-card-text">${escText(who + text)}</span>`,
        extras.length ? `    <span class="post-card-extra">${escText(extras.join(" · "))}</span>` : null,
        `</a>`,
    ].filter((l) => l !== null).join("\n");
}

// "2 images", "video", "link", "quote"
function attachments(embed) {
    switch (embed?.$type) {
        case "app.bsky.embed.images#view": {
            const n = embed.images?.length || 0;
            return n ? [n === 1 ? "1 image" : `${n} images`] : [];
        }
        case "app.bsky.embed.video#view":
            return ["video"];
        case "app.bsky.embed.external#view":
            return ["link"];
        case "app.bsky.embed.record#view":
            return ["quote"];
        case "app.bsky.embed.recordWithMedia#view":
            return [...attachments(embed.media), "quote"];
        default:
            return [];
    }
}

// text, then whatever is attached. with no appview copy, attachments are a link
function body(record, view, href) {
    const lines = [];
    if (record.text.trim()) {
        lines.push(`    <p class="post-item-body">${renderText(record.text, record.facets)}</p>`);
    }
    if (view?.embed) {
        lines.push(...renderEmbed(view.embed, href).map((l) => `    ${l}`));
    } else if (record.embed) {
        lines.push(`    <p class="post-item-note"><a href="${href}">attachment &rarr; view on bluesky</a></p>`);
    }
    return lines;
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
        const link = facetHref(facet.features[0]);
        out += link ? `<a href="${esc(link)}">${label}</a>` : label;
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

// the appview's embed views. images are its thumbnails, never full size
function renderEmbed(embed, href) {
    switch (embed.$type) {
        case "app.bsky.embed.images#view":
            return renderImages(embed.images);
        case "app.bsky.embed.video#view":
            return renderVideo(embed, href);
        case "app.bsky.embed.external#view":
            return renderCard(embed.external);
        case "app.bsky.embed.record#view":
            return renderQuote(embed.record);
        case "app.bsky.embed.recordWithMedia#view":
            return [...renderEmbed(embed.media, href), ...renderQuote(embed.record?.record)];
        default:
            return [];
    }
}

// one image keeps its shape; two or more go in a cropped grid
function renderImages(images = []) {
    const imgs = images
        .filter((img) => isHttps(img.thumb))
        .map((img) => `<img src="${esc(img.thumb)}" alt="${esc(img.alt || "")}"${sizeAttrs(img.aspectRatio)} loading="lazy" decoding="async" />`);
    if (imgs.length === 0) return [];
    const cls = imgs.length === 1 ? "post-item-media" : "post-item-media post-item-media--grid";
    return [`<div class="${cls}">`, ...imgs.map((i) => `    ${i}`), `</div>`];
}

// the thumbnail with a play mark; it plays on bluesky
function renderVideo(embed, href) {
    if (!isHttps(embed.thumbnail)) {
        return [`<p class="post-item-note"><a href="${href}">video &rarr; watch on bluesky</a></p>`];
    }
    const alt = embed.alt ? `${embed.alt} (video, plays on bluesky)` : "video, plays on bluesky";
    return [
        `<a class="post-item-video" href="${href}">`,
        `    <img src="${esc(embed.thumbnail)}" alt="${esc(alt)}"${sizeAttrs(embed.aspectRatio)} loading="lazy" decoding="async" />`,
        `</a>`,
    ];
}

function renderCard(external) {
    if (!isHttps(external?.uri, true)) return [];
    const domain = new URL(external.uri).hostname.replace(/^www\./, "");
    return [
        `<a class="post-item-card" href="${esc(external.uri)}">`,
        `    <span class="post-item-card-title">${escText(external.title || domain)}</span>`,
        external.description ? `    <span class="post-item-card-desc">${escText(external.description)}</span>` : null,
        `    <span class="post-item-card-meta">${escText(domain)}</span>`,
        `</a>`,
    ].filter((l) => l !== null);
}

function renderQuote(record) {
    const href = postHref(record?.uri);
    if (!href) return [];
    if (record.$type !== "app.bsky.embed.record#viewRecord" || typeof record.value?.text !== "string") {
        return [`<p class="post-item-note"><a href="${href}">quoting &rarr;</a></p>`];
    }
    return [
        `<a class="post-item-card post-item-quote" href="${href}">`,
        `    <span class="post-item-card-meta">${author(record.author)}</span>`,
        `    <span class="post-item-quote-text">${escText(record.value.text)}</span>`,
        `</a>`,
    ];
}

function author(a = {}) {
    const name = a.displayName || a.handle || "";
    return `${escText(name)} <span>@${escText(a.handle || "")}</span>`;
}

// at://did/app.bsky.feed.post/rkey -> https://bsky.app/profile/<handle or did>/post/rkey
function postHref(uri) {
    const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri || "");
    if (!match) return null;
    const who = match[1] === DID ? HANDLE : match[1];
    return `https://bsky.app/profile/${who}/post/${match[2]}`;
}

function isHttps(url, orHttp = false) {
    return typeof url === "string" && (orHttp ? /^https?:\/\// : /^https:\/\//).test(url);
}

function sizeAttrs(ratio) {
    return ratio?.width && ratio?.height ? ` width="${ratio.width}" height="${ratio.height}"` : "";
}

// 8 Oct 2026, 1:42 pm
function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const day = d.toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).toLowerCase();
    return `${day}, ${time}`;
}

function escText(s) {
    return esc(s).replace(/\n/g, "<br />");
}

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
