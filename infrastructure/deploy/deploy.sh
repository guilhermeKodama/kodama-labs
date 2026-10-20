#!/usr/bin/env bash
# Deploy one SHA onto the desktop-linux stack.
# Images are built on docker context "default" and loaded into "desktop-linux".
# The default context is never used to start, stop, or remove containers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

ORIG_ARGS=("$@")
DRY_RUN=0
FORCE=0
SHA_ARG=""
PAUSE_REASON=""
MODE="deploy"
OVERALL="unknown"
FAILURE_RECORDED=0

usage() {
  cat <<'EOF'
Usage:
  deploy.sh [--dry-run] [--sha <commit>] [--force]
  deploy.sh --pause [reason]
  deploy.sh --resume

--dry-run prints dirty units and the commands. It does not fetch, merge, or
talk to docker.
--force retries a SHA that already failed and ignores ~/deploys/PAUSED. The
SHA must still be reachable from origin/main. The deploy key cannot pass
--force; a local shell on kodama-ai can.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --from-ssh) ;;
    --sha)
      shift
      SHA_ARG="${1:-}"
      [[ -n "$SHA_ARG" ]] || die "--sha needs a commit"
      ;;
    --pause)
      MODE="pause"
      if [[ "${2:-}" != "" && "${2:-}" != --* ]]; then
        shift
        PAUSE_REASON="$1"
      fi
      ;;
    --resume) MODE="resume" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

if git -C "$SCRIPT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
elif [[ -n "${KODAMA_REPO:-}" ]]; then
  REPO="$KODAMA_REPO"
elif [[ -d "${HOME}/Documents/Github/kodama-labs/.git" ]]; then
  REPO="${HOME}/Documents/Github/kodama-labs"
else
  die "KODAMA_REPO must point at the checkout when deploy.sh is staged outside it"
fi
cd "$REPO"
export REPO

restore_latest_tag() { :; }
clear_maintenance() { :; }

on_exit() {
  local rc=$?
  trap - EXIT
  if [[ "$FAILURE_RECORDED" != 1 ]]; then
    restore_latest_tag || true
  fi
  clear_maintenance || true
  echo "KODAMA_OVERALL ${OVERALL}"
  print_app_summary || true
  exit "$rc"
}
trap on_exit EXIT

# git merge below replaces files in the checkout. Re-exec from a copy so bash
# is not reading deploy.sh while git rewrites it.
if [[ "$DRY_RUN" != 1 && "$MODE" == "deploy" && -z "${KODAMA_REEXECED:-}" ]]; then
  stage="$(mktemp -d)"
  cp -a "${SCRIPT_DIR}/." "$stage/"
  export KODAMA_REEXECED=1
  export KODAMA_REPO="$REPO"
  exec bash "${stage}/deploy.sh" "${ORIG_ARGS[@]}"
fi

load_deploy_env
mkdir -p "$KODAMA_DEPLOYS_DIR" "$KODAMA_BACKUPS_DIR"

if [[ "$MODE" == "pause" ]]; then
  printf 'manual: %s\n' "${PAUSE_REASON:-paused}" >"$KODAMA_PAUSE_FILE"
  echo "paused: $KODAMA_PAUSE_FILE"
  OVERALL="paused"
  exit 0
fi
if [[ "$MODE" == "resume" ]]; then
  rm -f "$KODAMA_PAUSE_FILE"
  echo "resumed"
  OVERALL="resumed"
  exit 0
fi

if [[ "$DRY_RUN" != 1 && "${KODAMA_LOCK_HELD:-0}" != 1 ]]; then
  exec 9>"${KODAMA_DEPLOYS_DIR}/deploy.lock"
  if ! flock -n 9; then
    die "another deploy holds ${KODAMA_DEPLOYS_DIR}/deploy.lock"
  fi
fi

if [[ ! -f "$KODAMA_STATUS" ]]; then
  die "missing ${KODAMA_STATUS}; run install.sh before the first deploy"
fi

if [[ -n "$SHA_ARG" ]]; then
  TARGET="$(git rev-parse --verify "${SHA_ARG}^{commit}")"
elif [[ "$DRY_RUN" == 1 ]]; then
  TARGET="$(git rev-parse --verify "${KODAMA_DRY_RUN_REF:-origin/main}^{commit}")"
else
  git fetch --prune origin main
  TARGET="$(git rev-parse --verify "origin/main^{commit}")"
fi

