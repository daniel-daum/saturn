// Shared helpers for likes and reply-by-email comments on blog posts.
// Used by functions/_middleware.js, functions/api/like.js and
// functions/api/moderate.js. See SOCIAL.md for the full write-up.
//
// hmacHex MUST stay in sync with workers/replies-inbound/src/lib.js. The
// email worker signs delete links and sender hashes with its copy; the
// Pages side verifies and matches them with this one. Same secret, same
// algorithm, same output, or moderation links stop working.

const BLOG_POST_RE = /^\/blog\/[a-z0-9-]+\/$/;

// Every string that came from the PDS, D1 or a request goes through this
// before it is written into a page.
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Blog post pages are the only pages that carry likes and replies. The micro
// feed lives at /blog/micro/ and is excluded on purpose.
export function isBlogPost(pathname) {
    return BLOG_POST_RE.test(pathname) && pathname !== "/blog/micro/";
}

// ---------------------------------------------------------------------------
// hmac

export async function hmacHex(secret, message) {
    if (typeof secret !== "string" || secret.length === 0) {
        throw new Error("SOCIAL_SECRET is not set");
    }
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return toHex(new Uint8Array(sig));
}

function toHex(bytes) {
    let out = "";
    for (const b of bytes) {
        out += b.toString(16).padStart(2, "0");
    }
    return out;
}

// Constant-time string comparison for signatures. Length differences short
// circuit, which leaks nothing useful because every valid signature has the
// same length.
export function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

// ---------------------------------------------------------------------------
// voter identity

// "YYYY-MM-DD" in UTC. The voter hash rotates when this changes.
export function utcDate(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

// One like per person per page per day, without a cookie and without storing
// anything that identifies the person: the voter key is an HMAC of the
// connection details plus today's date, so it cannot be reversed and it stops
// matching tomorrow. Both the like endpoint and the middleware call this so
// "already liked" is computed exactly the same way on both sides.
export async function voterId(secret, request) {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    return hmacHex(secret, ip + "|" + ua + "|" + utcDate());
}
