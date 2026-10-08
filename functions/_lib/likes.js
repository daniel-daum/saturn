// shared by _middleware.js and api/like.js

import { hmacHex } from "./hmac.js";

// pages that can carry likes: /about/, /now/, /now/<slug>/, /blog/<slug>/.
// never /blog/ itself
export function isLikeable(pathname) {
    return /^\/(about|now)\/$|^\/(blog|now)\/[a-z0-9-]+\/$/.test(pathname);
}

// one like per visitor per post per day, without cookies or stored ips:
// a keyed hash of ip + browser + today's date. it can't be reversed, and it
// stops matching at utc midnight.
export async function voterId(secret, request) {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ua = request.headers.get("User-Agent") || "";
    const day = new Date().toISOString().slice(0, 10);
    return hmacHex(secret, `${ip}|${ua}|${day}`);
}
