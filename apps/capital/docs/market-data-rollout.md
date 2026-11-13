# Market data rollout (F0, F1, F1.1)

What production needs once the market-data pull request is merged to `main`. Almost all of it applies itself with the normal deploy. The only manual choices are the optional `BRAPI_TOKEN` and restarting the two long-running services that read files at startup.

Every docker command starts with `--context desktop-linux`. Every compose command is, from `~/Documents/Github/kodama-labs` on the `kodama-ai` machine:

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml
```

Never `down`, never `-v`, never `prune`. Do not print any secret.

## What applies itself

- **Migrations.** `capital-migrate` runs `prisma migrate deploy` on `up`: `20261110130000_add_integration_run`, `20261111120000_add_asset_market_data`, `20261111150000_add_asset_stale_notification`, `20261112120000_market_data_sessions`, `20261113120000_alpha_vantage_source` (Yahoo source refs become Alpha Vantage; a Yahoo-only `etf` becomes `international_etf`, except a `.SA` ref, which is the old B3 fallback and is deleted), `20261113150000_alpha_vantage_call_budget` (one row per UTC day counting Alpha Vantage calls; the provider stops at 22).
- **Schedule.** `infrastructure/cronjobs/schedules/capital.json` now calls `/api/cron/market-close` at 22:30 UTC (19:30 in São Paulo), which runs `sync-prices`, `update-prices` and `portfolio-snapshot` in that order. The three old entries are gone; their routes still answer for a manual rerun.
- **Monitoring.** The provisioner adds the `kodama/cron-capital-api-cron-market-close` push monitor and deletes the three old ones (it owns every `kodama/` name).

## Steps

1. Deploy `capital` as usual (build, `capital-migrate`, `capital-web`).
2. Reload the cron runner, which reads the schedule file only at startup:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml restart cronjobs
   ```

3. Re-run the monitoring provisioner:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml up -d uptime-kuma-provision
   ```

4. Link the existing holdings once (idempotent; `--dry-run` first):

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml run --rm --no-deps capital-migrate pnpm exec tsx scripts/backfill-asset-links.ts --dry-run
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml run --rm --no-deps capital-migrate pnpm exec tsx scripts/backfill-asset-links.ts
   ```

   A holding left unlinked is reported with its reason. `currency_mismatch` means the holding's currency is not the one its market quotes in (a B3 ticker kept in USD): fix the holding's currency in Carteira › Editar and it relinks on save.

## Optional: brapi token

Without `BRAPI_TOKEN`, brapi.dev only answers its demo tickers and Ajustes › Dados › Saúde dos dados shows "brapi sem token". B3 has no other source. With a free token (https://brapi.dev/dashboard), the same brapi source prices the rest of B3.

International stocks and ETFs are Alpha Vantage (`ALPHA_VANTAGE_API_KEY` in this same file). `capital-web` loads it through `env_file: apps/capital/.env.production`, the same way it loads `BRAPI_TOKEN`. The cron runner only calls `capital-web` over HTTP and does not receive either key. Replacing Yahoo does not change the cron schedule: after `capital-migrate` applies `20261113120000_alpha_vantage_source`, recreate `capital-web` so it reloads `.env.production`. `cronjobs` does not need a restart for that change.

1. On `kodama-ai`, add the line `BRAPI_TOKEN=<token>` to `~/Documents/Github/kodama-labs/apps/capital/.env.production`. Do not paste the token anywhere else.
2. Recreate the web container so it reads the new environment. `restart` keeps the old environment and is not enough:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml up -d --no-deps capital-web
   ```

3. In Saúde dos dados, "Fonte ativa" for Ações, FIIs and BDRs reads brapi.dev and the "brapi sem token" line is gone.

`MARKET_DATA_CHAIN` and `MARKET_DATA_DISABLED` (see `apps/capital/.env.example`) reorder or drop a source the same way: edit `.env.production`, then the same `up -d --no-deps capital-web`.

## Checking it

- The morning after the first 22:30 UTC run, Saúde dos dados shows `sync-prices`, `update-prices` and `portfolio-snapshot` as Ok, all run at about the same time.
- `curl -fsS https://capital.kodamalabs.ai/api/health/market-data` answers 200 with `"status":"ok"`. It answers 503 only when a daily stage has not succeeded for more than two days, or the hourly FX job for more than six hours.
- A holding counts as stale only after it misses two closes on its market's calendar (weekends and B3/NYSE holidays do not count). The "Ativo sem cotação" push follows the same rule, once per episode.
