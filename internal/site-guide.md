# saturn: how my site works

A guide for an assistant helping me with danieldaum.net. Read all of it before changing anything. When this guide and the code disagree, the code wins. Tell me about the mismatch.

## the basics

- Handwritten HTML and one stylesheet (`global.css`). No framework, no build step, and no JavaScript on public pages.
- The source lives on Tangled: https://tangled.org/danieldaum.net/saturn (`origin`, `git@tangled.org:danieldaum.net/saturn`). GitHub and my Gitea are read-only mirrors.
- Hosting is Cloudflare Pages. Pushing to `main` on Tangled runs `.tangled/workflows/deploy.yml` on the public spindle. It copies every tracked file except `internal/`, `scripts/`, `.tangled/`, `.gitignore` and `mise.toml`, and deploys them. CI details are in section 6.
- Images live on R2, served from `https://assets.danieldaum.net/img/...`. Photos are `img/photos/<name>.webp`.
- `.well-known/atproto-did` verifies my Bluesky handle (`danieldaum.net`, DID `did:plc:e3z5gj5iyuwgqao562bo4bdf`). Leave it alone.
- Local preview: `mise run serve`, then open http://localhost:8080.

## rules that matter

- **CSP.** Every public page has a `Content-Security-Policy` meta tag with `style-src 'self'`. That means no `style=""` attributes and no `<style>` blocks. Only files in `internal/` may use inline styles. If a page loads images from a new host, add that host to its `img-src`.
- **Caps are CSS only.** Write normal case in HTML. Elements that show in caps are listed in the caps rule near the end of `global.css`, and the `.caps` class does the same for anything else.
- **Links.** Internal links end in a slash (`/now/sep-2026/`). Underlines only apply to links without a class inside `p`, `li`, `td`, `dd`, `blockquote` and `figcaption`. Links with a class style themselves.
- **Colour.** Lime (`--accent`) is for navigation and actions only. Labels, tags and dates are grey.
- **Style guide.** `internal/styles.html` shows every component. Update it when a component changes.
- **Never commit or push for me.** Show me the changes and I'll commit them.

## my voice

First person, casual and plain. Short sentences, the odd exclamation mark, and dry asides ("yay."). Headings and labels are short and lowercase in the source (CSS capitalises some of them). No marketing language. Example: "I built this site to practice writing, share my thoughts, and publish things I find interesting."

## folders

```
index.html            home: recent writing, projects
blog/index.html       the writing list (ol.archive)
now/index.html        a copy of the newest now post
now/<slug>/           now posts (now/jan-2026/, now/sep-2026/)
about/                about page (a post, with a 3-photo banner row)
photos/               photo wall + photos/<name>/ pages
games/ movies/ shows/ books/ music/   trackers + one page per entry
projects/             project cards + projects/<name>/ pages (saturn, holonet, rhea)
garden/ ratings/ changelog/ privacy/
feed.xml              atom feed, long-form posts only
internal/             never deployed: template.html, example.html, styles.html, this guide
scripts/              word-count.py
.tangled/workflows/   deploy.yml, mirror.yml (ci, see section 6)
.well-known/          atproto-did
```

---

## 1. publishing a new blog post or now post

Work out the slug (`now/oct-2026`, `blog/some-title`) and the date first.

