#!/usr/bin/env bash
# Put a previous image back, or restore a database dump on purpose.
# Image rollback does not migrate backwards and does not touch the database.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO"
export REPO
load_deploy_env

usage() {
  cat <<'EOF'
Usage:
  rollback.sh <unit>
  rollback.sh --restore-db <database> <dump>

Units: monitoring kodamalabs careers attention sentinel capital
--restore-db refuses unless CONFIRM_DB_RESTORE equals the database name.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -eq 0 ]]; then
  usage
  exit 0
fi

mkdir -p "$KODAMA_DEPLOYS_DIR"
exec 9>"${KODAMA_DEPLOYS_DIR}/deploy.lock"
if ! flock -n 9; then
  die "another deploy holds the lock"
fi

if [[ "$1" == "--restore-db" ]]; then
  db="${2:-}"
  dump="${3:-}"
  [[ -n "$db" && -n "$dump" ]] || die "usage: rollback.sh --restore-db <database> <dump>"
  case "$db" in
    capital | sentinel | attention | careers) ;;
    *) die "database must be capital, sentinel, attention, or careers" ;;
  esac
  [[ -f "$dump" ]] || die "dump not found: ${dump}"
  if [[ "${CONFIRM_DB_RESTORE:-}" != "$db" ]]; then
    die "refusing to restore ${db}. Re-run with CONFIRM_DB_RESTORE=${db}"
  fi
  echo "restoring ${dump} into ${db}"
  runtime_docker exec -i postgres pg_restore -U root -d "$db" --clean --if-exists <"$dump"
  echo "restore finished. Image rollback is separate; the running code was not changed."
  exit 0
fi

unit="$1"
[[ -n "${UNIT_IMAGE[$unit]:-}" ]] || die "unknown unit ${unit}"
[[ "${UNIT_KIND[$unit]}" == "image" ]] || die "${unit} has no image to roll back"
image="${UNIT_IMAGE[$unit]}"
if ! runtime_docker image inspect "${image}:rollback" >/dev/null 2>&1; then
  die "missing ${image}:rollback. Tags the deployer created look like ${image}:rollback-<40 hex chars>."
fi
runtime_docker tag "${image}:rollback" "${image}:latest"
read -r -a services <<<"${UNIT_SERVICES[$unit]}"
if [[ -n "${UNIT_ALSO_RECREATE[$unit]:-}" ]]; then
  services+=("${UNIT_ALSO_RECREATE[$unit]}")
fi
compose up -d --no-deps --no-build --force-recreate "${services[@]}"
echo "rolled ${unit} back to ${image}:rollback"
echo "The database was not restored. Status and PAUSED were left as they are."
echo "Remove ~/deploys/PAUSED from a local shell when deploys should resume."
