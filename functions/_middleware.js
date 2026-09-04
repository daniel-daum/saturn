// Cloudflare Pages Functions middleware: injects Bluesky posts from my PDS
// into the static pages at the edge. See MICRO.md for the full write-up.

const PDS_HOST = "https://atproto.danieldaum.net";
const REPO_DID = "did:plc:be2e4qfe6docqcysyxxwvsor";
const HANDLE = "danieldaum.net";
const LIMIT = 50;
const CACHE_TTL = 60;
const TZ = "America/Los_Angeles";

// Only these paths ever trigger a PDS request. Every other page on the site is
// passed through untouched. Adding a new injection point means adding a
// data-micro element to the page AND adding its path(s) here.
const ALLOWED_PATHS = new Set([
    "/",
    "/index.html",
    "/blog",
    "/blog/",
    "/blog/index.html",
    "/blog/micro",
    "/blog/micro/",
    "/blog/micro/index.html",
]);

const ACTIVITY_SNIPPET_LENGTH = 48;

export async function onRequest(context) {
    const { pathname } = new URL(context.request.url);
    if (!ALLOWED_PATHS.has(pathname)) {
        return context.next();
    }

    const response = await context.next();
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
        return response;
    }

    const posts = await fetchPosts();
    if (!posts) {
        // PDS unreachable, errored, or has no posts: leave the static fallback
        // markup ("NO POSTS YET") exactly as written in the HTML.
        return response;
    }

    return new HTMLRewriter()
        .on("[data-micro]", {
            element(el) {
                const mode = el.getAttribute("data-micro");
                const html = render(mode, posts);
                if (html !== null) {
                    el.setInnerContent(html, { html: true });
                }
            },
        })
        .transform(response);
}

// ---------------------------------------------------------------------------
// data

async function fetchPosts() {
    const url = new URL("/xrpc/com.atproto.repo.listRecords", PDS_HOST);
    url.searchParams.set("repo", REPO_DID);
    url.searchParams.set("collection", "app.bsky.feed.post");
    url.searchParams.set("limit", String(LIMIT));

    let data;
    try {
        const res = await fetch(url.toString(), {
            cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
        });
        if (!res.ok) {
            return null;
        }
        data = await res.json();
    } catch {
        return null;
    }

    const records = Array.isArray(data?.records) ? data.records : [];
    const posts = records
        .filter((r) => r?.value && typeof r.value.text === "string" && !r.value.reply)
        .map((r) => ({
            rkey: rkeyFromUri(r.uri),
            text: r.value.text,
            createdAt: r.value.createdAt || "",
            images: imagesFrom(r.value.embed),
        }))
        .filter((p) => p.rkey)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return posts.length > 0 ? posts : null;
}

function rkeyFromUri(uri) {
    if (typeof uri !== "string") return "";
    const idx = uri.lastIndexOf("/");
    return idx === -1 ? "" : uri.slice(idx + 1);
}

function imagesFrom(embed) {
    if (!embed || embed.$type !== "app.bsky.embed.images" || !Array.isArray(embed.images)) {
        return [];
    }
    return embed.images
        .map((img) => ({ cid: img?.image?.ref?.$link, alt: img?.alt || "" }))
        .filter((img) => typeof img.cid === "string" && img.cid.length > 0);
}

// ---------------------------------------------------------------------------
// rendering

function render(mode, posts) {
    switch (mode) {
        case "all":
            return posts.map((p) => renderArticle(p, { featured: false })).join("\n");
        case "latest-featured":
            return renderArticle(posts[0], { featured: true });
        case "latest-activity":
            return renderActivityItem(posts[0]);
        default:
            return null;
    }
}

function renderArticle(post, { featured }) {
    const cls = featured ? "micro-post micro-featured" : "micro-post";
    const id = featured ? "" : ` id="${escapeHtml(post.rkey)}"`;
    const href = featured ? `/blog/micro/#${escapeHtml(post.rkey)}` : `#${escapeHtml(post.rkey)}`;

    const images = post.images
        .map(
            (img) =>
                `<img class="micro-img" src="${blobUrl(img.cid)}" alt="${escapeHtml(img.alt)}" loading="lazy" />`
        )
        .join("\n    ");

    return [
        `<article${id} class="${cls}">`,
        `    <p class="meta">`,
        `        <span class="micro-at">@${escapeHtml(HANDLE)}</span>`,
        `        <a class="micro-time" href="${href}"><time datetime="${escapeHtml(post.createdAt)}">${formatTimestamp(post.createdAt)}</time></a>`,
        `    </p>`,
        `    <p class="micro-body">${formatBody(post.text)}</p>`,
        images ? `    ${images}` : null,
        `</article>`,
    ]
        .filter((line) => line !== null)
        .join("\n");
}

function renderActivityItem(post) {
    const href = `/blog/micro/#${escapeHtml(post.rkey)}`;
    return [
        `<span class="activity-icon" aria-hidden="true">&#182;</span>`,
        `<a class="activity-link" href="${href}">NEW MICRO POST &mdash; ${snippet(post.text)}</a>`,
        `<span class="activity-date">${formatActivityDate(post.createdAt)}</span>`,
    ].join("\n");
}

function blobUrl(cid) {
    const url = new URL("/xrpc/com.atproto.sync.getBlob", PDS_HOST);
    url.searchParams.set("did", REPO_DID);
    url.searchParams.set("cid", cid);
    return escapeHtml(url.toString());
}

// ---------------------------------------------------------------------------
// text helpers

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Post text is plain text with real newlines; keep them.
function formatBody(text) {
    return escapeHtml(text).replace(/\r?\n/g, "<br />\n");
}

// One-line excerpt for the homepage activity row: whitespace collapsed,
// truncated on a word boundary, uppercased to match the neighbouring rows.
function snippet(text) {
    const flat = text.replace(/\s+/g, " ").trim();
    if (flat.length <= ACTIVITY_SNIPPET_LENGTH) {
        return escapeHtml(flat.toUpperCase());
    }
    let cut = flat.slice(0, ACTIVITY_SNIPPET_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > ACTIVITY_SNIPPET_LENGTH / 2) {
        cut = cut.slice(0, lastSpace);
    }
    return escapeHtml(cut.toUpperCase()) + "&hellip;";
}

// "1 SEPTEMBER 2026 &middot; 18:42 PDT"
function formatTimestamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return escapeHtml(iso);
    }
    const parts = partsOf(
        new Intl.DateTimeFormat("en-US", {
            timeZone: TZ,
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZoneName: "short",
        }),
        date
    );
    return `${parts.day} ${parts.month.toUpperCase()} ${parts.year} &middot; ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

// "1 SEP"
function formatActivityDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const parts = partsOf(
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, day: "numeric", month: "short" }),
        date
    );
    return `${parts.day} ${parts.month.toUpperCase()}`;
}

function partsOf(formatter, date) {
    const out = {};
    for (const { type, value } of formatter.formatToParts(date)) {
        out[type] = value;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Deliberately NOT implemented in this pass:
//
// - rich text facets: links, mentions and hashtags render as plain text
// - quote posts (app.bsky.embed.record) and quote-with-media
//   (app.bsky.embed.recordWithMedia): the embed is ignored, only the text shows
// - external link cards (app.bsky.embed.external)
// - video embeds (app.bsky.embed.video)
// - threading: replies are filtered out entirely, thread structure is ignored
