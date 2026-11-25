# saturn

Source for [danieldaum.net](https://danieldaum.net), my personal site: a blog, projects, and a digital garden of books, games, films and photos.

## Stack

- Hand-written HTML and CSS
- Likes and comments use on Cloudflare Pages Functions and D1 (`social/`)
- Hosted on Cloudflare Pages

## Run locally

```bash
mise run serve        # static site on :8080
mise run social-dev   # with likes and comments on a local D1
```

## Publishing a post

Every step, from markdown to live: [`internal/publishing.md`](internal/publishing.md). The short version: put the post in a page from `internal/template.html`, check it in the browser, then:

```bash
mise run publish now/some-post/index.html --dry-run   # see what would change
mise run publish now/some-post/index.html
```

This adds the post to `feed.xml` (or updates it, if it's already there) and publishes it to [standard.site](https://standard.site) as a record on my PDS, so atproto readers can follow it. The page gets a `<link rel="site.standard.document">` and `/.well-known/site.standard.publication` is kept up to date. Running it again is safe: an unchanged post changes nothing.

standard.site needs a Bluesky app password in `ATPROTO_APP_PASSWORD`, e.g. in a gitignored `mise.local.toml`:

```toml
[env]
ATPROTO_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx"
```

Without it, the feed is still updated and nothing is written to the PDS; a post whose record is already there still gets its link tag. Adding the post to `/blog/` and the home page's writing list is still by hand.

## Source

Developed on [git.danieldaum.net](https://git.danieldaum.net/daniel-daum/saturn), mirrored to [Tangled](https://tangled.org/danieldaum.net/saturn) and [GitHub](https://github.com/daniel-daum/saturn).

## License

Code is MIT. Photos, writing and other content are © Daniel Daum, all rights reserved. See [LICENSE](LICENSE).
