# publishing a post

from markdown in my editor to live on the site, in RSS and on standard.site.
`internal/` is never deployed.

## once

1. **make an app password.** bsky.app → settings → privacy and security → app
   passwords. it's made on my pds (home.daum.dev), which is what the script
   logs in to.
2. **save it** in `mise.local.toml` at the repo root. it's gitignored, so it
   never gets committed:

   ```toml
   [env]
   ATPROTO_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx"
   ```

   without it, `mise run publish` still updates the RSS feed but can't publish
   to standard.site.

## every post

### 1. make the page

1. copy `internal/template.html` to `SECTION/SLUG/index.html`, e.g.
   `blog/my-post/index.html` or `now/dec-2026/index.html`. how to structure the
   body: `internal/example.html`
2. replace everything in CAPS:
   - **`<head>`**: `POST TITLE` (3×), `SECTION/SLUG` (the `og:url`), and
     `ONE SENTENCE SUMMARY` (3×). the summary becomes the post's RSS summary
     and its standard.site description, so write it for someone who hasn't
     read the post
   - **header**: the `/SECTION` kicker (it becomes the RSS category), the
     `<h1>`, and the `<time datetime="YYYY-MM-DD">` (the published date)
   - **banner** (optional): uncomment it and fill in the photo. it becomes the
     RSS figure and the standard.site cover image
   - **body**: paste the post in, as html
3. **pager**: point prev/next at the neighbouring posts, or delete the card
   that has no post yet. then add a `next` card to the previous post pointing
   here
4. **code blocks** (if any): `mise run highlight SECTION/SLUG/index.html`

### 2. check it

```bash
mise run serve        # localhost:8080
mise run social-dev   # localhost:8788, with likes, comments and bluesky posts
```

likes and comments work on `/blog/SLUG/` and `/now/SLUG/` with no extra setup.
for a new section (e.g. `/books/SLUG/`), see `social/README.md`.

### 3. list it

- **`blog/index.html`**: add a row to the top of the writing list (copy one,
  change the href, title, tag and date)
- **`index.html`**: add the same row to the home page's writing list. it
  shows the newest five
- **now posts only**: copy the new edition over `now/index.html`, and set its
  `data-social="/now/SLUG/"` so likes and comments go to the edition. older
  editions link to `/now/`, so they keep pointing at the newest

### 4. publish

```bash
mise run publish SECTION/SLUG/index.html --dry-run   # see what would change
mise run publish SECTION/SLUG/index.html
```

this adds the post to `feed.xml` (RSS), publishes its standard.site record to
my pds, and adds a `<link rel="site.standard.document">` to the page. it
refuses a page that still has template text in it.

only run it on the post's own page, never on `/now/` (that's a copy).

### 5. ship

commit and push. ci deploys to cloudflare pages. the standard.site record is
already live from step 4; the page and feed go live with the deploy.

## fixing a typo later

edit the page, then run `mise run publish` on it again. the feed entry's
title and content are replaced and its `updated` date moves to now, so readers
see it was changed. its published date and summary stay as they were. if
nothing changed, nothing happens. then commit and push.

## good to know

- **the feed summary is never overwritten.** once an entry exists, edit its
  `<summary>` in `feed.xml` by hand if you want to change it
- **a post's standard.site record is tied to its date and path.** change
  either and it becomes a new record; delete the old one on the pds
- **bluesky posts** (the POSTS sections on `/`, `/blog/` and `/posts/`) need
  nothing: they come from bluesky on their own. see `social/README.md`
