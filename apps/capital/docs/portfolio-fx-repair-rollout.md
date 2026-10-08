# Portfolio FX repair rollout

Runbook for the data repair that follows the portfolio read-path migration. It rewrites only the Avenue and Crypto rate-1 transfer legs, those two opening balances, the detached Crypto BTC buy cash leg, the legacy adjustment mode, and the holdings those modes change. It does not rewrite other USD investment cash legs, the 2026-09-30 BTC sell, a deleted 2026-10-02 adjustment, or caixinha rows.

Apply it only after the read-path migration is on `main`. The repair migration is `20261008150000_portfolio_fx_repair`. PTAX closes are embedded in that file (BCB Olinda `CotacaoMoedaPeriodo`, fetched 2026-10-08). The migration does not call the network.

The live checkout is `~/Documents/Github/kodama-labs`, on `main`. Do not print `DATABASE_URL`, `DIRECT_URL`, or any other secret. The rehearsal URL below uses the throwaway password `rehearsal` and is not the production database.

The production database is the container named `postgres` on `docker --context desktop-linux`. It is attached to the external network `kodama`. Apps reach it as `postgres:5432`. The kodama-prod compose file has no postgres service. Host port 5433 may belong to either the prod Postgres or a stale server under `--context default`, so never use it.

Every docker command starts with `--context desktop-linux`. Every compose command is:

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml
```

Run compose from `~/Documents/Github/kodama-labs`. `up` and `run` take `--no-deps`. `stop` does not accept `--no-deps`; it only stops the services named on the command line. Never `down`, never `-v`, never `prune`.

`capital-migrate` and `capital-web` share `image: kodama-capital:latest`. Building either one retags `latest`. The rehearsal image is `kodama-capital:portfolio-fx-rehearsal`, built from a worktree, and it never runs against the prod `postgres` container.

`apps/capital/.env.production` defines both `DATABASE_URL` and `DIRECT_URL`. `compose run capital-migrate` loads that file. Do not pass `-e DATABASE_URL` on a compose run unless the same command also passes `-e DIRECT_URL` for the same database. The rehearsal container below is not that service, so it sets both with `-e`.

## Step 0 — read-only precheck on production, before any dump

Pause nothing. The script only reads.

The precheck needs #75's migration `20261008140000_adjustment_mode_and_rate_days` (the `currency_rate_days` series and `adjustmentMode`). Production receives #75 first, deployed in this same window, before this precheck. A copy that does not have that migration yet is not this step: apply `20261008140000` on its own before prechecking it (`prisma db execute` of that migration file, then `prisma migrate resolve --applied 20261008140000_adjustment_mode_and_rate_days`).

```bash
mkdir -p ~/backups
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  run --rm --no-deps capital-migrate \
  pnpm exec tsx scripts/precheck-portfolio-fx.ts --expect-targets \
  | tee ~/backups/capital-fx-precheck-prod.txt
```

If `main` does not have the script yet, run it from the rehearsal image in the next section instead, against a restored copy, and do not point that image at the prod `postgres` container.

Read the saved output:

- The table has one row per brokerage account, with opening (native and BRL), contributed, current cash, holdings, Patrimônio, Total aportado, and Resultado, before and after.
- `issue` lines are absent. A `warn` line is a rate-1 USD/BRL leg outside the three targets. The migration leaves it unchanged. Duplicates and ambiguity are `issue` lines, and the migration aborts on those. An attachment on the BTC buy cash leg is an `issue` line; do not migrate until that file is moved off the leg.
- `delta` lines list every adjustment the migration will mark as delta: ticker, date, quantity, total, and notes. Confirm that list before migrating.
- `holding` lines show quantity, average, cost, and active, before and after, for every holding the replay changes.
- `--expect-targets` fails unless the Avenue 2026-08-12 leg, the Avenue 2026-09-16 leg, the Crypto deposit, and the BTC buy are each found once, or are already repaired.
- Avenue reconciliation: ending USD cash after equals ending cash before plus the lift. Each flow prints a running balance. The two repaired flows show the BRL amount, the previous business day, and the PTAX (`2026-08-12` uses `2026-08-11 = 5.1285`, `2026-09-16` uses `2026-09-15 = 5.1490`). `match` is `yes`. When `legacy.investment_accounts` is absent the line is `legacy_schema missing`. When the Avenue account is not in that table the line is `legacy_account missing`.
- Crypto lines show a non-negative running minimum. Where the 2026-09-30 sell is present, cash after is at least 6757.75.
- Opening lots use the same `openedAt` rate as opening cash. The BTC buy is that lot; there is no separate BTC rate.

Record the TOTAL before and after. The expected move is Total aportado down by about R$0.6–0.7M, with Resultado moving from about −R$190k to about +R$450k on about R$1M of Patrimônio. If the Avenue opening is not the reconciliation above, do not migrate.

## Rehearsal

Build from a detached worktree of the repair branch. Do not check that branch out in `~/Documents/Github/kodama-labs`.

```bash
cd ~/Documents/Github/kodama-labs
git fetch origin cursor/portfolio-fx-repair-6898
git worktree add --detach ~/capital-fx-rehearsal origin/cursor/portfolio-fx-repair-6898

