// POST /api/like. no GET, so crawlers and prefetchers can't like

import { isLikeable, voterId } from "../../lib.js";

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

export async function onRequestPost({ request, env }) {
    let path;
    try {
        path = (await request.formData()).get("path");
    } catch {
        return plain("bad request", 400);
    }
    if (typeof path !== "string" || !isLikeable(path)) return plain("bad request", 400);

    // no rows for pages that don't exist
    const exists = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
    if (exists.status !== 200) return plain("not found", 404);

    const now = new Date();
    const voter = await voterId(env.SOCIAL_SECRET, request);
    const [inserted] = await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO LikeVoters (page, voter, created_at) VALUES (?, ?, ?)").bind(path, voter, now.toISOString()),
        env.DB.prepare("DELETE FROM LikeVoters WHERE created_at < ?").bind(new Date(now - TWO_DAYS).toISOString()),
    ]);

    // a second like today does nothing
    if (inserted.meta.changes === 1) {
        await env.DB.prepare("INSERT INTO Likes (page, count) VALUES (?, 1) ON CONFLICT(page) DO UPDATE SET count = count + 1").bind(path).run();
    }

    return new Response(null, { status: 303, headers: { Location: path + "#likes" } });
}

function plain(body, status) {
    return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
