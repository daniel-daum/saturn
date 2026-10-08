// runs in front of /about/, /now/*, /blog/* and /api/* (see _routes.json).
// on likeable pages it reads likes and approved comments from d1 and writes
// them into the page's [data-social] placeholder. if anything fails, the
// page is served untouched with its fallback text.

import { isLikeable, voterId } from "./_lib/likes.js";
import { renderComments } from "./_lib/comments.js";

export async function onRequest(context) {
    const { request, env } = context;
    const { pathname } = new URL(request.url);
    if (!isLikeable(pathname)) {
        return context.next();
    }

    // drop conditional headers: the static file never changes, so the asset
    // server would answer 304 and the browser would show a stale count
    const fresh = new Request(request);
    fresh.headers.delete("If-None-Match");
    fresh.headers.delete("If-Modified-Since");
    const response = await context.next(fresh);

    if (!(response.headers.get("content-type") || "").includes("text/html")) {
        return response;
    }

    let voter;
    try {
        voter = await voterId(env.SOCIAL_SECRET, request);
    } catch {
        return response;
    }

    const page = new HTMLRewriter()
        .on("[data-social]", {
            async element(el) {
                // the placeholder can name another page, e.g. /now/ shows
                // /now/sep-2026/'s likes and comments. empty means this page.
                const key = el.getAttribute("data-social") || pathname;
                if (!isLikeable(key)) {
                    return;
                }
                try {
                    const [count, liked, comments] = await env.DB.batch([
                        env.DB.prepare("SELECT count FROM Likes WHERE page = ?").bind(key),
                        env.DB.prepare("SELECT 1 FROM LikeVoters WHERE page = ? AND voter = ?").bind(key, voter),
                        env.DB
                            .prepare("SELECT id, parent, name, body, is_author, created_at FROM Comments WHERE page = ? AND approved = 1 ORDER BY created_at")
                            .bind(key),
                    ]);
                    const likes = {
                        count: Number(count.results[0]?.count ?? 0),
                        liked: liked.results.length > 0,
                    };
                    const { title, thread, foot } = renderComments(key, comments.results);
                    el.setInnerContent(
                        `<div class="social-head"><h2 class="social-title">${title}</h2>${renderLikes(key, likes)}</div>${thread}${foot}`,
                        { html: true }
                    );
                } catch {
                    // leave the fallback text
                }
            },
        })
        .transform(response);

    // the like state is per visitor and changes on submit, so the back button
    // must not show a cached copy
    const out = new Response(page.body, page);
    out.headers.set("Cache-Control", "private, no-cache");
    out.headers.delete("ETag");
    return out;
}

// key already passed isLikeable(), so it is [a-z0-9-/] only and safe to
// write into the page as-is
function renderLikes(key, { count, liked }) {
    const noun = count === 1 ? "like" : "likes";
    const label = liked ? `you liked this post, ${count} ${noun}` : `like this post, ${count} ${noun}`;
    const state = liked ? ` disabled aria-pressed="true"` : "";
    return `<form class="like-form" id="likes" method="POST" action="/api/like">
    <input type="hidden" name="path" value="${key}" />
    <button type="submit" class="like-button" aria-label="${label}"${state}>${HEART} ${count}</button>
</form>`;
}

// outline by default, filled once liked (see .like-icon in global.css).
// path from feather icons, mit
const HEART = `<svg class="like-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>`;
