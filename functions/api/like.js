// POST /api/like: records one like and sends the visitor back to the post.
// there is no GET handler on purpose, so crawlers and link prefetchers can
// never add a like.

import { isLikeable, voterId } from "../_lib/likes.js";

// voter rows only matter for the day they were made; keep two days so the
// purge never races utc midnight
const VOTER_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
    const { request, env } = context;

    let path;
    try {
        path = (await request.formData()).get("path");
    } catch {
        return plain("bad request", 400);
    }
    if (typeof path !== "string" || !isLikeable(path)) {
        return plain("bad request", 400);
    }

    // no counter rows for pages that don't exist
    const { origin } = new URL(request.url);
    const exists = await env.ASSETS.fetch(new Request(origin + path));
    if (exists.status !== 200) {
        return plain("not found", 404);
    }

    const now = new Date();
    const voter = await voterId(env.SOCIAL_SECRET, request);
    const cutoff = new Date(now.getTime() - VOTER_TTL_MS).toISOString();

    const [inserted] = await env.DB.batch([
        env.DB
            .prepare("INSERT OR IGNORE INTO LikeVoters (page, voter, created_at) VALUES (?, ?, ?)")
            .bind(path, voter, now.toISOString()),
        env.DB.prepare("DELETE FROM LikeVoters WHERE created_at < ?").bind(cutoff),
    ]);

    // a repeat like today is a silent no-op
    if (inserted.meta.changes === 1) {
        await env.DB
            .prepare("INSERT INTO Likes (page, count) VALUES (?, 1) ON CONFLICT(page) DO UPDATE SET count = count + 1")
            .bind(path)
            .run();
    }

    return new Response(null, { status: 303, headers: { Location: path + "#likes" } });
}

function plain(body, status) {
    return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
