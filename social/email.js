// email worker: cloudflare email routing hands it everything sent to
// reply@replies.danieldaum.net. a good comment is saved (live, or held if it
// has a link) and daniel gets an email to approve or delete it.
// fixable mistakes bounce; anything that looks like abuse is dropped silently,
// since a bounce would go to a forged address.
// the sender's address is only used for the author check, never stored

import PostalMime from "postal-mime";
import { EmailMessage } from "cloudflare:email";
import { SITE, REPLY_TO, hmac, isLikeable } from "./lib.js";

const AUTHOR = "daniel@danieldaum.net";
const NOTIFY_FROM = "notify@replies.danieldaum.net";

// "re: https://danieldaum.net/now/sep-2026/", plus "#comment-<id>" for a reply
const SUBJECT_RE = /^\s*(?:re:\s*)*https:\/\/danieldaum\.net(\/[a-z0-9\/-]*)(?:#comment-([0-9a-f-]{36}))?\s*$/i;

const MAX_PER_HOUR = 20;
const MAX_BODY = 2000;
const MAX_LINKS = 2;
const MAX_NAME = 40;

export default {
    async email(message, env) {
        const auth = (message.headers.get("Authentication-Results") || "").toLowerCase();
        if (!auth.includes("dkim=pass") || !(auth.includes("spf=pass") || auth.includes("dmarc=pass"))) {
            console.log("drop: failed authentication");
            return;
        }

        // site-wide, so nothing per sender is kept
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM Comments WHERE created_at > ?").bind(since).first();
        if (recent.n >= MAX_PER_HOUR) {
            console.log("drop: hourly cap");
            return;
        }

        const email = await PostalMime.parse(message.raw);

        // /now/ itself moves to the next edition, so comments go on the edition
        const match = (email.subject || "").match(SUBJECT_RE);
        const page = match ? match[1].toLowerCase() : "";
        if (!isLikeable(page) || page === "/now/" || !(await pageExists(env, page))) {
            message.setReject("Please use the reply link on the post, so the subject is the post's address");
            return;
        }

        // one level of nesting; unknown ids become top-level
        const parent = match[2] ? await topLevelParent(env, match[2].toLowerCase(), page) : null;

        const { name, body } = cleanBody(email);
        const isAuthor = (email.from?.address || "").trim().toLowerCase() === AUTHOR && fromMyDomain(email);
        if (!name && !isAuthor) {
            message.setReject(`Please start your comment with a line like "name: sam". That name is shown with your comment`);
            return;
        }
        if (body.length < 2 || body.length > MAX_BODY) {
            message.setReject(`Comments must be between 2 and ${MAX_BODY} characters`);
            return;
        }
        const links = (body.match(/https?:\/\//g) || []).length;
        if (links > MAX_LINKS) {
            message.setReject(`Comments can have at most ${MAX_LINKS} links`);
            return;
        }

        // links are what spam is for, so those wait for approval
        const approved = isAuthor || links === 0;
        const id = crypto.randomUUID();
        const shownName = isAuthor ? "daniel" : name;
        await env.DB.prepare("INSERT INTO Comments (id, page, parent, name, body, is_author, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id, page, parent, shownName, body, isAuthor ? 1 : 0, approved ? 1 : 0, new Date().toISOString())
            .run();

        // every comment, mine too, so each one has a delete link
        try {
            const sig = await hmac(env.SOCIAL_SECRET, "moderate:" + id);
            const link = `${env.SITE_ORIGIN || SITE}/api/moderate?id=${id}&sig=${sig}`;
            await env.NOTIFY.send(new EmailMessage(NOTIFY_FROM, AUTHOR, notification({ page, id, name: shownName, body, approved, link })));
        } catch (err) {
            console.log("notify failed: " + (err?.message || err));
        }
    },
};

// ===== checks =====

// only cloudflare's own result counts: it strips forged headers carrying its id
function fromMyDomain(email) {
    return email.headers.some(
        (h) => h.key === "authentication-results" && /^\s*mx\.cloudflare\.net;/i.test(h.value) && /\bdmarc=pass\b[^;]*\bheader\.from=danieldaum\.net\b/i.test(h.value)
    );
}

// SITE_ORIGIN (.dev.vars) points at wrangler pages dev when testing locally
async function pageExists(env, page) {
    try {
        const res = await fetch((env.SITE_ORIGIN || SITE) + page, { method: "HEAD" });
        return res.status === 200;
    } catch {
        return false;
    }
}

async function topLevelParent(env, id, page) {
    const row = await env.DB.prepare("SELECT page, parent FROM Comments WHERE id = ? AND approved = 1").bind(id).first();
    if (!row || row.page !== page) return null;
    return row.parent || id;
}

// ===== text =====

// plain text without quoted mail or signatures. an optional "name: ..."
// first line sets the display name. escaped later, when rendered
function cleanBody(email) {
    const text = (email.text?.trim() ? email.text : htmlToText(email.html || "")).replace(/\r\n?/g, "\n");
    const lines = text.split("\n");

    let name = "";
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        const t = line.trim();

        // gmail can wrap "On <date> <name> wrote:" over two lines
        if (
            /^On\s.*wrote:$/.test(t) ||
            (/^On\s/.test(t) && /wrote:$/.test((lines[i + 1] || "").trim())) ||
            /^-{2,}\s*(original|forwarded) message/i.test(t) ||
            /^From:\s/.test(t) ||
            /^_{5,}$/.test(t) ||
            t === "--" ||
            /reply above this line/i.test(t) ||
            /^sent from my /i.test(t)
        ) {
            break;
        }
        if (t.startsWith(">")) continue;

        const nameLine = t.match(/^name:\s*(.*)$/i);
        if (nameLine && !name && !kept.some((k) => k.trim())) {
            name = nameLine[1];
            continue;
        }
        kept.push(line);
    }

    name = name.replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    const body = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { name, body };
}

function htmlToText(html) {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|blockquote|h[1-6]|tr)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

// ===== notification =====

// replying to it posts an answer under the comment. the marker line keeps the
// quoted notification out of that answer
function notification({ page, id, name, body, approved, link }) {
    const headers = [
        `From: ${NOTIFY_FROM}`,
        `To: ${AUTHOR}`,
        `Reply-To: ${REPLY_TO}`,
        `Subject: re: ${SITE}${page}#comment-${id}`,
        `Date: ${new Date().toUTCString().replace(/GMT$/, "+0000")}`,
        `Message-ID: <${crypto.randomUUID()}@replies.danieldaum.net>`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
    ];
    const status = approved ? "It is live." : "It has a link, so it is waiting for approval.";
    const action = approved ? "Delete" : "Approve or delete";
    const text = [`## reply above this line to answer on the site ##`, ``, `${name} commented on ${page}:`, ``, body, ``, status, `${action}: ${link}`, ``].join("\n");
    return headers.join("\r\n") + "\r\n\r\n" + text.replace(/\n/g, "\r\n");
}
