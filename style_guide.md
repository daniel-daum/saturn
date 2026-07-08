# saturn style guide

A reference for the visual and editorial conventions used across danieldaum.net. This document is the "why" and "when" — for the literal CSS values and rendered components, see the live reference at `/garden/styles` (source: `garden/styles/index.html`), which stays in sync with `global.css` by construction. Keep both in sync when either changes.

## visual system (summary)

Full detail lives at `/garden/styles`. Quick reference:

**Palette** (dark, single accent)

| token | value | use |
|---|---|---|
| `--background-dark` | `#141e15` | page background |
| `--borders` | `#273028` | hairlines, dividers, card borders |
| `--accent-muted` | `#354037` | inline code bg |
| `--text-secondary` | `#a8ad98` | meta, captions, secondary labels |
| `--text-body` | `#e0e2ce` | paragraph text |
| `--text-headings` | `#f3f4e2` | h2, inline code text |
| `--accent` | `#cddc39` | h1, h3, links, tags, focus rings |

**Type**: `Ioskeley Mono` (weights 300/400/600/700), falling back to Geist Mono / SF Mono / system monospace. Body copy is `1rem`, `line-height: 1.8`, measure capped at `68ch`.

**Scale**: h1 `1.75rem` (accent, bold) → h2 `1.35rem` (headings color, semibold) → h3 `1.15rem` (accent, semibold) → body `1rem` → `.meta` `0.85rem` → `.section-label` `0.78rem` (uppercase, tracked) → tiny/tag `0.72–0.82rem`.

**Components**: `.content-table` (listings, with or without date/tag columns), `.home-project-card` (homepage grid), `.project-card` (projects listing, hover glow), `.project-header` / `.project-stats` (project detail pages — stacked title/desc, then a label/value stat strip), `.two-col-list` (side-by-side lists). Don't invent new listing patterns — reuse `.content-table`; don't invent new card patterns — reuse the existing card class that matches the context.

**Motion/a11y**: respects `prefers-reduced-motion`, `prefers-contrast: high`, and has real print styles. Any new interactive component should account for all three, matching what `global.css` already does for existing components.

## voice & text formatting

The site mixes two registers on purpose: lowercase **chrome** and properly-cased **prose**. The rule of thumb:

> **Lowercase for chrome, sentence case for prose.**

- **Chrome** — short, label-like, structural text that isn't read as sentences: nav, footer, page `<h1>` titles, `.section-label` headers, `.meta` text (dates, timestamps), image captions, table tags, photo names/locations. These read fine lowercase because there's no sentence structure to parse — it's closer to a wordmark than writing.
- **Prose** — anything meant to be read continuously across multiple sentences: bio paragraphs, blog posts, now-page updates, project descriptions. Capitalization here isn't decoration, it's a reading aid — sentence starts, proper nouns, and especially the word "I" give the eye places to land. Running prose fully lowercase is exactly what feels off in long form.

### the one hard rule

**Always capitalize the pronoun "I."** A lowercase "i" is the single biggest readability cost in lowercase prose — it's a one-letter word that visually disappears without the capital, forcing the reader to do extra work mid-sentence. Plenty of otherwise-casual lowercase writing styles still capitalize "I" for exactly this reason. This applies everywhere prose appears, even if the surrounding sentence stays casual/lowercase in tone.

### reference table

| element | convention | status |
|---|---|---|
| nav, footer links | lowercase | consistent |
| page `<h1>` titles (about, now, garden, blog) | lowercase | consistent |
| `.section-label` / h2-as-label (recent writing, projects) | lowercase | consistent |
| `.meta` text, dates, timestamps | lowercase | consistent |
| image captions (`figcaption`) | lowercase | consistent |
| table tags (`#blog`, `#now`, `#project`), photo names/locations | lowercase | consistent |
| about bio prose | sentence case, "I" capitalized | correct — treat as the model for prose |
| now-page prose | sentence case, "I" capitalized | consistent |
| project description prose (`/projects/saturn`) | sentence case, "I" capitalized | consistent |
| homepage `<h1>` (the big bio tagline) | sentence case | correct — the one sanctioned exception to lowercase `<h1>`s, since it reads as a statement rather than a page title |
| hero `.meta` subtitle beneath the `<h1>` (every page, including homepage) | lowercase | consistent — chrome, regardless of whether that page's `<h1>` is lowercase or (homepage's) sentence case |
| blog post titles (table rows) | lowercase | **chrome, by design** — titles in listings act like headlines/labels, not prose. Leave lowercase even once linked posts exist. |

### applying this

- Write **now-page updates and project description prose in sentence case**, capitalizing "I," sentence starts, and proper nouns — this is the standing rule for any new prose added to those pages.
- Table titles, nav, meta, and labels stay lowercase — don't "fix" these, they're intentional and shouldn't be swept up when doing a prose capitalization pass.
- The hero `.meta` subtitle right under a page's `<h1>` is always chrome, never prose — lowercase it even on the homepage, even though the homepage `<h1>` itself is the sentence-case exception.
- When editing an existing prose page, convert it in full rather than partially — mixed capitalization within one block of prose reads as a typo, not a style choice.

## other conventions

- **"last updated" footer line**: only the homepage has one. Every other page's footer omits it — don't add it back to `about.html` or elsewhere.

## commit conventions

Simple single-line commits, `type: description` — lowercase, no scope, no period:

- `feat:` a new feature
- `fix:` a bug fix
- `docs:` documentation only
- `style:` formatting, no logic change
- `perf:` performance improvement
- `test:` adding or fixing tests
- `build:` build system or dependencies
- `ci:` ci pipeline or workflows
- `chore:` maintenance, no src change
- `revert:` undo a previous commit
