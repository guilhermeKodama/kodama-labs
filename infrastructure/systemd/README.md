# systemd — boot convergence for the Docker stack

The stack runs on **Docker Desktop's per-user engine** (context
`desktop-linux`, socket `~/.docker/desktop/docker.sock`) — NOT the system
`docker.service` (that rootful engine only hosts unrelated containers like
`whisper-rocm`, and has stale `postgres`/`qdrant`/`redis` leftovers; never
point this stack at it without a deliberate data migration).

`kodama-labs.service` is a systemd **user** unit that converges the stack
whenever the engine comes up: waits for the Docker Desktop socket (retrying
on failure), creates the external `kodama` network if missing, then
`docker compose up -d` on `infrastructure/postgres/docker-compose.yml` and on
the root `docker-compose.yml` (migrate one-shots re-run — `prisma migrate
deploy` is idempotent). Combined with `restart: always` on all services, this
guarantees the stack is up regardless of prior state (manually stopped,
crashed, or removed via `compose down`).

Install / update (no sudo — user units):

```bash
cp infrastructure/systemd/kodama-labs.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kodama-labs.service
systemctl --user enable docker-desktop.service
```

Check: `systemctl --user status kodama-labs` and `docker ps`.

Caveats:

- Docker Desktop's unit has `Requires=graphical-session.target`, so the
  engine only starts on **desktop login** — a reboot brings everything back
  automatically, but only after someone logs into the GUI (linger alone is
  not enough). For true login-independent boot, the stack would have to be
  migrated to the system `docker.service` engine (postgres data lives inside
  the Docker Desktop VM — dump/restore required; daily dumps are in
  `infrastructure/postgres/backups/`).
- With `restart: always`, a service stopped by hand comes back on the next
  engine restart. To keep one down, comment it out of the compose file.
