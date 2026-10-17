# Deploying kodama-labs

A merge to `main` deploys itself. GitHub Actions runs the `ci` workflow. When that finishes green on a push to `main`, the `deploy` workflow joins the tailnet and SSHes one command to kodama-ai. The deploy key cannot open a shell.

Nothing listens on a public port. The runner is GitHub-hosted. There is no self-hosted runner and no systemd timer.

| Docker context | Role |
|---|---|
| `desktop-linux` | The live stack (`kodama-prod`). Deploys load images, migrate, and recreate here. |
| `default` | Native engine. The deployer may only `docker build` and `docker save` here. The stale stack on this context is never started, stopped, or removed. |

Images are built on `default` because the Docker Desktop VM runs out of memory. They are loaded into `desktop-linux` and only then tagged `:latest`. Compose commands pass `--no-build`.

Smoke checks use container DNS (`http://capital-web:3000/api/health`). Capital also checks `https://capital.kodamalabs.ai/login` for a 302 to Cloudflare Access, and `POST /mcp` `tools/list`. The MCP bearer token is read inside the container and is not written to the log.

`infrastructure/postgres` is never applied. A change is logged and left for a person.

## What Guilherme sets up once

### 1. Deploy key, on your own machine

`install.sh` does not generate a key.

```bash
ssh-keygen -t ed25519 -f deploy_key -N ''
```

The private file is the `KODAMA_AI_SSH_KEY` secret. The `.pub` file is what `install.sh --authorize-key` reads. Do not commit either file.

### 2. On kodama-ai, as `kodama`

From `~/Documents/Github/kodama-labs`, after this branch is on `main`:

```bash
git fetch origin main
infrastructure/deploy/install.sh \
  --authorize-key /path/to/deploy_key.pub \
  --seed-sha c0e48d2212d5259c466edaea3bf8ea291114b585
```

`--seed-sha` is the commit production is actually running. It has to be reachable from `origin/main`. If `main` has moved and that commit was never deployed, do not seed `HEAD`. The first install records that SHA as already deployed for every unit, so the first real deploy builds only what changed after it.

The script copies `ssh-entry.sh`, `deploy.sh`, `rollback.sh`, `lib.sh`, `apps.conf`, and `status.py` to `~/.local/lib/kodama-deploy/`. sshd runs that copy. A deploy never replaces it. When those files change in git, the next deploy prints `WARNING: tooling drift` and sets `tooling_drift` in `~/deploys/status.json`. Re-run `install.sh` (it will not reset an existing status file). Nothing is installed automatically.

`--authorize-key` copies `~/.ssh/authorized_keys` to `authorized_keys.bak.<stamp>` and then replaces only the line marked `kodama-ci-deploy`:

```text
restrict,command="/home/kodama/.local/lib/kodama-deploy/ssh-entry.sh" ssh-ed25519 AAAA... kodama-ci-deploy
```

`restrict` disables pty, agent forwarding, port forwarding, X11, and user rc. Other keys in the file are left alone. Running the install again leaves a single forced-command line.

No sudo. The script refuses to run as root.

### 3. Known hosts

From a machine that is already on the tailnet:

```bash
ssh-keyscan -t ed25519 100.109.102.38
```

