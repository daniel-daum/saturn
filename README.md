# saturn

my personal site, live at [danieldaum.net](https://danieldaum.net). mostly handwritten html and css, no build step. the source lives on [tangled](https://tangled.org/danieldaum.net/saturn) and is mirrored to github and gitea. pushing to main deploys it.

## run it locally

```
mise install
mise run serve
```

then open localhost:8080.

## post on bluesky

post it. the sync pipeline runs once an hour and puts it on the home page, /blog/ and /posts/. to run it now: tangled → saturn → pipelines → the newest sync run → retry. `git pull` before working on the site again.

the same sync refreshes the recent commits on /projects/ and /projects/holonet/ (locally: `mise run sync-commits`).

## new blog post

1. `git pull`
2. copy `internal/template.html` to `blog/<name>/index.html` (or `now/<name>/` for a now page)
3. add it to the top of the writing list in `blog/index.html`
4. add it to recent writing on the home page, with the word count
5. add it to `feed.xml`
6. if it's a now page, update `/now/` too
7. push. the next sync puts it on standard.site

reviews go in the same writing list, tagged #game, #movie, #show, #book or #album. they don't go in the feed.

## new photos

1. upload the photo to r2, in `img/photos/`
2. add a tile and a lightbox to `photos/index.html`, newest first
3. copy a photo page to `photos/<name>/`
4. fix the newer / older links on the photos next to it

## good to know

- `internal/` never gets deployed. `internal/styles.html` shows every style on the site.
- ci lives in `.tangled/workflows/`: deploy and mirror run on every push to main, sync runs hourly. secrets are under settings → pipelines on tangled.
- `internal/site-guide.md` is the long version of all this, written for an llm to read before helping out.
