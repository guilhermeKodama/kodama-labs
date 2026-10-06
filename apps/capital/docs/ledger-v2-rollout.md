# Ledger v2 production rollout

This is the runbook for applying the ledger v2 migrations on the production `capital` database. Do not run `pnpm db:drop-legacy` as part of this rollout. The old tables stay in the `legacy` schema, including the link archives `legacy.attachment_links`, `legacy.budget_links`, and `legacy.reminder_dispatch_links`, until a later, separate decision.

Every compose command uses the desktop Docker context and the production project, and names the services it touches:

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml
```

`up` and `run` always take `--no-deps`. `stop` does not accept `--no-deps`; it only stops the services named on the command line. Never `down`, never `-v`, never `prune`.

`capital-migrate` and `capital-web` share `image: kodama-capital:latest`. Building either one retags `latest`. The rehearsal must not build that image.

## Checksums

Editing `20261004200000_ledger_v2_schema`, `20261004200100_ledger_v2_backfill`, or `20261004200200_ledger_v2_retire_legacy` changes their Prisma checksums. Any local or dev database that already applied an older copy of those files will refuse `migrate deploy` until it is recreated (`pnpm --filter @wallex/capital db:reset` against `capital_dev`, or drop and recreate the database). Production has never applied them. Step 0 confirms that: the `_prisma_migrations` query must return no `ledger_v2_*` rows. The latest migration already applied in production is `20261004120000`.

## Step 0 — read-only precheck on production, before any dump

Pause nothing yet. This script only `SELECT`s, inside `BEGIN READ ONLY` / `ROLLBACK`, and it uses pre-ledger tables, so it is safe on the live `capital` database.

```bash
docker --context desktop-linux exec -i postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d capital -v ON_ERROR_STOP=1' \
  < apps/capital/scripts/precheck-ledger-migration.sql \
  | tee /tmp/capital-ledger-v2-precheck-prod.txt
```

Read the saved output before continuing:

- Section 0 returns no rows. A `ledger_v2_*` row means production already applied one of these migrations and this runbook does not apply.
- Section 1, every `row_count` is 0. A positive count aborts the backfill. Each row includes up to 10 sample ids. Fix those rows (or decide the case, for an `externalId collision`) and rerun the precheck. Do not start the rehearsal with a failing section 1.
- Sections 2 and 3 are informational. Section 2 lists rows the unambiguous-owner rules will fill in. Section 3 lists business brokerages that keep the existing fallback onto the personal entity. Copy both lists into the rehearsal notes.
- Section 4 is the baseline. Record 4a through 4e (row counts, purchase count and absolute sum, income/expense totals excluding future card payments, bill-payment totals, transfer count). The post-migration `verify-ledger-migration.sql` run is checked against these numbers, and against the same numbers captured again in the rehearsal.

## Rehearsal

Take a custom-format dump from inside the postgres container and restore it into a new database. Do not build `capital-migrate` or `capital-web` here.

```bash
docker --context desktop-linux exec postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -d capital -f /tmp/capital-rehearsal.dump'

docker --context desktop-linux exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS capital_rehearsal_dev;" \
    -c "CREATE DATABASE capital_rehearsal_dev;"'

docker --context desktop-linux exec postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d capital_rehearsal_dev --no-owner --no-acl /tmp/capital-rehearsal.dump'
```

Run the precheck against the restored copy and confirm it matches `/tmp/capital-ledger-v2-precheck-prod.txt`, including the section 4 totals:

```bash
docker --context desktop-linux exec -i postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d capital_rehearsal_dev -v ON_ERROR_STOP=1' \
  < apps/capital/scripts/precheck-ledger-migration.sql \
  | tee /tmp/capital-ledger-v2-precheck-rehearsal.txt
```

Apply the migrations with the host Prisma client pointed at `capital_rehearsal_dev` (published on `localhost:5433`). That does not retag `kodama-capital:latest`.

```bash
cd apps/capital
DATABASE_URL="postgresql://root:<password>@127.0.0.1:5433/capital_rehearsal_dev" \
DIRECT_URL="postgresql://root:<password>@127.0.0.1:5433/capital_rehearsal_dev" \
  pnpm exec prisma migrate deploy
```

If the host client is not an option, build a separate tag and run that image only. Do not `compose build capital-migrate`, and do not tag the result `latest`. `capital-web` is pinned to `kodama-capital:latest`, so this `docker run` names the rehearsal tag explicitly:

```bash
docker --context desktop-linux build \
  -f Dockerfile --target capital \
  -t kodama-capital:pr67-rehearsal \
  --build-arg NEXT_PUBLIC_APP_URL=https://capital.kodamalabs.ai \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=<the value in docker-compose.yml> \
  .

docker --context desktop-linux run --rm --network kodama-prod_kodama \
  -e DATABASE_URL="postgresql://root:<password>@postgres:5432/capital_rehearsal_dev" \
  --entrypoint pnpm \
  kodama-capital:pr67-rehearsal \
  exec prisma migrate deploy