1. `git pull`.
2. **Copy the template:** `internal/template.html` → `<section>/<slug>/index.html`. Replace everything in CAPS:
   - `<title>`, `og:title` and `twitter:title`: `daniel daum - Post Title`.
   - `description`, `og:description` and `twitter:description`: one sentence, the same in all three (it's also the feed summary).
   - `og:url`: the full URL.
   - The kicker: `now` or `blog`.
   - The title in `<h1>`.
   - The date: `<time datetime="2026-10-01">1 October 2026</time>`.
3. **Structure.** Follow `internal/example.html`:
   - one short intro note in a blockquote
   - 2–4 `h2.caps` groups, and never a heading over fewer than two paragraphs
   - paragraphs of 3–6 sentences
   - media as `h4` labels over lists, one title per line
   - end on a plain paragraph with no heading
4. **Banner (optional):** see section 2.
5. **Pager:** the post's pager links to the previous post in date order across all writing (now posts and about mixed). Give the new post a `← previous` card pointing at the current newest post. Then add a `next →` card to that older post, and to `/now/index.html` if it's a copy of it. Remove any card with nothing to point to.
6. **`/blog/`:** add a row at the top of `ol.archive` in `blog/index.html`:
   ```html
   <li>
       <a class="archive-row" href="/now/oct-2026/">
           <span class="archive-title">Post Title</span>
           <span class="archive-tag">#now</span>
           <time class="archive-date" datetime="2026-10-01">01 Oct 26</time>
       </a>
   </li>
   ```
7. **Home page:** add it to the top of "recent writing" in `index.html`. The list currently shows the two newest, so ask me before removing the oldest. Get the word count with `mise run words now/oct-2026/index.html`.
   ```html
   <li class="recent-writing-item">
       <p class="recent-writing-tag">#now</p>
       <h3 class="recent-writing-title">
           <a href="/now/oct-2026/">Post Title</a>
       </h3>
       <ul class="recent-writing-meta">
           <li>512 words</li>
           <li>
               <time datetime="2026-10-01">1 October 2026</time>
           </li>
       </ul>
   </li>
   ```
8. **`feed.xml`:** add an `<entry>` at the top (newest first) and set the feed's top-level `<updated>` to match. Copy an existing entry's shape:
   - `title`, `link`, `id` (the full URL), `published` and `updated` as `2026-10-01T09:00:00-07:00`, `<category term="now" />`.
   - `summary`: the meta description, word for word.
   - `content type="html"` in CDATA: the post body. Banner first, as `<figure><img ... /></figure>`. Absolute URLs, no `class`/`aria-*`/`target`/`rel` attributes, one block per line, indented 6 spaces.
9. **Now posts only:** replace the article in `now/index.html` with the new post's article.
10. Check it locally, then show me the diff for me to commit and push.

When an existing post changes, also update its word count on the home page and its `<content>` in `feed.xml`.

## 2. banners

A banner is an optional photo across the top of a post. It must already be on `/photos/` and have its own photo page, and the banner links to that page.

```html
<a class="post-banner" href="/photos/lake-tahoe-boat/" aria-label="photo details: Boat on Lake Tahoe">
    <img src="https://assets.danieldaum.net/img/photos/lake-tahoe-boat.webp" alt="a boat crossing Lake Tahoe" />
</a>
```

It goes first inside `<article>`, before the post header. Use the photo's title and alt text exactly as they are on `/photos/`.

**How it crops.** Don't edit the file. The CSS crops it live:

- Desktop shows a **2:1** strip, phones (≤480px) show **4:3**. The image fills the box (`object-fit: cover`), centred by default.
- A portrait photo (3:4) only shows a band about 3/8 of its height on desktop. A landscape photo (4:3) shows about 2/3 of its height.
- To move the visible area, add a class to the `<a>`:
  - `post-banner--high` shows nearer the top (30%)
  - `post-banner--low` shows nearer the bottom (70%)
  - `post-banner--left` shows nearer the left (30%)
  - `post-banner--right` shows nearer the right (70%)

How to choose: picture a horizontal strip half as tall as the photo is wide. A good banner has its subject inside that strip, with plain space (sky, water, sand) above and below that can be lost. Horizons, skylines and wide landscapes work well. Faces and tall subjects don't, because they get cut. If the subject sits outside the 30/50/70% positions, choose another photo rather than editing the file, because the same file is used full size on its photo page.

**Three photos side by side** (like `/about/`):

```html
<figure class="post-banner post-banner--row">
    <img src=".../a.webp" alt="..." />
    <img class="post-banner--left" src=".../b.webp" alt="..." />
    <img src=".../c.webp" alt="..." />
</figure>
```

No link here. Phones show only the middle photo, so put the best one in the middle.

## 3. adding photos

For each photo I give you: file name, title, location, date, mood (film simulation, may be blank), and the camera (always the same unless I say otherwise).

1. I upload `<name>.webp` to R2 under `img/photos/`. Check the URL loads before using it.
2. Look at the photo and write lowercase alt text that describes it plainly. Don't identify people.
3. **`photos/index.html`, the wall.** Newest first. The tile id is the page name, and its lightbox is `#view-<name>`:
   ```html
   <figure class="photo-tile photo-tile--new" id="NAME">
       <a class="photo-link" href="#view-NAME" aria-label="view full size: TITLE">
           <img src="https://assets.danieldaum.net/img/photos/FILE.webp" alt="ALT" loading="lazy" />
       </a>
       <figcaption class="photo-caption">
           <span class="photo-caption-name">TITLE <span class="new-tag">New!</span></span>
           <span class="photo-caption-location">City, California</span>
           <span class="photo-caption-date">7 October 2026</span>
       </figcaption>
   </figure>
   ```
   Only the newest batch gets `photo-tile--new` and the `New!` tag. Remove both from the previous batch.
4. **The lightboxes**, in the same order under `<!-- ===== LIGHTBOXES ===== -->`:
   ```html
   <div class="lightbox" id="view-NAME" role="dialog" aria-label="TITLE, full size" tabindex="-1">
       <a class="lightbox-backdrop" href="#NAME" tabindex="-1" aria-hidden="true"></a>
       <figure class="lightbox-content">
           <img src="https://assets.danieldaum.net/img/photos/FILE.webp" alt="ALT" loading="lazy" />
           <figcaption class="lightbox-meta">
               <p class="lightbox-meta-name">TITLE</p>
               <a class="lightbox-details" href="/photos/NAME/">details &rarr;</a>
           </figcaption>
       </figure>
       <a class="lightbox-nav lightbox-prev" href="#view-PREVIOUS" aria-label="previous photo">&lsaquo;</a>
       <a class="lightbox-nav lightbox-next" href="#view-NEXT" aria-label="next photo">&rsaquo;</a>
       <a class="lightbox-close" href="#NAME" aria-label="close full size photo">&times;</a>
   </div>
   ```
   Prev and next follow wall order and **loop**: the first photo's prev is the last photo, and the last photo's next is the first. Fix the neighbours' links too.
5. **The photo page:** copy any `photos/<name>/index.html`, then replace the title, description, `og:` and `twitter:` tags, image `src` and alt (it appears in several places), the date, location and mood line. Leave out the `MOOD:` line if there's no mood. The camera line is `iPhone 16 Pro · Main 24mm &fnof;/1.78 · 12MP · ISO 64 · 0EV`.
6. **Pager:** `← newer` and `older →` follow wall order, with no looping. The first photo has no newer card and the last has no older card. Update the photo pages next to the new ones.
7. Check that every `#view-...` and `/photos/.../` link points at something that exists.

## 4. notes (reviews)

Every game, movie, show, book and album has a page (`games/<slug>/` and so on) with a review section:

```html
<section class="entry-review" aria-label="review">
    <h2 class="section-label">review</h2>
    <p>Review text.</p>
</section>
```

- **Ratings** are out of 5 and link to `/ratings/`. Use the class for the score:

  | Score | Class |
  |---|---|
  | 1 | `rating--terrible` |
  | 2 | `rating--below-average` |
  | 3 | `rating--good` |
  | 4 | `rating--above-average` |
  | 5 | `rating--great` |

  Example: `<a class="rating rating--great" href="/ratings/" aria-label="rated 5 out of 5, see my rating scale">(5/5)</a>`. Unrated: `class="rating"`, `(?/5)`, `aria-label="not yet rated, see my rating scale"`.
- When a review is written, add it to the `/blog/` writing list like a post. Link it to the entry page and tag it `#game`, `#movie`, `#show`, `#book` or `#album`.
- Notes **never** go in `feed.xml`.
- The ~130 empty entries are a backlog. Don't list them on `/blog/` until they have a review.

## 5. projects

A project shows up in three places, newest first:

1. **Home page:** a `.card` in the projects `.card-grid`, before the "all projects" card.
2. **`/projects/`:** a `.project-card`. The left side has the type line, name, description and pills. The right side has a screenshot (`.project-card-img`) or, before there is one, a commit log.
3. **`projects/<name>/`:** copy `projects/saturn/` (with a screenshot) or `projects/holonet/` (with the commit log in the banner).

**Pills.** `<div class="pills">` with `<span class="pill">#new</span>`. `#in-development` also carries `pill--dev`, a pulsing dot that is commented out in `global.css` for now. They're grey, never lime. Take them off when the project isn't new any more.

**Commit log.** Written by hand: one `li.commit-log-row` per commit inside a `.commit-log`, with the short hash, the first line of the message and the date (`09 Sep 26`). On the `/projects/` card, the log is `aria-hidden` because the whole card is a link, and it hides the hash to save room.

## 6. ci (tangled spindle)

Two workflows in `.tangled/workflows/`, run by the public spindle (`spindle.tangled.sh`). Status shows under Pipelines on the repo page.

- **deploy.yml** (every push to `main`): stages the public files and runs `npx wrangler@4 pages deploy`.
- **mirror.yml** (every push to `main`): force-pushes the newest `main` to GitHub (https + token) and Gitea (ssh to `git-ssh.danieldaum.net:2222`, which skips Cloudflare; https to `git.danieldaum.net` goes through Cloudflare's bot protection, which blocks spindle at random). Never push to those directly; it gets overwritten.

**Secrets** (Tangled → saturn → Settings → Pipelines): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GH_MIRROR_TOKEN` (GitHub, contents write on this repo) and `GITEA_MIRROR_KEY` (private half of the `spindle-mirror` SSH key on my Gitea account).

**Gotchas** (nixery engine):

- There's no "run workflow" button. A manual run is the Retry button on an existing run.
- All steps share one container and run `bash -c` without `set -e`, so multi-line steps start with `set -euo pipefail`.
- Images only have bash, git, coreutils, tar and zstd. Anything else (`gnugrep`, `findutils`, `nodejs`, `openssh`) goes under `dependencies: nixpkgs:`.
- Big nixpkgs packages can time out on nixery with a 504 (`wrangler` did). Prefer `npx` for those.
- The checkout is one commit deep (`clone.depth: 0` also means 1). `git fetch --unshallow origin` for full history.
- There's no `/etc/passwd`, which `ssh` needs. mirror.yml writes one before pushing.

## 7. don't

- Don't add JavaScript, inline styles, new external hosts or anything that needs a server to public pages without asking.
- Don't use `#view-...` links outside `/photos/`. Posts and banners link to `/photos/<name>/`.
- Don't commit `.claude/launch.json` or anything with a password in it.
- Don't re-add `@view-transition` (it caused unstyled loads in Safari).
- Don't push to GitHub or Gitea. They're mirrors of Tangled.
- Don't commit or push. Show me the changes instead.
