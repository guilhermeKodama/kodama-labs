#!/usr/bin/env bash
# Timer entrypoint. This file is copied to ~/.local/lib/kodama-deploy and that
# copy is what systemd runs. A successful deploy replaces the copy afterwards;
# a failed deploy cannot install a new poller.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${HERE}/lib.sh"

REPO="${KODAMA_REPO:-${HOME}/Documents/Github/kodama-labs}"
cd "$REPO"
export KODAMA_REPO="$REPO"

load_deploy_env
mkdir -p "$KODAMA_DEPLOYS_DIR"

exec 9>"${KODAMA_DEPLOYS_DIR}/deploy.lock"
if ! flock -n 9; then
  echo "deploy already running"
  exit 0
fi
export KODAMA_LOCK_HELD=1

if is_paused; then
  echo "paused: $(head -n 1 "$KODAMA_PAUSE_FILE")"
  exit 0
fi

if ! runtime_docker info >/dev/null 2>&1; then
  echo "Docker Desktop engine is not ready"
  exit 0
fi

git fetch --prune origin main
TARGET="$(git rev-parse --verify 'origin/main^{commit}')"
if sha_is_blocked "$TARGET"; then
  echo "not retrying blocked sha ${TARGET}"
  exit 0
fi

# Run the deploy.sh that belongs to origin/main, from a snapshot, so a merge
# cannot rewrite the script bash is executing.
stage="$(mktemp -d)"
git archive "$TARGET" infrastructure/deploy | tar -x -C "$stage"
export KODAMA_REEXECED=1
set +e
bash "${stage}/infrastructure/deploy/deploy.sh" --from-poller
rc=$?
set -e
rm -rf "$stage"

if [[ "$rc" -eq 0 ]]; then
  dest="${HOME}/.local/lib/kodama-deploy"
  mkdir -p "$dest"
  changed=0
  for file in poll.sh lib.sh apps.conf status.py; do
    if [[ ! -f "${dest}/${file}" ]] || ! cmp -s "${REPO}/infrastructure/deploy/${file}" "${dest}/${file}"; then
      changed=1
    fi
  done
  if [[ "$changed" -eq 1 ]]; then
    bash -n "${REPO}/infrastructure/deploy/poll.sh"
    bash -n "${REPO}/infrastructure/deploy/lib.sh"
    if [[ -f "${dest}/poll.sh" ]]; then
      cp "${dest}/poll.sh" "${dest}/poll.sh.prev"
    fi
    cp "${REPO}/infrastructure/deploy/poll.sh" \
      "${REPO}/infrastructure/deploy/lib.sh" \
      "${REPO}/infrastructure/deploy/apps.conf" \
      "${REPO}/infrastructure/deploy/status.py" \
      "$dest/"
    chmod 755 "${dest}/poll.sh" "${dest}/status.py"
    mkdir -p "${HOME}/.config/systemd/user"
    cp "${REPO}/infrastructure/deploy/kodama-deploy.service" \
      "${REPO}/infrastructure/deploy/kodama-deploy.timer" \
      "${HOME}/.config/systemd/user/"
    systemctl --user daemon-reload || true
    echo "installed deployer updated; the next tick uses it"
  fi
fi

exit "$rc"
