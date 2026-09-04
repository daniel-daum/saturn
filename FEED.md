# Publishing to the feed

`/feed.xml` is hand-maintained. There is no build step and nothing generates it.
When you publish a post you edit two files: the post itself, and `feed.xml`.

Canonical base URL: `https://danieldaum.net` (apex, no `www`).

---

## The two rules that cannot be broken

**1. An `<id>` never changes once published.**
Feed readers use `<id>` to decide whether they have already shown an entry. If you
change it, every subscriber sees the post again as if it were brand new. If you
change it back, some readers will show it a third time. There is no way to undo
this from your end.

**2. A published post file is never renamed or moved.**
The `<id>` is the post's URL. Renaming `blog/foo/` to `blog/bar/` breaks rule 1
and 404s every link anyone has saved. If you must change a slug, keep the old
directory in place serving a redirect, and leave the feed entry alone.

Corollary: get the slug right *before* the first deploy. Afterwards it is frozen.

---

## Publishing a new post, in order

### 1. Create the post file

Copy the template:

```bash
cp new-post-template.html blog/YOUR-SLUG/index.html
```

Replace every placeholder:

| Placeholder | Replace with |
|---|---|
| `POST TITLE` | the title, in caps (appears twice: `nav-back` and `<h1>`) |
| `daniel daum - POST TITLE` | the `<title>` tag |
| `SLUG` | the directory name — must match exactly |
| `ONE SENTENCE SUMMARY - ...` | the `<meta name="description">` |
| `000 WORDS` | actual word count |
| `1 JANUARY 2026` | the publish date |
| `#TAG1` | your tags |

Write the summary once, in `<meta name="description">`, and reuse that exact
sentence in the feed. Do not write two different summaries for the same post.

### 2. Work out the canonical URL

This is the part that is easy to get wrong.

- A **file** at the repo root is served without a trailing slash:
  `about.html` → `https://danieldaum.net/about`
- A **directory** with an `index.html` is served **with** a trailing slash.
  Cloudflare Pages issues a `308` from the slashless form:
  `blog/my-post/index.html` → `https://danieldaum.net/blog/my-post/`

Use the form Cloudflare actually settles on — the one with the trailing slash for
directories. Verify before you commit:

```bash
curl -sSI https://danieldaum.net/blog/YOUR-SLUG | grep -iE '^(HTTP|location)'
```

A `200` means the URL is canonical. A `308` means use the `location:` value instead.

### 3. Add the entry to `feed.xml`

Insert it **directly below the `<!-- NEWEST FIRST -->` comment**, above the
existing top entry. Newest first, always.

```xml
  <entry>
    <title>Your Title In Sentence Case</title>
    <link rel="alternate" type="text/html" href="https://danieldaum.net/blog/YOUR-SLUG/" />
    <id>https://danieldaum.net/blog/YOUR-SLUG/</id>
    <published>2026-10-04T09:00:00-07:00</published>
    <updated>2026-10-04T09:00:00-07:00</updated>
    <category term="TAG" />
    <summary type="text">The same sentence you put in meta description.</summary>
  </entry>
```

`<id>` and the `<link href>` must be byte-identical to each other.

### 4. Update the feed-level `<updated>`

Near the top of `feed.xml`, above the first `<entry>`:

```xml
  <updated>2026-10-04T09:00:00-07:00</updated>
```

Set it to the **exact same value** as your new entry's `<updated>`. This is the
field pollers key off. If you forget this step, the post is in the file but
nothing notices it exists.

### 5. Validate before deploying

```bash
python3 -c "import xml.etree.ElementTree as ET; ET.parse('feed.xml'); print('ok')"
```

After deploying, run the live file through <https://validator.w3.org/feed/>.
A malformed feed fails silently — readers just stop updating, with no error
anywhere you would see it.

---

## Timestamps

RFC 3339, always, with an explicit offset. A bare date is invalid and will be
rejected.

```
2026-10-04T09:00:00-07:00    valid
2026-01-21T09:00:00-08:00    valid
2026-10-04                   INVALID - no time, no offset
2026-10-04T09:00:00          INVALID - no offset
```

Watch the offset when you cross daylight saving:

- **PDT is `-07:00`** — roughly March through early November
- **PST is `-08:00`** — roughly November through March

