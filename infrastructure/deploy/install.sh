#!/usr/bin/env bash
# Install the deploy key's forced command for the kodama user.
# Does not use sudo, does not generate a private key, and does not start a timer.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

SEED_SHA=""
AUTHORIZE_KEY=""

usage() {
  cat <<'EOF'
usage: install.sh [--seed-sha <commit>] [--authorize-key <public-key-file>]

Does not generate a key. On your own machine:

  ssh-keygen -t ed25519 -f deploy_key -N ''

Then on kodama-ai, from ~/Documents/Github/kodama-labs:

  infrastructure/deploy/install.sh \
    --authorize-key deploy_key.pub \
    --seed-sha c0e48d2212d5259c466edaea3bf8ea291114b585

--seed-sha is the commit production is actually running. It is required
when ~/deploys/status.json does not exist yet, and it must be reachable
from origin/main. A later run leaves an existing status file alone.

--authorize-key reads an ssh-ed25519 public key. Before editing, the
current ~/.ssh/authorized_keys is copied to authorized_keys.bak.<stamp>.
Only the line marked kodama-ci-deploy is replaced.

KODAMA_AI_KNOWN_HOSTS is not produced here. From a machine on the tailnet:

  ssh-keyscan -t ed25519 100.109.102.38

On kodama-ai, the fingerprint must match the server's own host key:

  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
  ssh-keygen -lf <(ssh-keyscan -t ed25519 100.109.102.38)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed-sha)
      shift
      SEED_SHA="${1:-}"
      [[ -n "$SEED_SHA" ]] || die "--seed-sha needs the commit production is running"
      ;;
    --authorize-key)
      shift
      AUTHORIZE_KEY="${1:-}"
      [[ -n "$AUTHORIZE_KEY" ]] || die "--authorize-key needs a public key file"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
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

if [[ "${KODAMA_INSTALL_SKIP_DOCKER:-}" != 1 ]]; then
  docker context inspect desktop-linux >/dev/null
  docker context inspect default >/dev/null
  docker --context desktop-linux info >/dev/null
fi
command -v python3 >/dev/null
command -v git >/dev/null
command -v curl >/dev/null

lib_dir="${HOME}/.local/lib/kodama-deploy"
mkdir -p \
  "$KODAMA_DEPLOYS_DIR" \
  "$KODAMA_BACKUPS_DIR" \
  "$lib_dir" \
  "${HOME}/.config/kodama-deploy" \
  "${HOME}/.ssh"

if [[ ! -f "$KODAMA_DEPLOY_ENV" ]]; then
  cat >"$KODAMA_DEPLOY_ENV" <<'EOF'
# Optional failure webhook. Leave unset to skip. Values are never logged.
# DEPLOY_WEBHOOK_URL=https://example.invalid/hooks/deploy
# DEPLOY_WEBHOOK_HEADER=Authorization: Bearer replace-me
EOF
  chmod 600 "$KODAMA_DEPLOY_ENV"
fi

install -m 755 "${SCRIPT_DIR}/ssh-entry.sh" "${lib_dir}/ssh-entry.sh"
install -m 755 "${SCRIPT_DIR}/deploy.sh" "${lib_dir}/deploy.sh"
install -m 755 "${SCRIPT_DIR}/rollback.sh" "${lib_dir}/rollback.sh"
install -m 755 "${SCRIPT_DIR}/status.py" "${lib_dir}/status.py"
install -m 644 "${SCRIPT_DIR}/lib.sh" "${lib_dir}/lib.sh"
install -m 644 "${SCRIPT_DIR}/apps.conf" "${lib_dir}/apps.conf"

if [[ ! -f "$KODAMA_STATUS" ]]; then
  if [[ -z "$SEED_SHA" ]]; then
    die "--seed-sha is required when ${KODAMA_STATUS} does not exist"
  fi
  git -C "$REPO" fetch --prune origin main
  sha="$(git -C "$REPO" rev-parse --verify "${SEED_SHA}^{commit}")"
  git -C "$REPO" merge-base --is-ancestor "$sha" origin/main \
    || die "seed sha ${sha} is not an ancestor of origin/main"
  status_py init "$sha"
  echo "seeded ${KODAMA_STATUS} with ${sha} as already deployed"
else
  echo "left existing ${KODAMA_STATUS} in place"
  if [[ -n "$SEED_SHA" ]]; then
    echo "WARNING: --seed-sha was ignored because ${KODAMA_STATUS} already exists." >&2
  fi
fi

if [[ -n "$AUTHORIZE_KEY" ]]; then
  [[ -f "$AUTHORIZE_KEY" ]] || die "public key file not found: ${AUTHORIZE_KEY}"
  key_line="$(awk 'NF && $1 !~ /^#/ { print; exit }' "$AUTHORIZE_KEY")"
  if [[ ! "$key_line" =~ ^ssh-ed25519[[:space:]]+[A-Za-z0-9+/]+={0,2}([[:space:]]+.*)?$ ]]; then
    die "--authorize-key must be a single ssh-ed25519 public key"
  fi
  key_type="${key_line%% *}"
  key_rest="${key_line#* }"
  key_data="${key_rest%% *}"
  auth="${HOME}/.ssh/authorized_keys"
  entry="restrict,command=\"${lib_dir}/ssh-entry.sh\" ${key_type} ${key_data} kodama-ci-deploy"
  chmod 700 "${HOME}/.ssh"
  if [[ -f "$auth" ]]; then
    backup="${auth}.bak.$(stamp_utc)"
    if [[ -e "$backup" ]]; then
      backup="${backup}.$$"
    fi
    cp -p "$auth" "$backup"
    echo "backed up ${auth} to ${backup}"
  fi
  tmp="${auth}.tmp"
  if [[ -f "$auth" ]]; then
    awk '!/kodama-ci-deploy/' "$auth" >"$tmp"
  else
    : >"$tmp"
  fi
  printf '%s\n' "$entry" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$auth"
  chmod 600 "$auth"
  echo "authorized_keys updated for kodama-ci-deploy"
else
  echo "authorized_keys not changed (no --authorize-key)"
fi

echo "installed ${lib_dir}"
echo "deploys do not copy these scripts. Re-run install.sh when infrastructure/deploy changes."
