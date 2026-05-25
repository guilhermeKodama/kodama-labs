# Milhasgrupo

> Validation prototype. See [validation.md](validation.md) for the one-pager.

## Develop

From the repo root (preferred):

```sh
pnpm dev --filter=@ideas/milhasgrupo        # http://localhost:3100
pnpm typecheck --filter=@ideas/milhasgrupo
pnpm lint --filter=@ideas/milhasgrupo
pnpm build --filter=@ideas/milhasgrupo
```

Or from inside this folder: drop the `--filter` flag.

> Ideas default to port 3100. To run a second idea in parallel, pass `next dev --port 3101` manually — the scaffold doesn't auto-pick free ports.

## Environment

Copy `.env.example` to `.env.local` and fill what you need. All vars are optional locally.

## Deploy

1. New Vercel project, **root directory = `ideas/milhasgrupo`**.
2. Add env vars from `.env.example`.
3. Push. Vercel auto-detects Next.js.

## Structure

- `src/app/page.tsx` — landing (hero + how-it-works + FAQ + CTA → `/start`)
- `src/app/start/page.tsx` — trip intake form
- `src/app/thanks/page.tsx` — post-submit confirmation
- `src/app/api/lead/route.ts` — forwards submissions to `LEADS_WEBHOOK_URL`
- `src/components/hero.tsx` — landing hero + CTA
- `src/components/how-it-works.tsx` — 3-step explainer
- `src/components/faq.tsx` — FAQ section
- `src/components/intake-form.tsx` — the trip form (origin / window / group size / programs / contact)
- `src/components/footer.tsx` — footer with non-affiliation disclaimer
- `src/lib/analytics.tsx` — Meta pixel + GA snippets

> Routes are English (`/start`, `/thanks`); copy is pt-BR for the Brazilian audience.