docker --context desktop-linux build \
  -f ~/capital-fx-rehearsal/Dockerfile \
  --target capital \
  -t kodama-capital:portfolio-fx-rehearsal \
  --build-arg NEXT_PUBLIC_APP_URL=https://capital.kodamalabs.ai \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=BIZPytT1AcEzKXA5YQRz6V7tso9r_1uFeSfAuDhTLOotQ3_p8aIwOJwTKaEBWpG9xCSfUobWA2k00AumltvwztE \
  ~/capital-fx-rehearsal
```

On the 8 GB Docker Desktop VM the rehearsal may build `--target base` instead, so it does not run a second `next build`. The `base` stage's workdir is `/repo` and it does not set `NODE_ENV`. The run commands below pass `--workdir /repo/apps/capital` and `NODE_ENV=production` for that reason: the throwaway database is named `capital`, and db-guard refuses that name unless `NODE_ENV` is `production`.

```bash
docker --context desktop-linux build \
  -f ~/capital-fx-rehearsal/Dockerfile \
  --target base \
  -t kodama-capital:portfolio-fx-rehearsal \
  ~/capital-fx-rehearsal
```

Dump production to the host. `pg_dump` writes to the command's stdout; the redirect creates the file on the host.

```bash
mkdir -p ~/backups
ts=$(date -u +%Y%m%dT%H%M%SZ)
docker --context desktop-linux exec postgres \
  pg_dump -Fc -U root capital > ~/backups/capital-pre-fx-$ts.dump
ls -lh ~/backups/capital-pre-fx-$ts.dump
docker --context desktop-linux exec -i postgres \
  pg_restore -l < ~/backups/capital-pre-fx-$ts.dump \
  | tee ~/backups/capital-pre-fx-$ts.list
```

The file must be non-empty. The list must include `ledger_entries` and `accounts`.

Restore into a throwaway Postgres on its own network, using the same image as the prod `postgres` container. Publish no port. Do not restore into the prod `postgres` container, and do not attach this network to `kodama`.

```bash
pg_image=$(docker --context desktop-linux inspect -f '{{.Config.Image}}' postgres)
docker --context desktop-linux network create capital-rehearsal-net
docker --context desktop-linux run -d \
  --name capital-rehearsal-pg \
  --network capital-rehearsal-net \
  -e POSTGRES_USER=root \
  -e POSTGRES_PASSWORD=rehearsal \
  -e POSTGRES_DB=capital \
  "$pg_image"
until docker --context desktop-linux exec capital-rehearsal-pg \
  pg_isready -h 127.0.0.1 -U root -d capital; do sleep 1; done

docker --context desktop-linux exec -i capital-rehearsal-pg \
  pg_restore -U root -d capital --no-owner --no-acl --exit-on-error --single-transaction \
  < ~/backups/capital-pre-fx-$ts.dump
