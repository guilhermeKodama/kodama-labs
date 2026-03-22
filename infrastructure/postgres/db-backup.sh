#!/usr/bin/env bash
#
# Dump and restore local PostgreSQL databases (capital + sentinel).
#
# Usage:
#   pnpm db:dump              # creates timestamped dump in ./backups/
#   pnpm db:dump my-backup    # creates ./backups/my-backup.sql.gz
#   pnpm db:restore           # restores latest dump
#   pnpm db:restore my-backup # restores ./backups/my-backup.sql.gz
#
set -euo pipefail

CONTAINER="postgres"
PG_USER="root"
DATABASES=("capital" "sentinel")
BACKUP_DIR="$(cd "$(dirname "$0")" && pwd)/backups"

action="${1:-}"
label="${2:-}"

usage() {
  echo "Usage:"
  echo "  $0 dump  [label]   Dump all databases to ./backups/"
  echo "  $0 restore [label] Restore databases from a dump"
  echo "  $0 list             List available backups"
  exit 1
}

ensure_container() {
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    echo "Error: Docker container '${CONTAINER}' is not running."
    echo "Start it with: cd infrastructure/postgres && docker compose up -d"
    exit 1
  fi
}

cmd_dump() {
  ensure_container
  mkdir -p "$BACKUP_DIR"

  local tag="${label:-$(date +%Y%m%d_%H%M%S)}"

  for db in "${DATABASES[@]}"; do
    local file="${BACKUP_DIR}/${tag}_${db}.sql.gz"
    echo "Dumping ${db} → ${file} ..."
    docker exec "$CONTAINER" pg_dump -U "$PG_USER" -d "$db" --no-owner --no-acl \
      | gzip > "$file"
    local size
    size=$(du -h "$file" | cut -f1)
    echo "  Done (${size})"
  done

  echo ""
  echo "Backup complete: ${tag}"
  echo "Files saved in: ${BACKUP_DIR}/"
}

cmd_restore() {
  ensure_container

  local tag="$label"

  if [[ -z "$tag" ]]; then
    local latest
    latest=$(ls -1 "$BACKUP_DIR"/*_capital.sql.gz 2>/dev/null | sort | tail -1 || true)
    if [[ -z "$latest" ]]; then
      echo "Error: No backups found in ${BACKUP_DIR}/"
      exit 1
    fi
    tag=$(basename "$latest" | sed 's/_capital\.sql\.gz$//')
    echo "No label specified, using latest: ${tag}"
  fi

  for db in "${DATABASES[@]}"; do
    local file="${BACKUP_DIR}/${tag}_${db}.sql.gz"
    if [[ ! -f "$file" ]]; then
      echo "Warning: ${file} not found, skipping ${db}"
      continue
    fi

    echo "Restoring ${db} from ${file} ..."

    docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid();" \
      > /dev/null 2>&1 || true

    docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS ${db};" > /dev/null
    docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -c "CREATE DATABASE ${db};" > /dev/null

    gunzip -c "$file" | docker exec -i "$CONTAINER" psql -U "$PG_USER" -d "$db" --quiet > /dev/null 2>&1
    echo "  Done"
  done

  echo ""
  echo "Restore complete from: ${tag}"
  echo ""
  echo "You may need to restart your dev servers and regenerate Prisma clients:"
  echo "  cd apps/sentinel && npx prisma generate"
  echo "  cd apps/capital && npx prisma generate"
}

cmd_list() {
  if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
    echo "No backups found in ${BACKUP_DIR}/"
    exit 0
  fi

  echo "Available backups in ${BACKUP_DIR}/:"
  echo ""

  local prev_tag=""
  for f in $(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | sort); do
    local base
    base=$(basename "$f")
    local tag
    tag=$(echo "$base" | sed -E 's/_(capital|sentinel)\.sql\.gz$//')
    local db
    db=$(echo "$base" | sed -E 's/^.*_(capital|sentinel)\.sql\.gz$/\1/')
    local size
    size=$(du -h "$f" | cut -f1)

    if [[ "$tag" != "$prev_tag" ]]; then
      [[ -n "$prev_tag" ]] && echo ""
      echo "  ${tag}"
      prev_tag="$tag"
    fi
    echo "    ${db}: ${size}"
  done
  echo ""
}

case "$action" in
  dump)    cmd_dump ;;
  restore) cmd_restore ;;
  list)    cmd_list ;;
  *)       usage ;;
esac
