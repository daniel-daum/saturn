// GET /media/<cid>: one blob from my PDS, served same-origin with Range
// support. See MICRO.md.
//
// The PDS answers every request for a blob with the whole file and no
// Accept-Ranges, and Safari (so every browser on iOS) refuses to play a
// video it cannot seek into. Cloudflare's Cache API does honour Range on a
// cached object, so the blob is stored there once and every later request,
// ranged or not, is served from the edge. Blobs are content-addressed, which
// is why the cache entry can be immutable.
//
// This route serves blobs only; a page that fails to reach it just shows an
// empty player. It is not on the middleware's fail-open path.

const PDS_HOST = "https://atproto.danieldaum.net";
const REPO_DID = "did:plc:be2e4qfe6docqcysyxxwvsor";

// CIDv1 in base32, the only form the PDS hands out. Anything else is refused
// before a request is made upstream.
const CID_RE = /^b[a-z2-7]{20,}$/;

// Only media is proxied. The PDS sets the type from the record, so it is
// trusted here, but a blob of any other type is not something a page embeds.
const MEDIA_TYPE_RE = /^(image|video)\//;

export async function onRequestGet(context) {
    const { request, params } = context;
    const cid = params.cid;
    if (typeof cid !== "string" || !CID_RE.test(cid)) {
        return plain("not found", 404);
    }

    const cache = caches.default;
    // The key is the canonical URL without the query string, so /media/<cid>
    // and /media/<cid>?x share an entry. Range is carried on the lookup
    // request, which is what makes the Cache API return a 206.
    const keyUrl = new URL(request.url);
    keyUrl.search = "";
    const lookup = new Request(keyUrl.toString(), { headers: rangeOnly(request) });

    let response = await cache.match(lookup);
    if (response) {
        return response;
    }

    let upstream;
    try {
        upstream = await fetch(blobUrl(cid));
    } catch {
        return plain("bad gateway", 502);
    }
    if (!upstream.ok) {
        return plain("not found", upstream.status === 404 ? 404 : 502);
    }
    const type = upstream.headers.get("content-type") || "";
    if (!MEDIA_TYPE_RE.test(type)) {
        return plain("not found", 404);
    }

    // Everything goes through memory once so the cached copy and the response
    // are built from the same bytes. Only the first request for a blob at a
    // given PoP pays for this.
    let body;
    try {
        body = await upstream.arrayBuffer();
    } catch {
        return plain("bad gateway", 502);
    }
    const headers = mediaHeaders(type, body.byteLength);
    context.waitUntil(cache.put(lookup.url, new Response(body.slice(0), { status: 200, headers })));

    return ranged(request, body, headers);
}

// The range parsing here only runs on a cache miss; the Cache API does the
// same job on every hit. One range, bytes only. Anything the parser does not
// understand gets the whole file, which is what the spec asks for.
function ranged(request, body, headers) {
    const length = body.byteLength;
    const range = parseRange(request.headers.get("range"), length);
    if (range === null) {
        return new Response(body, { status: 200, headers });
    }
    if (range === false) {
        const h = new Headers(headers);
        h.set("content-range", `bytes */${length}`);
        h.delete("content-length");
        return new Response(null, { status: 416, headers: h });
    }
    const [start, end] = range;
    const h = new Headers(headers);
    h.set("content-range", `bytes ${start}-${end}/${length}`);
    h.set("content-length", String(end - start + 1));
    return new Response(body.slice(start, end + 1), { status: 206, headers: h });
}

// null: no usable range, serve everything. false: unsatisfiable, 416.
// [start, end]: inclusive byte range within the file.
function parseRange(header, length) {
    if (!header || length === 0) {
        return null;
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === "" && m[2] === "")) {
        return null;
    }
    let start;
    let end;
    if (m[1] === "") {
        // suffix range: the last N bytes
        const suffix = Number(m[2]);
        if (suffix === 0) {
            return false;
        }
        start = Math.max(0, length - suffix);
        end = length - 1;
    } else {
        start = Number(m[1]);
        end = m[2] === "" ? length - 1 : Math.min(Number(m[2]), length - 1);
    }
    if (start >= length || start > end) {
        return false;
    }
    return [start, end];
}

function mediaHeaders(type, length) {
    return {
        "content-type": type,
        "content-length": String(length),
        "accept-ranges": "bytes",
        // content-addressed: the bytes behind a cid never change
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        // a blob must never be able to run anything, whatever it claims to be
        "content-security-policy": "default-src 'none'; sandbox",
    };
}

function rangeOnly(request) {
    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) {
        headers.set("range", range);
    }
    return headers;
}

function blobUrl(cid) {
    const url = new URL("/xrpc/com.atproto.sync.getBlob", PDS_HOST);
    url.searchParams.set("did", REPO_DID);
    url.searchParams.set("cid", cid);
    return url.toString();
}

function plain(text, status) {
    return new Response(text, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
}