if [[ "$DRY_RUN" != 1 ]]; then
  git fetch --prune origin main
  git rev-parse --verify "origin/main^{commit}" >/dev/null
  if ! git merge-base --is-ancestor "$TARGET" origin/main; then
    echo "sha ${TARGET} is not reachable from origin/main" >&2
    OVERALL="rejected"
    exit 1
  fi
fi

declare -A PLAN_BUILD=()
declare -A PLAN_RECREATE=()
declare -A PLAN_SERVICE=()
WARN_POSTGRES=0
RECREATE_OUTSIDE=0

collect_plan() {
  local unit from line
  for unit in "${unit_order[@]}"; do
    from="$(status_py get "apps.${unit}.sha")"
    [[ -n "$from" ]] || die "status has no sha for ${unit}; run install.sh"
    if [[ "$from" == "$TARGET" ]]; then
      continue
    fi
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      case "$line" in
        "build ${unit}") PLAN_BUILD["$unit"]=1 ;;
        "recreate ${unit}") PLAN_RECREATE["$unit"]=1 ;;
        "warn postgres") WARN_POSTGRES=1 ;;
      esac
    done < <(git diff --name-only "$from" "$TARGET" | effects_for_files)
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      case "$line" in
        "BUILD "*) PLAN_BUILD["${line#BUILD }"]=1 ;;
        "RECREATE_SERVICE "*) PLAN_SERVICE["${line#RECREATE_SERVICE }"]=1 ;;
        "RECREATE_OUTSIDE") RECREATE_OUTSIDE=1 ;;
      esac
    done < <(compose_plan_lines "$REPO" "$from" "$TARGET")
  done
  local name svc owner
  for name in "${!PLAN_BUILD[@]}"; do
    unset "PLAN_RECREATE[$name]"
  done
  if [[ -n "${PLAN_BUILD[capital]:-}" ]]; then
    unset "PLAN_RECREATE[cronjobs]"
  fi
  for svc in "${!PLAN_SERVICE[@]}"; do
    owner="$(unit_for_service "$svc")"
    if [[ "$owner" != service:* && -n "${PLAN_BUILD[$owner]:-}" ]]; then
      unset "PLAN_SERVICE[$svc]"
    fi
  done
}

collect_plan

