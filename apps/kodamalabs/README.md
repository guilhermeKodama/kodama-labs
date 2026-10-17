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

## Figures

Each figure has a folder in `src/figures`: its data (`*-data.ts`, all invented), its component, and a timeline in `src/motion/timelines`. `src/figures/__tests__/port.test.tsx` compares every figure with its drawing in the mockup, shape for shape and word for word, so a figure can be refactored without drifting from the design.

Every figure is drawn twice, and CSS shows the one that fits:

- **wide** (`*-figure.tsx`), across the page, with the spine as a vertical line. Shown from the `wide` breakpoint up; the four smaller figures from `nav` up.
- **narrow** (`*-narrow.tsx`), on a 340-unit sheet that reads top to bottom, where the gate is a horizontal rule the flow crosses on its way down. There is no mockup of these; `narrow.test.tsx` holds them to the same rules (words from the messages, text inside the sheet, every gate on a gate rule).

Both drawings of a figure play the same timeline, so they have the same parts; a narrow part that runs down the sheet asks for its verb turned (`m(key, true)`). A drawing taller than a phone can play its timeline in acts (`scope(timeline, from)`), each starting when the reader reaches it.

## Motion

A figure's markup carries its own schedule and CSS plays it; see the header of `src/motion/timeline.ts`. A figure plays when the reader scrolls to it, the spine is inked as far as they have come, and a few sentences are inked when reached. With reduced motion or without JavaScript the page is simply the static page.

What the reader can do: replay a figure, undo and confirm the import in the Capital figure, point at a node of the Sentinel pipeline to trace what feeds it, and turn motion off in the footer (remembered in `localStorage`).

To look at a timeline:

- `?m=slow` plays everything at a quarter of the speed.
- `?m=<figure>@<ms>` (or `?m=all@<ms>`) freezes a figure at that point.
- `?m=off` turns motion off.
- `window.__m` offers `replay(id)`, `seek(id, ms)`, `undo(id, ms)`, `resume(id)`, `enable(on)` and `state()` in the console.

## Checks

```sh
pnpm --filter @wallex/kodamalabs lint
pnpm --filter @wallex/kodamalabs typecheck
pnpm --filter @wallex/kodamalabs test
pnpm --filter @wallex/kodamalabs build
```

## Deploy

`kodamalabs-web` in the root `docker-compose.yml` (`kodama-prod`), port 3003. The footer shows the commit and date of the build when they are passed in:

```sh
KODAMALABS_COMMIT=$(git rev-parse --short HEAD) KODAMALABS_BUILT_AT=$(date -u +%F) docker compose build kodamalabs-web
```

The Cloudflare tunnel routes `kodamalabs.ai` and `www.kodamalabs.ai` at it. DNS cutover is done on the registrar, not in this repo.
