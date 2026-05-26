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
- `src/components/intake-form.tsx` — 2-step wizard on `/start` (Step 1: context + email, Step 2: WhatsApp/Telegram). Replace step 1 fields with what your idea needs.
- `src/components/track-view-content.tsx` — fires `ViewContent` when `/start` mounts.
- `src/lib/analytics.tsx` — Meta Pixel + GA4 + Google Ads loader + `trackViewContent` / `trackLead` / `trackCompleteRegistration` helpers.
- `src/lib/utm.ts` — captures `utm_*` + `referrer` from the URL and forwards them in the lead payload.

### Tracking

All ad tracking loads conditionally on env vars — no env, no script. The funnel fires out of the box:

| Event | When | Meta Pixel | GA4 | Google Ads |
| --- | --- | --- | --- | --- |
| PageView | every page | `PageView` | auto | auto |
| ViewContent | `/start` mounts | `ViewContent` | `view_content` | — |
| Lead | step 1 submitted (email captured) | `Lead` | `generate_lead` | `conversion` (if `LEAD_LABEL` set) |
| CompleteRegistration | step 2 submitted (contact captured) | `CompleteRegistration` | `sign_up` | — |

Set `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GOOGLE_ADS_ID` and `NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL` in Vercel. See `.env.example`.

> Routes are English (`/start`, `/thanks`); user-facing copy is whatever language your audience speaks (default pt-BR in the boilerplate).

## Flow

```
/  →  click CTA  →  /start  →  submit  →  /thanks
                                  │
                                  └─→ POST /api/lead → LEADS_WEBHOOK_URL
```
