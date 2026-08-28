#!/bin/bash
set -euo pipefail

export DOCKER_CONTEXT=desktop-linux

BACKUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

for db in attention careers capital sentinel wallex; do
  f="$BACKUP_DIR/$db-$TIMESTAMP.sql.gz"
  docker exec postgres pg_dump -U root "$db" | gzip > "$f"
  size=$(stat -c%s "$f")
  if [ "$size" -lt 4096 ]; then
    echo "WARNING: $db dump suspiciously small ($size bytes) — check for a failed dump" >&2
  fi
  # keep 14 days
  find "$BACKUP_DIR" -name "$db-*.sql.gz" -mtime +14 -delete
done
