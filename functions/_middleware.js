// Cloudflare Pages Functions middleware: injects Bluesky posts from my PDS
// into the static pages at the edge. See MICRO.md for the full write-up.
//
// Blog post pages get a different treatment: like counts and the reply thread
// are read from D1 and rendered into their data-likes / data-replies
// placeholders. See SOCIAL.md. The two paths never overlap: a blog post never
// triggers a PDS request, and a micro page never touches D1.

import { escapeHtml, isBlogPost, voterId } from "./_lib/social.js";

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

// The activity row never wraps: css fades the text out at the right edge, so
// this only caps what is sent, it is not the visible cut.
const ACTIVITY_SNIPPET_LENGTH = 140;

// Blog post likes and replies. Blog post pages match isBlogPost() rather than
// ALLOWED_PATHS, so a new post needs no change here: only the placeholder
// markup in the page (see SOCIAL.md).
const SITE_URL = "https://danieldaum.net";
const REPLY_ADDRESS = "reply@replies.danieldaum.net";
const MAX_THREAD_DEPTH = 6;

export async function onRequest(context) {
    const { pathname } = new URL(context.request.url);
    if (!ALLOWED_PATHS.has(pathname) && !isBlogPost(pathname)) {
        return context.next();
    }

    // Kick the PDS request off before waiting on the asset so the two round
    // trips overlap instead of queueing.
    const pending = isBlogPost(pathname) ? null : fetchPosts();

    let response = await context.next();
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
        return response;
    }

    let posts = null;
    let social = null;
    if (isBlogPost(pathname)) {
        social = await loadSocial(context, pathname);
        if (!social) {
            // D1 unreachable, errored, or the secret is missing: leave the
            // static fallback markup ("LIKES UNAVAILABLE") exactly as written.
            return response;
        }
        // The like count and liked-state are per visitor and change the moment
        // the form is submitted, so the browser must not serve this page from
        // its cache on back navigation.
        response = new Response(response.body, response);
        response.headers.set("Cache-Control", "private, no-cache");
    } else {
        posts = await pending;
        if (!posts) {
            // PDS unreachable, errored, or has no posts: leave the static fallback
            // markup ("NO POSTS YET") exactly as written in the HTML.
            return response;
        }
    }

    return new HTMLRewriter()
        .on("[data-micro]", {
            element(el) {
                if (!posts) {
                    return;
                }
                const mode = el.getAttribute("data-micro");
                const html = render(mode, posts);
                if (html !== null) {
                    el.setInnerContent(html, { html: true });
                }
            },
        })
        .on("[data-likes]", {
            element(el) {
                if (social) {
                    el.setInnerContent(renderLikes(social), { html: true });
                }
            },
        })
        .on("[data-replies]", {
            element(el) {
                if (social) {
                    el.setInnerContent(renderReplies(social), { html: true });
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
            ...mediaFrom(r.value.embed),
        }))
        .filter((p) => p.rkey)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return posts.length > 0 ? posts : null;
}

// Like count, whether this visitor already liked today, and the live reply
// rows for one blog post. Returns null on any failure so the page is served
// with its fallback markup: D1 must never break a page.
async function loadSocial(context, pathname) {
    const { env, request } = context;
    try {
        const voter = await voterId(env.SOCIAL_SECRET, request);
        const [likes, liked, replies] = await env.DB.batch([
            env.DB.prepare("SELECT count FROM Likes WHERE page = ?").bind(pathname),
            env.DB.prepare("SELECT 1 FROM LikeVoters WHERE page = ? AND voter = ?").bind(pathname, voter),
            env.DB
                .prepare(
                    "SELECT guid, parent, name, message, created_at FROM Replies WHERE url = ? AND approved = 1 AND deleted_at IS NULL ORDER BY created_at ASC"
                )
                .bind(pathname),
        ]);
        return {
            path: pathname,
            count: Number(likes.results[0]?.count ?? 0),
            liked: liked.results.length > 0,
            replies: replies.results,
        };
    } catch {
        return null;
    }
}

function rkeyFromUri(uri) {
    if (typeof uri !== "string") return "";
    const idx = uri.lastIndexOf("/");
    return idx === -1 ? "" : uri.slice(idx + 1);
}

// Media attached to a post: a set of images or one video, the two things the
// Bluesky app can attach. A quote-with-media post carries the same embed one
// level down under `media`, so it is unwrapped here and the quoted record is
// dropped. Anything else (link cards, bare quotes) yields no media.
function mediaFrom(embed) {
    const media = embed?.$type === "app.bsky.embed.recordWithMedia" ? embed.media : embed;
    return { images: imagesFrom(media), video: videoFrom(media) };
}

