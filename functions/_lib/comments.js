// shared by _middleware.js and api/moderate.js

// everything from d1 or a request goes through this before it is written
// into a page
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// a stored comment as paragraphs: blank lines split paragraphs, single
// newlines become <br>
export function bodyHtml(body) {
    return body
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br />")}</p>`)
        .join("");
}

// approved comments for one page, oldest first, as a one-level thread plus
// the heading count and the "comment by email" footer. key passed
// isLikeable(), so it is safe to write into the page as-is
export function renderComments(key, rows) {
    const replies = new Map();
    for (const row of rows) {
        if (row.parent) {
            replies.set(row.parent, [...(replies.get(row.parent) || []), row]);
        }
    }
    const top = rows.filter((row) => !row.parent);
    const thread = (list) => `<ol class="comment-thread">${list.map((row) => `<li>${comment(row, replies.get(row.id))}</li>`).join("")}</ol>`;

    const title = rows.length === 0 ? "no comments yet" : rows.length === 1 ? "1 comment" : `${rows.length} comments`;
    return {
        title,
        thread: top.length ? thread(top) : "",
        foot: `<div class="social-foot">
    <a class="comment-link" href="${mailto(key)}">comment by email &rarr;</a>
    <p class="meta">Start with a "name:" line for your display name. Your email is never shown or stored</p>
</div>`,
    };

    function comment(row, children) {
        const id = `comment-${row.id}`;
        return `<article class="comment" id="${id}">
    <p class="meta">
        <span class="comment-name">${escapeHtml(row.name)}</span>${row.is_author ? `<span class="comment-author">author</span>` : ""}
        <a class="comment-time" href="#${id}"><time datetime="${escapeHtml(row.created_at)}">${when(row.created_at)}</time></a>
    </p>
    <div class="comment-body">${bodyHtml(row.body)}</div>
    <a class="comment-link" href="${mailto(key + "#" + id)}">reply &rarr;</a>
    ${children ? thread(children) : ""}
</article>`;
    }
}

// the subject is what the email worker reads to know where a comment goes;
// the body starts with an empty name line as a hint
function mailto(target) {
    const subject = encodeURIComponent(`re: https://danieldaum.net${target}`);
    return `mailto:reply@replies.danieldaum.net?subject=${subject}&amp;body=${encodeURIComponent("name: ")}`;
}

// "4 Sep 2026 · 09:12", oakland time
function when(iso) {
    const parts = Object.fromEntries(
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
            .map((p) => [p.type, p.value])
    );
    return `${parts.day} ${parts.month} ${parts.year} &middot; ${parts.hour}:${parts.minute}`;
}
