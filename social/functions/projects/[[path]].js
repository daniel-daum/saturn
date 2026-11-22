// /projects/ is showcase, the code site at code.danieldaum.net. the old pages
// under /projects/ in this repo are never served
//
// MODE "redirect": a 302 to the same path on code.danieldaum.net
// MODE "proxy": showcase served here, under /projects/. set "base_path":
// "/projects" in showcase's config first, so its links stay under /projects/.
// clone, go get and docker pull stay on code.danieldaum.net

const ORIGIN = "https://code.danieldaum.net";
const MODE = "redirect";

export async function onRequest({ request }) {
    const url = new URL(request.url);
    if (MODE === "redirect") {
        const rest = url.pathname.replace(/^\/projects/, "") || "/";
        return Response.redirect(ORIGIN + rest + url.search, 302);
    }

    // read-only, like the site it stands in for
    if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" } });
    }

    // the origin is fixed, so only showcase's pages come back. cookies stay
    // here: showcase reads the theme cookie in the browser, not the server
    const upstream = new Request(ORIGIN + url.pathname + url.search, request);
    upstream.headers.delete("Cookie");
    return fetch(upstream, { redirect: "manual" });
}
