# Saturn

My minimalist personal website — hosted at [danieldaum.net](https://danieldaum.net).

Handwritten HTML and CSS, zero frameworks. Deployed on [Cloudflare Pages](https://pages.cloudflare.com/) with edge functions.

## Features

- **Blog** with Atom feed, manual publishing workflow, and no build step
- **Microblogging** — Bluesky posts pulled from a personal PDS and injected at the edge via Cloudflare Workers
- **Social features** — like counts and reply-by-email comments, rendered with zero client-side JavaScript
- **Email worker** — receives replies via Cloudflare Workers Email Handler, validates authentication, and stores in D1
- **Static-first** — the entire site is static HTML with server-side injection for dynamic content

## Stack

| Layer          | Technology                                                       |
| -------------- | ---------------------------------------------------------------- |
| Hosting        | Cloudflare Pages (static assets)                                 |
| Edge Functions | Cloudflare Pages Functions + Workers                             |
| Database       | Cloudflare D1 (SQLite)                                           |
| Dev tooling    | Vite (dev server), Wrangler (preview/deploy), mise (task runner) |
| Bluesky        | AT Protocol (PDS hosted on danieldaum.net)                       |

## Running locally

```bash
mise run dev          # Vite dev server (static HTML, no functions)
mise run preview      # Wrangler Pages dev (full stack with functions + D1)
```

No `package.json` at the repo root — Wrangler is fetched on-demand via `npx`.

## Docs

Documentation for publishing, likes, and replies:

- `FEED.md` — how to publish blog posts and maintain the Atom feed
- `MICRO.md` — how microblogging (Bluesky) injection works
- `SOCIAL.md` — how likes and reply-by-email comments work
