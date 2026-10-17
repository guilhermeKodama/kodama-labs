# Deploying kodama-labs

The production checkout on kodama-ai polls `origin/main` and deploys it after the GitHub check run named `ci` is green. Nothing on the server accepts a connection from GitHub. The repo is public, so a self-hosted runner is the wrong tool: a fork pull request can execute workflow code on that runner, and this machine holds production env files and the Docker socket.

GitHub-hosted Actions plus a Tailscale SSH key would also work for pushes to `main`, and fork pull requests would not receive that secret. A later commit on `main` can still print the secret from the workflow. This deployer keeps every credential on the server.

## What runs where

| Docker context | Role |
|---|---|
| `desktop-linux` | The live stack (`kodama-prod`): apps, Postgres, cloudflared, cronjobs, monitoring. Deploys recreate containers here. |
| `default` | Native engine, used only to `docker build` and `docker save`. The stale stack and `whisper-rocm` live here and are never started, stopped, or removed. |

`next build` already sets a 4 GB Node heap. That is enough for V8 and not enough for the 8 GB Docker Desktop VM, which is also running Postgres. Builds stay on the native engine. Images are loaded into `desktop-linux` and only then tagged `:latest`. Compose commands pass `--no-build`, so a recreate cannot fall back to building inside the VM.

Smoke checks use container DNS (`http://capital-web:3000/api/health`), not the published host port. Careers, attention, capital, and sentinel answer `/api/health` with a database ping (`"db":"ok"`). Kodamalabs answers the same path with `"db":"skipped"`.

## Install

Run this on kodama-ai as `kodama`, from the checkout at `~/Documents/Github/kodama-labs`. It does not enable the timer.

```bash
infrastructure/deploy/install.sh
```

Linger has to already be on (`loginctl show-user kodama -p Linger` prints `Linger=yes`). If it is off, the script stops and prints the one root command: `sudo loginctl enable-linger kodama`. Nothing else needs root.

Then, still without the timer:

```bash
git fetch origin main
infrastructure/deploy/deploy.sh --dry-run
infrastructure/deploy/deploy.sh
```

`--dry-run` prints the dirty units, the CI gate, and the commands. It does not fetch, merge, or talk to Docker. Fetch yourself first if you want the plan for the latest `main`. A local commit that is not on `origin/main` yet still prints a plan; a real deploy refuses that commit. When the supervised deploy looks right:

```bash
infrastructure/deploy/install.sh --enable
```

The timer waits about two minutes, then polls. Re-running `install.sh` does not disable a timer you already enabled, and it does not reset `~/deploys/status.json` if that file exists. The first install records the current HEAD as already deployed for every unit, so it does not rebuild the world.

## What a poll does

1. If `~/deploys/PAUSED` exists, or the Docker Desktop engine is down, or a deploy is already running, it exits.
2. `git fetch origin main`. Several merges during one deploy collapse into the next run. There is no per-commit queue.
3. If this SHA is recorded as a failed deploy, it does not try again.
4. If any unit's last good SHA differs from `main` in a path that unit cares about, it waits until the check run named `ci` is green.
5. It fast-forwards the checkout, dumps the database for each app it is about to migrate, tags the running image `kodama-<app>:rollback-<40 hex sha>`, builds on the native engine, loads the image, runs `prisma migrate deploy`, recreates that app's services, and smokes them.
6. Capital also checks `https://capital.kodamalabs.ai/login` (302 to Cloudflare Access, redirects not followed) and `POST /mcp` `tools/list`. The MCP bearer token is the container's `MCP_API_KEY` and is not written to the log.
7. On success it writes `~/deploys/status.json`, appends `~/deploys/<stamp>-<sha>.log`, and may POST the webhook.

A careers-only change does not rebuild capital. `packages/storage` rebuilds careers, sentinel, and capital. Root `Dockerfile`, lockfile, and `packages/typescript-config` rebuild the Next.js images. `infrastructure/cronjobs/src` rebuilds capital, because cronjobs runs out of that image. Schedule JSON only recreates the `cronjobs` container (the directory is a bind mount) and rebuilds the monitoring image (the Dockerfile copies the schedules in). `infrastructure/postgres` is never applied; the log says so once per SHA.

Apps run in this order: monitoring, kodamalabs, careers, attention, sentinel, capital. Capital is last because cronjobs uses its image.

## Failures are not retried

After `build_failed`, `migrate_failed`, `rolled_back`, or `rollback_unhealthy` for SHA X, the next ticks do nothing with X. A newer `origin/main`, or `deploy.sh --force`, is what runs again. `--force` still requires the SHA to be an ancestor of `origin/main`, skips the CI wait, and ignores `PAUSED`.

| Result | Running containers | `PAUSED` |
|---|---|---|
| `build_failed` (includes a failed `pg_dump` or image load) | Unchanged. `:latest` was not moved if the build never finished. | No |
| `migrate_failed` | The previous process keeps serving. `:latest` is pointed back at the rollback tag so a reboot does not start the new image. | Yes |
| `rolled_back` | Previous image restored and smoked. | No |
| `rollback_unhealthy` | Rollback was attempted and the previous image is not healthy. | Yes |

`migrate_failed` and `rolled_back` can leave the new schema under the old code when the migration committed. The status error says `schema_may_be_new`. The database is not restored automatically. The dump is the matching file under `~/backups/`.

```bash
CONFIRM_DB_RESTORE=capital infrastructure/deploy/rollback.sh --restore-db capital ~/backups/<file>.dump
```

