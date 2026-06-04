# @wallex/kodamalabs

Kodama Labs umbrella landing page. Showcases the flagship products (Capital, Sentinel) and the idea pipeline (milhasgrupo and future experiments).

- **Live**: https://kodamalabs.ai
- **Stack**: Next.js 16 · React 19 · Tailwind v4 · shadcn/ui · next-intl · Framer Motion
- **Locales**: English (default), Portuguese

## Run locally

```sh
# from repo root
pnpm install
pnpm dev --filter=@wallex/kodamalabs
```

Opens at http://localhost:3003 (English). Portuguese is at http://localhost:3003/pt-BR.

## Adding a project

Edit two files:

1. `src/lib/projects.ts` — add a `Project` entry (slug, category, status, stack, accent).
2. `src/messages/en.json` and `src/messages/pt-BR.json` — add a `projects.<slug>` namespace with `name`, `tagline`, `description`, `challenges` (array of 3), `impact`.

The card renders automatically based on the project's category.

## Deploy

Vercel project root = `apps/kodamalabs`. Framework: Next.js (auto). `vercel.json` already overrides the install command to run from monorepo root. Custom domain `kodamalabs.ai` is configured in the Vercel dashboard.
