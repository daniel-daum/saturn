// keyed sha-256 hash as hex. shared by likes, comment moderation and the
// email worker (workers/comments imports this file), so signatures made on
// one side always match on the other

export async function hmacHex(secret, message) {
    if (!secret) {
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
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// checks a signature from a link. compares every character so the time taken
// doesn't reveal how much of a guess was right
export async function hmacMatches(secret, message, sig) {
    const expected = await hmacHex(secret, message);
    if (typeof sig !== "string" || sig.length !== expected.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < sig.length; i++) {
        diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
}