On kodama-ai, the fingerprint must match the server's own host key before that line becomes the secret:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf <(ssh-keyscan -t ed25519 100.109.102.38)
```

`KODAMA_AI_KNOWN_HOSTS` is the `ssh-keyscan` line (`100.109.102.38 ssh-ed25519 AAAA...`). The workflow SSHes to that IP, not to a MagicDNS name. `/etc/ssh/ssh_host_ed25519_key.pub` is world-readable.

### 4. GitHub

Repository `guilhermeKodama/kodama-labs`.

1. Settings → Environments → New environment → name `production`.
2. Deployment branches: Selected branches, add `main` only. Required reviewers are optional. Leave them off if a merge should deploy by itself. A required reviewer waits for a person.
3. Environment secrets (not repository secrets):
   - `TS_OAUTH_CLIENT_ID`
   - `TS_OAUTH_SECRET`
   - `KODAMA_AI_SSH_KEY` (the private key, including the BEGIN and END lines)
   - `KODAMA_AI_KNOWN_HOSTS` (the single `ssh-keyscan` line)
4. Settings → Branches → branch protection for `main`. Require a pull request. Require the status check named `ci`. That check exists after the workflow has run once on `main`. Do not require the deploy workflow as a merge check.

### 5. Tailscale

Tailnet `kodama-labs-ubuntu`. kodama-ai is `100.109.102.38`.

1. Add the tag `tag:ci-deploy`. Tag owner: `autogroup:admin`.
2. Create an OAuth client. Scope: writable `auth_keys` (the admin console labels this devices:core write). The only tag on the client is `tag:ci-deploy`. Do not use a reusable auth key.
3. Merge this into the existing policy. Do not replace the rest of the file. Add the tag owner, and add one grant. Use `acls` or `grants` to match the style the policy already has. Adding only the fragment below as the entire policy would remove every existing grant.

```json
{
  "tagOwners": {
    "tag:ci-deploy": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:ci-deploy"],
      "dst": ["100.109.102.38:22"]
    }
  ]
}
```

The same reachability as a grant, if the policy uses `grants` instead of `acls`:

```json
{
  "src": ["tag:ci-deploy"],
  "dst": ["100.109.102.38"],
  "ip": ["22"]
}
```

`tag:ci-deploy` can open TCP 22 to kodama-ai and nothing else. The GitHub Action marks the node ephemeral. It is removed when the job ends. If the Tailscale address changes, update the ACL, the workflow `ping` input, the SSH target, and `KODAMA_AI_KNOWN_HOSTS` together.

## What a deploy does

The forced command accepts only:

| Command | Effect |
|---|---|
| `deploy` and 40 lowercase hex digits | Fetch `origin/main`, require the SHA to be reachable from it, fast-forward the checkout, deploy what changed. |
| `rollback` and `capital`, `careers`, `attention`, `sentinel`, `kodamalabs`, or `monitoring` | Point that image's `:latest` back at the moving `:rollback` tag and recreate its services. The database is not restored. |
| `status` | Print `~/deploys/status.json`. |

Anything else is rejected and is not echoed. That includes `deploy abc; rm -rf ~`, a short SHA, `--force`, and `rollback postgres`.

`deploy.sh` fast-forwards only. An older SHA that is already contained in the checkout, while `HEAD` is `origin/main`, exits 0 with `superseded by <HEAD>` and does not move git backwards. Image rollback is the way back to a previous build.

`~/deploys/PAUSED` refuses the deploy key. Clearing it, or retrying a blocked SHA with `deploy.sh --sha <sha> --force`, is a local shell on kodama-ai. The deploy key cannot pass `--force`. Database restore (`CONFIRM_DB_RESTORE=<db> rollback.sh --restore-db <db> <dump>`) is local-only too.

Per image, compared with that unit's last SHA in `status.json`:

1. `pg_dump -U root -d <db> -Fc` in the `postgres` container on `desktop-linux` (careers, attention, sentinel, capital).
2. Tag `:latest` as `kodama-<app>:rollback-<old sha>` and as the moving `:rollback` tag.
3. `docker --context default build`, then `docker save | docker --context desktop-linux load`.
4. Migrate with `--no-build`. Recreate the long-running services with `--no-build`. Capital also recreates `cronjobs`.
5. Smoke over container DNS.

| Result | Running containers | `:latest` | `PAUSED` | Actions |
|---|---|---|---|---|
| `build_failed` (includes a bad `pg_dump` or image load) | Unchanged | Restored if it was already moved | No | Red |
| `migrate_failed` | The previous process keeps serving | Pointed back at the rollback tag | Yes | Red |
| `rolled_back` | Previous image restored and smoked | Previous image | No | Red |
| `rollback_unhealthy` | Previous image is not healthy | Previous tag | Yes | Red |

`migrate_failed` and `rolled_back` can leave a new schema under the old code. The status error says `schema_may_be_new`. The dump is under `~/backups/`. It is not restored automatically.

A careers-only change does not rebuild capital. `packages/storage` rebuilds careers, sentinel, and capital. The root `Dockerfile`, lockfile, and `packages/typescript-config` rebuild the Next.js images. `infrastructure/cronjobs/src` rebuilds capital. Schedule JSON recreates `cronjobs` and rebuilds monitoring.

Order: monitoring, kodamalabs, careers, attention, sentinel, capital.

Rotation deletes only manifest entries that match `rollback-` plus 40 hex digits, a 40-hex tag, or a dump named `<stamp>Z-<40 hex>-<db>.dump`. It keeps the newest 5 rollback tags, the newest 5 SHA tags, and the newest 10 dumps per database.

## Logs and status

Stdout is the Actions log and `~/deploys/<stamp>-<sha>.log`. The job summary is a per-app table parsed from `KODAMA_APP` lines. The runner checks out the workflow commit only to render that table. It does not check out the SHA being deployed, and it does not build images.

`~/deploys/status.json` is what the monitor reads. `tooling_drift` is `true` when the installed scripts differ from `infrastructure/deploy` at the SHA that was requested. The field is a JSON boolean.

Optional failure webhook, in `~/.config/kodama-deploy/env` (mode 600), created empty by the installer. It is not a GitHub secret. A failed POST does not fail the deploy. The header is sent and never logged.

```bash
DEPLOY_WEBHOOK_URL=https://example.invalid/hooks/deploy
DEPLOY_WEBHOOK_HEADER=Authorization: Bearer replace-me
```

## Manual re-run

Actions → Deploy → Run workflow, on `main`. `command` is `deploy`, `rollback`, or `status`. A blocked SHA or a `PAUSED` file still refuses `deploy`. Fix that on the server, then run the workflow again.

Queued deploys do not cancel each other. A later SHA fast-forwards. An older SHA that starts after that exits 0 as superseded.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It has no secrets. The job `verify` lints, typechecks, and tests packages changed since the base commit, with Postgres 17. Capital's portfolio fx-repair test runs afterwards against `capital_fx_test`. The job `ci` fails when `verify` fails. Branch protection should require the check named `ci`.
