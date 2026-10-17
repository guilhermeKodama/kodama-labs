#!/usr/bin/env bash
# Run unit tests for packages changed since the base SHA. Capital's
# portfolio-fx repair test rewrites rows across the database, so it runs
# alone against capital_fx_test after the rest of the suite.
set -euo pipefail

base="${1:-}"
cd "$(git rev-parse --show-toplevel)"

export PGPASSWORD="${PGPASSWORD:-root}"
psql_exec() {
  psql -h 127.0.0.1 -U root -d postgres -v ON_ERROR_STOP=1 "$@"
}

for db in capital_test capital_fx_test sentinel_test; do
  exists="$(psql_exec -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" || true)"
  if [[ "$exists" != *1* ]]; then
    psql_exec -c "CREATE DATABASE ${db}"
  fi
done

filter=()
if [[ -n "$base" ]]; then
  filter=(--filter="...[${base}]")
fi

json="$(pnpm turbo run test --dry-run=json "${filter[@]}")"
mapfile -t pkgs < <(python3 -c '
import json, sys
data = json.load(sys.stdin)
names = set()
for task in data.get("tasks") or []:
    task_name = task.get("task") or ""
    task_id = str(task.get("taskId") or "")
    if task_name == "test" or task_id.endswith("#test"):
        package = task.get("package") or task_id.split("#", 1)[0]
        if package:
            names.add(package)
print("\n".join(sorted(names)))
' <<<"$json")

echo "affected test packages: ${pkgs[*]:-none}"

want() {
  local needle="$1" item
  for item in "${pkgs[@]}"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

others=()
for pkg in @repo/storage @infrastructure/cronjobs @infrastructure/monitoring @wallex/sentinel; do
  if want "$pkg"; then
    others+=("$pkg")
  fi
done

if [[ ${#others[@]} -gt 0 ]]; then
  turbo_filters=()
  for pkg in "${others[@]}"; do
    turbo_filters+=(--filter="$pkg")
  done
  if want "@wallex/sentinel"; then
    DATABASE_URL="postgresql://root:root@127.0.0.1:5432/sentinel_test" \
      DIRECT_URL="postgresql://root:root@127.0.0.1:5432/sentinel_test" \
      pnpm turbo run test "${turbo_filters[@]}"
  else
    pnpm turbo run test "${turbo_filters[@]}"
  fi
fi

if want "@wallex/capital"; then
  DATABASE_URL="postgresql://root:root@127.0.0.1:5432/capital_test" \
    DIRECT_URL="postgresql://root:root@127.0.0.1:5432/capital_test" \
    pnpm --filter @wallex/capital exec prisma migrate deploy
  DATABASE_URL="postgresql://root:root@127.0.0.1:5432/capital_test" \
    DIRECT_URL="postgresql://root:root@127.0.0.1:5432/capital_test" \
    pnpm --filter @wallex/capital exec vitest run
  DATABASE_URL="postgresql://root:root@127.0.0.1:5432/capital_fx_test" \
    DIRECT_URL="postgresql://root:root@127.0.0.1:5432/capital_fx_test" \
    pnpm --filter @wallex/capital exec prisma migrate deploy
  DATABASE_URL="postgresql://root:root@127.0.0.1:5432/capital_fx_test" \
    DIRECT_URL="postgresql://root:root@127.0.0.1:5432/capital_fx_test" \
    pnpm --filter @wallex/capital exec vitest run --config vitest.fx.config.ts
fi