plan_is_empty() {
  [[ ${#PLAN_BUILD[@]} -eq 0 && ${#PLAN_RECREATE[@]} -eq 0 && ${#PLAN_SERVICE[@]} -eq 0 && "$RECREATE_OUTSIDE" -eq 0 ]]
}

print_reasons() {
  local unit="$1" from file count=0 rule prefix action units
  from="$(status_py get "apps.${unit}.sha")"
  [[ -n "$from" ]] || return 0
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    for rule in "${PATH_RULES[@]}"; do
      IFS='|' read -r prefix action units <<<"$rule"
      if rule_matches "$file" "$prefix" && [[ ",${units}," == *",${unit},"* ]]; then
        echo "      ${file}"
        count=$((count + 1))
        break
      fi
    done
    if [[ "$count" -ge 20 ]]; then
      echo "      ..."
      return 0
    fi
  done < <(git diff --name-only "$from" "$TARGET")
}

compose_base() {
  echo docker --context desktop-linux compose -p "$COMPOSE_PROJECT" -f "${REPO}/docker-compose.yml" --project-directory "$REPO"
}

echo_compose() {
  printf '    %s %s\n' "$(compose_base)" "$*"
}

print_build() {
  local unit="$1" oldsha image db migrate services also dockerfile target arg svc
  oldsha="$(status_py get "apps.${unit}.sha")"
  image="${UNIT_IMAGE[$unit]}"
  db="${UNIT_DATABASE[$unit]:-}"
  migrate="${UNIT_MIGRATE[$unit]:-}"
  services="${UNIT_SERVICES[$unit]}"
  also="${UNIT_ALSO_RECREATE[$unit]:-}"
  dockerfile="${UNIT_DOCKERFILE[$unit]}"
  target="${UNIT_TARGET[$unit]:-}"
  echo "  BUILD ${unit}  (${oldsha:0:12} -> ${TARGET:0:12})"
  print_reasons "$unit"
  if [[ -n "$db" ]]; then
    echo "    docker --context desktop-linux exec postgres pg_dump -U root -d ${db} -Fc > ${KODAMA_BACKUPS_DIR}/<stamp>-${oldsha}-${db}.dump"
  fi
  echo "    docker --context desktop-linux tag ${image}:latest ${image}:rollback-${oldsha}"
  echo "    docker --context desktop-linux tag ${image}:latest ${image}:rollback"
  printf '    docker --context default build -f %q' "${REPO}/${dockerfile}"
  if [[ -n "$target" ]]; then
    printf ' --target %q' "$target"
  fi
  while IFS= read -r arg; do
    [[ -z "$arg" ]] && continue
    printf ' --build-arg %q' "$arg"
  done < <(build_arg_lines "$unit")
  printf ' -t %q %q\n' "${image}:${TARGET}" "$REPO"
  echo "    docker --context default save ${image}:${TARGET} | docker --context desktop-linux load"
  echo "    docker --context desktop-linux tag ${image}:${TARGET} ${image}:latest"
  if [[ -n "$migrate" ]]; then
    echo_compose up --no-deps --no-build --abort-on-container-exit --exit-code-from "$migrate" "$migrate"
  fi
  for svc in $services; do
    echo_compose up -d --no-deps --no-build --force-recreate "$svc"
  done
  if [[ -n "${UNIT_PORT[$unit]:-}" ]]; then
    echo "    smoke GET http://$(svc_host_for "$unit"):${UNIT_PORT[$unit]}/api/health expects db=${UNIT_SMOKE_DB[$unit]}"
  fi
  if [[ "$unit" == "capital" ]]; then
    echo "    smoke GET https://capital.kodamalabs.ai/login expects 200 with the sign-in form, /transactions a redirect to /login, / the homepage"
    echo "    smoke POST tools/list on capital-web:3000/mcp (bearer token is read inside the container and not logged)"
  fi
  if [[ "$unit" == "monitoring" ]]; then
    echo_compose up --no-deps --no-build --abort-on-container-exit --exit-code-from uptime-kuma-provision uptime-kuma-provision
  fi
  if [[ -n "$also" ]]; then
    echo_compose up -d --no-deps --no-build --force-recreate "$also"
  fi
  echo "    on migrate failure: tag ${image}:rollback-${oldsha} back to ${image}:latest, leave running containers, write PAUSED"
  echo "    on smoke failure: tag the rollback image back to :latest and force-recreate the services above"
}

svc_host_for() {
  case "$1" in
    capital) echo capital-web ;;
    careers) echo careers-web ;;
    attention) echo attention-web ;;
    sentinel) echo sentinel-web ;;
    kodamalabs) echo kodamalabs-web ;;
    *) echo "$1" ;;
  esac
}

print_recreate_unit() {
  local unit="$1" svc
  echo "  RECREATE ${unit} (no image build)"
  print_reasons "$unit"
  for svc in ${UNIT_SERVICES[$unit]}; do
    echo_compose up -d --no-deps --no-build --force-recreate "$svc"
  done
  if [[ "$unit" == "cloudflared" ]]; then
    echo "    smoke GET https://status.kodamalabs.ai/ expects 200 and Kodama Labs"
    echo "    smoke GET https://status.kodamalabs.ai/api/status-page/kodama expects 200"
    echo "    smoke GET https://status.kodamalabs.ai/dashboard expects 404"
    echo "    smoke GET https://status.kodamalabs.ai/socket.io/?EIO=4&transport=polling expects 404"
    echo "    smoke GET https://status.kodamalabs.ai/api/push/x expects 404"
    echo "    smoke GET https://status.kodamalabs.ai/metrics expects 404"
    echo "    smoke GET https://status.kodamalabs.ai/api/badge/1/status expects 404"
    echo "    on status smoke failure: restore infrastructure/cloudflared/config.yml from the previous cloudflared sha and force-recreate cloudflared"
  fi
}

blocked="no"
if sha_is_blocked "$TARGET"; then
  blocked="yes"
fi
paused="no"
if is_paused; then
  paused="yes ($(head -n 1 "$KODAMA_PAUSE_FILE"))"
fi

check_tooling_drift "$TARGET" "$REPO" "$SCRIPT_DIR" || true

