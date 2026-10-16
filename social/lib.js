// shared by the pages functions and the email worker

export const SITE = "https://danieldaum.net";
export const REPLY_TO = "reply@replies.danieldaum.net";

// /about/, /now/, /now/<slug>/, /blog/<slug>/, /projects/<slug>/
export function isLikeable(path) {
    return /^\/(about|now)\/$|^\/(blog|now|projects)\/[a-z0-9-]+\/$/.test(path);
}

// ===== hmac =====

export async function hmac(secret, message) {
    if (!secret) throw new Error("SOCIAL_SECRET is not set");
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// constant time
export async function hmacMatches(secret, message, sig) {
    const expected = await hmac(secret, message);
    if (typeof sig !== "string" || sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

// one like per visitor per page per day: ip + browser + date, hashed.
// no cookies, nothing reversible, stops matching at utc midnight
export function voterId(secret, request) {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    return hmac(secret, `${ip}|${ua}|${new Date().toISOString().slice(0, 10)}`);
}

// ===== html =====

export function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// blank lines split paragraphs, single newlines become <br>
export function bodyHtml(body) {
    return body
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br />")}</p>`)
        .join("");
}

// what goes inside [data-social]. key has passed isLikeable(), so it is safe as-is
export function renderSocial(key, likes, rows) {
    const replies = new Map();
    for (const row of rows) {
        if (row.parent) replies.set(row.parent, [...(replies.get(row.parent) || []), row]);
    }
    const top = rows.filter((row) => !row.parent);
    const title = rows.length === 0 ? "no comments yet" : rows.length === 1 ? "1 comment" : `${rows.length} comments`;

    const thread = (list) => `<ol class="comment-thread">${list.map((row) => `<li>${comment(row)}</li>`).join("")}</ol>`;
    const comment = (row) => {
        const id = `comment-${row.id}`;
        const kids = replies.get(row.id);
        return `<article class="comment" id="${id}">
    <p class="meta">
        <span class="comment-name">${escapeHtml(row.name)}</span>${row.is_author ? `<span class="comment-author">author</span>` : ""}
        <a class="comment-time" href="#${id}"><time datetime="${escapeHtml(row.created_at)}">${when(row.created_at)}</time></a>
    </p>
    <div class="comment-body">${bodyHtml(row.body)}</div>
    <a class="comment-link" href="${mailto(key + "#" + id)}">reply &rarr;</a>
    ${kids ? thread(kids) : ""}
</article>`;
    };

    return `<div class="social-head">
    <h2 class="social-title">${title}</h2>
    ${likeForm(key, likes)}
</div>
${top.length ? thread(top) : ""}
<div class="social-foot">
    <a class="comment-link" href="${mailto(key)}">comment by email &rarr;</a>
    <p class="meta">Start with a "name:" line for your display name. Your email is never shown or stored</p>
</div>`;
}

function likeForm(key, { count, liked }) {
    const noun = count === 1 ? "like" : "likes";
    const label = liked ? `you liked this post, ${count} ${noun}` : `like this post, ${count} ${noun}`;
    const state = liked ? ` disabled aria-pressed="true"` : "";
    return `<form class="like-form" id="likes" method="POST" action="/api/like">
        <input type="hidden" name="path" value="${key}" />
        <button type="submit" class="like-button" aria-label="${label}"${state}>${HEART} ${count}</button>
    </form>`;
}

// feather icons, mit
const HEART = `<svg class="like-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>`;

// the email worker reads the subject to know where a comment goes
function mailto(target) {
    const subject = encodeURIComponent(`re: ${SITE}${target}`);
    return `mailto:${REPLY_TO}?subject=${subject}&amp;body=${encodeURIComponent("name: ")}`;
}

// "4 Sep 2026 · 09:12", oakland time
function when(iso) {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "America/Los_Angeles",
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        })
            .formatToParts(new Date(iso))
            .map((part) => [part.type, part.value])
    );
    return `${p.day} ${p.month} ${p.year} &middot; ${p.hour}:${p.minute}`;
}
