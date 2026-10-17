# shellcheck shell=bash
# Shared helpers for the kodama-ai deployer.
# Sourced, not executed. Safe to source in tests: nothing here talks to docker or git.

if [[ -n "${KODAMA_LIB_LOADED:-}" ]]; then
  return 0
fi
KODAMA_LIB_LOADED=1

KODAMA_DEPLOYS_DIR="${KODAMA_DEPLOYS_DIR:-${HOME}/deploys}"
KODAMA_BACKUPS_DIR="${KODAMA_BACKUPS_DIR:-${HOME}/backups}"
KODAMA_STATUS="${KODAMA_STATUS:-${KODAMA_DEPLOYS_DIR}/status.json}"
KODAMA_DEPLOY_ENV="${KODAMA_DEPLOY_ENV:-${HOME}/.config/kodama-deploy/env}"
KODAMA_TAG_MANIFEST="${KODAMA_TAG_MANIFEST:-${KODAMA_DEPLOYS_DIR}/tag-manifest.txt}"
KODAMA_DUMP_MANIFEST="${KODAMA_DUMP_MANIFEST:-${KODAMA_DEPLOYS_DIR}/dump-manifest.txt}"
KODAMA_PAUSE_FILE="${KODAMA_PAUSE_FILE:-${KODAMA_DEPLOYS_DIR}/PAUSED}"
KODAMA_GITHUB_REPO="${KODAMA_GITHUB_REPO:-guilhermeKodama/kodama-labs}"
KODAMA_KEEP_ROLLBACK_TAGS="${KODAMA_KEEP_ROLLBACK_TAGS:-5}"
KODAMA_KEEP_SHA_TAGS="${KODAMA_KEEP_SHA_TAGS:-5}"
KODAMA_KEEP_DUMPS="${KODAMA_KEEP_DUMPS:-10}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-kodama-prod}"

# Installed next to each other outside the checkout. Compared with the same
# paths at the target SHA. install.sh is not in this list: it is run from the
# checkout by a person, and a deploy never copies it into place.
TOOLING_FILES=(
  ssh-entry.sh
  deploy.sh
  rollback.sh
  lib.sh
  apps.conf
  status.py
)

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=apps.conf
source "${_LIB_DIR}/apps.conf"

die() {
  echo "deploy: $*" >&2
  exit 1
}

now_utc() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

stamp_utc() {
  date -u +%Y%m%dT%H%M%SZ
}

status_py() {
  KODAMA_STATUS="$KODAMA_STATUS" python3 "${_LIB_DIR}/status.py" "$@"
}

load_deploy_env() {
  local file="${KODAMA_DEPLOY_ENV}"
  if [[ -z "$file" || ! -f "$file" ]]; then
    return 0
  fi
  set -a
  # shellcheck disable=SC1090
  source "$file"
  set +a
}

# --- change detection -------------------------------------------------------

