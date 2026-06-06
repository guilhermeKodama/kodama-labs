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

- `src/app/page.tsx` — landing (hero + problem + how-it-works + FAQ + repeated CTA + footer)
- `src/app/start/page.tsx` — trip intake form
- `src/app/thanks/page.tsx` — post-submit confirmation
- `src/app/api/lead/route.ts` — forwards submissions to `LEADS_WEBHOOK_URL`
- `src/components/hero.tsx` — landing hero with serif H1, scarcity microcopy, trust row
- `src/components/problem.tsx` — "Hoje, é assim:" pain bullets (validation §2)
- `src/components/how-it-works.tsx` — 3-step explainer with amber step numbers
- `src/components/faq.tsx` — FAQ accordion (includes security/credentials item)
- `src/components/cta-repeat.tsx` — second-shot CTA before the footer
- `src/components/intake-form.tsx` — 4-field form (travel_window / group_size / email / contact) per validation §5; UTM params captured automatically
- `src/components/flight-path-art.tsx` — subtle SVG arc behind the hero
- `src/components/footer.tsx` — non-affiliation disclaimer
- `src/lib/analytics.tsx` — Meta Pixel + GA4 snippets

> Routes are English (`/start`, `/thanks`); copy is pt-BR for the Brazilian audience.

---

## Operations

The validation funnel (§5 of [validation.md](validation.md)) tracks four stages: **Click → Landing → Lead → Active → Issuance**. The landing handles the first two. The rest is **manual concierge** for the first ~20 beta users, per golden rule #5 — no Telegram bot, no scrapers, no admin UI. The Sheet is the dashboard.

### 1. Lead storage — Google Sheets via Apps Script

The `/api/lead` route POSTs every submission as JSON to `LEADS_WEBHOOK_URL`. Point that at a Google Sheets Web App and you get persistence with zero infrastructure.

**Setup (≤10 min):**

1. Create a new Google Sheet. Name it `milhasgrupo-leads`.
2. Add this header row (column A through M):
   ```
   received_at | email | contact | group_size | travel_window | utm_source | utm_medium | utm_campaign | referrer | status | alerts_sent | issuances | notes
   ```
   The last four (`status`, `alerts_sent`, `issuances`, `notes`) are filled **manually** as you work each lead. Allowed `status` values and transitions: [lead-playbook.md](lead-playbook.md) — Status dos leads.