```

The init-phase server listens on the socket only, so `pg_isready` has to go through `127.0.0.1`. This restore is into an empty database, so the command does not pass `--clean`.

The precheck needs #75's migration `20261008140000_adjustment_mode_and_rate_days`. A dump taken before that migration was on production does not have it. Apply that file alone, then mark it applied, before the precheck:

```bash
docker --context desktop-linux run --rm \
  --network capital-rehearsal-net \
  --workdir /repo/apps/capital \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  -e DIRECT_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  --entrypoint pnpm \
  kodama-capital:portfolio-fx-rehearsal \
  exec prisma db execute --file prisma/migrations/20261008140000_adjustment_mode_and_rate_days/migration.sql

docker --context desktop-linux run --rm \
  --network capital-rehearsal-net \
  --workdir /repo/apps/capital \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  -e DIRECT_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  --entrypoint pnpm \
  kodama-capital:portfolio-fx-rehearsal \
  exec prisma migrate resolve --applied 20261008140000_adjustment_mode_and_rate_days
```

Skip those two commands when the restored copy already has `20261008140000`. Production itself gets #75 first, in the same window, so a dump taken after that deploy already has it.

Precheck the copy. Both URLs are the throwaway database, not production:

```bash
docker --context desktop-linux run --rm \
  --network capital-rehearsal-net \
  --workdir /repo/apps/capital \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  -e DIRECT_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  --entrypoint pnpm \
  kodama-capital:portfolio-fx-rehearsal \
  exec tsx scripts/precheck-portfolio-fx.ts --expect-targets \
  | tee ~/backups/capital-fx-precheck-rehearsal.txt
```

The rehearsal precheck must match the production precheck, including the TOTAL row and `match yes`. Then migrate the copy:

```bash
docker --context desktop-linux run --rm \
  --network capital-rehearsal-net \
  --workdir /repo/apps/capital \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  -e DIRECT_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  --entrypoint pnpm \
  kodama-capital:portfolio-fx-rehearsal \
  exec prisma migrate deploy
```

Wait until the log says `All migrations have been successfully applied`. Then:

```bash
docker --context desktop-linux run --rm \
  --network capital-rehearsal-net \
  --workdir /repo/apps/capital \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  -e DIRECT_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  --entrypoint pnpm \
  kodama-capital:portfolio-fx-rehearsal \
  exec tsx scripts/verify-portfolio-fx.ts --expect-targets \
  | tee ~/backups/capital-fx-verify-rehearsal.txt
```

The command must exit 0. Read the output:

- The same per-account table, now from the backup (before) and the repaired ledger (after).
- Avenue `match` is `yes`, and each repaired flow is the BRL amount divided by the embedded previous-day PTAX.
- Crypto running minimum is non-negative. With the sell present, cash is at least 6757.75.
- Every holding with a delta operation matches replay: VUAA is about 17.2791 shares at US$144.67 and active, and the Crypto BTC holding includes the live sell. There is no `issue` line.

Remove the throwaway when the verify is saved, and also if a step fails:

```bash
docker --context desktop-linux rm -f capital-rehearsal-pg
docker --context desktop-linux network rm capital-rehearsal-net
```

Leave the worktree until production is verified. Remove it later with `git worktree remove ~/capital-fx-rehearsal` from the live checkout. Do not drop the prod database.

## Maintenance window

1. The pull request is merged to `main`. On the server, record the pre-merge SHA before pulling. Rollback checks out that SHA.

   ```bash
   cd ~/Documents/Github/kodama-labs
   mkdir -p ~/backups
   git rev-parse HEAD | tee ~/backups/capital-pre-fx-sha.txt
   git pull origin main
   git status
   ```

   `git status` must be clean before any build. Do not check out the repair branch here.

2. Open an Uptime Kuma maintenance window before stopping writers:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps uptime-kuma-provision node dist/maintenance.js start 60
   ```

   `start 60` is 60 minutes over every `kodama/` monitor. Clear it after verification, or at the end of a rollback.

3. Tag the running image before any build:

   ```bash
   docker --context desktop-linux tag kodama-capital:latest kodama-capital:rollback-pre-fx
   ```

