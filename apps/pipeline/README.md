# Pipeline — dashboard de métricas do funil das ideias

Acompanha o funil de aquisição paga de cada ideia em `ideas/`:
**Custo → [Meta | Google] → Impressões → Cliques → LP → Sessões → Leads → Ativos → Clientes**,
com CPM, CTR, Bounce, CPL, AR, PCR e CAC/LTV calculados sobre contagens cruas,
thresholds por ideia (do `idea.yaml`) e veredito go/kill pela matriz de decisão.

- **Portfólio** (`/`): saúde + veredito de todas as ideias, pacing de budget, alertas.
- **Ideia** (`/ideas/<slug>`): funil visual com diagnóstico por métrica, charts, critérios GO/PIVOT/KILL.
- **Leads** (`/leads`): fonte da verdade dos leads; status segue a state machine do playbook.
- **Operações** (`/ops`): jobs de ingestão, inbox de leads estacionados, entrada manual de spend, config.

## Rodando local

```bash
pnpm db:up                              # postgres docker (porta 5433; cria o DB pipeline)
cp apps/pipeline/.env.example apps/pipeline/.env
pnpm --filter @wallex/pipeline db:migrate
pnpm dev --filter @wallex/pipeline      # http://localhost:3004
pnpm sync:ideas                         # sobe os idea.yaml pro dashboard local
```

`pnpm --filter @wallex/pipeline test` roda os testes do health engine.

## Como uma ideia entra no dashboard

1. `pnpm new:idea <slug>` gera `ideas/<slug>/idea.yaml` (targets, economics, kill criteria).
   **Sem `idea.yaml` a ideia não existe para o dashboard.**
2. Push para `main` → GitHub Action `sync-ideas` valida e POSTa para `/api/sync/ideas`.
   (Local: `pnpm sync:ideas`; `--dry-run` só valida.)
3. Promover `status: hypothesis → validating` exige `landing_url`, `economics`,
   `tracking.ga4_property_id` e uma conta de ads — o CI falha sem isso (promotion gate).
4. Thresholds editados na UI ficam com `source: MANUAL` e nunca são sobrescritos pelo sync.

GitHub: secret `PIPELINE_SYNC_SECRET` + variable `PIPELINE_URL` no repo.

## Leads — webhook

A LP posta no próprio `/api/lead` (server-side), que encaminha **assinado (HMAC)** para
`LEADS_WEBHOOK_URL=https://<pipeline>/api/webhook/lead/<slug>` com `LEADS_WEBHOOK_SECRET`
(igual ao `WEBHOOK_HMAC_SECRET` daqui). O segredo nunca vai ao browser.

O webhook **nunca rejeita** um lead plausível: tudo entra no `lead_inbox` antes de
validar; assinatura inválida/payload malformado estacionam para triagem em `/ops`.
Origin de browser só passa se bater com o `landing_url` de alguma ideia sincada
(allowlist automática). Migração do Sheets do milhasgrupo:

```bash
node scripts/import-sheets-leads.mjs --idea milhasgrupo export.csv
```

Depois do import, repointe `LEADS_WEBHOOK_URL` no Vercel da LP e redeploye.

## Ingestão

| Job | Cron | Fonte |
|---|---|---|
| `ingest-meta-ads` | 4×/dia | Insights API v25, janela hoje+7d (plataformas reatribuem) |
| `ingest-google-ads` | 4×/dia | GAQL via `google-ads-api`, mesma janela |
| `ingest-ga4` | 1×/dia 06:00 BRT | Data API, janela D-4..D-1 com zero-fill |

Backfill manual: `GET /api/cron/ingest/meta-ads?days=35` (bearer `CRON_SECRET`);
GA4: `?start=YYYY-MM-DD`. Sem credenciais o job completa com `SKIPPED` (visível em /ops)
e a **entrada manual** em /ops cobre o funil — reenviar o mesmo dia edita; quando a API
chegar, apague as linhas manuais (a UI avisa sobre overlap).

### Setup Meta (~30 min, sem App Review para contas próprias)

1. business.facebook.com → Business Manager Kodama Labs.
2. developers.facebook.com → Create App → tipo **Business** → vincular ao BM → produto **Marketing API**.
3. Business Settings → System users → criar `pipeline-ingest` (role **Admin**) → Assign Assets → o app (full control).
4. Generate token → app → expiração **Never** → escopos `ads_read` + `business_management` → `META_SYSTEM_USER_TOKEN`.
5. Smoke: `curl "https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,currency,timezone_name&access_token=$TOKEN"`.
6. Por ideia: conta de anúncios **America/Sao_Paulo + BRL** → `act_…` no `idea.yaml`.

Token morreu (erro 190 em /ops) → regenerar no system user e atualizar a env.

### Setup Google Ads (começar JÁ — aprovação pode demorar semanas)

1. MCC → Tools → **API Center** → developer token. Se vier com **Explorer Access**,
   já dá pra ler produção (2.880 ops/dia — sobra). Aplicar para **Basic** em paralelo.
2. GCP → projeto → enable **Google Ads API** → OAuth consent **PUBLICADO EM PRODUÇÃO**
   (em "testing" o refresh token expira em 7 dias) → OAuth Client (Web, redirect `http://localhost:5555/callback`).
3. `GOOGLE_ADS_CLIENT_ID=... GOOGLE_ADS_CLIENT_SECRET=... node scripts/google-ads-auth.mjs`
   → `GOOGLE_ADS_REFRESH_TOKEN`. `GOOGLE_ADS_LOGIN_CUSTOMER_ID` = MCC sem traços.
4. Conta compartilhada: **America/Sao_Paulo + BRL**; campanhas com prefixo `{slug}_`
   (é o mapeamento campanha→ideia); customer id no `idea.yaml`.

### Setup GA4

1. GCP → enable `analyticsdata.googleapis.com` → service account `pipeline-ga4-reader` → key JSON →
   `GA4_SA_KEY_BASE64=$(base64 -i key.json | tr -d '\n')`.
2. Por ideia: GA4 property (TZ São Paulo) → Admin → Property Access Management → SA como **Viewer**;
   **Google Signals OFF + Reporting Identity = Device-based** (evita thresholding com tráfego baixo);
   property ID numérico no `idea.yaml`.

## Deploy (Vercel)

Projeto novo, root `apps/pipeline`. Envs: ver `.env.example` (mínimo: `DATABASE_URL`,
`DIRECT_URL`, `CRON_SECRET`, `SYNC_SECRET`, `WEBHOOK_HMAC_SECRET`, `DASHBOARD_USER/PASSWORD`).
Crons já definidos em `vercel.json`. Basic auth protege páginas e `/api/v1/*`;
`/api/webhook|sync|cron` têm auth próprio.

## Runbook — rotação de segredos

- `WEBHOOK_HMAC_SECRET`: trocar aqui **e** `LEADS_WEBHOOK_SECRET` em cada LP (redeploy das LPs).
- `SYNC_SECRET`: trocar aqui **e** o secret `PIPELINE_SYNC_SECRET` no GitHub.
- Meta/Google tokens: ver seções de setup; falhas aparecem como JobRun FAILED em /ops.
