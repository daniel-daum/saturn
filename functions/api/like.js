// POST /api/like: records one like for a blog post and redirects back to it.
// Plain HTML form target, no JavaScript. See SOCIAL.md.
//
// There is deliberately no onRequestGet: a GET to this path falls through to
// the platform's 405 so link prefetchers and crawlers can never add a like.

import { isBlogPost, voterId } from "../_lib/social.js";

// LikeVoters rows only need to live for the day they were created; keep two
// days so a purge never races the UTC rollover.
const VOTER_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
    const { request, env } = context;

    let form;
    try {
        form = await request.formData();
    } catch {
        return plain("bad request", 400);
    }

    const path = form.get("path");
    if (typeof path !== "string" || !isBlogPost(path)) {
        return plain("bad request", 400);
    }

    // Refuse to create counter rows for pages that do not exist.
    const { origin } = new URL(request.url);
    const page = await env.ASSETS.fetch(new Request(origin + path));
    if (page.status !== 200) {
        return plain("not found", 404);
    }

    const now = new Date();
    const voter = await voterId(env.SOCIAL_SECRET, request);
    const cutoff = new Date(now.getTime() - VOTER_TTL_MS).toISOString();

    // ---------------------------------------------------------------------------
    // record

    const [inserted] = await env.DB.batch([
        env.DB
            .prepare("INSERT OR IGNORE INTO LikeVoters (page, voter, created_at) VALUES (?, ?, ?)")
            .bind(path, voter, now.toISOString()),
        // opportunistic purge of stale voter rows on every call
        env.DB.prepare("DELETE FROM LikeVoters WHERE created_at < ?").bind(cutoff),
    ]);

    // A repeat like from the same voter is a silent no-op, never an error.
    if (inserted.meta.changes === 1) {
        await env.DB
            .prepare(
                "INSERT INTO Likes (page, count) VALUES (?, 1) ON CONFLICT(page) DO UPDATE SET count = count + 1"
            )
            .bind(path)
            .run();
    }

    return new Response(null, {
        status: 303,
        headers: { Location: path + "#likes" },
    });
}

function plain(body, status) {
    return new Response(body, {
        status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
}
