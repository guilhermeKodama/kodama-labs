#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy key.
# sshd runs the installed copy in ~/.local/lib/kodama-deploy, not this checkout.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

reject() {
  echo "rejected" >&2
  exit 2
}

require_public_origin() {
  local url
  url="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  if [[ "$url" == https://*@* ]]; then
    echo "origin URL embeds credentials; use the public GitHub URL" >&2
    exit 1
  fi
}

main() {
  local cmd="${SSH_ORIGINAL_COMMAND:-}"
  local repo="${KODAMA_REPO:-${HOME}/Documents/Github/kodama-labs}"
  if [[ "$cmd" == *$'\n'* || "$cmd" == *$'\r'* ]]; then
    reject
  fi
  if [[ "$cmd" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
    local sha="${BASH_REMATCH[1]}"
    require_public_origin "$repo"
    git -C "$repo" fetch --prune origin main
    if ! git -C "$repo" cat-file -e "${sha}^{commit}" 2>/dev/null; then
      echo "sha is not a commit" >&2
      exit 1
    fi
    if ! git -C "$repo" merge-base --is-ancestor "$sha" origin/main; then
      echo "sha ${sha} is not reachable from origin/main" >&2
      exit 1
    fi
    export KODAMA_REPO="$repo"
    exec bash "${SCRIPT_DIR}/deploy.sh" --from-ssh --sha "$sha"
  fi
  if [[ "$cmd" =~ ^rollback\ (monitoring|kodamalabs|careers|attention|sentinel|capital)$ ]]; then
    export KODAMA_REPO="$repo"
    exec bash "${SCRIPT_DIR}/rollback.sh" "${BASH_REMATCH[1]}"
  fi
  if [[ "$cmd" == "status" ]]; then
    if [[ ! -f "$KODAMA_STATUS" ]]; then
      echo "missing ${KODAMA_STATUS}" >&2
      exit 1
    fi
    cat "$KODAMA_STATUS"
    exit 0
  fi
  reject
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi
