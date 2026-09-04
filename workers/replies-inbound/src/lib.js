// Shared crypto helper for the replies worker.
//
// hmacHex MUST stay in sync with functions/_lib/social.js at the repo root.
// This worker signs delete links and sender hashes with it; the Pages side
// verifies and matches them with its copy. Same secret, same algorithm, same
// output, or moderation links stop working.

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
