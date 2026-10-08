// email worker for comments. cloudflare email routing hands it everything
// sent to reply@replies.danieldaum.net. each message goes through the checks
// below in order; a good one is saved (live, or held if it has a link) and
// daniel gets an email with a link to approve or delete it.
//
// a fixable mistake (bad subject, empty body) bounces so the sender knows.
// anything that looks like abuse is dropped silently, since a bounce would
// go to whoever's address was forged.
//
// the sender's address is used for the author check and then forgotten:
// it is never stored, hashed or logged.

import PostalMime from "postal-mime";
import { EmailMessage } from "cloudflare:email";
import { hmacHex } from "../../../functions/_lib/hmac.js";
import { isLikeable } from "../../../functions/_lib/likes.js";

const SITE_URL = "https://danieldaum.net";
const AUTHOR = "daniel@danieldaum.net";
const NOTIFY_FROM = "notify@replies.danieldaum.net";

// "re: https://danieldaum.net/now/sep-2026/" with an optional
// "#comment-<id>" when replying to a comment. mail apps may add more "re:"s
const SUBJECT_RE = /^\s*(?:re:\s*)*https:\/\/danieldaum\.net(\/[a-z0-9\/-]*)(?:#comment-([0-9a-f-]{36}))?\s*$/i;

const MAX_PER_HOUR = 20;
const MAX_BODY = 2000;
const MAX_LINKS = 2;
const MAX_NAME = 40;

export default {
    async email(message, env) {
        // 1. the mail really comes from the domain it claims
        const auth = (message.headers.get("Authentication-Results") || "").toLowerCase();
        if (!auth.includes("dkim=pass") || !(auth.includes("spf=pass") || auth.includes("dmarc=pass"))) {
            console.log("drop: failed authentication");
            return;
        }

        // 2. site-wide cap, counted from rows only, nothing per sender
        const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM Comments WHERE created_at > ?").bind(since).first();
        if (recent.n >= MAX_PER_HOUR) {
            console.log("drop: hourly cap reached");
            return;
        }

        const email = await PostalMime.parse(message.raw);

        // 3. subject names a real post. /now/ itself is excluded because it
        //    moves to a new edition; comments belong to the edition
        const match = (email.subject || "").match(SUBJECT_RE);
        const page = match ? match[1].toLowerCase() : "";
        if (!isLikeable(page) || page === "/now/" || !(await pageExists(env, page))) {
            message.setReject("Please use the reply link on the post, so the subject is the post's address");
            return;
        }

        // 4. a reply to a comment hangs under that comment's top-level
        //    comment (one level of nesting). unknown ids become top-level
        const parent = match[2] ? await topLevelParent(env, match[2].toLowerCase(), page) : null;

        // 5. the text itself, without quoted mail or signatures. everyone
        //    but daniel (proven by dmarc) picks their own name
        const { name, body } = cleanBody(email);
        const from = (email.from?.address || "").trim().toLowerCase();
        const isAuthor = from === AUTHOR && auth.includes("dmarc=pass");
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

        // 6. plain comments go live at once. links are what spam is for, so
        //    a comment with one waits for approval. daniel's are always live
        const approved = isAuthor || links === 0;

        const id = crypto.randomUUID();
        const shownName = isAuthor ? "daniel" : name;
        await env.DB
            .prepare(
                "INSERT INTO Comments (id, page, parent, name, body, is_author, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(id, page, parent, shownName, body, isAuthor ? 1 : 0, approved ? 1 : 0, new Date().toISOString())
            .run();

        // 7. tell daniel about every comment, his own included, so each one
        //    has a delete link. the comment is already saved, so a failure
        //    here only logs
        try {
            const sig = await hmacHex(env.SOCIAL_SECRET, "moderate:" + id);
            const raw = notification({ page, id, name: shownName, body, approved, link: `${env.SITE_ORIGIN || SITE_URL}/api/moderate?id=${id}&sig=${sig}` });
            await env.NOTIFY.send(new EmailMessage(NOTIFY_FROM, AUTHOR, raw));
        } catch (err) {
            console.log("notify failed: " + (err?.message || err));
        }
    },
};

// ===== checks =====

// SITE_ORIGIN is for local testing only (.dev.vars): it points the page
// check and the moderation link at wrangler pages dev instead of the live site
async function pageExists(env, page) {
    try {
        const res = await fetch((env.SITE_ORIGIN || SITE_URL) + page, { method: "HEAD" });
        return res.status === 200;
    } catch {
        return false;
    }
}

async function topLevelParent(env, id, page) {
    const row = await env.DB.prepare("SELECT page, parent FROM Comments WHERE id = ? AND approved = 1").bind(id).first();
    if (!row || row.page !== page) {
        return null;
    }
    return row.parent || id;
}

// ===== text =====

// plain text with quoted history and signatures cut off. a "name: ..."
// first line sets the display name (empty if missing).
// stored as plain text, escaped when the page is rendered
function cleanBody(email) {
    const text = (email.text?.trim() ? email.text : htmlToText(email.html || "")).replace(/\r\n?/g, "\n");
    const lines = text.split("\n");

    let name = "";
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        const t = line.trim();

        // where the previous message or a signature starts. gmail can wrap
        // "On <date> <name> wrote:" over two lines
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
        if (t.startsWith(">")) {
            continue;
        }
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
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
}

// ===== notification =====

// a minimal plain-text email, built by hand. its reply-to and subject make
// hitting reply post an answer under the comment. the marker line keeps the
// quoted notification (and its moderation link) out of that answer
function notification({ page, id, name, body, approved, link }) {
    const headers = [
        `From: ${NOTIFY_FROM}`,
        `To: ${AUTHOR}`,
        `Reply-To: reply@replies.danieldaum.net`,
        `Subject: re: ${SITE_URL}${page}#comment-${id}`,
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
