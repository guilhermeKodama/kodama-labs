#!/usr/bin/env bash
# Shell tests for the deployer. They do not call a Docker daemon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="${TMP}/home"
export KODAMA_DEPLOYS_DIR="${TMP}/deploys"
export KODAMA_BACKUPS_DIR="${TMP}/backups"
export KODAMA_STATUS="${KODAMA_DEPLOYS_DIR}/status.json"
export KODAMA_DEPLOY_ENV="${TMP}/env"
export KODAMA_PAUSE_FILE="${KODAMA_DEPLOYS_DIR}/PAUSED"
export KODAMA_TAG_MANIFEST="${KODAMA_DEPLOYS_DIR}/tag-manifest.txt"
export KODAMA_DUMP_MANIFEST="${KODAMA_DEPLOYS_DIR}/dump-manifest.txt"
mkdir -p "$HOME" "$KODAMA_DEPLOYS_DIR" "$KODAMA_BACKUPS_DIR"
: >"$KODAMA_DEPLOY_ENV"

# shellcheck source=lib.sh
source "${ROOT}/infrastructure/deploy/lib.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  [[ "$1" == "$2" ]] || fail "$3: expected [$2] got [$1]"
}

effects() {
  printf '%s\n' "$@" | effects_for_files
}

echo "path rules"
got="$(effects apps/careers/src/app/page.tsx)"
assert_eq "$got" "build careers" "careers file"

got="$(effects packages/storage/src/index.ts)"
assert_eq "$got" "$(printf '%s\n' "build capital" "build careers" "build sentinel")" "storage dependents"

got="$(effects Dockerfile)"
assert_eq "$got" "$(printf '%s\n' "build attention" "build capital" "build careers" "build kodamalabs" "build sentinel")" "root Dockerfile"

got="$(effects pnpm-lock.yaml)"
assert_eq "$got" "$(printf '%s\n' "build attention" "build capital" "build careers" "build kodamalabs" "build monitoring" "build sentinel")" "lockfile"

got="$(effects infrastructure/cronjobs/schedules/capital.json)"
assert_eq "$got" "$(printf '%s\n' "build monitoring" "recreate cronjobs")" "schedules"

got="$(effects infrastructure/cronjobs/src/index.ts)"
assert_eq "$got" "build capital" "cronjobs source"

got="$(effects infrastructure/postgres/docker-compose.yml)"
assert_eq "$got" "warn postgres" "postgres"

got="$(effects infrastructure/cloudflared/config.yml)"
assert_eq "$got" "recreate cloudflared" "cloudflared"

got="$(effects apps/docs/content/docs/infrastructure/deploy.mdx packages/eslint-config/index.js packages/ui/src/button.tsx infrastructure/deploy/poll.sh)"
assert_eq "$got" "" "docs, eslint, ui, deployer"

echo "compose service map"
line="$(grep -n 'CAREERS_WEB_PORT' docker-compose.yml | head -n 1 | cut -d: -f1)"
assert_eq "$(service_at_line docker-compose.yml "$line")" "careers-web" "careers-web line"
line="$(grep -n 'target: capital' docker-compose.yml | head -n 1 | cut -d: -f1)"
assert_eq "$(service_at_line docker-compose.yml "$line")" "capital-migrate" "capital build line"
line_requests_rebuild "+    build: { context: . }" || fail "build line should rebuild"
if line_requests_rebuild "+    ports: [\"1:1\"]"; then
  fail "ports line should not rebuild"
fi

echo "compose diff"
repo="${TMP}/repo"
git init -b main "$repo" >/dev/null
git -C "$repo" config user.email "deploy-test@example.com"
git -C "$repo" config user.name "deploy-test"
cat >"${repo}/docker-compose.yml" <<'EOF'
name: kodama-prod
services:
  careers-web:
    image: kodama-careers:latest
    ports: ["3006:3006"]
  careers-migrate:
    build: { context: ., dockerfile: Dockerfile, target: careers }
    image: kodama-careers:latest
