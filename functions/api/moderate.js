// /api/moderate: the delete link from a reply notification email lands here.
// See SOCIAL.md.
//
// GET renders a confirm page and never mutates anything, because mail clients
// and link scanners prefetch URLs. Only the POST from the confirm page's form
// performs the delete. Both require a valid signature over the reply guid.

import { hmacHex, safeEqual } from "../_lib/social.js";

const GUID_RE = /^[0-9a-f-]{36}$/;
const PREVIEW_LENGTH = 200;

export async function onRequestGet(context) {
    const { searchParams } = new URL(context.request.url);
    const id = searchParams.get("id");
    const sig = searchParams.get("sig");
    if (!(await authorized(context.env, id, sig))) {
        return forbidden();
    }

    const reply = await lookup(context.env, id);
    if (!reply || reply.deleted_at !== null) {
        return page("MODERATE", [
            `<p>No such reply, or it has already been deleted.</p>`,
            reply ? `<p><a href="${escapeHtml(reply.url)}">BACK TO THE POST &rarr;</a></p>` : null,
        ]);
    }

    return page("MODERATE", [
        `<p class="meta">DELETE THIS REPLY?</p>`,
        `<article class="reply">`,
        `    <p class="meta">`,
        `        <span class="reply-name">${escapeHtml(reply.name)}</span>`,
        `        <a class="reply-time" href="${escapeHtml(reply.url)}#reply-${escapeHtml(reply.guid)}">${escapeHtml(reply.url)}</a>`,
        `    </p>`,
        `    <p class="reply-body">${escapeHtml(preview(reply.message))}</p>`,
        `</article>`,
        `<form class="moderate-form" method="POST" action="/api/moderate">`,
        `    <input type="hidden" name="id" value="${escapeHtml(id)}" />`,
        `    <input type="hidden" name="sig" value="${escapeHtml(sig)}" />`,
        `    <button type="submit" class="moderate-button">DELETE</button>`,
        `</form>`,
    ]);
}

export async function onRequestPost(context) {
    let form;
    try {
        form = await context.request.formData();
    } catch {
        return forbidden();
    }
    const id = form.get("id");
    const sig = form.get("sig");
    if (!(await authorized(context.env, id, sig))) {
        return forbidden();
    }

    const reply = await lookup(context.env, id);
    if (!reply) {
        return page("MODERATE", [`<p>No such reply.</p>`]);
    }

    await context.env.DB
        .prepare("UPDATE Replies SET deleted_at = datetime('now') WHERE guid = ? AND deleted_at IS NULL")
        .bind(id)
        .run();

    return page("MODERATE", [
        `<p>Reply deleted. <a href="${escapeHtml(reply.url)}">BACK TO THE POST &rarr;</a></p>`,
    ]);
}

// ---------------------------------------------------------------------------
// auth and data

async function authorized(env, id, sig) {
    if (typeof id !== "string" || !GUID_RE.test(id) || typeof sig !== "string") {
        return false;
    }
    const expected = await hmacHex(env.SOCIAL_SECRET, "delete:" + id);
    return safeEqual(sig, expected);
}

async function lookup(env, id) {
    const row = await env.DB
        .prepare("SELECT guid, url, name, message, deleted_at FROM Replies WHERE guid = ?")
        .bind(id)
        .first();
    return row || null;
}

function forbidden() {
    return new Response("forbidden", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
}

// ---------------------------------------------------------------------------
// rendering

function preview(message) {
    const flat = String(message).replace(/\s+/g, " ").trim();
    return flat.length > PREVIEW_LENGTH ? flat.slice(0, PREVIEW_LENGTH) + "…" : flat;
}

// Same head, header and CSP as every static page on the site.
function page(title, lines) {
    const body = lines.filter((line) => line !== null).join("\n            ");
    const html = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' https://assets.danieldaum.net; media-src 'self' https://assets.danieldaum.net;" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="stylesheet" href="/global.css" />
    <link rel="icon" type="image/jpeg" href="/assets/favicon/coast.jpeg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-touch-icon.png" />
    <title>daniel daum - ${escapeHtml(title.toLowerCase())}</title>
</head>

<body>
    <header class="site-header">
        <a class="site-name" href="/" aria-label="return home">DANIEL DAUM</a>
        <nav aria-label="main navigation">
            <a href="/" aria-label="return home">HOME</a>
            <a href="/about" aria-label="about me">ABOUT</a>
            <a href="/now" aria-label="now page">NOW</a>
            <a href="/blog" aria-label="blog">BLOG</a>
            <a href="/projects" aria-label="projects">PROJECTS</a>
            <a href="/garden" aria-label="garden">GARDEN</a>
        </nav>
    </header>

    <main>
        <section class="hero">
            <h1>/${escapeHtml(title)}</h1>
        </section>
        <section class="post-social">
            ${body}
        </section>
    </main>
</body>

</html>
`;
    return new Response(html, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store",
        },
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