function imagesFrom(embed) {
    if (!embed || embed.$type !== "app.bsky.embed.images" || !Array.isArray(embed.images)) {
        return [];
    }
    return embed.images
        .map((img) => ({ cid: img?.image?.ref?.$link, alt: img?.alt || "" }))
        .filter((img) => typeof img.cid === "string" && img.cid.length > 0);
}

// The aspect ratio is optional on the record; when present it is written
// out as width/height attributes so the box is reserved before the video's
// metadata has loaded and the page does not jump.
function videoFrom(embed) {
    if (!embed || embed.$type !== "app.bsky.embed.video") {
        return null;
    }
    const cid = embed.video?.ref?.$link;
    if (typeof cid !== "string" || cid.length === 0) {
        return null;
    }
    const ratio = embed.aspectRatio;
    const width = Number.isInteger(ratio?.width) && ratio.width > 0 ? ratio.width : 0;
    const height = Number.isInteger(ratio?.height) && ratio.height > 0 ? ratio.height : 0;
    return { cid, alt: typeof embed.alt === "string" ? embed.alt : "", width, height };
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
            return renderActivityItem(posts);
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
    const video = post.video ? renderVideo(post.video) : "";

    return [
        `<article${id} class="${cls}">`,
        `    <p class="meta">`,
        `        <span class="micro-at">@${escapeHtml(HANDLE)}</span>`,
        `        <a class="micro-time" href="${href}"><time datetime="${escapeHtml(post.createdAt)}">${formatTimestamp(post.createdAt)}</time></a>`,
        `    </p>`,
        `    <p class="micro-body">${formatBody(post.text)}</p>`,
        images ? `    ${images}` : null,
        video ? `    ${video}` : null,
        `</article>`,
    ]
        .filter((line) => line !== null)
        .join("\n");
}

// One row for the newest post. When several posts landed on the same
// (Pacific) day the label counts them; the text is always the newest one.
function renderActivityItem(posts) {
    const post = posts[0];
    const day = dayKey(post.createdAt);
    const sameDay = posts.filter((p) => dayKey(p.createdAt) === day).length;
    const label = sameDay > 1 ? `${sameDay} NEW MICRO POSTS` : "NEW MICRO POST";
    const href = `/blog/micro/#${escapeHtml(post.rkey)}`;
    return [
        `<span class="activity-icon" aria-hidden="true">&#9670;</span>`,
        `<a class="activity-link" href="${href}">${label} &mdash; ${snippet(post.text)}</a>`,
        `<span class="activity-date">${formatActivityDate(post.createdAt)}</span>`,
    ].join("\n");
}

// Not autoplayed and not muted: it is a post attachment, the visitor presses
// play. `playsinline` keeps iOS from taking over the screen on tap. The link
// inside is what a browser without <video> support gets.
function renderVideo(video) {
    const src = mediaUrl(video.cid);
    const size = video.width && video.height ? ` width="${video.width}" height="${video.height}"` : "";
    const label = video.alt ? ` aria-label="${escapeHtml(video.alt)}"` : "";
    return `<video class="micro-video" src="${src}"${size}${label} controls playsinline preload="metadata"><a href="${src}">VIDEO</a></video>`;
}

function blobUrl(cid) {
    const url = new URL("/xrpc/com.atproto.sync.getBlob", PDS_HOST);
    url.searchParams.set("did", REPO_DID);
    url.searchParams.set("cid", cid);
    return escapeHtml(url.toString());
}

// Video is served through /media/<cid> (functions/media/[cid].js) rather than
// straight from the PDS: the PDS ignores Range requests, and Safari will not
// play a video it cannot seek. Images keep going to the PDS directly.
function mediaUrl(cid) {
    return escapeHtml(`/media/${encodeURIComponent(cid)}`);
}

// ---------------------------------------------------------------------------
// rendering: likes and replies

function renderLikes({ path, count, liked }) {
    const heart = liked ? "&#9829;" : "&#9825;";
    const state = liked ? ` disabled aria-pressed="true"` : "";
    // the visible label is a heart and a number, so spell it out for
    // screen readers, count included
    const likes = count === 1 ? "1 like" : `${count} likes`;
    const label = liked ? `you liked this post, ${likes}` : `like this post, ${likes}`;
    return [
        `<form class="like-form" method="POST" action="/api/like">`,
        `    <input type="hidden" name="path" value="${escapeHtml(path)}" />`,
        `    <button type="submit" class="like-button" aria-label="${label}"${state}>${heart} <span class="like-count">${count}</span></button>`,
        `</form>`,
    ].join("\n");
}