4. Build `capital-migrate` before stopping writers. The tag in step 3 still points at the image that is running.

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     build capital-migrate
   ```

5. Stop the writers, then take the final dump on the host:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     stop capital-web cronjobs

   ts=$(date -u +%Y%m%dT%H%M%SZ)
   dump=~/backups/capital-pre-fx-$ts.dump
   docker --context desktop-linux exec postgres \
     pg_dump -Fc -U root capital > "$dump"
   ls -lh "$dump"
   docker --context desktop-linux exec -i postgres \
     pg_restore -l < "$dump" \
     | tee ~/backups/capital-pre-fx-$ts.list
   printf '%s\n' "$dump"
   ```

   The file must be non-empty. The list must include `ledger_entries` and `accounts`. Record the path printed by `printf`. Rollback uses that literal path. A later shell does not have this `$ts`.

6. Repeat the rehearsal against this final dump: new throwaway network and a container of the prod Postgres image (`docker inspect -f '{{.Config.Image}}' postgres`), restore this file, apply `20261008140000` first if the dump does not have it, precheck, migrate, verify, then `rm` the container and the network. Do not `compose build`, and do not restore the dump into the prod `postgres` container. Start the production migrate only after that verify exits 0.

7. Apply on production. The image was built in step 4. `capital-migrate` runs `prisma migrate deploy` and reads `DATABASE_URL` and `DIRECT_URL` from `apps/capital/.env.production`:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate
   ```

   The log must contain `All migrations have been successfully applied`, and the command must exit 0.

   If the repair refuses, `prisma migrate deploy` leaves the migration failed. A second `migrate deploy` then stops with P3009. Read the refusal from the precheck output. Recovery is one of:

   - Restore the host dump (rollback section) and stop.
   - Mark the failed attempt rolled back, fix the data, and deploy again:

     ```bash
     docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
       run --rm --no-deps capital-migrate \
       pnpm exec prisma migrate resolve --rolled-back 20261008150000_portfolio_fx_repair

     docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
       run --rm --no-deps capital-migrate
     ```

8. Verify, and compare with the rehearsal file:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate \
     pnpm exec tsx scripts/verify-portfolio-fx.ts --expect-targets \
     | tee ~/backups/capital-fx-verify-prod.txt
   ```

   The command must exit 0. The TOTAL after row must match the rehearsal. Do not start the app while any `issue` line is present.

9. Start the app, then the cron runner:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps capital-web

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps --force-recreate cronjobs
   ```

10. End the maintenance window:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps uptime-kuma-provision node dist/maintenance.js clear
   ```

## Rollback, before writes resume

Use this only if verify failed or the app is wrong and nothing has written to the ledger since the dump. Do not drop the failed database. The restore path is the literal dump path written down in step 5, not `$ts` from that shell. The app role and the restore role are both `root`, so this restore does not pass `--no-owner` or `--no-acl`. The rehearsal restore keeps those flags because that database is empty and throwaway.

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  stop capital-web cronjobs

docker --context desktop-linux exec -i postgres \
  psql -U root -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'capital' AND pid <> pg_backend_pid();
ALTER DATABASE capital RENAME TO capital_failed_fx;
CREATE DATABASE capital;
SQL

docker --context desktop-linux exec -i postgres \
  pg_restore -U root -d capital --exit-on-error --single-transaction \
  < ~/backups/capital-pre-fx-YYYYMMDDTHHMMSSZ.dump

docker --context desktop-linux tag kodama-capital:rollback-pre-fx kodama-capital:latest

cd ~/Documents/Github/kodama-labs
git checkout "$(cat ~/backups/capital-pre-fx-sha.txt)"
git status
```

`git status` must be clean, and `HEAD` must be the SHA recorded in step 1. Do not recreate cronjobs before this checkout.

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps capital-web
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps --force-recreate cronjobs
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  run --rm --no-deps uptime-kuma-provision node dist/maintenance.js clear
```

`capital_failed_fx` stays until someone decides to drop it. The backup tables inside a successful repair (`portfolio_fx_repair_entry` and the other `portfolio_fx_repair_*` tables) are the before-image the verify script reads. They are not the rollback path. Rollback is the dump.
