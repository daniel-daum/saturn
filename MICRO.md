# Micro posts

Micro posts on this site are Bluesky posts, pulled from my own PDS and injected
into the static HTML at the Cloudflare edge. Nothing about them lives in this
repo except the placeholders and the middleware that fills them.

## Where posts come from

I post from the Bluesky iOS app. Each post is an `app.bsky.feed.post` record in
my repo on my PDS:

- DID: `did:plc:be2e4qfe6docqcysyxxwvsor`
- PDS: `https://atproto.danieldaum.net`
- Handle: `danieldaum.net`

`functions/_middleware.js` calls `com.atproto.repo.listRecords` on the PDS,
drops replies, sorts by `createdAt` descending, and renders the result into
the page. Replies are never shown.

## The 300 grapheme limit

Bluesky caps a post at 300 graphemes. That is a hard constraint on how I write
here: a micro post is at most 300 characters, full stop. Anything longer is a
longform post and belongs under `/blog` or `/now` with an entry in `feed.xml`
(see `FEED.md`).

## The `data-micro` modes

The middleware looks for any element carrying a `data-micro` attribute and
replaces its inner HTML. The attribute value picks what gets rendered:

| Mode | Renders | Used on |
|---|---|---|
| `latest-activity` | one row's worth of content for an `<li class="activity-item">`: icon, `NEW MICRO POST &mdash; <text>` link (or `3 NEW MICRO POSTS` when several landed on the same Pacific day), and a `1 SEP` style date. The text is capped at 140 characters server-side; the row never wraps and css fades whatever does not fit | `/` (activity feed) |
| `latest-featured` | one `<article class="micro-post micro-featured">` for the newest post, timestamp linking to its anchor on `/blog/micro/`, media included | `/` (recent post card), `/blog` |
| `all` | every post as `<article class="micro-post">`, newest first, each with an `id` anchor, media included | `/blog/micro/` |

Anchor ids are the record key (the last path segment of the `at://` URI, a
TID). The old `YYYY-MM-DD-N` convention is gone.

Whatever is inside the `data-micro` element in the HTML is the fallback. It is
what visitors see when the PDS is down, returns an error, or has no posts. The
middleware never touches a page in that case, so the fallback must be real,
presentable markup, not an empty div.

## Adding a new injection point

Three steps, all required:

1. Add an element with `data-micro="<mode>"` and fallback content to the page.
2. Add every path form the page can be requested at to `ALLOWED_PATHS` in
   `functions/_middleware.js` (for a directory page that means `/foo`,
   `/foo/`, and `/foo/index.html`).
3. Make sure `_routes.json` at the repo root routes the path through
   Functions. Anything not listed in its `include` array is served straight
   from the static asset store and never reaches the middleware.

The allowlist is checked before anything is fetched, so a page that is not on
it is served exactly as written and never causes a PDS request. Forgetting step
2 means the placeholder stays as the fallback text forever.

Blog post pages are not on the allowlist and never will be; their `data-likes`
and `data-replies` injection is a separate path, documented in `SOCIAL.md`.

If the new page needs images, add `https://atproto.danieldaum.net` to
`img-src` in that page's CSP meta tag. Only the three pages listed above have
that today. Video is same-origin (see below) and is covered by the
`media-src 'self'` every page already carries.

## Media

A post can carry a set of images (`app.bsky.embed.images`) or one video
(`app.bsky.embed.video`); the middleware renders both below the text, in
`latest-featured` and `all`. A quote-with-media post
(`app.bsky.embed.recordWithMedia`) keeps its media and drops the quote.

Images are `<img>` tags pointing straight at the PDS's
`com.atproto.sync.getBlob`, which is why the PDS origin is in `img-src`.

Video is different. The PDS answers every blob request with the whole file
and no `Accept-Ranges`, and Safari (so every browser on iOS) will not play a
video it cannot seek into. So the `<video>` src is `/media/<cid>`, served by
`functions/media/[cid].js`: it fetches the blob from the PDS once, stores it
in the Cloudflare cache (immutable, blobs are content-addressed), and lets the
Cache API answer every request after that, `Range` included. On the first,
cold request the function slices the range itself. Only image and video
content types are passed through; the cid has to look like a base32 CIDv1 or
nothing is fetched.

`/media/*` is in `_routes.json` so it reaches the function. No CSP change is
needed for it: it is same-origin.

The player is not autoplayed or muted, it is `controls` and
`preload="metadata"`, and it sits above the card's stretched permalink in the
stacking order so the controls take the tap instead of the card.

## Local dev

- `mise run dev` runs Vite. Vite does not run Pages Functions, so every
  `data-micro` element shows its fallback ("NO POSTS YET").
- `mise run preview` runs `wrangler pages dev .`, which does run the
  middleware and shows real posts from the PDS. Its default port is 8788.
  Wrangler writes its state to `.wrangler/`, which is gitignored.

No `package.json`, no dependencies. `npx` fetches wrangler on demand.

## Caching

The PDS fetch is made with a 60 second edge cache (`cf.cacheTtl`), so each
Cloudflare PoP asks the PDS at most once a minute regardless of traffic. A new
post can take up to a minute to appear on the site. Deleting a post on Bluesky
takes the same minute to disappear.

## Not implemented

Deliberately left out of this pass. Everything below renders as plain text or
is ignored:

- rich text facets: links, mentions and hashtags are not linkified
- quote posts: the quoted record is dropped, only my text shows (a
  quote-with-media keeps the media, see above)
- external link cards
- video posters: the record has no thumbnail, so the player shows the first
  frame once metadata loads
- threading: replies are filtered out entirely, and thread structure is ignored