3. **Extensions → Apps Script**. Replace the default code with:

   ```js
   function doPost(e) {
     const data = JSON.parse(e.postData.contents);
     const sheet = SpreadsheetApp.getActiveSheet();

     // Google Sheets interprets cells starting with @, =, +, - as formulas.
     // Prepend an invisible apostrophe so they render as literal text
     // (Telegram handles "@username" natively; this is purely a Sheets quirk).
     const safe = (v) => {
       const s = String(v ?? "");
       return /^[=+\-@]/.test(s) ? "'" + s : s;
     };

     sheet.appendRow([
       safe(data.receivedAt),
       safe(data.email),
       safe(data.contact),
       safe(data.group_size),
       safe(data.travel_window),
       safe(data.utm_source),
       safe(data.utm_medium),
       safe(data.utm_campaign),
       safe(data.referrer),
       "", // status
       "", // alerts_sent
       "", // issuances
       "", // notes
     ]);

     return ContentService
       .createTextOutput(JSON.stringify({ ok: true }))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

   > **After editing the script later, redeploy via Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** Just saving doesn't update the live endpoint.

4. **Deploy → New deployment → Type: Web app**. Execute as: *me*. Who has access: *Anyone*. Copy the Web app URL.
5. In Vercel → Project → Settings → Environment Variables, set `LEADS_WEBHOOK_URL` to that URL. Redeploy.
6. Smoke test: visit the production landing, submit the form, confirm a row lands in the Sheet.

### 2. Analytics — Meta Pixel + GA4 + Google Ads

All three load via `src/lib/analytics.tsx` and stay silent if the corresponding env vars are unset. To wire them up:

- **Meta Pixel** — Meta Ads Manager → Events Manager → create Pixel → copy ID. Set `NEXT_PUBLIC_META_PIXEL_ID` in Vercel.
- **GA4** — Google Analytics → Admin → Data Streams → new Web stream → copy *Measurement ID* (starts with `G-`). Set `NEXT_PUBLIC_GA_ID` in Vercel.
- **Google Ads** — Google Ads → Tools → Conversions → new conversion (Website → Lead) → copy the `AW-XXXXXXX` ID and the conversion *label*. Set `NEXT_PUBLIC_GOOGLE_ADS_ID` and `NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL` in Vercel.

Redeploy. The full funnel fires automatically:

| Event | When | Meta Pixel | GA4 | Google Ads |
| --- | --- | --- | --- | --- |
| PageView | every page | `PageView` | auto | auto |
| ViewContent | `/start` mounts | `ViewContent` | `view_content` | — |
| Lead | step 1 submitted (travel + email) | `Lead` | `generate_lead` | `conversion` (uses `LEAD_LABEL`) |
| CompleteRegistration | step 2 submitted (WhatsApp/Telegram) | `CompleteRegistration` | `sign_up` | — |

UTMs (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) and `referrer` are captured from the URL on submit and forwarded to the lead webhook — confirm via Sheet rows.

### 3. Concierge runbook — manual alerts + issuance follow-up

**Lead onboarding:** [lead-playbook.md](lead-playbook.md) — Mensagem 0 padrão (WhatsApp/Telegram) + checklist. Enviar antes de buscar voos.

**Daily routine (15-30 min):**

1. Open the Sheet. Filter `status` in `(vazio)`, `Lead`, `Onboarding`, `Qualified` as needed.
2. `(vazio)` / `Lead`: send **Mensagem 0** from [lead-playbook.md](lead-playbook.md) (≤24h) → set `Onboarding`.
3. `Onboarding`: when they answer the 3 questions → `Qualified` + `notes`.
4. `Qualified`: scout **Azul Fidelidade**, **LATAM Pass**, **Smiles** (`travel_window` × `group_size` → GRU/CNF/VCP → MCO).
5. When you find N seats on the same flight, send the alert template via Telegram (preferred) or WhatsApp → `Active`.

**Alert template (paste-ready):**

```
✈️ {{N}} assentos em {{ORIGEM}} → MCO, {{DATA_IDA}}/{{DATA_VOLTA}}
Programa: {{PROGRAMA}} ({{MILHAS_TOTAIS}} milhas no total)
Link: {{LINK_DIRETO}}

Aja rápido — esses lugares somem em horas.
Me avisa quando tentar emitir 🙏
```

**Update the Sheet on send:**
- `alerts_sent` → increment by 1
- `status` → `Active`
- `notes` → append `[YYYY-MM-DD] alerta {{N}} assentos {{PROGRAMA}}`

**Follow-up 24-48h later** (Telegram DM):

```
Oi {{NOME}}, deu pra emitir? Quantos lugares?
```

**Log the reply:**
- `issuances` → number of seats they actually booked (0 if not)
- `status` → `Issued` if `issuances` ≥ 1 (otherwise keep `Active`)
- `notes` → append the user's reply verbatim — the *texture* of why they did/didn't book is the real validation signal (Mom Test #3)

**Weekly check-in** (`Onboarding` for >7 days, then `Cold` or `Lost` if no reply):

```
Oi {{NOME}}, ainda planejando a viagem? Posso te avisar de combinações específicas se precisar.
```

### 4. Funnel metrics — reading the Sheet

In a second tab, compute against [validation.md §5](validation.md) thresholds:

| Metric | Formula (rough) | Healthy | Death |
|---|---|---|---|
| CTR | (GA4 sessions) / (ad impressions) | > 1.5% | < 0.5% |
| Landing → Lead | `COUNTA(email)` / (GA4 sessions) | > 5% | < 1% |
| Lead → Active | `COUNTIF(status, "Active" or "Issued")` / `COUNTA(email)` | > 60% | < 30% |
| Active → Issuance | `SUMIF(status, "Issued", issuances)` / `COUNTIF(status, "Active" or "Issued")` | > 30% | < 10% |
| **CAC per channel** | `ad_spend_by_utm_source` / `COUNTIF(utm_source, ...)` | < R$ 300 | > R$ 400 |

§7 GO criteria (review at week 4): CAC < R$ 300, Landing → Lead > 5%, 15+ active beta users out of 20 spots, **5+ confirmed issuances**. Anything weaker → PIVOT or KILL per §7.
