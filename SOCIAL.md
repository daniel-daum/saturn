# Likes and replies

Blog posts carry two social features, both rendered with zero client-side
JavaScript: a like button and reply-by-email comments. Everything lives at the
Cloudflare edge; the static HTML only carries placeholders and fallback text.
Micro posts (`/blog/micro/`) get neither. See `MICRO.md` for that side.

## Scope

A "blog post page" is any path matching `^/blog/[a-z0-9-]+/$` that is not
`/blog/micro/`. That predicate is `isBlogPost()` in `functions/_lib/social.js`
and is the single gate used by the middleware and the like endpoint. Nothing
else on the site (home, `/blog`, `/now/*`, `/about`) is touched.

## Moving parts

| Piece | Where | Role |
|---|---|---|
| D1 database `saturn-social` | bound as `DB` to the Pages project and the worker | all state |
| `functions/_middleware.js` | Pages Function | renders like count, liked-state and the reply thread into the page |
| `functions/api/like.js` | Pages Function, `POST /api/like` | records a like, 303s back to the post |
| `functions/api/moderate.js` | Pages Function, `GET`/`POST /api/moderate` | signed delete link from the notification email |
| `functions/_lib/social.js` | shared module | `isBlogPost`, `hmacHex`, `safeEqual`, `voterId` |
| `workers/replies-inbound/` | separate email Worker | receives mail on `reply@replies.danieldaum.net`, validates, inserts, notifies |
| `schema.sql` | repo root | the tables below |

## Tables

`Likes`: one row per page.

| column | meaning |
|---|---|
| `page` | the post path, `/blog/<slug>/` (primary key) |
| `count` | total likes ever recorded |

`LikeVoters`: who has liked what today. Rows are disposable.

| column | meaning |
|---|---|
| `page` | post path |
| `voter` | daily-rotating HMAC of the visitor (see below); `(page, voter)` is the primary key |
| `created_at` | ISO timestamp, used only so stale rows can be purged |

`Replies`: every comment ever received, including deleted ones.

| column | meaning |
|---|---|
| `guid` | random UUID, primary key; also the HTML anchor `#reply-<guid>` |
| `url` | post path the reply belongs to |
| `parent` | guid of the reply being answered, or NULL for top-level |
| `name` | display name, stored raw and escaped at render |
| `message` | plain text body after quote stripping, stored raw and escaped at render |
| `sender` | HMAC of the sender's lowercased address; used only for rate limiting. The address itself is never stored anywhere |
| `approved` | always 1 today. Exists so switching to a moderation queue later is a query change, not a migration |
| `created_at` | ISO timestamp |
| `deleted_at` | NULL while live; set by `/api/moderate`. Rows are never physically deleted |

Indexes: `(url, deleted_at, created_at)` for the thread query and
`(sender, created_at)` for the rate limit.

## Likes

The like button is a plain form:

```html
<form class="like-form" method="POST" action="/api/like">
    <input type="hidden" name="path" value="/blog/SLUG/" />
    <button type="submit" class="like-button" aria-label="like this post">&#9825; <span class="like-count">0</span></button>
</form>
```

`POST /api/like`, in order:

1. `path` must satisfy `isBlogPost()`, else 400.
2. The page must exist: `env.ASSETS.fetch(origin + path)` must be 200, else
   404. No counter rows for pages that do not exist.
3. Compute the voter key.
4. One D1 batch: `INSERT OR IGNORE` into `LikeVoters`, plus a purge of
   `LikeVoters` rows older than two days. If the insert changed a row
   (`meta.changes === 1`), upsert `Likes.count + 1`. A repeat like is a silent
   no-op, never an error.
5. `303 See Other` to `path + "#likes"`. The endpoint never renders a body.

There is no `onRequestGet`. A GET to `/api/like` falls through Pages Functions
to static assets and gets the site's 404. (Pages does not synthesise a 405 for
an unhandled method; the important property is that GET never mutates.)

### The voter key

```
voter = HMAC-SHA-256(SOCIAL_SECRET, ip + "|" + user_agent + "|" + YYYY-MM-DD in UTC)
```

`ip` is `CF-Connecting-IP`. The key changes at UTC midnight, so
`PRIMARY KEY (page, voter)` naturally scopes to one like per person per page
per day. Nothing that identifies the person is stored: without the secret the
hash is opaque, and even with it there is nothing to reverse. `LikeVoters` rows
are purged after two days on every call to `/api/like`.