EOF
git -C "$repo" add docker-compose.yml
git -C "$repo" commit -m init >/dev/null
base="$(git -C "$repo" rev-parse HEAD)"
sed -i 's/3006:3006/13006:3006/' "${repo}/docker-compose.yml"
git -C "$repo" add docker-compose.yml
git -C "$repo" commit -m "port" >/dev/null
port_sha="$(git -C "$repo" rev-parse HEAD)"
plan="$(compose_plan_lines "$repo" "$base" "$port_sha")"
assert_eq "$plan" "RECREATE_SERVICE careers-web" "port change recreates one service"
sed -i 's/target: careers/target: careers-next/' "${repo}/docker-compose.yml"
git -C "$repo" add docker-compose.yml
git -C "$repo" commit -m "target" >/dev/null
target_sha="$(git -C "$repo" rev-parse HEAD)"
plan="$(compose_plan_lines "$repo" "$port_sha" "$target_sha")"
echo "$plan" | grep -qx "BUILD careers" || fail "build arg change should build careers, got: ${plan}"

echo "rotation"
sha_a="$(python3 -c 'print("ab"*20)')"
sha_b="$(python3 -c 'print("cd"*20)')"
manifest="$(cat <<EOF
20261017T000001Z kodama-capital:rollback-pre95
20261017T000002Z kodama-capital:rollback-pre-fx
20261017T000003Z kodama-capital:rollback-${sha_a}
20261017T000004Z kodama-capital:rollback-${sha_b}
20261016T000001Z kodama-capital:${sha_a}
20261017T000005Z kodama-capital:${sha_b}
20261017T000006Z kodama-capital:latest
20261017T000007Z kodama-capital:rollback
EOF
)"
pruned="$(printf '%s\n' "$manifest" | tags_to_prune 1 1 | sort)"
assert_eq "$pruned" "$(printf '%s\n' "kodama-capital:${sha_a}" "kodama-capital:rollback-${sha_a}" | sort)" "only our older sha tags"
is_our_rollback_ref "rollback-pre95" && fail "pre95 matched rollback pattern"
is_our_rollback_ref "rollback-pre-fx" && fail "pre-fx matched rollback pattern"
is_our_rollback_ref "rollback-${sha_a}" || fail "40 hex rollback tag should match"
is_our_sha_ref "$sha_a" || fail "sha ref"
is_our_dump_name "capital-pre95.dump" && fail "manual dump matched"
is_our_dump_name "20261017T000003Z-${sha_a}-capital.dump" || fail "deployer dump should match"
dump_manifest="$(cat <<EOF
20261017T000001Z ${TMP}/capital-pre95.dump
20261017T000002Z ${TMP}/capital-pre-fx.dump
20261017T000003Z ${TMP}/20261017T000003Z-${sha_a}-capital.dump
20261017T000004Z ${TMP}/20261017T000004Z-${sha_b}-capital.dump
EOF
)"
dump_pruned="$(printf '%s\n' "$dump_manifest" | dumps_to_prune 1)"
assert_eq "$dump_pruned" "${TMP}/20261017T000003Z-${sha_a}-capital.dump" "keep newest deployer dump only"

echo "pause and blocked sha"
result_should_pause migrate_failed || fail "migrate_failed should pause"
result_should_pause rollback_unhealthy || fail "rollback_unhealthy should pause"
result_should_pause rolled_back && fail "rolled_back should not pause"
result_should_pause build_failed && fail "build_failed should not pause"
result_should_pause ci_failed && fail "ci_failed should not pause"
status_py init "$(git rev-parse HEAD)"
FORCE=0
sha_is_blocked "$(git rev-parse HEAD)" && fail "fresh status should not be blocked"
KODAMA_STATUS_ERROR="boom" KODAMA_STATUS_RESULT="migrate_failed" status_py block "$(git rev-parse HEAD)"
sha_is_blocked "$(git rev-parse HEAD)" || fail "blocked sha should stick"
FORCE=1
sha_is_blocked "$(git rev-parse HEAD)" && fail "--force should ignore the block"
FORCE=0
sha_is_blocked "$(git rev-parse HEAD~1)" && fail "older sha is not the blocked one"

