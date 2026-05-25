# {{IDEA_NAME}}

> Validation prototype. See [validation.md](validation.md) for the one-pager.

## Develop

From the repo root (preferred):

```sh
pnpm dev --filter=@ideas/{{IDEA_SLUG}}        # http://localhost:3100
pnpm typecheck --filter=@ideas/{{IDEA_SLUG}}
pnpm lint --filter=@ideas/{{IDEA_SLUG}}
pnpm build --filter=@ideas/{{IDEA_SLUG}}
```

Or from inside this folder: drop the `--filter` flag.

> Ideas default to port 3100. To run a second idea in parallel, pass `next dev --port 3101` manually — the scaffold doesn't auto-pick free ports.

## Environment

Copy `.env.example` to `.env.local` and fill what you need. All vars are optional locally.

## Deploy

1. New Vercel project, **root directory = `ideas/{{IDEA_SLUG}}`**.
2. Add env vars from `.env.example`.
3. Push. Vercel auto-detects Next.js.

## Structure

- `src/app/page.tsx` — landing (hero + how-it-works + FAQ + CTA → `/start`)
- `src/app/start/page.tsx` — the prototype's core interaction (form/wizard/etc.)
- `src/app/thanks/page.tsx` — post-submit confirmation
- `src/app/api/lead/route.ts` — forwards submissions to `LEADS_WEBHOOK_URL`
- `src/components/hero.tsx` — landing hero + CTA button
- `src/components/how-it-works.tsx` — 3-step explainer
- `src/components/faq.tsx` — FAQ section
- `src/components/intake-form.tsx` — example form on `/start` showing radio + checkbox + text patterns. Replace fields with what your idea actually needs to capture.
- `src/lib/analytics.tsx` — Meta pixel + GA snippets

> Routes are English (`/start`, `/thanks`); user-facing copy is whatever language your audience speaks (default pt-BR in the boilerplate).

## Flow

```
/  →  click CTA  →  /start  →  submit  →  /thanks
                                  │
                                  └─→ POST /api/lead → LEADS_WEBHOOK_URL
```