```

Wait until the log says `All migrations have been successfully applied`. Then:

```bash
docker --context desktop-linux exec -i postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d capital_rehearsal_dev -v ON_ERROR_STOP=1' \
  < apps/capital/scripts/verify-ledger-migration.sql \
  | tee /tmp/capital-ledger-v2-verify-rehearsal.txt
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

Leave `capital_rehearsal_dev` in place until the production run has been verified. Drop it later with `DROP DATABASE capital_rehearsal_dev`. Do not drop `capital`.

## Maintenance window

1. Pause the Contador MCP client so nothing writes during the dump or the migration.
2. Tag the running image before any build:

   ```bash
   docker --context desktop-linux tag kodama-capital:latest kodama-capital:rollback-pre67
   ```

3. Stop the writers, then take the final dump:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     stop capital-web cronjobs

   docker --context desktop-linux exec postgres \
     sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -d capital -f /tmp/capital-pr67.dump'

   docker --context desktop-linux exec postgres \
     sh -c 'pg_restore -l /tmp/capital-pr67.dump' | tee /tmp/capital-pr67.list
   ```

   The list must include the pre-ledger tables `transactions` and `businesses`. Copy the dump off the container before leaving the window (`docker cp postgres:/tmp/capital-pr67.dump`).

4. Rerun the precheck against production one last time and confirm section 1 is still all zeros and section 4 still matches the rehearsal baseline. A drift here means something wrote after the rehearsal dump; stop and re-rehearse.

5. Build and apply. `--abort-on-container-exit` makes the shell return the migrate container's exit code:

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     build capital-migrate

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up --no-deps --abort-on-container-exit --exit-code-from capital-migrate capital-migrate
   ```

   The log must contain `All migrations have been successfully applied`, and the command must exit 0. A refusal (`ledger backfill refused:`) rolls the backfill transaction back. `ledger_v2_schema` stays applied (empty new tables, old tables intact) and `ledger_v2_retire_legacy` does not start. Fix the listed ids and rerun `capital-migrate`; do not restore yet unless you are abandoning the window.

6. Verify, and compare with the rehearsal file and with precheck section 4:

   ```bash
   docker --context desktop-linux exec -i postgres \
     sh -c 'psql -U "$POSTGRES_USER" -d capital -v ON_ERROR_STOP=1' \
     < apps/capital/scripts/verify-ledger-migration.sql \
     | tee /tmp/capital-ledger-v2-verify-prod.txt
   ```

   The same equalities as the rehearsal must hold. Do not start the app while any of them fails.

7. Start the app, then the cron runner, then the one-shot provisioner. `uptime-kuma-provision` has `restart: "no"`; wait until that container exits 0.

   ```bash
   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps capital-web

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up -d --no-deps --force-recreate cronjobs

   docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
     up --no-deps --abort-on-container-exit --exit-code-from uptime-kuma-provision uptime-kuma-provision
   ```

8. Smoke. Sign in, open a month that has card purchases and a month that has transfers, and confirm balances match the rehearsal verify output. Then, from a shell that has `apps/capital/.env.production` and `DATABASE_URL` pointed at production, run the idempotent follow-ups dry-run first:

   ```bash
   pnpm --filter @wallex/capital exec tsx --env-file=.env.production scripts/localize-system-categories.ts --dry-run
   pnpm --filter @wallex/capital exec tsx --env-file=.env.production scripts/localize-system-categories.ts

   pnpm --filter @wallex/capital exec tsx --env-file=.env.production scripts/backfill-portfolio-snapshots.ts --dry-run
   pnpm --filter @wallex/capital exec tsx --env-file=.env.production scripts/backfill-portfolio-snapshots.ts
   ```

   Resume the Contador MCP client only after the smoke checks pass.

## Rollback, before writes resume

Use this only if verify failed or the app is wrong and nothing has written to the new ledger yet. Do not drop the failed database.

```bash
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  stop capital-web cronjobs

docker --context desktop-linux exec postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1' <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'capital' AND pid <> pg_backend_pid();
ALTER DATABASE capital RENAME TO capital_failed_pr67;
CREATE DATABASE capital;
SQL

docker --context desktop-linux exec postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d capital --no-owner --no-acl /tmp/capital-pr67.dump'

docker --context desktop-linux tag kodama-capital:rollback-pre67 kodama-capital:latest

docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps capital-web
docker --context desktop-linux compose -p kodama-prod -f docker-compose.yml \
  up -d --no-deps --force-recreate cronjobs
```

`capital_failed_pr67` stays until someone decides to drop it. Resume Contador only after the restored app answers.

## What Contador sees

Tool names and input schemas are unchanged. Behavior that differs:

- Delete is soft (`deletedAt`). A deleted entry stays in the database and disappears from lists.
- `list_transactions` excludes transfer groups and filters by effective date. A card purchase falls in the statement's closing month, not the purchase date.
- `update_budget` edits the row in place, including past months. A later amount is a new budget with a new `effectiveFrom`.
- `import_credit_card_statement` books the remaining installments immediately.
- `find_orphan_transactions` is income or expense with no category, or with an archived one.
- `localize-system-categories` renames system categories to pt-BR. Entries keep the category id.
