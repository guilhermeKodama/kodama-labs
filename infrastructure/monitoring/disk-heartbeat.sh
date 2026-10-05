#!/bin/sh
# Host disk check. Runs on the Ubuntu host (systemd user timer), not inside
# the Docker Desktop VM, so df sees the filesystem that actually fills up.
# Push token bytes match infrastructure/monitoring/src/push-token.ts:
# sha256(secret + ":" + "kodama/host-disk") with no trailing newline.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
ENV_FILE=${KUMA_ENV_FILE:-$ROOT/infrastructure/monitoring/.env.production}
TOKEN_FILE=${KUMA_PUSH_TOKEN_FILE:-/home/kodama/.local/share/kodama-monitoring/push-tokens.json}

env_value() {
  key=$1
  [ -f "$ENV_FILE" ] || return 0
  val=$(awk -F= -v k="$key" '$1 == k { v = substr($0, index($0, "=") + 1) } END { print v }' "$ENV_FILE")
  val=${val#\"}
  val=${val%\"}
  val=${val#\'}
  val=${val%\'}
  printf '%s' "$val"
}

secret=$(env_value KUMA_PUSH_TOKEN_SECRET)
if [ -z "$secret" ]; then
  echo "[disk] KUMA_PUSH_TOKEN_SECRET unset; skipping" >&2
  exit 0
fi

port=$(env_value UPTIME_KUMA_PORT)
[ -n "$port" ] || port=13020
threshold=$(env_value DISK_ALERT_PERCENT)
[ -n "$threshold" ] || threshold=85

name=kodama/host-disk
token=$(printf '%s' "${secret}:${name}" | sha256sum | awk '{print $1}')
if [ -f "$TOKEN_FILE" ]; then
  override=$(node -e 'const fs=require("fs"); try { const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const v=j[process.argv[2]]; if (typeof v==="string") process.stdout.write(v); } catch {}' "$TOKEN_FILE" "$name")
  [ -n "$override" ] && token=$override
fi

status=up
detail=""
seen=" "
for target in / /home; do
  [ -d "$target" ] || continue
  line=$(df -P "$target" | awk 'NR==2 { print $6, $5 }')
  mount=${line%% *}
  use=${line##* }
  use=${use%%%}
  case "$seen" in
    *" $mount "*) continue ;;
  esac
  seen="$seen$mount "
  detail="${detail}${mount}=${use}% "
  if [ "$use" -ge "$threshold" ]; then
    status=down
  fi
done

enc=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "disk ${detail}")
curl -fsS --max-time 15 -o /dev/null \
  "http://127.0.0.1:${port}/api/push/${token}?status=${status}&msg=${enc}&ping="