rule_matches() {
  local file="$1" prefix="$2"
  if [[ "$prefix" != */* ]]; then
    [[ "$file" == "$prefix" ]]
  else
    [[ "$file" == "$prefix" || "$file" == "$prefix/"* ]]
  fi
}

# Reads repo paths on stdin. Prints "build <unit>", "recreate <unit>", or
# "warn postgres", one per line, unique and sorted.
effects_for_files() {
  local file rule prefix action units unit
  declare -A seen=()
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    for rule in "${PATH_RULES[@]}"; do
      IFS='|' read -r prefix action units <<<"$rule"
      if ! rule_matches "$file" "$prefix"; then
        continue
      fi
      if [[ "$action" == "warn" ]]; then
        seen["warn postgres"]=1
        continue
      fi
      local IFS=','
      for unit in $units; do
        seen["${action} ${unit}"]=1
      done
    done
  done
  if [[ ${#seen[@]} -eq 0 ]]; then
    return 0
  fi
  printf '%s\n' "${!seen[@]}" | sort
}

service_at_line() {
  local file="$1" target="$2"
  awk -v target="$target" '
    /^services:[[:space:]]*$/ { in_services = 1; next }
    in_services && /^[^ #]/ { in_services = 0 }
    in_services && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
      name = $1
      sub(/:/, "", name)
      if (NR <= target) { current = name }
    }
    END { print current }
  ' "$file"
}

line_requests_rebuild() {
  local text="$1"
  [[ "$text" =~ ^[+-][[:space:]]*(build:|dockerfile:|target:|args:|context:|NEXT_PUBLIC_) ]]
}

unit_for_service() {
  case "$1" in
    careers-*) echo careers ;;
    attention-*) echo attention ;;
    capital-migrate | capital-web) echo capital ;;
    cronjobs) echo cronjobs ;;
    sentinel-*) echo sentinel ;;
    kodamalabs-*) echo kodamalabs ;;
    uptime-kuma-provision | log-watcher) echo monitoring ;;
    cloudflared) echo cloudflared ;;
    docker-socket-proxy | uptime-kuma) echo "service:$1" ;;
    *) echo "" ;;
  esac
}

# Prints plan lines for a docker-compose.yml diff between two commits.
# BUILD lines come from build-block edits. RECREATE_SERVICE lines come from
# any other edit inside a service. OUTSIDE means the change is not inside a
# single service (anchors, networks).
compose_plan_lines() {
  local repo="$1" from="$2" to="$3"
  if git -C "$repo" diff --quiet "$from" "$to" -- docker-compose.yml; then
    return 0
  fi
  local new_file old_file diff_file
  new_file="$(mktemp)"
  old_file="$(mktemp)"
  diff_file="$(mktemp)"
  git -C "$repo" show "$to:docker-compose.yml" >"$new_file"
  if git -C "$repo" cat-file -e "$from:docker-compose.yml" 2>/dev/null; then
    git -C "$repo" show "$from:docker-compose.yml" >"$old_file"
  else
    : >"$old_file"
  fi
  git -C "$repo" diff -U0 "$from" "$to" -- docker-compose.yml >"$diff_file"

  declare -A seen=()
  local new_line=0 old_line=0 line kind text service unit outside=0
  while IFS= read -r line; do
    if [[ "$line" =~ ^@@\ -([0-9]+)(,([0-9]+))?[[:space:]]\+([0-9]+)(,([0-9]+))?[[:space:]]@@ ]]; then
      old_line="${BASH_REMATCH[1]}"
      new_line="${BASH_REMATCH[4]}"
      continue
    fi
    [[ "$line" == "---"* || "$line" == "+++"* || "$line" == "diff "* || "$line" == "index "* ]] && continue
    if [[ "$line" == +* ]]; then
      text="$line"
      service="$(service_at_line "$new_file" "$new_line")"
      new_line=$((new_line + 1))
    elif [[ "$line" == -* ]]; then
      text="$line"
      service="$(service_at_line "$old_file" "$old_line")"
      old_line=$((old_line + 1))
    else
      continue
    fi
    if [[ -z "$service" ]]; then
      outside=1
      continue
    fi
    unit="$(unit_for_service "$service")"
    if [[ -z "$unit" ]]; then
      outside=1
      continue
    fi
    if [[ "$unit" == service:* ]]; then
      seen["RECREATE_SERVICE ${unit#service:}"]=1
      continue
    fi
    if line_requests_rebuild "$text" && [[ "${UNIT_KIND[$unit]:-}" == "image" ]]; then
      seen["BUILD ${unit}"]=1
    else
      seen["RECREATE_SERVICE ${service}"]=1
    fi
  done <"$diff_file"
  rm -f "$new_file" "$old_file" "$diff_file"
  if [[ "$outside" -eq 1 ]]; then
    seen["RECREATE_OUTSIDE"]=1
  fi
  if [[ ${#seen[@]} -eq 0 ]]; then
    return 0
  fi
  printf '%s\n' "${!seen[@]}" | sort
}

# Files changed between two commits. Prints the same vocabulary as effects_for_files
# plus RECREATE_SERVICE / RECREATE_OUTSIDE from compose.
plan_raw_lines() {
  local repo="$1" from="$2" to="$3"
  git -C "$repo" diff --name-only "$from" "$to" | effects_for_files
  compose_plan_lines "$repo" "$from" "$to"
}

# --- tags and dumps we are allowed to delete --------------------------------

is_our_rollback_ref() {
  [[ "$1" =~ ^rollback-[0-9a-f]{40}$ ]]
}

is_our_sha_ref() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

is_our_dump_name() {
  local base
  base="$(basename "$1")"
  [[ "$base" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}-[a-z0-9]+\.dump$ ]]
}

# Manifest lines are "<stamp> <tag>". Prints tags to delete, oldest first.
# KEEP_ROLLBACK and KEEP_SHA select how many of each kind survive per image.
tags_to_prune() {
  local keep_rollback="${1:-5}" keep_sha="${2:-5}"
  # -c leaves stdin for the manifest. A heredoc would swallow the pipe.
  python3 -c '
import re, sys
keep_rollback = int(sys.argv[1])
keep_sha = int(sys.argv[2])
rollback_re = re.compile(r"^rollback-[0-9a-f]{40}$")
sha_re = re.compile(r"^[0-9a-f]{40}$")
groups = {}
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split()
    if len(parts) != 2 or ":" not in parts[1]:
        continue
    stamp, tag = parts
    image, ref = tag.rsplit(":", 1)
    if rollback_re.match(ref):
        kind = "rollback"
    elif sha_re.match(ref):
        kind = "sha"
    else:
        continue
    groups.setdefault((image, kind), []).append((stamp, tag))
for key, items in groups.items():
    kind = key[1]
    keep = keep_rollback if kind == "rollback" else keep_sha
    items.sort()
    doomed = items if keep <= 0 else items[:-keep]
    for _stamp, tag in doomed:
        print(tag)
' "$keep_rollback" "$keep_sha"
}

dumps_to_prune() {
  local keep="${1:-10}"
  python3 -c '
import os, re, sys
keep = int(sys.argv[1])
pattern = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}-([a-z0-9]+)\.dump$")
groups = {}
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    parts = line.split()
    if len(parts) != 2:
        continue
    stamp, path = parts
    name = os.path.basename(path)
    match = pattern.match(name)
    if not match:
        continue
    groups.setdefault(match.group(1), []).append((stamp, path))
for db, items in groups.items():
    items.sort()
    extra = items if keep <= 0 else items[:-keep]
    for _stamp, path in extra:
        print(path)
' "$keep"
}

result_should_pause() {
  case "$1" in
    migrate_failed | rollback_unhealthy) return 0 ;;
    *) return 1 ;;
  esac
}

sha_is_blocked() {
  local sha="$1"
  [[ "${FORCE:-0}" == 1 ]] && return 1
  local blocked
  blocked="$(status_py get blockedSha 2>/dev/null || true)"
  [[ -n "$blocked" && "$blocked" == "$sha" ]]
}

# --- docker context guards --------------------------------------------------

# The native engine (context "default") hosts a stale stack and whisper-rocm.
# Building there is allowed. Starting, stopping, or deleting anything is not.
build_docker() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    build | save) ;;
    *)
      echo "refusing to run '${sub}' on the default docker context" >&2
      return 64
      ;;
  esac
  command docker --context default "$sub" "$@"
}

runtime_docker() {
  command docker --context desktop-linux "$@"
}

compose() {
  runtime_docker compose -p "$COMPOSE_PROJECT" -f "${REPO}/docker-compose.yml" --project-directory "$REPO" "$@"
}

# --- build args (defaults match docker-compose.yml) ------------------------

build_arg_lines() {
  local unit="$1"
  case "$unit" in
    careers)
      printf '%s\n' \
        "NEXT_PUBLIC_APP_URL=${CAREERS_APP_URL:-https://careers.kodamalabs.ai}" \
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY=${CAREERS_VAPID_PUBLIC_KEY:-BKQd4fNvNY4Q7IA-teiYts6qi7rFRzBmjcJhQUjqXoRdsmbJh6y4AgGERaeGFQXsgV5oYXbASXGPxtogrxo69AE}"
      ;;
    attention)
      printf '%s\n' \
        "NEXT_PUBLIC_APP_URL=${ATTENTION_APP_URL:-https://attentio.dev}" \
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY=${ATTENTION_VAPID_PUBLIC_KEY:-BNc3iQ75zEEvAk1rsm56R8pc01BDQUb0ax4JYrtWcBvnxmek6HjHlxJ57Bfjfc6xRo7gX8cPRU0MvlrpPEQszmg}"
      ;;
    capital)
      printf '%s\n' \
        "NEXT_PUBLIC_APP_URL=${CAPITAL_PUBLIC_URL:-https://capital.kodamalabs.ai}" \
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY=${CAPITAL_VAPID_PUBLIC_KEY:-BIZPytT1AcEzKXA5YQRz6V7tso9r_1uFeSfAuDhTLOotQ3_p8aIwOJwTKaEBWpG9xCSfUobWA2k00AumltvwztE}"
      ;;
    sentinel)
      printf '%s\n' "NEXT_PUBLIC_APP_URL=${SENTINEL_PUBLIC_URL:-https://sentinel.kodamalabs.ai}"
      ;;
    *) ;;
  esac
}

# --- notifications ----------------------------------------------------------

webhook_header_valid() {
  local header="${1:-}" name value
  [[ -z "$header" ]] && return 1
  [[ "$header" == *:* ]] || return 1
  name="${header%%:*}"
  value="${header#*:}"
  value="${value#"${value%%[![:space:]]*}"}"
  [[ "$name" =~ ^[A-Za-z0-9-]+$ ]] || return 1
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || return 1
  [[ -n "$value" ]] || return 1
  return 0
}

post_webhook() {
  local url="${DEPLOY_WEBHOOK_URL:-}"
  [[ -z "$url" ]] && return 0
  [[ -f "$KODAMA_STATUS" ]] || return 0
  local -a header_arg=()
  if [[ -n "${DEPLOY_WEBHOOK_HEADER:-}" ]]; then
    if ! webhook_header_valid "$DEPLOY_WEBHOOK_HEADER"; then
      echo "webhook skipped: DEPLOY_WEBHOOK_HEADER is not a single Name: value" >&2
      return 0
    fi
    local name value
    name="${DEPLOY_WEBHOOK_HEADER%%:*}"
    value="${DEPLOY_WEBHOOK_HEADER#*:}"
    value="${value#"${value%%[![:space:]]*}"}"
    header_arg=(-H "${name}: ${value}")
  fi
  local code
  # Discard curl's own stderr: a failure line would include the URL.
  if ! code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
    -X POST -H "Content-Type: application/json" "${header_arg[@]}" \
    --data-binary @"$KODAMA_STATUS" \
    "$url" 2>/dev/null)"; then
    echo "webhook request failed" >&2
    return 0
  fi
  echo "webhook http ${code}"
}

# Compare the installed copies with infrastructure/deploy at sha.
# Prints a WARNING per differing file and sets tooling_drift. Never copies.
check_tooling_drift() {
  local sha="$1" repo="$2" installed="$3"
  local file inst_hash repo_hash drift=0
  for file in "${TOOLING_FILES[@]}"; do
    if [[ ! -f "${installed}/${file}" ]]; then
      echo "WARNING: tooling drift: installed ${file} is missing. Re-run install.sh on kodama-ai. Not auto-installing."
      drift=1
      continue
    fi
    inst_hash="$(sha256sum "${installed}/${file}" | awk '{print $1}')"
    if ! git -C "$repo" cat-file -e "${sha}:infrastructure/deploy/${file}" 2>/dev/null; then
      echo "WARNING: tooling drift: infrastructure/deploy/${file} is missing at ${sha}. Re-run install.sh on kodama-ai. Not auto-installing."
      drift=1
      continue
    fi
    repo_hash="$(git -C "$repo" show "${sha}:infrastructure/deploy/${file}" | sha256sum | awk '{print $1}')"
    if [[ "$inst_hash" != "$repo_hash" ]]; then
      echo "WARNING: tooling drift: infrastructure/deploy/${file} at ${sha} differs from the installed copy. Re-run install.sh on kodama-ai. Not auto-installing."
      drift=1
    fi
  done
  if [[ -f "$KODAMA_STATUS" ]]; then
    if [[ "$drift" -eq 1 ]]; then
      status_py set-field tooling_drift true
    else
      status_py set-field tooling_drift false
    fi
  fi
  return 0
}

# Machine-readable block the Actions job turns into the step summary.
print_app_summary() {
  local unit sha result
  [[ -f "${KODAMA_STATUS:-}" ]] || return 0
  echo "KODAMA_SUMMARY_BEGIN"
  for unit in "${unit_order[@]}"; do
    sha="$(status_py get "apps.${unit}.sha" 2>/dev/null || true)"
    result="$(status_py get "apps.${unit}.result" 2>/dev/null || true)"
    [[ -n "$sha" ]] || sha="-"
    [[ -n "$result" ]] || result="-"
    printf 'KODAMA_APP %s %s %s\n' "$unit" "$result" "$sha"
  done
  echo "KODAMA_SUMMARY_END"
}

notify_once() {
  local key="$1" sha="$2" result="$3" description="$4"
  mkdir -p "$KODAMA_DEPLOYS_DIR"
  local marker="${KODAMA_DEPLOYS_DIR}/notified-${key}"
  if [[ -f "$marker" ]]; then
    return 0
  fi
  # Success stays in the Actions log and status.json. The webhook is failure-only.
  if [[ "$result" != "success" ]]; then
    post_webhook || true
  fi
  : >"$marker"
}

write_auto_pause() {
  local result="$1" unit="$2" error="$3" sha="$4"
  mkdir -p "$KODAMA_DEPLOYS_DIR"
  local tmp="${KODAMA_PAUSE_FILE}.tmp"
  cat >"$tmp" <<EOF
auto: ${result}
sha: ${sha}
unit: ${unit}
error: ${error}
EOF
  mv "$tmp" "$KODAMA_PAUSE_FILE"
  echo "paused: ${KODAMA_PAUSE_FILE}"
}

clear_auto_pause() {
  if [[ -f "$KODAMA_PAUSE_FILE" ]] && grep -q '^auto:' "$KODAMA_PAUSE_FILE"; then
    rm -f "$KODAMA_PAUSE_FILE"
    echo "removed automatic pause"
  fi
}

is_paused() {
  [[ -f "$KODAMA_PAUSE_FILE" ]]
}
