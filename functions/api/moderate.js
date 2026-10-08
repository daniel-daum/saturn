// /api/moderate: the link in a new-comment email lands here.
// GET only shows the comment with approve / delete buttons, because mail apps
// and link scanners open links on their own. the buttons POST. both need the
// signature from the email, so nobody else can use this page.

import { hmacMatches } from "../_lib/hmac.js";
import { bodyHtml, escapeHtml } from "../_lib/comments.js";

const ID_RE = /^[0-9a-f-]{36}$/;

export async function onRequestGet({ request, env }) {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const sig = params.get("sig");
    if (!(await authorized(env, id, sig))) {
        return forbidden();
    }

    const comment = await env.DB.prepare("SELECT page, name, body, approved FROM Comments WHERE id = ?").bind(id).first();
    if (!comment) {
        return page(`<p>This comment has already been deleted.</p>`);
    }

    const hidden = `<input type="hidden" name="id" value="${id}" /><input type="hidden" name="sig" value="${escapeHtml(sig)}" />`;
    return page(`
            <p class="meta">${escapeHtml(comment.name)} on <a href="${comment.page}">${comment.page}</a>, ${comment.approved ? "approved" : "waiting for approval"}</p>
            <blockquote>${bodyHtml(comment.body)}</blockquote>
            <div class="moderate-actions">
                ${comment.approved ? "" : `<form method="POST">${hidden}<button class="like-button" name="action" value="approve">approve</button></form>`}
                <form method="POST">${hidden}<button class="like-button" name="action" value="delete">delete</button></form>
            </div>`);
}

export async function onRequestPost({ request, env }) {
    let form;
    try {
        form = await request.formData();
    } catch {
        return forbidden();
    }
    const id = form.get("id");
    if (!(await authorized(env, id, form.get("sig")))) {
        return forbidden();
    }

    const comment = await env.DB.prepare("SELECT page FROM Comments WHERE id = ?").bind(id).first();
    if (!comment) {
        return page(`<p>This comment has already been deleted.</p>`);
    }

    if (form.get("action") === "approve") {
        await env.DB.prepare("UPDATE Comments SET approved = 1 WHERE id = ?").bind(id).run();
        return new Response(null, { status: 303, headers: { Location: `${comment.page}#comment-${id}` } });
    }

    // gone for good, along with any replies to it
    await env.DB.prepare("DELETE FROM Comments WHERE id = ? OR parent = ?").bind(id, id).run();
    return page(`<p>Deleted. <a href="${comment.page}">Back to the post</a></p>`);
}

async function authorized(env, id, sig) {
    return typeof id === "string" && ID_RE.test(id) && (await hmacMatches(env.SOCIAL_SECRET, "moderate:" + id, sig));
}

function forbidden() {
    return new Response("forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// page paths in d1 passed isLikeable() on the way in, so they are safe to
// write into the page as-is
function page(content) {
    const html = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; font-src 'self';" />
    <meta name="referrer" content="no-referrer" />
    <link rel="stylesheet" href="/global.css" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png" />
    <title>daniel daum - moderate</title>
</head>

<body>
    <main id="main">
        <header class="page-header">
            <h1><span aria-hidden="true">/</span>moderate</h1>
        </header>
        <section>${content}
        </section>
    </main>
</body>

</html>
`;
    return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
}
