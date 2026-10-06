# Ledger v2 production rollout

Runbook for applying the ledger v2 migrations on the production `capital` database. Do not run `pnpm db:drop-legacy` in this rollout. The old tables stay in the `legacy` schema, including `legacy.attachment_links`, `legacy.budget_links`, and `legacy.reminder_dispatch_links`.

The live checkout is `~/Documents/Github/kodama-labs`, on `main`. `infrastructure/cronjobs/schedules` is bind-mounted into the running cronjobs container, so the git checkout and the cron image have to move together.

The production database is the container named `postgres` (compose project `infrastructure/postgres`) on `docker --context desktop-linux`. It is attached to the external network `kodama`. Apps reach it as `postgres:5432`. The kodama-prod compose file has no postgres service. Host port 5433 may belong to either the prod Postgres or a stale server under `--context default`, so never use it.

Every docker command starts with `--context desktop-linux`. Every compose command is:

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml
```

Run compose from `~/Documents/Github/kodama-labs`. `up` and `run` take `--no-deps`. `stop` does not accept `--no-deps`; it only stops the services named on the command line. Never `down`, never `-v`, never `prune`.

`capital-migrate` and `capital-web` share `image: kodama-capital:latest`. Building either one retags `latest`. The rehearsal image is a different tag, built from a worktree, and it never runs against the prod `postgres` container.

`apps/capital/.env.production` defines both `DATABASE_URL` and `DIRECT_URL` (the Prisma schema uses `directUrl`). `compose run capital-migrate` loads that file. Do not pass `-e DATABASE_URL` on a compose run unless the same command also passes `-e DIRECT_URL` for the same database. The rehearsal container below is not that service, so it sets both with `-e`.

## Checksums

Editing `20261004200000_ledger_v2_schema`, `20261004200100_ledger_v2_backfill`, or `20261004200200_ledger_v2_retire_legacy` changes their Prisma checksums. Any local or dev database that already applied an older copy of those files will refuse `migrate deploy` until it is recreated (`pnpm --filter @wallex/capital db:reset` against `capital_dev`, or drop and recreate the database). Production has never applied them. Step 0 confirms that: section 0 returns no `ledger_v2_*` rows. The latest migration already applied in production is `20261004120000`.

## Step 0 — read-only precheck on production, before any dump

Pause nothing. The script only `SELECT`s, inside `BEGIN READ ONLY` / `ROLLBACK`, and it uses pre-ledger tables.

```bash
mkdir -p ~/backups
docker --context desktop-linux exec -i postgres \
  psql -U root -d capital -v ON_ERROR_STOP=1 \
  < apps/capital/scripts/precheck-ledger-migration.sql \
  | tee ~/backups/capital-ledger-v2-precheck-prod.txt
```

If `main` does not have the script yet, read it from the rehearsal worktree in the next section (`~/capital-ledger-v2-rehearsal/apps/capital/scripts/precheck-ledger-migration.sql`).

Read the saved output:

- Section 0 returns no rows. A `ledger_v2_*` row means this runbook does not apply.
- Section 1, every `row_count` is 0. A positive count aborts the backfill. Each row includes up to 10 sample ids. Fix those rows (or decide an `externalId collision`) and rerun. Do not rehearse with a failing section 1.
- Sections 2 and 3 are informational. Section 2 lists rows the unambiguous-owner rules will fill in. Section 3 lists business brokerages that fall back onto the personal entity.
- Section 3b lists non-base-currency transactions and transfers whose stored `exchangeRate` is 1, with up to 10 ids. A non-zero count does not block. Those rows stay 1:1, which is the rate already stored.
- Section 4 is the baseline. Record 4a through 4e. `verify-ledger-migration.sql` is checked against these numbers.

Precheck on production, 2026-10-06: section 1 blockers 0, section 2 remaps 0, section 3 brokerage fallbacks 0. Section 4a: 519 transactions, 2257 bill_transactions, 132 transfers, 75 investment_transactions. The final pre-deploy precheck in the maintenance window must match this unless something has written since; if it has, the new section 4 is the baseline and this one is the earlier record.

## Rehearsal

Build from a detached worktree of `capital-ledger-v2`. Do not check that branch out in `~/Documents/Github/kodama-labs`.

```bash
cd ~/Documents/Github/kodama-labs
git fetch origin capital-ledger-v2
git worktree add --detach ~/capital-ledger-v2-rehearsal origin/capital-ledger-v2