The middleware computes the same key for the current request to decide whether
to render the button as already-liked (filled heart, `disabled`,
`aria-pressed="true"`). Both sides call `voterId()` in `_lib/social.js` so they
cannot drift.

## Replies

The reply affordance is a `mailto:` link with a prefilled subject:

```
mailto:reply@replies.danieldaum.net?subject=re:%20https://danieldaum.net/blog/SLUG/
```

Replying to a specific comment appends its guid as a URL fragment,
`%23<guid>`. The worker parses it back out to thread the reply. Threads render
from `parent IS NULL` downward, nested at most 6 deep (anything deeper is
flattened into the list at depth 6, not dropped), with a visited set guarding
against cycles. A reply whose parent was deleted is re-parented to the top
level at render time.

### The email worker, gate by gate

`workers/replies-inbound/src/index.js`, `email(message, env, ctx)`. Each step
short-circuits on failure. "Reject" means `message.setReject(reason)`, which
bounces with the reason; "drop" means `console.log` and return, no bounce.

1. **Authentication.** `Authentication-Results` must contain `dkim=pass` and
   at least one of `spf=pass` / `dmarc=pass`. Else drop (a bounce here would be
   backscatter).
2. **Parse** with `postal-mime`.
3. **Subject** must match
   `re: https://danieldaum.net/blog/<slug>/` with an optional `#<guid>`,
   case-insensitive, and the path must not be `/blog/micro/`. Else reject.
   This is the one user-fixable failure, so the bounce is useful.
4. **Page exists.** `HEAD https://danieldaum.net<path>` must be 200. Else
   reject.
5. **Parent.** If a guid was given it must be a live reply on the same post.
   Otherwise the reply is stored as top-level; never rejected for this.
6. **Body.** `text` part, or `html` with tags stripped. Every line starting
   with `>` is dropped, and everything from the first `On ... wrote:`,
   `-- Original Message` or `From: ` line onward is cut. Three or more blank
   lines collapse to two. Result must be 2 to 2000 characters, else reject.
   More than 2 URLs, reject.
7. **Sender** = `HMAC(SOCIAL_SECRET, lowercased address)`. The address is
   never stored and never logged.
8. **Rate limits.** In the last hour: at most 5 replies per sender, at most
   30 site-wide. Else drop.
9. **Name.** `From` display name trimmed, else the local part of the address.
   Control characters stripped, capped at 40 characters, stored raw.
10. **Insert** with a random UUID, ISO `created_at`, `approved = 1`.
    Nothing is held for moderation.
11. **Notify** me with a hand-built RFC 5322 plain-text message via the
    `NOTIFY` send_email binding, containing the name, the first 500
    characters, a link to the reply's anchor on the post, and a signed delete
    link. A notification failure is logged and does not undo the insert.

### Delete links and `/api/moderate`

The delete link is

```
https://danieldaum.net/api/moderate?id=<guid>&sig=<HMAC(SOCIAL_SECRET, "delete:" + guid)>
```

`GET /api/moderate` verifies the signature (constant-time compare; 403 with a
plain-text body on any mismatch or malformed id), looks the reply up, and
renders a confirm page: name, first 200 characters, the post path, and a form
that POSTs the same `id` and `sig` with one DELETE button. **GET never
mutates.** Mail clients and link scanners prefetch URLs in email; if GET
deleted, a security scanner could remove every comment before I ever saw the
notification.

`POST /api/moderate` verifies the same signature, sets
`deleted_at = datetime('now')`, and renders a one-line confirmation with a link
back to the post. Because `deleted_at` is checked in every read query, the
reply disappears from the page immediately.

`hmacHex` exists in two places, `functions/_lib/social.js` and
`workers/replies-inbound/src/lib.js`, and must stay identical. Both files say
so at the top.

## Adding the placeholders to a new post

`new-post-template.html` already carries them. Directly after the closing
`</section>` of `.post-body` and before `</main>`:

```html
        <section class="post-social" aria-label="likes and replies">
            <div id="likes" data-likes>
                <p class="meta">LIKES UNAVAILABLE</p>
            </div>
            <div id="replies" data-replies>
                <p class="meta">REPLIES UNAVAILABLE</p>
            </div>
        </section>
```

