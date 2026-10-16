# social

likes and comments. everything for them lives in this folder, and none of it is served as a file.

## files

| file | what it does |
| --- | --- |
| `lib.js` | shared by everything: which pages are allowed, hashing, the html that gets written into a page |
| `functions/_middleware.js` | runs before a page is served and fills its `data-social` section from d1 |
| `functions/api/like.js` | the like button posts here |
| `functions/api/moderate.js` | the approve/delete page linked from new-comment emails |
| `email.js` | email worker: turns mail sent to `reply@replies.danieldaum.net` into comments |
| `schema.sql` | the d1 tables: `Likes`, `LikeVoters`, `Comments` |
| `wrangler.toml` | pages config (d1 binding) |
| `email.toml` | email worker config (d1 + send-email bindings) |
| `/_routes.json` | at the site root, because pages only reads it there. the paths the functions run on |

## how it works

**a page.** a visitor opens `/now/sep-2026/`. the path is in `_routes.json`, so `_middleware.js` runs. it finds `<section data-social>`, reads the like count and approved comments from d1, and writes them in. if anything fails, the page shows its fallback text ("likes and comments unavailable").

**a like.** the heart is a plain form (no js) that posts the page path to `/api/like`. the visitor is identified by a hash of ip + browser + today's date, so they get one like per page per day. the hash can't be reversed and is deleted after two days. a second like the same day does nothing.

**a comment.** "comment by email" opens a mailto with the post's url as the subject. cloudflare email routing hands the mail to `email.js`, which:

1. drops it if it fails dkim/spf, or if 20 comments already came in during the last hour (site-wide)
2. bounces it if the subject isn't a real post, the `name:` line is missing, or it's empty, too long, or has more than 2 links
3. cuts off quoted replies and signatures, then saves the name, comment, page and time. the sender's address is never saved
4. comments without links go live straight away. ones with a link wait for approval
5. emails me the comment with a signed link to `/api/moderate`

**moderating.** the link opens a page with approve/delete buttons. deleting removes the comment and its replies. replying to the notification email posts my answer under that comment, marked "author".

**replies** nest one level deep. a reply to a reply goes under the same top comment.

## adding likes and comments to a page

put this at the end of the post, inside `<article>` if it has one. the template already has it:

```html
<section class="post-social" id="comments" data-social aria-label="likes and comments">
    <p class="meta">likes and comments unavailable</p>
</section>
```

this works on `/about/`, `/now/<slug>/`, `/blog/<slug>/` and `/projects/<slug>/`. take the section out and the page has none.

`/now/` is a copy of the newest edition, so it points at that edition: `data-social="/now/<slug>/"`. update it with each new now post. comments always go on the edition, never on `/now/`.

### a new kind of page (e.g. `/books/<slug>/`)

1. add it to `isLikeable()` in `lib.js`: `(blog|now|projects)` → `(blog|now|projects|books)`
2. add `"/books/*"` to `/_routes.json`. every path in there runs a function and isn't cached, so keep it narrow
3. add the section to the pages
4. `mise run social-email`: the worker uses `isLikeable()` too, so it rejects comments for the new pages until it's redeployed

## deploying

- **functions:** automatic. on every push, ci (`.gitea/workflows/deploy.yaml`) runs wrangler from this folder
- **email worker:** `mise run social-email`, only when `email.js`, `lib.js` or `email.toml` change
- **secret:** `SOCIAL_SECRET` signs moderation links and like hashes. it's set on both the pages project and the worker:
  - `wrangler pages secret put SOCIAL_SECRET --project-name saturn`
  - `wrangler secret put SOCIAL_SECRET -c email.toml`

## locally

1. `echo 'SOCIAL_SECRET=anything' > .dev.vars` in this folder (gitignored)
2. `mise run social-dev`, then open localhost:8788

this uses a local, empty d1 in `.wrangler/`. comments can't be tested locally, but likes and the moderate page can.

## looking at the data

run these from this folder:

```
wrangler d1 execute saturn-social --remote --command "SELECT page, count FROM Likes"
wrangler d1 execute saturn-social --remote --command "SELECT id, page, name, approved FROM Comments ORDER BY created_at DESC LIMIT 10"
wrangler tail saturn-replies-inbound   # live worker logs, for when an email doesn't show up
```

to take a comment down without the email: `DELETE FROM Comments WHERE id = '...' OR parent = '...'`.
