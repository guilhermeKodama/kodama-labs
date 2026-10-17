#!/usr/bin/env bash
# One-time (and repeatable) install for the kodama user. Does not enable the
# timer unless --enable is passed, so a dry-run and a supervised deploy can
# happen first. Does not use sudo. If linger is off, it prints the one command
# a human has to run and stops.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

ENABLE=0
for arg in "$@"; do
  case "$arg" in
    --enable) ENABLE=1 ;;
    -h | --help)
      echo "usage: install.sh [--enable]"
      exit 0
      ;;
    *) die "unknown argument: $arg" ;;
  esac
done

if [[ "$(id -u)" -eq 0 ]]; then
  die "run this as the kodama user, not root"
fi

REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
EXPECTED="${HOME}/Documents/Github/kodama-labs"
expected_real=""
if [[ -d "$EXPECTED" ]]; then
  expected_real="$(cd "$EXPECTED" && pwd -P)"
fi
repo_real="$(cd "$REPO" && pwd -P)"
if [[ "$repo_real" != "$expected_real" ]]; then
  if [[ "${KODAMA_ALLOW_OTHER_REPO:-}" != 1 ]]; then
    echo "Refusing to install from ${repo_real}." >&2
    echo "On kodama-ai the checkout has to be ${EXPECTED}." >&2
    exit 1
  fi
  echo "warning: installing from ${repo_real}, not ${EXPECTED}" >&2
fi

linger="$(loginctl show-user "$USER" -p Linger 2>/dev/null || true)"
if [[ "$linger" != *yes* ]]; then
  echo "Linger is off for ${USER}. User timers stop at logout until a human runs:" >&2
  echo "  sudo loginctl enable-linger ${USER}" >&2
  exit 1
fi

docker context inspect desktop-linux >/dev/null
docker context inspect default >/dev/null
docker --context desktop-linux info >/dev/null
command -v python3 >/dev/null
command -v git >/dev/null
command -v curl >/dev/null

mkdir -p \
  "$KODAMA_DEPLOYS_DIR" \
  "$KODAMA_BACKUPS_DIR" \
  "${HOME}/.local/lib/kodama-deploy" \
  "${HOME}/.config/kodama-deploy" \
  "${HOME}/.config/systemd/user"

if [[ ! -f "$KODAMA_DEPLOY_ENV" ]]; then
  cat >"$KODAMA_DEPLOY_ENV" <<'EOF'
# Optional. Empty values are skipped.
# DEPLOY_WEBHOOK_URL=https://example.invalid/hooks/deploy
# DEPLOY_WEBHOOK_HEADER=Authorization: Bearer replace-me
# GITHUB_TOKEN=
EOF
  chmod 600 "$KODAMA_DEPLOY_ENV"
fi

install -m 755 "${SCRIPT_DIR}/poll.sh" "${HOME}/.local/lib/kodama-deploy/poll.sh"
install -m 644 "${SCRIPT_DIR}/lib.sh" "${HOME}/.local/lib/kodama-deploy/lib.sh"
install -m 644 "${SCRIPT_DIR}/apps.conf" "${HOME}/.local/lib/kodama-deploy/apps.conf"
install -m 755 "${SCRIPT_DIR}/status.py" "${HOME}/.local/lib/kodama-deploy/status.py"
install -m 644 "${SCRIPT_DIR}/kodama-deploy.service" "${HOME}/.config/systemd/user/kodama-deploy.service"
install -m 644 "${SCRIPT_DIR}/kodama-deploy.timer" "${HOME}/.config/systemd/user/kodama-deploy.timer"

systemctl --user daemon-reload

if [[ ! -f "$KODAMA_STATUS" ]]; then
  sha="$(git -C "$REPO" rev-parse HEAD)"
  status_py init "$sha"
  echo "seeded ${KODAMA_STATUS} with ${sha} as already deployed"
else
  echo "left existing ${KODAMA_STATUS} in place"
fi

if [[ "$ENABLE" == 1 ]]; then
  systemctl --user enable --now kodama-deploy.timer
  echo "timer enabled"
else
  echo "timer not enabled"
  echo "next: deploy.sh --dry-run, then a supervised deploy.sh, then install.sh --enable"
fi