The existing January entry uses `-08:00` and the two later ones use `-07:00`.
That is correct, not an inconsistency.

Publish times are approximated at `09:00` local, since posts only carry a date.
Keep using `09:00` so ordering stays stable.

---

## Editing a post after publishing

Small typo fix: change nothing in the feed. Not worth resurfacing the post.

Substantive rewrite worth re-notifying subscribers about:

1. Change **only** that entry's `<updated>` to the new time.
2. Leave `<published>` alone — it records first publication.
3. Leave `<id>` alone. Always.
4. Update the feed-level `<updated>` to match, **only if** this is now the newest
   `<updated>` in the file.

Do not reorder entries on edit. Order follows `<published>`, not `<updated>`.

---

## The `/now` page has its own rule

`/now` is a living URL — it gets overwritten with each new edition, so it can
never be a feed entry. A reader that fetched "Wake Me Up When September Ends"
from `/now` would later find different content at the same URL.

So each edition gets archived to a dated, permanent directory, and **the feed
points at the archive, never at `/now`**:

- `/now/jan-2026/` — January 2026 edition
- `/now/sep-2026/` — September 2026 edition
- `/now/` — always a copy of the newest edition

When you write the next now page:

1. Copy the *current* `now/index.html` to `now/MONTH-YEAR/index.html` — this
   freezes the outgoing edition at a permanent URL.
2. In that new archive copy, change the blockquote to point readers at `/now` for
   the current edition.
3. Fix the `page-nav` pagers. The pager is not now-page specific: it walks the
   writing table on `/blog` from the oldest entry (bottom) to the newest (top),
   and every page in that table carries one. So the archive you just created
   gets `next` pointing at the new edition's archive URL, the new
   `now/index.html` (and its archive twin) gets `prev` pointing at the archive
   you just created and a disabled `next`, and any page between them in the
   table (an `/about` rewrite, a blog post) links to its neighbours.
4. Now overwrite `now/index.html` with the new edition.
5. Add a feed entry pointing at the **archive** URL, e.g.
   `https://danieldaum.net/now/oct-2026/`.
6. Repoint the two listing links at the new archive, so they keep pointing at the
   edition they name rather than drifting to whatever `/now` holds later:
   - `index.html` — the `recent-writing-list` entry
   - `blog/index.html` — the `content-table` row

   ```bash
   grep -rn '/now/sep-2026/' index.html blog/index.html
   ```

Never add a feed entry whose `<id>` is `https://danieldaum.net/now/`. Same rule
for the listing links in step 6 — they name a specific edition, so they must
point at that edition's permanent URL, never at `/now`.

---

## Adding the autodiscovery tag to new pages

Every HTML page carries this in `<head>`, immediately after the webmanifest link:

```html
<link rel="alternate" type="application/atom+xml" title="daniel daum" href="https://danieldaum.net/feed.xml" />
```

`new-post-template.html` already has it. If you hand-write a page from scratch,
add it. To find pages missing it:

```bash
grep -rL 'application/atom+xml' --include='*.html' .
```

The `FEED` link in the footer is separate — that one is for humans. New pages
need both.

---

## Content type

`_headers` sets the MIME type Cloudflare serves `feed.xml` with:

```
/feed.xml
  Content-Type: application/atom+xml; charset=utf-8
```

Without this it goes out as `application/xml` or `text/xml`, which mostly works
but is not what some pollers expect. Do not remove it.

---

## robots.txt

`robots.txt` denies the default `User-agent: *` group everything except the feed:

```
User-agent: *
Allow: /feed.xml
Disallow: /
Crawl-delay: 10
```

`Allow: /feed.xml` wins over `Disallow: /` because Google and Bing resolve
conflicts by longest matching path, and `/feed.xml` is longer than `/`. So
pollers that respect robots.txt — annot.at, and anything else you point at the
feed later — can fetch it, while the rest of the site stays closed to them.

The named AI-bot groups (`GPTBot`, `CCBot`, `Claude-Web`, and the rest) still get
a bare `Disallow: /`. A user-agent-specific group replaces the `*` group entirely
rather than merging with it, so those crawlers are blocked from `/feed.xml` too.
That is intentional — do not add an `Allow` line to any of them.

If you ever move the feed, update the `Allow` path to match or pollers go dark
with no error anywhere you would see it.
