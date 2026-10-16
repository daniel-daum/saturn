// fills [data-social] with likes and comments from d1. if anything fails the
// page keeps its fallback text. runs on the paths in /_routes.json

import { isLikeable, voterId, renderSocial } from "../lib.js";

export async function onRequest(context) {
    const { request, env } = context;
    const { pathname } = new URL(request.url);
    if (!isLikeable(pathname)) return context.next();

    // the file never changes, so a 304 would show stale counts
    const fresh = new Request(request);
    fresh.headers.delete("If-None-Match");
    fresh.headers.delete("If-Modified-Since");
    const response = await context.next(fresh);
    if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

    let voter;
    try {
        voter = await voterId(env.SOCIAL_SECRET, request);
    } catch {
        return response;
    }

    const page = new HTMLRewriter()
        .on("[data-social]", {
            async element(el) {
                // /now/ shows the current edition's, e.g. data-social="/now/sep-2026/"
                const key = el.getAttribute("data-social") || pathname;
                if (!isLikeable(key)) return;
                try {
                    const [count, liked, comments] = await env.DB.batch([
                        env.DB.prepare("SELECT count FROM Likes WHERE page = ?").bind(key),
                        env.DB.prepare("SELECT 1 FROM LikeVoters WHERE page = ? AND voter = ?").bind(key, voter),
                        env.DB.prepare("SELECT id, parent, name, body, is_author, created_at FROM Comments WHERE page = ? AND approved = 1 ORDER BY created_at").bind(key),
                    ]);
                    const likes = { count: Number(count.results[0]?.count ?? 0), liked: liked.results.length > 0 };
                    el.setInnerContent(renderSocial(key, likes, comments.results), { html: true });
                } catch {}
            },
        })
        .transform(response);

    // per visitor, so no shared or back-button copies
    const out = new Response(page.body, page);
    out.headers.set("Cache-Control", "private, no-cache");
    out.headers.delete("ETag");
    return out;
}