docker --context desktop-linux build \
  -f ~/capital-ledger-v2-rehearsal/Dockerfile \
  --target capital \
  -t kodama-capital:pr67-rehearsal \
  --build-arg NEXT_PUBLIC_APP_URL=https://capital.kodamalabs.ai \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=BIZPytT1AcEzKXA5YQRz6V7tso9r_1uFeSfAuDhTLOotQ3_p8aIwOJwTKaEBWpG9xCSfUobWA2k00AumltvwztE \
  ~/capital-ledger-v2-rehearsal
```

Dump production to the host. `pg_dump` writes to the command's stdout; the redirect creates the file on the host.

```bash
mkdir -p ~/backups
ts=$(date -u +%Y%m%dT%H%M%SZ)
docker --context desktop-linux exec postgres \
  pg_dump -Fc -U root capital > ~/backups/capital-pre67-$ts.dump
ls -lh ~/backups/capital-pre67-$ts.dump
docker --context desktop-linux exec -i postgres \
  pg_restore -l < ~/backups/capital-pre67-$ts.dump \
  | tee ~/backups/capital-pre67-$ts.list
```

The file must be non-empty. The list must include `transactions` and `businesses`.

Restore into a throwaway Postgres 17 on its own network. Publish no port. Do not restore into the prod `postgres` container, and do not attach this network to `kodama`.

```bash
docker --context desktop-linux network create capital-rehearsal-net
docker --context desktop-linux run -d \
  --name capital-rehearsal-pg \
  --network capital-rehearsal-net \
  -e POSTGRES_USER=root \
  -e POSTGRES_PASSWORD=rehearsal \
  -e POSTGRES_DB=capital \
  postgres:17
until docker --context desktop-linux exec capital-rehearsal-pg \
  pg_isready -h 127.0.0.1 -U root -d capital; do sleep 1; done

docker --context desktop-linux exec -i capital-rehearsal-pg \
  pg_restore -U root -d capital --no-owner --no-acl --exit-on-error --single-transaction \
  < ~/backups/capital-pre67-$ts.dump
```

The init-phase server listens on the socket only, so `pg_isready` has to go through `127.0.0.1`. `--exit-on-error` and `--single-transaction` are compatible with `--no-owner` and `--no-acl`, and `--single-transaction` still works together with `--clean` / `-c`. This restore is into an empty database, so the command does not pass `--clean`: a `DROP` of an object that is not there errors, and `--single-transaction` would roll the whole restore back. Confirm with `SELECT count(*) FROM transactions` inside `capital-rehearsal-pg` (519 on the 2026-10-06 dump).

Run the precheck against the copy and confirm it matches the prod precheck, including section 4:

```bash
docker --context desktop-linux exec -i capital-rehearsal-pg \
  psql -U root -d capital -v ON_ERROR_STOP=1 \
  < ~/capital-ledger-v2-rehearsal/apps/capital/scripts/precheck-ledger-migration.sql \
  | tee ~/backups/capital-ledger-v2-precheck-rehearsal.txt
```

Migrate the copy. Both URLs are required:

```bash
docker --context desktop-linux run --rm \
  --network capital-rehearsal-net \
  -e DATABASE_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  -e DIRECT_URL="postgresql://root:rehearsal@capital-rehearsal-pg:5432/capital" \
  --entrypoint pnpm \
  kodama-capital:pr67-rehearsal \
  exec prisma migrate deploy
```

Wait until the log says `All migrations have been successfully applied`. Then:

```bash
docker --context desktop-linux exec -i capital-rehearsal-pg \
  psql -U root -d capital -v ON_ERROR_STOP=1 \
  < ~/capital-ledger-v2-rehearsal/apps/capital/scripts/verify-ledger-migration.sql \
  | tee ~/backups/capital-ledger-v2-verify-rehearsal.txt
