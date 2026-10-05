# Monitoring

Uptime Kuma and a log watcher for the `kodama-prod` stack. Alerts leave the box as one JSON POST. Nothing here is published through `cloudflared`.

The slim image has no embedded MariaDB. Compose sets `UPTIME_KUMA_DB_TYPE=sqlite`, which writes `db-config.json` and starts the main server. Without that variable a fresh data directory stays on the database setup page, the image healthcheck can still pass, and the provisioner has no socket to talk to.

Kuma listens on `127.0.0.1:${UPTIME_KUMA_PORT:-13020}`. Open it with an SSH tunnel:

```bash
ssh -L 13020:127.0.0.1:13020 kodama-ai
```

Then browse `http://127.0.0.1:13020`.

## What is checked

- `GET /api/health` on each web container over the `kodama` network. Capital and sentinel also keep `/api/v1/health` (no database). Kodamalabs has no database, so its health route reports `db: "skipped"`.
- Public `https://capital.kodamalabs.ai/login`, `https://careers.kodamalabs.ai/` and `https://attentio.dev/` with redirects **not** followed and statuses 200–399 accepted. Cloudflare Access answers 302; an origin failure shows up as 5xx or 530.
- `EXTRA_PUBLIC_HOSTS` (comma-separated) for hostnames that are not on our DNS yet, such as `https://sentinel.kodamalabs.ai/` and `https://kodamalabs.ai/`.
- `SELECT 1` against `capital`, `sentinel`, `attention` and `careers` on `postgres:5432`.
- Docker "must be running" for the long-running compose services, via a GET-only socket proxy. One-shot `*-migrate` containers are not in that list.
- A push monitor per cron in `infrastructure/cronjobs/schedules`. The runner pushes `status=up` after a success. A failure is a missed heartbeat. `maxretries` defaults to 1, so the first miss stays pending and the second consecutive miss is Down. Override a job in `CRON_PUSH_OVERRIDES` in `src/spec.ts`.
- Host disk, from a systemd user timer, at `DISK_ALERT_PERCENT` (default 85). A single reading over the threshold pushes `status=down` (`maxretries` 0). A dead timer is Down after 15 minutes.
- Ollama and Whisper only when `OLLAMA_HEALTH_URL` / `WHISPER_HEALTH_URL` are set.

Redis and Qdrant are not monitored. They are not used by these apps.

The log watcher tails `kodama-prod` containers through the same proxy, ignoring the known `reminderDispatch` unique-constraint log line, and POSTs at most one alert per error signature per 30 minutes.

If `ALERT_WEBHOOK_URL` is empty, monitors still run and nothing is sent. The watcher stays up and idles.

## Webhook

`ALERT_WEBHOOK_HEADER` is the header name (default `Authorization`). `ALERT_WEBHOOK_HEADER_VALUE` is sent verbatim. `ALERT_WEBHOOK_KEY` is used only when the value is empty, as `Bearer <key>`.

Kuma's body is a Liquid template. String fields go through the `json` filter so quotes and newlines cannot break the JSON. The template never interpolates `monitorJSON` as a whole (that object holds the Postgres URL).

## Add a monitor

Edit `src/spec.ts` and recreate the provisioner (`compose up -d uptime-kuma-provision`). Names starting with `kodama/` are owned by the provisioner: a monitor with that prefix that is not in the spec is deleted on the next run. A one-off created in the UI must use another prefix. The webhook notification is the default, so UI monitors still notify.

## Maintenance window

Run this on the server, from the main checkout. Credentials come from the service `env_file`, not the command line. There is no local pnpm or Node step.

```bash
docker --context desktop-linux compose -p kodama-prod run --rm uptime-kuma-provision node dist/maintenance.js start 30
# build / up -d
docker --context desktop-linux compose -p kodama-prod run --rm uptime-kuma-provision node dist/maintenance.js clear
```

`start 30` is a 30 minute window over every `kodama/` monitor. HTTP checks also wait through two retries (about three minutes) before they notify, so a short bounce does not need a window.

## Test an alert

After provision has exited 0, push Down and then Up. The token is `sha256(KUMA_PUSH_TOKEN_SECRET + ":kodama/host-disk")` (no newline):

```bash
SECRET=$(awk -F= '$1=="KUMA_PUSH_TOKEN_SECRET"{print substr($0,index($0,"=")+1)}' infrastructure/monitoring/.env.production)
TOKEN=$(printf '%s' "${SECRET}:kodama/host-disk" | sha256sum | awk '{print $1}')
curl -fsS "http://127.0.0.1:13020/api/push/${TOKEN}?status=down&msg=test"
curl -fsS "http://127.0.0.1:13020/api/push/${TOKEN}?status=up&msg=test"
```