function renderReplies({ path, replies }) {
    const n = replies.length;
    const label = n === 0 ? "NO REPLIES YET" : n === 1 ? "1 REPLY" : `${n} REPLIES`;
    const head = [
        `<div class="reply-head">`,
        `    <p class="meta">${label}</p>`,
        `    <a class="reply-link" href="${replyHref(path, null)}">REPLY BY EMAIL &rarr;</a>`,
        `</div>`,
    ];
    if (n === 0) {
        return head.join("\n");
    }
    const byParent = groupByParent(replies);
    return head.concat(renderThread(byParent, null, path, 0, new Set(), "")).join("\n");
}

// Children keyed by parent guid. A reply whose parent is gone (deleted, or
// never existed) is re-parented to the top level rather than dropped.
function groupByParent(replies) {
    const live = new Set(replies.map((r) => r.guid));
    const byParent = new Map();
    for (const r of replies) {
        const key = r.parent && live.has(r.parent) ? r.parent : null;
        if (!byParent.has(key)) {
            byParent.set(key, []);
        }
        byParent.get(key).push(r);
    }
    return byParent;
}

// One <ol class="reply-thread"> for the children of `parent`. Nesting stops at
// MAX_THREAD_DEPTH: anything deeper is flattened into the list at that depth
// so it still renders. `visited` guards against cycles in the parent column.
function renderThread(byParent, parent, path, depth, visited, indent) {
    const flatten = depth >= MAX_THREAD_DEPTH;
    const items = (flatten ? descendants(byParent, parent, visited) : byParent.get(parent) || []).filter(
        (r) => !visited.has(r.guid)
    );
    if (items.length === 0) {
        return [];
    }
    const lines = [`${indent}<ol class="reply-thread">`];
    for (const r of items) {
        visited.add(r.guid);
        const id = `reply-${escapeHtml(r.guid)}`;
        const children = flatten ? [] : renderThread(byParent, r.guid, path, depth + 1, visited, `${indent}        `);
        lines.push(
            `${indent}    <li>`,
            `${indent}        <article id="${id}" class="reply">`,
            `${indent}            <p class="meta">`,
            `${indent}                <span class="reply-name">${escapeHtml(r.name)}</span>`,
            `${indent}                <a class="reply-time" href="#${id}"><time datetime="${escapeHtml(r.created_at)}">${formatTimestamp(r.created_at)}</time></a>`,
            `${indent}            </p>`,
            `${indent}            <p class="reply-body">${formatBody(r.message)}</p>`,
            `${indent}            <a class="reply-link" href="${replyHref(path, r.guid)}">REPLY &rarr;</a>`,
            ...children,
            `${indent}        </article>`,
            `${indent}    </li>`
        );
    }
    lines.push(`${indent}</ol>`);
    return lines;
}

// Every reply below `parent`, depth first, in thread order.
function descendants(byParent, parent, visited) {
    const out = [];
    const stack = [...(byParent.get(parent) || [])].reverse();
    const seen = new Set(visited);
    while (stack.length > 0) {
        const r = stack.pop();
        if (seen.has(r.guid)) {
            continue;
        }
        seen.add(r.guid);
        out.push(r);
        const kids = byParent.get(r.guid) || [];
        for (let i = kids.length - 1; i >= 0; i--) {
            stack.push(kids[i]);
        }
    }
    return out;
}

// mailto: link with the post URL as the subject. Replying to a specific reply
// carries its guid as a URL fragment in the subject; the inbound email worker
// parses it back out to thread the comment.
function replyHref(path, parentGuid) {
    // path is /blog/<slug>/ and the guid is a UUID, so neither needs encoding;
    // only the space and the "#" do.
    let href = `mailto:${REPLY_ADDRESS}?subject=re:%20${SITE_URL}${path}`;
    if (parentGuid) {
        href += `%23${parentGuid}`;
    }
    return escapeHtml(href);
}

// ---------------------------------------------------------------------------
// text helpers

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

// "2026-09-03" in the site's time zone, for grouping posts by day.
function dayKey(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const parts = partsOf(
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
        date
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
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
// - quote posts (app.bsky.embed.record): the quoted record is ignored, only
//   the text shows. quote-with-media keeps its images or video, drops the quote
// - external link cards (app.bsky.embed.external)
// - threading: replies are filtered out entirely, thread structure is ignored
