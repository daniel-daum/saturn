// shared by _middleware.js and api/like.js

// pages that can carry likes: /about/, /now/, /now/<slug>/, /blog/<slug>/.
// never /blog/ itself
export function isLikeable(pathname) {
    return /^\/(about|now)\/$|^\/(blog|now)\/[a-z0-9-]+\/$/.test(pathname);
}

// one like per visitor per post per day, without cookies or stored ips:
// a keyed hash of ip + browser + today's date. it can't be reversed, and it
// stops matching at utc midnight.
export async function voterId(secret, request) {
    if (!secret) {
        throw new Error("SOCIAL_SECRET is not set");
    }
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    const day = new Date().toISOString().slice(0, 10);

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${ip}|${ua}|${day}`));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
