# @wallex/kodamalabs

The homepage of kodamalabs.ai: Guilherme Kodama as an engineer, and the systems he builds and runs.

One notation runs through the page. A dashed stroke is something a machine proposed, a solid stroke is committed, and the one green line (the spine) is the gate where a person or a fail-closed check decides.

- **Stack**: Next.js 16 · React 19 · Tailwind v4 · next-intl. No UI kit and no animation library.
- **Locales**: English. A locale goes live when it is listed in `src/messages/published.json`.
- **Theme**: follows the system (`prefers-color-scheme`); there is no toggle.

## Run locally

```sh
# from the repo root
pnpm install
pnpm --filter @wallex/kodamalabs dev
```

Opens at http://localhost:3003.

## Where things are

| Path | What |
|---|---|
| `design/main.dc.html` | The approved mockup, kept as the porting spec. Never imported. |
| `src/messages/<locale>/` | Every word a reader sees. Components hold no text (a lint rule enforces it). |
| `src/content/facts.ts` | Facts only the owner knows, each `known` or `unknown`. An unknown fact is not rendered. |
| `src/styles/` | Tokens (the only file with colour literals), the Tailwind theme, the page grid, the figure notation. |
| `src/components/` | The page: header, sections, footer, layout rows. |
| `src/figures/` | The drawings: shared primitives and one folder per figure. All data in them is invented. |
| `src/motion/` | How the figures move: timelines as data, the CSS that plays them, a small controller. |

## Motion

A figure's markup carries its own schedule and CSS plays it; see the header of `src/motion/timeline.ts`. With reduced motion or without JavaScript the page is simply the static page.

To look at a timeline:

- `?m=slow` plays everything at a quarter of the speed.
- `?m=<figure>@<ms>` (or `?m=all@<ms>`) freezes a figure at that point.
- `?m=off` turns motion off.
- `window.__m` offers `replay(id)`, `seek(id, ms)` and `state()` in the console.

## Checks

```sh
pnpm --filter @wallex/kodamalabs lint
pnpm --filter @wallex/kodamalabs typecheck
pnpm --filter @wallex/kodamalabs test
pnpm --filter @wallex/kodamalabs build
```

## Deploy

`kodamalabs-web` in the root `docker-compose.yml` (`kodama-prod`), port 3003. The Cloudflare tunnel routes `kodamalabs.ai` and `www.kodamalabs.ai` at it. DNS cutover is done on the registrar, not in this repo.
