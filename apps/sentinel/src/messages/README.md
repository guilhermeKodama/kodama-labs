# Sentinel i18n

`pt-BR` is the default locale; `en` is the only other supported locale today. The routing is configured in `src/i18n/routing.ts` and uses `localePrefix: "as-needed"`, so the default locale renders at the URL root (no `/pt-BR` prefix) and English renders under `/en`.

## Wording rules

Sentinel surfaces **possible inconsistencies that merit human review** — never allegations. Every user-facing string must be readable as a flag for verification, not a verdict.

Never use, in either locale:
- `fraude` / `fraud`
- `corrupção` / `corruption`
- `crime` / `criminal`
- `ilegal` / `illegal`
- `culpado` / `guilty`
- `suspeito` / `suspicious`
- `conluio` / `collusion`
- `empresa de fachada` / `shell company`
- `anômalo` as a verdict — `atípico` / `unusual` is fine for describing observations

Prefer neutral framings: `possível inconsistência` / `possible inconsistency`, `atípico` / `unusual`, `a revisar` / `worth reviewing`, `sinaliza` / `flags`, `padrão a verificar` / `pattern to verify`.

The Claude prompt in `src/server/modules/pipeline/analysis/analyze-ai.ts` enforces these rules on the AI output. If you extend it, keep the language-discipline section intact.

## Backend codes vs. UI labels

Analyzers write **stable, technical codes** to the database — never localized strings — for any classification value (alert type, severity, flag, link type, relationship, etc.). The UI is solely responsible for translating each code via the `codes.<group>` namespace in the message files.

### Code groups currently in use

| Group | Source | Codes |
|---|---|---|
| `alertType` | `AlertType` enum | `OVERPRICING`, `SHELL_COMPANY`, `SANCTIONED_ENTITY`, `SUSPICIOUS_NETWORK`, `AI_FLAG`, `POLITICAL_LINK` |
| `severity` | `Severity` enum | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `shellCompanyFlag` | `analyze-shell-companies.ts` | `recently_created`, `low_capital`, `single_shareholder` |
| `priceAnalysisMethod` | `analyze-overpricing.ts` | `market_price`, `catmat_iqr`, `description_iqr`, `description_insufficient_data`, `bid_spread` |
| `priceConfidence` | `analyze-overpricing.ts` | `high`, `medium`, `low` |
| `politicalLinkType` | `analyze-political-links.ts` | `SHAREHOLDER_IS_POLITICIAN`, `SUPPLIER_DONATED`, `DONOR_GOT_CONTRACT`, `FAMILY_IN_SUPPLIER`, `FAMILY_DONATED`, `POLITICIAN_IS_SERVANT`, `WEALTH_ANOMALY`, `DONOR_IS_SHAREHOLDER`, `DONATION_TIMING`, `DONOR_CONCENTRATION` |
| `relationship` | `analyze-political-links.ts` | `mother`, `father`, `brother`, `spouse`, `son`, `nephew`, `cousin`, `uncle`, `grandparent`, `grandson` |
| `donorType` | `CampaignDonation.donorType` | `PF`, `PJ` |
| `aiAnalysisType` | `AiAnalysis.analysisType` | `risk_assessment` |
| `aiTargetType` | `AiAnalysis.targetType` | `procurement`, `contract`, `entity` |

### Adding a new code

1. Use the bare code string in the analyzer (e.g. `"high_capital_jump"`). Do not localize it. Do not write a label map next to the analyzer.
2. Add the code to `codes.<group>` in **both** `pt-BR.json` and `en.json`.
3. The UI picks it up automatically via the `codes.<group>.<code>` translation key — `t('codes.shellCompanyFlag.recently_created')` and friends.

## Alert templates (DB-backed)

Alerts are generated server-side. Each `alert.data` blob now carries a small `i18n` block:

```ts
data.i18n = {
  titleKey: "alerts.templates.shellCompany.title",
  descriptionKey: "alerts.templates.shellCompany.description",
  params: { entityName, cnpj, flagCount, flags: "recently_created,low_capital" }
}
```

The UI reads `data.i18n` and renders the template with the active locale. `alert.title` / `alert.description` columns still hold a pt-BR fallback string so old alerts and code paths that read the columns directly keep working.

Code-typed params (`flags`, `confidence`, `method`, `relationshipLabel`) are stored as raw codes — the UI translates them through the `codes.*` namespace before substituting into the template. The mapping of param-name → code-group lives in `src/lib/alert-render.ts`.

When you add a new alert template, add ICU-lite strings (just `{name}` placeholders, no number/select tokens) to `alerts.templates.<name>.title` and `alerts.templates.<name>.description` in both locales, then call `buildAlertI18n` from your analyzer.

## Locale-aware formatters

Use the helpers in `src/lib/utils.ts` — `formatCurrency`, `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent` — instead of inline `.toLocaleString("pt-BR")`. They take an `AppLocale` argument; pages get the locale from `params` (server) or `useLocale()` (client).

BRL is the currency regardless of the active UI locale (this is Brazilian government data); only the number/separator style changes between `pt-BR` and `en`.