echo "target: ${TARGET}"
echo "force: $([[ "$FORCE" == 1 ]] && echo yes || echo no)"
echo "paused: ${paused}"
echo "blocked: ${blocked}"
if [[ "$DRY_RUN" == 1 ]]; then
  if plan_is_empty; then
    echo "dirty units: none"
  else
    echo "dirty units:"
    for unit in "${unit_order[@]}"; do
      if [[ -n "${PLAN_BUILD[$unit]:-}" ]]; then
        print_build "$unit"
      elif [[ -n "${PLAN_RECREATE[$unit]:-}" ]]; then
        print_recreate_unit "$unit"
      fi
    done
    if [[ ${#PLAN_SERVICE[@]} -gt 0 ]]; then
      echo "  compose services:"
      for svc in $(printf '%s\n' "${!PLAN_SERVICE[@]}" | sort); do
        echo_compose up -d --no-deps --no-build --force-recreate "$svc"
      done
    fi
    if [[ "$RECREATE_OUTSIDE" -eq 1 ]]; then
      echo "  compose changed outside a single service; recreate long-running services that are not part of a build above"
    fi
  fi
  if [[ "$WARN_POSTGRES" -eq 1 ]]; then
    echo "postgres: infrastructure/postgres changed. It will NOT be applied."
  fi
  echo "database restore: never automatic. rollback.sh --restore-db needs CONFIRM_DB_RESTORE."
  echo "dry-run: no docker or git changes were made"
  OVERALL="dry-run"
  exit 0
fi

if [[ "$blocked" == "yes" && "$FORCE" != 1 ]]; then
  echo "not retrying blocked sha ${TARGET}"
  OVERALL="blocked"
  exit 1
fi
if [[ "$paused" != "no" && "$FORCE" != 1 ]]; then
  echo "PAUSED is set; not deploying"
  OVERALL="paused"
  exit 1
fi

head_now="$(git rev-parse HEAD)"
origin_now="$(git rev-parse "origin/main^{commit}")"
if [[ "$TARGET" != "$head_now" && "$head_now" == "$origin_now" ]] && git merge-base --is-ancestor "$TARGET" "$head_now"; then
  echo "superseded by ${head_now}"
  OVERALL="superseded"
  exit 0
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "tracked changes in the checkout; not deploying"
  notify_once "dirty-${TARGET}" "$TARGET" "failure" "checkout has tracked changes"
  OVERALL="dirty"
  exit 1
fi

prev_result="$(status_py get result)"
if [[ "$prev_result" == "in_progress" && "$FORCE" != 1 ]]; then
  prev_sha="$(status_py get targetSha)"
  write_auto_pause "interrupted" "deploy" "previous deploy left status in_progress" "${prev_sha:-$TARGET}"
  KODAMA_STATUS_ERROR="previous deploy left status in_progress" KODAMA_STATUS_RESULT="interrupted" \
    status_py block "${prev_sha:-$TARGET}"
  notify_once "${prev_sha:-$TARGET}-interrupted" "${prev_sha:-$TARGET}" "failure" "previous deploy was interrupted"
  OVERALL="interrupted"
  exit 1
fi

if [[ "$(git rev-parse HEAD)" != "$TARGET" ]]; then
  if ! git merge --ff-only "$TARGET"; then
    echo "not a fast-forward to ${TARGET}" >&2
    notify_once "diverged-${TARGET}" "$TARGET" "failure" "checkout is not fast-forward to ${TARGET}"
    OVERALL="not_fast_forward"
    exit 1
  fi
fi

if plan_is_empty; then
  if [[ "$WARN_POSTGRES" -eq 1 && "$(status_py get postgresWarnedSha)" != "$TARGET" ]]; then
    status_py set-field postgresWarnedSha "$TARGET"
    notify_once "postgres-${TARGET}" "$TARGET" "failure" "infrastructure/postgres changed and was not applied"
    echo "postgres files changed; a human has to apply infrastructure/postgres"
  fi
  echo "checkout matches ${TARGET}; no containers changed"
  OVERALL="success"
  exit 0
fi

LOG="${KODAMA_DEPLOYS_DIR}/$(stamp_utc)-${TARGET:0:12}.log"
exec > >(tee -a "$LOG") 2>&1
echo "logging to ${LOG}"
KODAMA_STATUS_NOW="$(now_utc)" status_py mark-start "$TARGET" "$LOG"

FAILURE_RECORDED=0
CURRENT_RESTORE_IMAGE=""
CURRENT_RESTORE_TAG=""
MAINT=0

restore_latest_tag() {
  if [[ -n "$CURRENT_RESTORE_TAG" ]]; then
    echo "restoring ${CURRENT_RESTORE_IMAGE}:latest from ${CURRENT_RESTORE_TAG}"
    runtime_docker tag "$CURRENT_RESTORE_TAG" "${CURRENT_RESTORE_IMAGE}:latest" || true
    CURRENT_RESTORE_TAG=""
  fi
}

clear_maintenance() {
  if [[ "$MAINT" == 1 ]]; then
    compose_run_loaded kodama-monitoring:latest uptime-kuma-provision node dist/maintenance.js clear || true
    MAINT=0
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [[ "$FAILURE_RECORDED" != 1 ]]; then
    restore_latest_tag || true
  fi
  clear_maintenance || true
  echo "KODAMA_OVERALL ${OVERALL}"
  print_app_summary || true
  exit "$rc"
}
trap on_exit EXIT

record_failure() {
  local unit="$1" result="$2" error="$3"
  FAILURE_RECORDED=1
  OVERALL="$result"
  restore_latest_tag
  KODAMA_STATUS_ERROR="$error" status_py set-app-failure "$unit" "$result" "$TARGET"
  KODAMA_STATUS_ERROR="$error" KODAMA_STATUS_RESULT="$result" status_py block "$TARGET"
  KODAMA_STATUS_ERROR="$error" KODAMA_STATUS_NOW="$(now_utc)" status_py mark-end "$result"
  if result_should_pause "$result"; then
    write_auto_pause "$result" "$unit" "$error" "$TARGET"
  fi
  notify_once "${TARGET}-${result}" "$TARGET" "$result" "${result} ${unit}: ${error}"
  exit 1
}

dump_database() {
  local db="$1" oldsha="$2"
  local file="${KODAMA_BACKUPS_DIR}/$(stamp_utc)-${oldsha}-${db}.dump"
  echo "dumping ${db} to ${file}"
  if ! runtime_docker exec postgres pg_dump -U root -d "$db" -Fc >"$file"; then
    rm -f "$file"
    return 1
  fi
  if [[ ! -s "$file" ]]; then
    rm -f "$file"
    return 1
  fi
  chmod 600 "$file"
  echo "$(stamp_utc) ${file}" >>"$KODAMA_DUMP_MANIFEST"
  status_py add-dump "$file"
}

append_tag() {
  echo "$(stamp_utc) $1" >>"$KODAMA_TAG_MANIFEST"
}

smoke_http() {
  local service="$1" port="$2" dbfield="$3" attempt
  for attempt in $(seq 1 30); do
    if compose exec -T \
      -e "SMOKE_URL=http://127.0.0.1:${port}/api/health" \
      -e "SMOKE_NEED=\"db\":\"${dbfield}\"" \
      "$service" \
      node -e 'fetch(process.env.SMOKE_URL).then(async (r) => { const t = await r.text(); if (r.status !== 200 || !t.includes(process.env.SMOKE_NEED)) { console.log(r.status); console.log(t.slice(0, 200)); process.exit(1); } }).catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); })'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

services_are_up() {
  local running svc
  running="$(compose ps --status running --format '{{.Service}}')"
  for svc in "$@"; do
    grep -qx "$svc" <<<"$running" || return 1
  done
}

wait_services() {
  local attempt
  for attempt in $(seq 1 15); do
    if services_are_up "$@"; then
      return 0
    fi
    sleep 2
  done
  services_are_up "$@"
}

status_expect() {
  local path="$1" expect="$2" needle="${3:-}" body code
  body="$(mktemp)"
  code="$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' "https://status.kodamalabs.ai${path}" || true)"
  if [[ "$code" != "$expect" ]]; then
    echo "status smoke ${path} got ${code:-curl-failed}, expected ${expect}: $(head -c 120 "$body" | tr '\n' ' ')"
    rm -f "$body"
    return 1
  fi
  if [[ -n "$needle" ]] && ! grep -q "$needle" "$body"; then
    echo "status smoke ${path} body missing ${needle}"
    rm -f "$body"
    return 1
  fi
  rm -f "$body"
}

status_page_smoke_once() {
  status_expect "/" "200" "Kodama Labs" || return 1
  status_expect "/api/status-page/kodama" "200" '"slug":"kodama"' || return 1
  status_expect "/dashboard" "404" || return 1
  status_expect "/socket.io/?EIO=4&transport=polling" "404" || return 1
  status_expect "/api/push/x" "404" || return 1
  status_expect "/metrics" "404" || return 1
  status_expect "/api/badge/1/status" "404" || return 1
}

status_page_smoke() {
  local attempt
  for attempt in $(seq 1 15); do
    if status_page_smoke_once; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# cloudflared has no image to roll back. Put the previous ingress file back
# and recreate so a restart cannot republish a failed allowlist. The working
# tree then differs from HEAD on purpose; the next deploy refuses a dirty
# checkout until that file is checked out again.
restore_cloudflared_ingress() {
  local oldsha tmp
  oldsha="$(status_py get "apps.cloudflared.sha")"
  if [[ ! "$oldsha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "no previous cloudflared sha; ingress file left as deployed"
    return 1
  fi
  if ! git cat-file -e "${oldsha}:infrastructure/cloudflared/config.yml" 2>/dev/null; then
    echo "previous cloudflared config not found at ${oldsha}"
    return 1
  fi
  tmp="$(mktemp)"
  if ! git show "${oldsha}:infrastructure/cloudflared/config.yml" >"$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" infrastructure/cloudflared/config.yml
  echo "restored infrastructure/cloudflared/config.yml from ${oldsha}"
  echo "checkout has that tracked change so a cloudflared restart stays fail-closed; the next deploy refuses a dirty tree until the file is checked out"
  recreate_services cloudflared || echo "cloudflared recreate after ingress restore failed"
}

# Capital is on the internet without Cloudflare Access: its own sign-in is
# the protection. The sign-in page must answer with its form, and a page of
# the app without a session must send the visitor to it.
public_login_ok() {
  local body code hdr loc
  body="$(mktemp)"
  hdr="$(mktemp)"
  code="$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' "https://capital.kodamalabs.ai/login" || true)"
  if [[ "$code" != "200" ]] || ! grep -q 'id="auth-password"' "$body"; then
    rm -f "$body" "$hdr"
    return 1
  fi
  code="$(curl -sS --max-time 20 -o /dev/null -D "$hdr" -w '%{http_code}' "https://capital.kodamalabs.ai/transactions" || true)"
  loc="$(awk 'tolower($1)=="location:" { print $2 }' "$hdr" | tr -d '\r' | head -n 1)"
  if [[ ! "$code" =~ ^30[1278]$ || "$loc" != */login* ]]; then
    rm -f "$body" "$hdr"
    return 1
  fi
  # And the homepage is public at "/".
  code="$(curl -sS --max-time 20 -o "$body" -w '%{http_code}' "https://capital.kodamalabs.ai/" || true)"
  local home=1
  [[ "$code" == "200" ]] && grep -q 'id="cerne-home"' "$body" && home=0
  rm -f "$body" "$hdr"
  return "$home"
}

mcp_ok() {
  compose exec -T capital-web node -e '
    const key = process.env.MCP_API_KEY;
    if (!key) { console.error("MCP_API_KEY missing"); process.exit(1); }
    fetch("http://127.0.0.1:3000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer " + key,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }).then(async (r) => {
      const t = await r.text();
      if (r.status !== 200 || !t.includes("tools")) {
        console.log(r.status);
        console.log(t.slice(0, 200));
        process.exit(1);
      }
    }).catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
  '
}

smoke_unit() {
  local unit="$1"
  local port="${UNIT_PORT[$unit]:-}"
  local dbfield="${UNIT_SMOKE_DB[$unit]:-}"
  local -a services_array
  read -r -a services_array <<<"${UNIT_SERVICES[$unit]}"
  wait_services "${services_array[@]}"
  if [[ -n "$port" ]]; then
    smoke_http "$(svc_host_for "$unit")" "$port" "$dbfield"
  fi
}

open_maintenance() {
  if compose_run_loaded kodama-monitoring:latest uptime-kuma-provision node dist/maintenance.js start 30; then
    MAINT=1
  else
    echo "maintenance window was not opened; continuing"
  fi
}

recreate_services() {
  local svc
  for svc in "$@"; do
    compose up -d --no-deps --no-build --force-recreate "$svc"
  done
}

rollback_services() {
  local unit="$1"
  local -a services_array
  read -r -a services_array <<<"${UNIT_SERVICES[$unit]}"
  if [[ -n "${UNIT_ALSO_RECREATE[$unit]:-}" ]]; then
    services_array+=("${UNIT_ALSO_RECREATE[$unit]}")
  fi
  restore_latest_tag
  recreate_services "${services_array[@]}"
}

finish_smoke_failure() {
  local unit="$1" migrated="$2"
  local note="smoke failed; previous image restored"
  if [[ "$migrated" == 1 ]]; then
    note="${note}; schema_may_be_new; database was not restored"
  fi
  if ! smoke_unit "$unit"; then
    record_failure "$unit" rollback_unhealthy "previous image is not healthy after rollback"
  fi
  if [[ -n "${UNIT_ALSO_RECREATE[$unit]:-}" ]]; then
    if ! wait_services "${UNIT_ALSO_RECREATE[$unit]}"; then
      record_failure "$unit" rollback_unhealthy "rolled-back companion service is not running"
    fi
  fi
  record_failure "$unit" rolled_back "$note"
}

execute_build() {
  local unit="$1"
  local image="${UNIT_IMAGE[$unit]}"
  local oldsha db migrate dockerfile target arg svc migrated=0
  oldsha="$(status_py get "apps.${unit}.sha")"
  db="${UNIT_DATABASE[$unit]:-}"
  migrate="${UNIT_MIGRATE[$unit]:-}"
  dockerfile="${UNIT_DOCKERFILE[$unit]}"
  target="${UNIT_TARGET[$unit]:-}"
  echo "building ${unit} ${oldsha} -> ${TARGET}"
  if [[ -n "$db" ]] && ! dump_database "$db" "$oldsha"; then
    record_failure "$unit" build_failed "pg_dump ${db} failed"
  fi
  if ! runtime_docker tag "${image}:latest" "${image}:rollback-${oldsha}"; then
    record_failure "$unit" build_failed "could not tag ${image}:latest as rollback-${oldsha}"
  fi
  runtime_docker tag "${image}:latest" "${image}:rollback" || true
  append_tag "${image}:rollback-${oldsha}"
  local -a args=()
  while IFS= read -r arg; do
    [[ -z "$arg" ]] && continue
    args+=(--build-arg "$arg")
  done < <(build_arg_lines "$unit")
  local -a build_cmd=(build -f "${REPO}/${dockerfile}")
  if [[ -n "$target" ]]; then
    build_cmd+=(--target "$target")
  fi
  build_cmd+=("${args[@]}" -t "${image}:${TARGET}" "$REPO")
  if ! build_docker "${build_cmd[@]}"; then
    record_failure "$unit" build_failed "docker build failed"
  fi
  if ! build_docker save "${image}:${TARGET}" | runtime_docker load; then
    record_failure "$unit" build_failed "docker load into desktop-linux failed"
  fi
  append_tag "${image}:${TARGET}"
  if ! runtime_docker tag "${image}:${TARGET}" "${image}:latest"; then
    record_failure "$unit" build_failed "could not retag ${image}:latest"
  fi
  CURRENT_RESTORE_IMAGE="$image"
  CURRENT_RESTORE_TAG="${image}:rollback-${oldsha}"
  if [[ -n "$migrate" ]]; then
    if ! compose up --no-deps --no-build --abort-on-container-exit --exit-code-from "$migrate" "$migrate"; then
      record_failure "$unit" migrate_failed "prisma migrate deploy failed for ${migrate}"
    fi
    migrated=1
  fi
  local -a services_array
  read -r -a services_array <<<"${UNIT_SERVICES[$unit]}"
  if ! recreate_services "${services_array[@]}"; then
    record_failure "$unit" build_failed "could not recreate ${unit} services"
  fi
  if ! smoke_unit "$unit"; then
    rollback_services "$unit" || true
    finish_smoke_failure "$unit" "$migrated"
  fi
  if [[ "$unit" == "capital" ]]; then
    if ! public_login_ok || ! mcp_ok; then
      rollback_services "$unit" || true
      finish_smoke_failure "$unit" "$migrated"
    fi
  fi
  if [[ "$unit" == "monitoring" ]]; then
    if ! compose up --no-deps --no-build --abort-on-container-exit --exit-code-from uptime-kuma-provision uptime-kuma-provision; then
      record_failure "$unit" build_failed "uptime-kuma provision failed"
    fi
  fi
  if [[ -n "${UNIT_ALSO_RECREATE[$unit]:-}" ]]; then
    if ! recreate_services "${UNIT_ALSO_RECREATE[$unit]}" || ! wait_services "${UNIT_ALSO_RECREATE[$unit]}"; then
      rollback_services "$unit" || true
      finish_smoke_failure "$unit" "$migrated"
    fi
    status_py set-app-success "${UNIT_ALSO_RECREATE[$unit]}" "$TARGET"
  fi
  CURRENT_RESTORE_TAG=""
  status_py set-app-success "$unit" "$TARGET"
  echo "${unit} is healthy at ${TARGET}"
}

execute_recreate_unit() {
  local unit="$1"
  local -a services_array
  read -r -a services_array <<<"${UNIT_SERVICES[$unit]}"
  echo "recreating ${unit}"
  if ! recreate_services "${services_array[@]}"; then
    record_failure "$unit" build_failed "could not recreate ${unit}"
  fi
  if [[ -n "${UNIT_PORT[$unit]:-}" ]]; then
    if ! smoke_unit "$unit"; then
      record_failure "$unit" build_failed "smoke failed after recreating ${unit}"
    fi
  elif ! wait_services "${services_array[@]}"; then
    record_failure "$unit" build_failed "${unit} did not stay up"
  fi
  if [[ "$unit" == "cloudflared" ]]; then
    if ! status_page_smoke; then
      restore_cloudflared_ingress || true
      record_failure "$unit" build_failed "status page smoke failed; previous cloudflared ingress restored"
    fi
  fi
  status_py set-app-success "$unit" "$TARGET"
}

OUTSIDE_SERVICES=(
  careers-web careers-jobs careers-sources careers-maintenance
  attention-web attention-whatsapp attention-maintenance attention-jobs
  capital-web cronjobs
  sentinel-web
  kodamalabs-web
  log-watcher
  cloudflared
  docker-socket-proxy
  uptime-kuma
)

if ! plan_is_empty; then
  open_maintenance
  for unit in "${unit_order[@]}"; do
    if [[ -n "${PLAN_BUILD[$unit]:-}" ]]; then
      execute_build "$unit"
    elif [[ -n "${PLAN_RECREATE[$unit]:-}" ]]; then
      execute_recreate_unit "$unit"
    fi
  done
  if [[ ${#PLAN_SERVICE[@]} -gt 0 ]]; then
    for svc in $(printf '%s\n' "${!PLAN_SERVICE[@]}" | sort); do
      if ! recreate_services "$svc"; then
        record_failure "${svc}" build_failed "could not recreate ${svc}"
      fi
      owner="$(unit_for_service "$svc")"
      if [[ "$owner" != service:* && -n "$owner" ]]; then
        status_py set-app-success "$owner" "$TARGET"
      fi
    done
  fi
  if [[ "$RECREATE_OUTSIDE" -eq 1 ]]; then
    for svc in "${OUTSIDE_SERVICES[@]}"; do
      owner="$(unit_for_service "$svc")"
      if [[ "$owner" != service:* && -n "${PLAN_BUILD[$owner]:-}${PLAN_RECREATE[$owner]:-}" ]]; then
        continue
      fi
      if ! recreate_services "$svc"; then
        record_failure "cloudflared" build_failed "could not recreate ${svc} after a compose-wide change"
      fi
    done
    for unit in "${unit_order[@]}"; do
      if [[ "$(status_py get "apps.${unit}.sha")" != "$TARGET" ]]; then
        status_py set-app-success "$unit" "$TARGET"
      fi
    done
  fi
fi

if [[ "$WARN_POSTGRES" -eq 1 && "$(status_py get postgresWarnedSha)" != "$TARGET" ]]; then
  status_py set-field postgresWarnedSha "$TARGET"
  notify_once "postgres-${TARGET}" "$TARGET" "failure" "infrastructure/postgres changed and was not applied"
  echo "postgres files changed; a human has to apply infrastructure/postgres"
fi

if plan_is_empty; then
  KODAMA_STATUS_ERROR="" KODAMA_STATUS_NOW="$(now_utc)" status_py mark-end success
  status_py set-field targetSha "$TARGET"
  clear_auto_pause
  echo "checkout matches ${TARGET}; no containers changed"
  OVERALL="success"
  exit 0
fi

if [[ -f "$KODAMA_TAG_MANIFEST" ]]; then
  while IFS= read -r tag; do
    [[ -z "$tag" ]] && continue
    echo "removing old tag ${tag}"
    runtime_docker rmi "$tag" || echo "could not remove ${tag}" >&2
  done < <(tags_to_prune "$KODAMA_KEEP_ROLLBACK_TAGS" "$KODAMA_KEEP_SHA_TAGS" <"$KODAMA_TAG_MANIFEST")
fi
if [[ -f "$KODAMA_DUMP_MANIFEST" ]]; then
  while IFS= read -r dump; do
    [[ -z "$dump" ]] && continue
    if [[ -f "$dump" ]]; then
      echo "removing old dump ${dump}"
      rm -f "$dump"
    fi
  done < <(dumps_to_prune "$KODAMA_KEEP_DUMPS" <"$KODAMA_DUMP_MANIFEST")
fi

KODAMA_STATUS_ERROR="" KODAMA_STATUS_NOW="$(now_utc)" status_py mark-end success
clear_auto_pause
notify_once "${TARGET}-success" "$TARGET" "success" "deployed ${TARGET:0:12}"
echo "deployed ${TARGET}"
OVERALL="success"
exit 0
