# AGENTS.md

Review guidance for this repo. Personal site, served by Cloudflare Pages.

## What this is

Hand-written static HTML, one file per page, no build step and no bundler.
Vite is dev-server only; deploying is `git push` to `main`. Pages are plain
files, so there is no template layer and shared markup (the `<head>`, the
header, the footer) is genuinely duplicated across pages on purpose.

Dynamic behaviour lives at the edge in `functions/`, not in the browser.

## Invariants — flag any change that breaks one

**No client-side JavaScript.** There is not one `<script>` tag on the site and
no inline handlers. Likes and replies work as plain form POSTs handled by edge
middleware. A change that adds JS to a page breaks the core constraint.

**Edge code fails open.** `functions/_middleware.js` must serve the page's
static fallback markup on any error from D1 or the PDS, never a 500 and never a
broken page. Any new `catch` that rethrows, or new code that can throw before
`context.next()` resolves, is a bug.

**Escape everything from outside.** Reply bodies, Bluesky post text and any
other remote or user-supplied string must go through `escapeHtml` before it
reaches HTML.

**`_routes.json` stays in step** with `ALLOWED_PATHS` in
`functions/_middleware.js` and `isBlogPost()` in `functions/_lib/social.js`.
Adding a dynamic path in one place and not the others silently disables it.

**Feed IDs are permanent.** A published `<id>` never changes and a published
post directory is never renamed or moved — it re-notifies every subscriber and
404s saved links. `/now/` is a living URL and must never be a feed entry; each
edition is archived to a dated directory first. See `FEED.md`.

**Secrets stay out of the repo.** `.dev.vars` is gitignored; bindings and
secrets are configured in Cloudflare, not committed.

## Conventions

- **Colours come from the custom properties** in the `html {}` block of
  `global.css` (`--accent`, `--text-body`, `--text-secondary`, `--borders`, the
  rating scale). Flag hardcoded hex in new CSS. Adding a token means adding it
  to the `prefers-contrast: high` block too.
- **Fonts are self-hosted only** (`assets/fonts/`, woff2, preloaded). No font
  CDNs.
- **The CSP is a per-page `<meta>` tag.** Any new external origin has to be
  added to the CSP on every page that loads from it, or it will be blocked in
  production but not in dev.
- **The `og:`/`twitter:` block is duplicated in every page's head** and
  maintained by hand. If a PR changes it in one page it should change it in all
  of them; only title, description and `og:url` differ per page.
- **URLs**: directory pages are canonical with a trailing slash
  (`/garden/books/`), root-level pages without an extension (`/about`). Pages
  308-redirects the other forms.
- **Accessibility is part of review**: semantic elements, `aria-label` on nav
  landmarks, `aria-hidden` on decorative glyphs, visible `:focus-visible`
  styles, and the `prefers-reduced-motion` / `prefers-contrast` blocks kept
  working.
- **Comments explain why, not what.** Match the existing lowercase, prose style.

## Out of scope — do not raise these

- Suggesting a framework, static-site generator, template engine, bundler or
  build step. The absence of one is the design.
- Flagging duplicated `<head>`, header or footer markup as a DRY problem. With
  no build step, duplication is the only option.
- Suggesting client-side JS, analytics, trackers or third-party embeds.
- Suggesting a test suite or CI test job for static HTML and CSS.
- Adding npm dependencies to the site itself. `workers/` may have them.
- Style nits already settled by the existing file: lowercase page titles and
  comments, uppercase display text in markup.

## Priorities

Rank findings: broken invariants above > correctness in `functions/` >
accessibility and CSP regressions > everything else. Prefer few specific
comments over broad ones. If a change is a deliberate deviation the author
explained in a comment, leave it alone.
