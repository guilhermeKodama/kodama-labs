# Ideas — Validation Product Line

A home for fast, structured idea validation. Every idea here lives by the same playbook: write a one-pager, build a 5-day prototype, run paid traffic, decide go/no-go at week 4.

## Active ideas

| Idea | Status | Started | Decision gate |
|---|---|---|---|
| [milhasgrupo](milhasgrupo/validation.md) | Hypothesis | 2026-05-25 | week 4 |

> Update this table when an idea moves between **Hypothesis → Validating → Validated → Killed**.

## Read these before you write anything

1. [Golden rules](_rules/golden-rules.md) — non-negotiables. Time-boxes, build constraints, anti-patterns.
2. [One-pager template](_rules/one-pager-template.md) — the structure every `validation.md` follows.

## Start a new idea

```sh
pnpm new:idea <slug>
```

`<slug>` must be kebab-case, no leading underscore. The script:

1. Copies `ideas/_template/` to `ideas/<slug>/`.
2. Renames the package to `@ideas/<slug>`.
3. Seeds `validation.md` from the one-pager template.

Then:

```sh
# From repo root (preferred — keeps you next to turbo cache):
pnpm dev --filter=@ideas/<slug>

# Or from inside the idea folder:
cd ideas/<slug>
pnpm dev
```

Either way, the landing renders at http://localhost:3100.

> All ideas share port 3100 — run one prototype at a time. To run a second in parallel, override with `next dev --port 3101` manually.

Fill in `validation.md` **before** writing code. If you can't articulate the riskiest assumption in one sentence, the idea isn't ready.

## Deploying an idea to Vercel

1. New Vercel project, **root directory = `ideas/<slug>`**.
2. Framework preset: Next.js (auto-detected).
3. Install command is inherited from the idea's `vercel.json`.
4. Add env vars: `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GA_ID`, `LEADS_WEBHOOK_URL`.

## Folder layout

```
ideas/
├── _rules/         # the playbook (golden rules + template)
├── _template/      # boilerplate the scaffold copies from — don't run it directly
└── <slug>/         # one Next.js app per idea, validation.md alongside it
```