The middleware replaces the inner content of each `data-*` element. Whatever
is written inside them is the fallback: it is what visitors see if D1 throws,
the secret is missing, or anything else goes wrong. The middleware never
touches the page in that case (same rule as the PDS fallback in `MICRO.md`).
There is no allowlist to update: any path matching `isBlogPost()` is handled.

Transformed blog post responses carry `Cache-Control: private, no-cache` so
the back button after a like does not show a stale count.

## Secrets

One secret, `SOCIAL_SECRET`, set in two places with the same value.
Generate it once with `openssl rand -hex 32`.

| where | command |
|---|---|
| Pages project | `npx wrangler pages secret put SOCIAL_SECRET --project-name saturn` (repo root) |
| Email worker | `npx wrangler secret put SOCIAL_SECRET` (from `workers/replies-inbound/`) |

If the values differ, the worker's delete links will never verify on the Pages
side. Rotating the secret invalidates every outstanding delete link and resets
today's liked-state for everyone (the counts are unaffected).

Local dev reads `.dev.vars` (gitignored) in the repo root and in
`workers/replies-inbound/`. Any throwaway value works, as long as both files
agree.

## Local dev

Pages side:

- `mise run db-local` applies `schema.sql` to the local D1 (idempotent).
- `mise run preview` runs `wrangler pages dev .` on port 8788 with the `DB`
  binding, `ASSETS`, and `.dev.vars`. Likes, the thread, and `/api/*` all work.
- `mise run dev` (Vite) runs no Functions, so every placeholder shows its
  fallback text.

Worker side:

- `mise run replies-dev` runs `wrangler dev` in `workers/replies-inbound/` on
  port 8787 with `--persist-to ../../.wrangler/state`. That flag is the point:
  Pages dev and worker dev each default to their own `.wrangler/state`, which
  means two separate local D1 databases. Pointing the worker at the root's
  state directory makes a reply posted to the worker show up on the page
  served by `mise run preview`. Both configs must carry the same
  `database_id`; local D1 files are keyed on it.
- The worker's `.dev.vars` also sets `PAGE_CHECK_ORIGIN=http://localhost:8788`
  so the "page exists" gate checks the local preview instead of the live site.
  This variable is a dev-only override; it is not set in production and
  everything else (subject parsing, links, notification) always uses
  `https://danieldaum.net`.
- Feed the worker a message by POSTing raw RFC 822 to
  `http://localhost:8787/cdn-cgi/handler/email?from=<addr>&to=reply@replies.danieldaum.net`
  with `Content-Type: message/rfc822`. Local wrangler insists on a
  `Message-ID` header before the worker runs at all. The response body says
  whether the worker processed, rejected (with the reason), or errored.
  Silent drops look like "processed" from the outside; check the row count.
- Locally, `send_email` does not send. Each notification is written as an
  `.eml` under `workers/replies-inbound/.wrangler/tmp/email/`, which is where
  to find the delete link for testing `/api/moderate`.
- Worker dev serves an email handler only; a browser GET to port 8787 logs a
  "does not export a fetch()" error. That is expected.

Only the worker directory has a `package.json` (`postal-mime`). The repo root
has none and must not get one.

## Deploy

`.gitea/workflows/deploy.yaml` deploys the Pages project (unchanged).
`.gitea/workflows/deploy-replies-worker.yaml` deploys the worker on pushes
that touch `workers/replies-inbound/**`, or by hand. It runs `npm ci` in that
directory and `wrangler deploy` from it. Email Routing for
`replies.danieldaum.net` and the custom address `reply@` that targets the
worker are configured in the dashboard, not in code.

`wrangler pages deploy` uploads the repo root as static assets. Its built-in
ignore list is `functions`, `.wrangler`, `_worker.js`, `_redirects`,
`_headers`, `_routes.json`, `**/node_modules`, `**/.git`, `**/.DS_Store`, so
`workers/replies-inbound/src/*.js`, its `package.json` and `wrangler.toml` are
served as public files, the same way `MICRO.md` and `schema.sql` are. They
contain no secrets.

## Not implemented

Deliberately left out of this pass:

- per-reply likes
- a moderation queue (`approved` exists so this is a query change later)
- editing a reply
- an email confirmation to the commenter
- likes on micro posts
- deleting a reply from anywhere but the emailed delete link
- rendering links in reply bodies; URLs are plain text