echo "default context guard"
if build_docker compose up >/dev/null 2>"${TMP}/guard.err"; then
  fail "build_docker compose should fail"
fi
grep -q "refusing" "${TMP}/guard.err" || fail "guard should say refusing"
# A mock docker would have been invoked if the guard called through.
mock_bin="${TMP}/bin"
mkdir -p "$mock_bin"
cat >"${mock_bin}/docker" <<'EOF'
#!/bin/bash
echo "$*" >> "${DOCKER_LOG:?}"
exit 0
EOF
chmod +x "${mock_bin}/docker"
DOCKER_LOG="${TMP}/docker.log"
: >"$DOCKER_LOG"
export DOCKER_LOG
PATH="${mock_bin}:${PATH}" build_docker compose up >/dev/null 2>&1 || true
if [[ -s "$DOCKER_LOG" ]]; then
  fail "refused default-context command still invoked docker: $(cat "$DOCKER_LOG")"
fi
# Dry-run prints the native build/save commands. The only place that runs
# them is build_docker, and it only accepts build and save.
if grep -n -- '--context default' \
  infrastructure/deploy/deploy.sh \
  infrastructure/deploy/lib.sh \
  infrastructure/deploy/poll.sh \
  infrastructure/deploy/install.sh \
  infrastructure/deploy/rollback.sh \
  | grep -v -E 'command docker --context default "\$sub"|docker --context default build|docker --context default save'; then
  fail "unexpected default-context docker invocation"
fi
if grep -n 'default compose' \
  infrastructure/deploy/deploy.sh \
  infrastructure/deploy/lib.sh \
  infrastructure/deploy/poll.sh \
  infrastructure/deploy/install.sh \
  infrastructure/deploy/rollback.sh \
  infrastructure/deploy/status.py \
  infrastructure/deploy/apps.conf; then
  fail "default context must not be used with compose"
fi

echo "ci decision"
export KODAMA_CI_WAIT_SECONDS=1200
decision="$(ci_decision_from_json 1000 0 <<'EOF'
{"check_runs":[{"name":"ci","status":"completed","conclusion":"success","started_at":"2026-10-17T00:00:00Z"}]}
EOF
)"
assert_eq "$(printf '%s' "$decision" | head -n 1)" "success" "ci success"
decision="$(ci_decision_from_json 1000 0 <<'EOF'
{"check_runs":[{"name":"verify","status":"completed","conclusion":"success","started_at":"2026-10-17T00:00:00Z"}]}
EOF
)"
assert_eq "$(printf '%s' "$decision" | head -n 1)" "pending" "missing ci is pending"
decision="$(ci_decision_from_json 5000 1000 <<'EOF'
{"check_runs":[]}
EOF
)"
assert_eq "$(printf '%s' "$decision" | head -n 1)" "failed" "wait expired"
decision="$(ci_decision_from_json 1000 0 <<'EOF'
{"check_runs":[{"name":"ci","status":"completed","conclusion":"failure","started_at":"2026-10-17T00:00:02Z"},{"name":"ci","status":"completed","conclusion":"success","started_at":"2026-10-17T00:00:01Z"}]}
EOF
)"
assert_eq "$(printf '%s' "$decision" | head -n 1)" "failed" "latest ci run wins"

echo "webhook header is not logged"
webhook_header_valid "Authorization: Bearer super-secret" || fail "valid header"
webhook_header_valid "Not a header" && fail "invalid header"
export DEPLOY_WEBHOOK_URL="https://example.invalid/hook"
export DEPLOY_WEBHOOK_HEADER="Authorization: Bearer super-secret"
printf '%s\n' '{"result":"success"}' >"$KODAMA_STATUS"
cat >"${mock_bin}/curl" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" >> "${CURL_LOG:?}"
echo 204
exit 0
EOF
chmod +x "${mock_bin}/curl"
export CURL_LOG="${TMP}/curl.log"
: >"$CURL_LOG"
stderr="$(PATH="${mock_bin}:${PATH}" post_webhook 2>&1 >/dev/null || true)"
if [[ "$stderr" == *super-secret* ]]; then
  fail "webhook stderr contained the header secret"
