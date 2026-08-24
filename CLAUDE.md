# kodama-labs monorepo

## Local secrets for a new worktree — READ THIS BEFORE RUNNING ANY APP

Every app's `.env` is gitignored and **not present in a fresh worktree checkout**.
Without it, `pnpm dev` / workers / systemd services for that app will fail to
start or crash on missing env vars (`DATABASE_URL`, API keys, etc).

Local dev secrets for each app are stored in a dedicated 1Password
**Environment** (the newer 1Password feature for env-var sets, distinct from
regular vault items), named `kodama-labs-<app>-dev`:

- `kodama-labs-capital-dev`
- `kodama-labs-sentinel-dev`
- `kodama-labs-attention-dev`
- `kodama-labs-careers-dev`

When starting work in a new app, or a new worktree of an existing app, fetch
its `.env` like this from the repo root:

```bash
# One-time per shell: get the account ID (or hardcode it — it doesn't rotate)
ACCOUNT_ID=$(sudo -u kodama op account list --format=json | node -e \
  'process.stdin.on("data",d=>console.log(JSON.parse(d)[0].account_uuid))')

# Materialize <app>'s .env into the current worktree checkout
sudo -E -u kodama env KODAMA_LABS_1P_ACCOUNT_ID="$ACCOUNT_ID" \
  node scripts/1password-env.mjs create-local-env-file kodama-labs-<app>-dev /tmp/<app>.env
cat /tmp/<app>.env > apps/<app>/.env
rm /tmp/<app>.env
```

(`create-local-env-file`'s `mountPath` is a live-refreshing named pipe, not a
plain file — read it once via `cat` into the app's real `.env` path rather
than pointing a long-running process at the pipe directly.)

### Why `sudo -u kodama` is required

This machine has `loginctl enable-linger` set for `kodama` so background
services (systemd `--user` units) survive logout. That means the persistent
session hosting agent tooling here predates any given login and never picks
up group-membership changes (`onepassword` / `onepassword-mcp` /
`onepassword-cli`, gid 1001-1003) that a normal login would apply — even a
full desktop logout/login doesn't refresh it, because `systemd --user` reuses
the lingering instance instead of restarting it. `sudo -u kodama <cmd>`
recomputes group membership fresh via `/etc/group` on every invocation,
sidestepping the stale session entirely. A real fix would mean restarting
`user@1000.service` or rebooting, both of which would also kill whatever's
using this — not worth it for reading env vars.

### Scripts

- `scripts/1password-env.mjs` — CLI wrapper around the local `1password-mcp`
  server. Commands: `list-environments`, `list-variables <env>`,
  `create-environment <env>`, `append-variables <env> <jsonFile>` (idempotent
  — skips names already present), `create-local-env-file <env> <mountPath>`.
- `scripts/env-to-1password-vars.mjs <envFile> <outFile>` — converts a `.env`
  file into the JSON array `append-variables` expects, without ever printing
  values to stdout.

### Adding a new app

1. Create the Environment once: `create-environment kodama-labs-<app>-dev`
   (via `scripts/1password-env.mjs`, same `sudo -u kodama` prefix).
2. Push its current `.env` into it: `env-to-1password-vars.mjs` then
   `append-variables`.
3. Add the app to this doc's list above.

## Postgres

Shared Postgres 17 in Docker (port 5433), one DB per app — see
`infrastructure/postgres/`. Do not bump the image version without also fixing
the volume mount path (see `infrastructure/postgres/docker-compose.yml`
history) — a prior mismatched bump silently orphaned the real data volume.

## Ports

| App | Port |
|---|---|
| `apps/capital` | 3000 |
| `apps/docs` | 3001 |
| `apps/sentinel` | 3002 |
| `apps/kodamalabs` | 3003 |
| `apps/attention` | 3005 |
| `apps/careers` | 3006 |
| `ideas/*` | 3100 |