```

`ON_ERROR_STOP` only stops on SQL errors. Read the output:

- Section 1 legacy counts equal precheck 4a.
- Section 2 unmapped counts are all 0.
- Section 3 `legacy_n` and `legacy_sum` equal precheck 4b.
- Section 4 legacy sums equal precheck 4c, per user and type.
- Section 5 matches precheck 4d.
- Section 6 `ledger_legs` is twice precheck 4e, and section 7 is 0.
- Section 8 archived counts equal the live counts.
- Section 9 lists the same business-brokerage fallbacks as precheck section 3.

Remove the throwaway when the verify is saved, and also if a step fails:

```bash
docker --context desktop-linux rm -f capital-rehearsal-pg
docker --context desktop-linux network rm capital-rehearsal-net
```

Leave the worktree until production is verified. Remove it later with `git worktree remove ~/capital-ledger-v2-rehearsal` from the live checkout. Do not drop the prod database.

## Maintenance window

1. The pull request is merged to `main`. On the server:

   ```bash
   cd ~/Documents/Github/kodama-labs
   git pull origin main
   git status
   ```

   `git status` must be clean before any build. Do not check out `capital-ledger-v2` here.

2. Open an Uptime Kuma maintenance window before stopping writers. From the live checkout, credentials come from the service env file:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps uptime-kuma-provision node dist/maintenance.js start 60
   ```

   `start 60` is 60 minutes over every `kodama/` monitor. Clear it after verification (step 10), or at the end of a rollback.

3. Tag the running image before any build:

   ```bash
   docker --context desktop-linux tag kodama-capital:latest kodama-capital:rollback-pre67
   docker --context desktop-linux tag kodama-monitoring:latest kodama-monitoring:rollback-pre67
   ```

4. Stop the writers, then take the final dump on the host:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     stop capital-web cronjobs

   ts=$(date -u +%Y%m%dT%H%M%SZ)
   dump=~/backups/capital-pre67-$ts.dump
   docker --context desktop-linux exec postgres \
     pg_dump -Fc -U root capital > "$dump"
   ls -lh "$dump"
   docker --context desktop-linux exec -i postgres \
     pg_restore -l < "$dump" \
     | tee ~/backups/capital-pre67-$ts.list
   printf '%s\n' "$dump"
   ```

   The file must be non-empty. The list must include `transactions` and `businesses`. Record the path printed by `printf`. Rollback uses that literal path. A later shell does not have this `$ts`.

5. Re-run the precheck on production. Section 1 must still be all zeros, and section 4 must match the rehearsal (or be recorded as the new baseline if rows were written after the earlier dump). Then repeat the rehearsal section against this final dump: new throwaway network and `postgres:17` container, restore this file, precheck, `kodama-capital:pr67-rehearsal` with both `-e DATABASE_URL` and `-e DIRECT_URL`, verify, then `rm` the container and the network. At this size that takes a few minutes. Do not `compose build`, and do not restore the dump into the prod `postgres` container. Start the production migrate only after that verify matches.

6. Apply on production. `capital-migrate` runs `prisma migrate deploy` and reads `DATABASE_URL` and `DIRECT_URL` from `apps/capital/.env.production`:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     build capital-migrate

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate
   ```

   The log must contain `All migrations have been successfully applied`, and the command must exit 0.

   If the backfill refuses, `prisma migrate deploy` does not print the refusal list. The log shows `current transaction is aborted, commands ignored until end of transaction block`, and the migration is left failed. A second `migrate deploy` then stops with P3009. Read the rows from the precheck (section 1) or by running the backfill SQL with `psql` on the rehearsal copy.

   Recovery is one of:

   - Restore the host dump (rollback section) and stop.
   - Mark the failed attempt rolled back, fix the data, and deploy again:

     ```bash
     docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
       run --rm --no-deps capital-migrate \
       pnpm exec prisma migrate resolve --rolled-back 20261004200100_ledger_v2_backfill

     docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
       run --rm --no-deps capital-migrate
     ```

     `ledger_v2_schema` stays applied (empty new tables, old tables intact). `ledger_v2_retire_legacy` has not started. Fix the ids from the precheck before the second deploy.

7. Verify, and compare with the rehearsal file and with precheck section 4:

   ```bash
   docker --context desktop-linux exec -i postgres \
     psql -U root -d capital -v ON_ERROR_STOP=1 \
     < apps/capital/scripts/verify-ledger-migration.sql \
     | tee ~/backups/capital-ledger-v2-verify-prod.txt
   ```

   The same equalities as the rehearsal must hold. Do not start the app while any of them fails.