That refuses to run unless `CONFIRM_DB_RESTORE` equals the database name. Image rollback is separate:

```bash
infrastructure/deploy/rollback.sh capital
```

It retags `kodama-capital:rollback` to `:latest` and recreates capital's services. It does not touch Postgres, `PAUSED`, or the failed-SHA record.

An interrupted deploy (status left at `in_progress`) also writes `PAUSED`. Read the log before `deploy.sh --resume`.

CI that is still running is not a failure. CI that finished red is recorded once and is not a blocked SHA: a re-run of the same commit can still deploy. A missing `ci` check is waited on for 20 minutes, then treated as red.

Notifications are once per SHA and result. Markers live in `~/deploys/notified-*`.

## Pause, force, dry-run

```bash
infrastructure/deploy/deploy.sh --pause "holding for the schema review"
infrastructure/deploy/deploy.sh --resume
infrastructure/deploy/deploy.sh --sha <40-hex> --force
infrastructure/deploy/deploy.sh --dry-run --sha <40-hex>
```

`--pause` writes a `manual:` line. A failure writes an `auto:` line. A later successful deploy removes only an `auto:` pause.

## Rotation

The deployer deletes only names it created, and only when the name matches its pattern:

- image tags `kodama-<app>:rollback-` plus 40 hex characters, and `kodama-<app>:` plus 40 hex characters, listed in `~/deploys/tag-manifest.txt`
- dumps named `<stamp>Z-<40 hex>-<database>.dump`, listed in `~/deploys/dump-manifest.txt`

It keeps the newest 5 rollback tags, the newest 5 SHA tags, and the newest 10 dumps per database. `kodama-capital:rollback-pre95`, `rollback-pre-fx`, and `~/backups/capital-pre*.dump` do not match, are not in the manifest unless someone hand-edited it, and are not removed even then because the pattern check runs again. `:latest` and the moving `:rollback` tag are not in the manifest.

Build cache on the native engine is not pruned automatically. When the disk needs it:

```bash
docker --context default buildx prune -f --filter until=168h --keep-storage 20GB
```

Do not `docker system prune` on either context.

## Webhook and GitHub

`~/.config/kodama-deploy/env` (mode 600), created empty by the installer:

```bash
DEPLOY_WEBHOOK_URL=https://example.invalid/hooks/deploy
DEPLOY_WEBHOOK_HEADER=Authorization: Bearer replace-me
GITHUB_TOKEN=
```

The webhook is a JSON POST of `status.json`. The header is a single `Name: value`. It is sent and never logged. An empty URL skips the POST. A failed POST does not fail the deploy.

Without `GITHUB_TOKEN`, CI is read anonymously (60 requests/hour/IP; idle polls do not call the API) and no commit status is posted. With a token, the deployer also posts the commit status `kodama-ai/deploy` and a deployment in the `kodama-ai` environment.

Fine-grained personal access token, this repository only:

| Permission | Access |
|---|---|
| Commit statuses | Read and write |
| Deployments | Read and write |
| Checks | Read-only |
| Contents | None. `git fetch` uses the public HTTPS URL. |
| Metadata | Read-only, which GitHub always includes |

No Administration, Secrets, Workflows, or Pull requests. The token stays in that env file. It is not a GitHub Actions secret.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It has no secrets. The job `verify` lints, typechecks, and tests packages changed since the base commit. The job `ci` depends on `verify` and fails when `verify` fails. The deployer waits for a check run whose **name** is `ci`. Adding a matrix later means listing those jobs in `needs` and leaving the aggregator named `ci`.

Capital tests use a Postgres service container. `portfolio-fx-repair.test.ts` rewrites rows across the database, so it is excluded from the parallel run and executed afterwards against `capital_fx_test`.

### Branch protection

Ask the repository owner to require the `ci` check before merging to `main` (Settings → Branches → branch protection for `main` → require status checks → `ci`). The workflow does not do that by itself. Until it is on, a red PR can still be merged, and the deployer will then refuse that SHA.

## The deployer updating itself

systemd runs `~/.local/lib/kodama-deploy/poll.sh`, a copy, not a symlink into the checkout. After a deploy exits 0, that copy is replaced from the checkout when `poll.sh`, `lib.sh`, `apps.conf`, or `status.py` differ. `bash -n` runs first, and the previous poller is kept as `poll.sh.prev`. The process that just finished does not re-exec. A failed deploy does not replace the copy, so a broken poller cannot install itself.

```bash
cp ~/.local/lib/kodama-deploy/poll.sh.prev ~/.local/lib/kodama-deploy/poll.sh
systemctl --user daemon-reload
```

## Layout

| Path | Role |
|---|---|
| `install.sh` | Copy units and seed status. `--enable` arms the timer. |
| `poll.sh` | Timer entrypoint. |
| `deploy.sh` | One SHA. |
| `rollback.sh` | Image rollback, or an explicit database restore. |
| `lib.sh`, `apps.conf`, `status.py` | Plan, guards, status file. |
| `deploy.test.sh` | Shell tests. No Docker daemon. |
| `ci-test.sh` | Affected tests inside GitHub Actions. |
| `kodama-deploy.service`, `kodama-deploy.timer` | User units. `TimeoutStartSec` is two hours. |

State outside the repo: `~/deploys/status.json`, `~/deploys/PAUSED`, `~/deploys/*.log`, `~/backups/*.dump`.
