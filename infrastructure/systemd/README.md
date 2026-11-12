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

User timers and this unit only keep running after logout when lingering is enabled. It already is on this host; confirm before relying on the disk timer:

```bash
loginctl show-user kodama -p Linger
# expected: Linger=yes
# if not: sudo loginctl enable-linger kodama
```

Install / update (no sudo — user units):

```bash
cp infrastructure/systemd/kodama-labs.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kodama-labs.service
systemctl --user enable docker-desktop.service
```

Check: `systemctl --user status kodama-labs` and `docker ps`.

Disk usage is a separate user timer (it has to run on the host, not in the Docker Desktop VM):

```bash
cp infrastructure/systemd/kodama-disk-heartbeat.service infrastructure/systemd/kodama-disk-heartbeat.timer \
  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kodama-disk-heartbeat.timer
```

The script and the Kuma push monitor are documented in `infrastructure/monitoring/README.md`.

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

## Claude Code Remote Control

`claude-remote-control.service` keeps Claude Code agents running on this host. The phone (Claude app, Code tab) and the Mac (claude.ai/code) only control them. Nothing runs on those devices. It needs no inbound port: the process only makes outbound HTTPS calls to Anthropic.

Each session started from the phone or the web gets its own git worktree under `.claude/worktrees/` (gitignored). No session works in the checkout itself, because deploys run from it and refuse tracked changes. At most 8 sessions run at once, in `auto` permission mode.

Set up once, as `kodama`:

```bash
claude auth login            # full claude.ai login; a setup-token is not enough
cd ~/Documents/Github/kodama-labs
claude remote-control        # answer "Enable Remote Control? y", then Ctrl+C
cp infrastructure/systemd/claude-remote-control.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now claude-remote-control.service
```

Check: `systemctl --user status claude-remote-control`. The status screen goes to `/dev/null`; errors go to the journal (`journalctl --user -u claude-remote-control`).

Caveats:

- A clean stop or restart comes back at once. After a hard crash, Anthropic still holds the old registration for a few minutes and the new process exits with "This folder is already served". `Restart=always` retries every 30 seconds, and it was back in about 3 minutes in testing.
- The process exits after about 10 minutes without network; systemd starts it again.
- Agents that run the apps or tests need the Postgres on port 5433, which only comes up after a desktop login (see the Docker Desktop caveat above).
- Update Claude Code with `claude update`, then `systemctl --user restart claude-remote-control`.