8. Start the app, then the cron runner, then rebuild and run the provisioner. `infrastructure/monitoring/Dockerfile` copies `infrastructure/cronjobs/schedules` into the image, and `uptime-kuma-provision` has no bind mount for that directory. `run` on the current `kodama-monitoring:latest` would keep the old categorize-bills and categorize-statements monitors (they then go Down) and would not create notify, portfolio-snapshot, or benchmarks. Build the provisioner before running it. That build retags `kodama-monitoring:latest`.

   `log-watcher` uses the same image and does not read the cron schedules (`node dist/watch.js` tails container logs). Recreate it after the build so it runs the new image; the container started earlier keeps the previous one.

   `uptime-kuma-provision` has `restart: "no"`. `run` exits when it finishes; that exit code must be 0.

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps capital-web

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps --force-recreate cronjobs

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     build uptime-kuma-provision

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps uptime-kuma-provision

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps --force-recreate log-watcher
   ```

   Then open Uptime Kuma and check that every Sentinel monitor that was paused is still paused. `editMonitor` sends `active: true`, so a monitor the provisioner updated is turned back on. Pause any that came back on.

9. Smoke. Sign in, open a month that has card purchases and a month that has transfers, and confirm balances match the rehearsal verify output. Then run the idempotent follow-ups inside the image, dry-run first. Do not run them from the host.

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate \
     pnpm exec tsx scripts/localize-system-categories.ts --dry-run
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate \
     pnpm exec tsx scripts/localize-system-categories.ts

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate \
     pnpm exec tsx scripts/backfill-portfolio-snapshots.ts --dry-run
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     run --rm --no-deps capital-migrate \
     pnpm exec tsx scripts/backfill-portfolio-snapshots.ts
   ```

10. End the maintenance window, then resume the Contador MCP client:

    ```bash
    docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
      run --rm --no-deps uptime-kuma-provision node dist/maintenance.js clear
    ```

## Rollback, before writes resume

Use this only if verify failed or the app is wrong and nothing has written to the new ledger yet. Do not drop the failed database. The restore path is the literal dump path written down in step 4, not `$ts` from that shell.

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  stop capital-web cronjobs

docker --context desktop-linux exec -i postgres \
  psql -U root -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'capital' AND pid <> pg_backend_pid();
ALTER DATABASE capital RENAME TO capital_failed_pr67;
CREATE DATABASE capital;
SQL

docker --context desktop-linux exec -i postgres \
  pg_restore -U root -d capital --no-owner --no-acl --exit-on-error --single-transaction \
  < ~/backups/capital-pre67-YYYYMMDDTHHMMSSZ.dump

docker --context desktop-linux tag kodama-capital:rollback-pre67 kodama-capital:latest
docker --context desktop-linux tag kodama-monitoring:rollback-pre67 kodama-monitoring:latest

cd ~/Documents/Github/kodama-labs
git checkout 14df14b61
git status
```

`14df14b61` is `main` before this pull request. The checkout makes the bind-mounted schedules match the old image. `git status` must be clean. Do not recreate cronjobs before this checkout.

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps capital-web
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps --force-recreate cronjobs
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps --force-recreate log-watcher
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  run --rm --no-deps uptime-kuma-provision
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  run --rm --no-deps uptime-kuma-provision node dist/maintenance.js clear
```

`capital_failed_pr67` stays until someone decides to drop it. Resume Contador only after the restored app answers. `git checkout main` in the live tree comes later, together with a cronjobs recreate, so the mounted schedules and the image stay paired.

## What Contador sees

Tool names and input schemas are unchanged. Behavior that differs:

- Delete is soft (`deletedAt`). A deleted entry stays in the database and disappears from lists.
- `list_transactions` excludes transfer groups and filters by effective date. A card purchase falls in the statement's closing month, not the purchase date.
- `update_budget` edits the row in place, including past months. A later amount is a new budget with a new `effectiveFrom`.
- `import_credit_card_statement` books the remaining installments immediately.
- `find_orphan_transactions` is income or expense with no category, or with an archived one.
- `localize-system-categories` renames system categories to pt-BR. Entries keep the category id.