fi
grep -q "Authorization: Bearer super-secret" "$CURL_LOG" || fail "curl was not given the header"
unset DEPLOY_WEBHOOK_URL DEPLOY_WEBHOOK_HEADER

echo "workflow aggregator is named ci"
python3 - <<'PY'
from pathlib import Path
text = Path(".github/workflows/ci.yml").read_text()
marker = "\n  ci:\n"
if marker not in text:
    raise SystemExit("missing ci job")
section = text.split(marker, 1)[1]
head = section.split("\n    steps:", 1)[0]
if "name: ci" not in head or "needs:" not in head or "verify" not in head:
    raise SystemExit("ci job must be named ci and need verify")
PY

echo "dry-run does not invoke docker"
status_py init "$(git rev-parse HEAD~5)"
for unit in monitoring kodamalabs careers attention sentinel cronjobs cloudflared; do
  status_py set-app-success "$unit" "$(git rev-parse HEAD)"
done
export KODAMA_GITHUB_CHECK_FIXTURE="${TMP}/checks.json"
cat >"$KODAMA_GITHUB_CHECK_FIXTURE" <<'EOF'
{"check_runs":[{"name":"ci","status":"completed","conclusion":"success","started_at":"2026-10-17T00:00:00Z"}]}
EOF
: >"$DOCKER_LOG"
dry="$(PATH="${mock_bin}:${PATH}" bash infrastructure/deploy/deploy.sh --dry-run --sha HEAD)"
if [[ -s "$DOCKER_LOG" ]]; then
  fail "dry-run invoked docker: $(cat "$DOCKER_LOG")"
fi
if [[ -s "$CURL_LOG" ]]; then
  : >"$CURL_LOG"
fi
printf '%s\n' "$dry" | grep -q "BUILD capital" || fail "dry-run did not select capital: ${dry}"
printf '%s\n' "$dry" | grep -q "docker --context default build" || fail "dry-run missing native build"
printf '%s\n' "$dry" | grep -q "docker --context desktop-linux" || fail "dry-run missing desktop-linux"
printf '%s\n' "$dry" | grep -q -- "--no-build" || fail "dry-run missing --no-build"
printf '%s\n' "$dry" | grep -q "api/health" || fail "dry-run missing health smoke"
printf '%s\n' "$dry" | grep -q "ci: success" || fail "dry-run missing ci gate"
if printf '%s\n' "$dry" | grep -q "default compose"; then
  fail "dry-run printed a default-context compose command"
fi
printf '%s\n' "$dry" >"${TMP}/dry-run.txt"
if [[ -n "${KODAMA_DRY_RUN_OUT:-}" ]]; then
  printf '%s\n' "$dry" >"$KODAMA_DRY_RUN_OUT"
fi

echo "install does not enable the timer"
cat >"${mock_bin}/loginctl" <<'EOF'
#!/bin/bash
echo "Linger=yes"
EOF
cat >"${mock_bin}/systemctl" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${SYSTEMCTL_LOG:?}"
exit 0
EOF
chmod +x "${mock_bin}/loginctl" "${mock_bin}/systemctl"
export SYSTEMCTL_LOG="${TMP}/systemctl.log"
: >"$SYSTEMCTL_LOG"
install_home="${TMP}/install-home"
mkdir -p "$install_home"
PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh
if grep -q "enable" "$SYSTEMCTL_LOG"; then
  fail "install enabled the timer: $(cat "$SYSTEMCTL_LOG")"
fi
grep -q "daemon-reload" "$SYSTEMCTL_LOG" || fail "install did not reload systemd"
: >"$SYSTEMCTL_LOG"
PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --enable
grep -q "enable --now kodama-deploy.timer" "$SYSTEMCTL_LOG" || fail "install --enable did not enable the timer: $(cat "$SYSTEMCTL_LOG")"

echo "deploy.test.sh ok"
echo "DRY_RUN_SAVED ${TMP}/dry-run.txt"
