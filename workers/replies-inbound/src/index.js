// Email Worker for reply-by-email comments on blog posts. Cloudflare Email
// Routing delivers everything sent to reply@replies.danieldaum.net here.
// Each message passes a fixed sequence of gates, in the order below, and is
// inserted into D1 as a public comment. See ../../SOCIAL.md.
//
// Failure modes, deliberately different:
// - setReject: the sender did something fixable (wrong subject, empty body),
//   so a bounce is useful to them.
// - silent drop (console.log + return): authentication or rate limit
//   failures, where a bounce would only be backscatter.

import PostalMime from "postal-mime";
import { EmailMessage } from "cloudflare:email";
import { hmacHex } from "./lib.js";

const SITE_URL = "https://danieldaum.net";
const NOTIFY_FROM = "notify@replies.danieldaum.net";
const NOTIFY_TO = "daniel@danieldaum.net";

const SUBJECT_RE = /^\s*re:\s*https:\/\/danieldaum\.net(\/blog\/[a-z0-9-]+\/)(?:#([0-9a-f-]{36}))?\s*$/i;
const URL_RE = /https?:\/\/\S+/g;
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

const MIN_BODY = 2;
const MAX_BODY = 2000;
const MAX_URLS = 2;
const MAX_NAME = 40;
const NOTIFY_PREVIEW = 500;

const PER_SENDER_PER_HOUR = 5;
const GLOBAL_PER_HOUR = 30;

export default {
    async email(message, env, ctx) {
        // 1. authentication: only mail that passed DKIM and at least one of
        //    SPF / DMARC at Cloudflare's edge gets any further.
        const auth = (message.headers.get("Authentication-Results") || "").toLowerCase();
        if (!auth.includes("dkim=pass") || !(auth.includes("spf=pass") || auth.includes("dmarc=pass"))) {
            console.log("drop: authentication failed");
            return;
        }

        // 2. parse
        const email = await PostalMime.parse(message.raw);

        // 3. subject carries the post URL and, optionally, the parent guid
        const match = (email.subject || "").match(SUBJECT_RE);
        if (!match || match[1] === "/blog/micro/") {
            message.setReject("Subject must be the reply link from the post page");
            return;
        }
        const path = match[1];
        const requestedParent = match[2] ? match[2].toLowerCase() : null;

        // 4. the post must exist
        if (!(await pageExists(env, path))) {
            message.setReject("That post does not exist");
            return;
        }

        // 5. parent: must be a live reply on the same post, else top-level
        const parent = requestedParent ? await liveParent(env, requestedParent, path) : null;

        // 6. body
        const body = cleanBody(email);
        if (body.length < MIN_BODY || body.length > MAX_BODY) {
            message.setReject(`Reply must be between ${MIN_BODY} and ${MAX_BODY} characters after quoted text is removed`);
            return;
        }
        if ((body.match(URL_RE) || []).length > MAX_URLS) {
            message.setReject(`Reply may contain at most ${MAX_URLS} links`);
            return;
        }

        // 7. sender: a keyed hash of the address, used only for rate limiting.
        //    The address itself is never stored and never logged.
        const address = (email.from?.address || "").trim().toLowerCase();
        if (!address) {
            console.log("drop: no from address");
            return;
        }
        const sender = await hmacHex(env.SOCIAL_SECRET, address);

        // 8. rate limits
        if (!(await underRateLimits(env, sender))) {
            console.log("drop: rate limited");
            return;
        }

        // 9. display name
        const name = displayName(email.from?.name, address);

        // 10. insert
        const guid = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        await env.DB
            .prepare(
                "INSERT INTO Replies (guid, url, parent, name, message, sender, approved, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
            )
            .bind(guid, path, parent, name, body, sender, createdAt)
            .run();

        // 11. notify, with a signed delete link. A failure here must not undo
        //     the insert, so it only logs.
        try {
            const deleteSig = await hmacHex(env.SOCIAL_SECRET, "delete:" + guid);
            const raw = notification({ path, guid, name, body, deleteSig });
            await env.NOTIFY.send(new EmailMessage(NOTIFY_FROM, NOTIFY_TO, raw));
        } catch (err) {
            console.log("notify failed: " + (err && err.message ? err.message : String(err)));
        }
    },
};

// ---------------------------------------------------------------------------
// gates

// PAGE_CHECK_ORIGIN is a local-dev override only (set in .dev.vars) so the
// check can point at `wrangler pages dev` instead of the live site. It is
// never set in production; links and subjects always use SITE_URL.
async function pageExists(env, path) {
    try {
        const origin = env.PAGE_CHECK_ORIGIN || SITE_URL;
        const res = await fetch(origin + path, { method: "HEAD" });
        return res.status === 200;
    } catch {
        return false;
    }
}

async function liveParent(env, guid, path) {
    const row = await env.DB
        .prepare("SELECT url FROM Replies WHERE guid = ? AND deleted_at IS NULL")
        .bind(guid)
        .first();
    return row && row.url === path ? guid : null;
}

async function underRateLimits(env, sender) {
    const [mine, all] = await env.DB.batch([
        env.DB
            .prepare("SELECT COUNT(*) AS n FROM Replies WHERE sender = ? AND created_at > datetime('now', '-1 hour')")
            .bind(sender),
        env.DB.prepare("SELECT COUNT(*) AS n FROM Replies WHERE created_at > datetime('now', '-1 hour')"),
    ]);
    const perSender = Number(mine.results[0]?.n ?? 0);
    const global = Number(all.results[0]?.n ?? 0);
    return perSender < PER_SENDER_PER_HOUR && global < GLOBAL_PER_HOUR;
}

// ---------------------------------------------------------------------------
// text

// Plain text body with quoted history removed. Stored raw; escaping happens
// when the middleware renders it.
function cleanBody(email) {
    let text = typeof email.text === "string" && email.text.trim() ? email.text : htmlToText(email.html || "");
    text = text.replace(/\r\n?/g, "\n");

    const kept = [];
    for (const line of text.split("\n")) {
        // everything from the first quote header onward is the previous message
        if (/^On .+ wrote:$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line) || /^From: /.test(line)) {
            break;
        }
        if (line.startsWith(">")) {
            continue;
        }
        kept.push(line.replace(/\s+$/, ""));
    }

    return kept
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
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

function displayName(fromName, address) {
    let name = typeof fromName === "string" ? fromName.trim() : "";
    if (!name) {
        name = address.split("@")[0];
    }
    name = name.replace(CONTROL_RE, "").trim();
    if (name.length > MAX_NAME) {
        name = name.slice(0, MAX_NAME);
    }
    return name || "anonymous";
}

// ---------------------------------------------------------------------------
// notification

// A minimal RFC 5322 message, built by hand. Plain text only.
function notification({ path, guid, name, body, deleteSig }) {
    const postUrl = `${SITE_URL}${path}#reply-${guid}`;
    const deleteUrl = `${SITE_URL}/api/moderate?id=${guid}&sig=${deleteSig}`;
    const preview = body.length > NOTIFY_PREVIEW ? body.slice(0, NOTIFY_PREVIEW) + "..." : body;

    const headers = [
        `From: ${NOTIFY_FROM}`,
        `To: ${NOTIFY_TO}`,
        `Subject: New reply on ${path}`,
        `Date: ${rfc5322Date(new Date())}`,
        `Message-ID: <${crypto.randomUUID()}@replies.danieldaum.net>`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
    ];
    const lines = [
        `${name} replied on ${path}:`,
        ``,
        preview,
        ``,
        `View: ${postUrl}`,
        ``,
        `Delete: ${deleteUrl}`,
        ``,
    ];
    return headers.join("\r\n") + "\r\n\r\n" + lines.join("\n").replace(/\r?\n/g, "\r\n");
}

// "Thu, 03 Sep 2026 18:42:00 +0000"
function rfc5322Date(date) {
    return date.toUTCString().replace(/GMT$/, "+0000");
}