`{"ok":true}` means Kuma accepted the token. A 404 means the server stored a different token; the provisioner writes that token to `/home/kodama/.local/share/kodama-monitoring/push-tokens.json` and cron/disk read it.

## Disk timer and linger

User timers do not run unless lingering is on. `infrastructure/systemd/README.md` already depends on linger for `kodama-labs.service`.

```bash
loginctl show-user kodama -p Linger
# Linger=yes is required. If not:
sudo loginctl enable-linger kodama

cp infrastructure/systemd/kodama-disk-heartbeat.service infrastructure/systemd/kodama-disk-heartbeat.timer \
  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kodama-disk-heartbeat.timer
```

## What was checked against the real images

`louislam/uptime-kuma:2.5.3-slim` with `UPTIME_KUMA_DB_TYPE=sqlite`:

- The socket client has to start on polling. A websocket-only connection is answered with the SPA HTML.
- `needSetup` is a boolean. `setup(username, password)` does not log in; `login({ username, password })` does.
- `monitorList`, `notificationList`, `dockerHostList` and `maintenanceList` are emitted during login. There is no ack for `getNotificationList` or `getDockerHostList`. `getMonitorList` and `getMaintenanceList` do ack.
- `add` stores a client-supplied `pushToken`. `getMonitor` returns the same value. `GET /api/push/<token>?status=up` returns `{"ok":true}`. A wrong token is 404.
- The process runs as root (`id` inside the container). The image healthcheck can pass while the database setup page is still up, which is why the sqlite env var is set in compose.

`tecnativa/docker-socket-proxy:v0.4.2` (Docker Hub has no `0.4.2` tag) with `POST=0`: `GET /containers/json` lists containers, `POST /containers/create` is 403, and `GET /containers/<id>/logs?follow=1` streams log frames within a few seconds. That was against a stock Docker engine, not Docker Desktop.

The provisioner still reads the push token back and, on a mismatch, writes `push-tokens.json`.

The Desktop socket is a different engine. Confirm it on the server:

1. **Socket mount.** The proxy bind-mounts `/home/kodama/.docker/desktop/docker.sock`. `/var/run/docker.sock` on that host is the other engine. If the mount fails, provision logs `docker host check failed` and skips Docker monitors (HTTP and push monitors are still saved) and exits 1.
2. **Log follow on that socket.** From a container on the `kodama` network:

```bash
docker --context desktop-linux run --rm --network kodama curlimages/curl:8.11.1 \
  -m 10 "http://docker-socket-proxy:2375/containers/json?limit=1"
```

A JSON array means the proxy can list. Then follow one running container for 10 seconds (`/containers/<id>/logs?follow=1&stdout=1&stderr=1&tail=1`). If that returns no bytes while `docker logs` on the host shows lines, HAProxy is buffering the stream. Fallback, still on the Desktop socket:

- Mount `/home/kodama/.docker/desktop/docker.sock` read-only at `/var/run/docker.sock` on `log-watcher` and point `DOCKER_HOST=unix:///var/run/docker.sock`.
- Set the provisioner's `DOCKER_TYPE=socket` and `DOCKER_DAEMON=/var/run/docker.sock`, and give `uptime-kuma` the same socket mount.
- A `:ro` mount does not make the Docker API read-only. The proxy is what blocks mutating calls. The direct-socket fallback relies on our client only calling list, inspect and logs.

## Rollout

On the main checkout, context `desktop-linux`:

1. `mkdir -p /home/kodama/.local/share/uptime-kuma /home/kodama/.local/share/kodama-monitoring`
2. `docker exec` into `uptime-kuma` and run `id`. `louislam/uptime-kuma:2.5.3-slim` has no `USER` (the process is root on a stock run). `chown` the data directory to that uid if it is not already, and keep it mode `0700`.
3. Write `infrastructure/monitoring/.env.production` from `.env.example`. Copy `KUMA_PUSH_TOKEN_SECRET` into `infrastructure/cronjobs/.env.production`. Leave the webhook empty for a silent first boot.
4. `loginctl show-user kodama -p Linger` must be `yes` before enabling the disk timer.
5. `docker --context desktop-linux compose config` then `compose up -d docker-socket-proxy uptime-kuma uptime-kuma-provision log-watcher`.
6. Confirm the socket and, if you want log alerts, the follow check above.
7. `uptime-kuma-provision` should exit 0. Exit 1 with a docker host error means step 6 failed; HTTP monitors may already be saved.
8. Open a maintenance window, rebuild the app images so `/api/health` exists, then `compose up -d` and clear the window.
9. Install the disk timer. Curl the push URL Down and Up and confirm the webhook body.
10. Do not add Kuma to `infrastructure/cloudflared/config.yml`.
