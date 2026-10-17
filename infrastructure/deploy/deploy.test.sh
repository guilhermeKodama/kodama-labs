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

got="$(effects apps/docs/content/docs/infrastructure/deploy.mdx packages/eslint-config/index.js packages/ui/src/button.tsx infrastructure/deploy/ssh-entry.sh)"
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
  infrastructure/deploy/ssh-entry.sh \
  infrastructure/deploy/install.sh \
  infrastructure/deploy/rollback.sh \
  | grep -v -E 'command docker --context default "\$sub"|docker --context default build|docker --context default save'; then
  fail "unexpected default-context docker invocation"
fi
if grep -n 'default compose' \
  infrastructure/deploy/deploy.sh \
  infrastructure/deploy/lib.sh \
  infrastructure/deploy/ssh-entry.sh \
  infrastructure/deploy/install.sh \
  infrastructure/deploy/rollback.sh \
  infrastructure/deploy/status.py \
  infrastructure/deploy/apps.conf; then
  fail "default context must not be used with compose"
fi

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
printf '%s\n' "$dry" | grep -q "cloudflareaccess.com" || fail "dry-run missing capital public smoke"
printf '%s\n' "$dry" | grep -q "tools/list" || fail "dry-run missing MCP smoke"
printf '%s\n' "$dry" | grep -q "KODAMA_OVERALL dry-run" || fail "dry-run missing summary marker"
if printf '%s\n' "$dry" | grep -q "will check again"; then
  fail "dry-run still polls CI"
fi
if printf '%s\n' "$dry" | grep -q "default compose"; then
  fail "dry-run printed a default-context compose command"
fi
if grep -n 'echo.*MCP_API_KEY' infrastructure/deploy/deploy.sh; then
  fail "deploy.sh logs MCP_API_KEY"
fi
printf '%s\n' "$dry" >"${TMP}/dry-run.txt"
if [[ -n "${KODAMA_DRY_RUN_OUT:-}" ]]; then
  printf '%s\n' "$dry" >"$KODAMA_DRY_RUN_OUT"
fi

echo "install seed sha"
install_home="${TMP}/install-home"
mkdir -p "$install_home"
rm -f "$KODAMA_STATUS"
set +e
noseed_out="$(PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh 2>&1)"
noseed_rc=$?
set -e
[[ "$noseed_rc" -ne 0 ]] || fail "install without --seed-sha should fail when status is missing"
printf '%s\n' "$noseed_out" | grep -q -- "--seed-sha" || fail "missing seed hint: ${noseed_out}"
[[ ! -f "$KODAMA_STATUS" ]] || fail "refused install wrote status.json"
if [[ -f "${install_home}/.ssh/authorized_keys" ]]; then
  fail "install generated authorized_keys without --authorize-key"
fi

good="$(git rev-parse origin/main)"
PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --seed-sha "$good" >/dev/null
assert_eq "$(status_py get apps.capital.sha)" "$good" "seed-sha writes origin/main"
assert_eq "$(status_py get apps.careers.sha)" "$good" "seed-sha covers every unit"
assert_eq "$(status_py get tooling_drift)" "false" "fresh status has no drift"

kept="$(status_py get apps.capital.sha)"
seed_out="$(PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --seed-sha "$(git rev-parse HEAD)" 2>&1)"
assert_eq "$(status_py get apps.capital.sha)" "$kept" "existing status must ignore --seed-sha"
printf '%s\n' "$seed_out" | grep -q "ignored" || fail "missing ignored warning: ${seed_out}"

rm -f "$KODAMA_STATUS"
orphan="$(git -c user.email=deploy-test@example.com -c user.name=deploy-test \
  commit-tree "$(git rev-parse 'HEAD^{tree}')" -m 'deploy-test seed not on main')"
set +e
bad_out="$(PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --seed-sha "$orphan" 2>&1)"
bad_rc=$?
set -e
[[ "$bad_rc" -ne 0 ]] || fail "seed sha off origin/main should fail"
printf '%s\n' "$bad_out" | grep -q "not an ancestor of origin/main" || fail "missing ancestor error: ${bad_out}"
[[ ! -f "$KODAMA_STATUS" ]] || fail "rejected seed wrote status.json"

echo "authorized_keys"
status_py init "$good"
ssh-keygen -t ed25519 -f "${TMP}/deploy_key" -N "" -C github-actions-deploy >/dev/null
mkdir -p "${install_home}/.ssh"
printf '%s\n' "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPersonalKeyForTheTestOnly personal" > "${install_home}/.ssh/authorized_keys"
chmod 600 "${install_home}/.ssh/authorized_keys"
PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --authorize-key "${TMP}/deploy_key.pub" >/dev/null
auth_file="${install_home}/.ssh/authorized_keys"
grep -q "personal" "$auth_file" || fail "personal key was removed"
marker_count="$(grep -c kodama-ci-deploy "$auth_file")"
assert_eq "$marker_count" "1" "one forced-command line"
grep -q 'restrict,command=' "$auth_file" || fail "missing restrict,command"
grep -q "${install_home}/.local/lib/kodama-deploy/ssh-entry.sh" "$auth_file" || fail "forced command path is wrong"
if grep -q "BEGIN OPENSSH PRIVATE" "$auth_file"; then
  fail "authorized_keys contains a private key"
fi
compgen -G "${auth_file}.bak.*" >/dev/null || fail "authorized_keys was not backed up"
PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --authorize-key "${TMP}/deploy_key.pub" >/dev/null
marker_count="$(grep -c kodama-ci-deploy "$auth_file")"
assert_eq "$marker_count" "1" "second install stays idempotent"
grep -q "personal" "$auth_file" || fail "second install dropped the personal key"
printf '%s\n' "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC0 not-ed25519" > "${TMP}/bad.pub"
set +e
bad_key="$(PATH="${mock_bin}:${PATH}" HOME="$install_home" KODAMA_ALLOW_OTHER_REPO=1 \
  bash infrastructure/deploy/install.sh --authorize-key "${TMP}/bad.pub" 2>&1)"
bad_key_rc=$?
set -e
[[ "$bad_key_rc" -ne 0 ]] || fail "rsa key should be rejected"
printf '%s\n' "$bad_key" | grep -q "ssh-ed25519" || fail "missing key type error: ${bad_key}"
assert_eq "$(grep -c kodama-ci-deploy "$auth_file")" "1" "rejected key left the existing line"

echo "entry grammar"
entry="${TMP}/entry"
mkdir -p "$entry"
cp infrastructure/deploy/ssh-entry.sh infrastructure/deploy/lib.sh infrastructure/deploy/apps.conf infrastructure/deploy/status.py "$entry/"
cat >"${entry}/deploy.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" > "${STAMP:?}"
exit 0
EOF
cat >"${entry}/rollback.sh" <<'EOF'
#!/bin/bash
printf '%s\n' "$@" > "${STAMP:?}"
exit 0
EOF
chmod +x "${entry}/ssh-entry.sh" "${entry}/deploy.sh" "${entry}/rollback.sh"
stamp="${TMP}/entry-stamp"
fixture="${TMP}/entry-repo"
git init -b main "$fixture" >/dev/null
git -C "$fixture" config user.email "deploy-test@example.com"
git -C "$fixture" config user.name "deploy-test"
echo fixture >"${fixture}/README"
git -C "$fixture" add README
git -C "$fixture" commit -m init >/dev/null
bare="${TMP}/entry-bare"
git -c init.defaultBranch=main init --bare "$bare" >/dev/null
git -C "$fixture" remote add origin "$bare"
git -C "$fixture" push -q origin main
good_sha="$(git -C "$fixture" rev-parse HEAD)"
orphan_sha="$(git -C "$fixture" commit-tree "$(git -C "$fixture" rev-parse 'HEAD^{tree}')" -m 'not on main')"

run_entry() {
  local command="$1"
  rm -f "$stamp"
  set +e
  entry_out="$(SSH_ORIGINAL_COMMAND="$command" STAMP="$stamp" KODAMA_REPO="$fixture" \
    bash "${entry}/ssh-entry.sh" 2>&1)"
  entry_rc=$?
  set -e
}

expect_reject() {
  local command="$1" label="$2"
  run_entry "$command"
  [[ "$entry_rc" -eq 2 ]] || fail "${label} exit ${entry_rc}: ${entry_out}"
  [[ ! -f "$stamp" ]] || fail "${label} reached deploy.sh: $(cat "$stamp")"
  printf '%s\n' "$entry_out" | grep -qx "rejected" || fail "${label} did not say rejected: ${entry_out}"
}

expect_reject "deploy abc; rm -rf ~" "injection"
expect_reject 'deploy $(rm -rf ~)' "substitution"
expect_reject "deploy ${good_sha}; rm -rf ~" "trailing command"
expect_reject "deploy ${good_sha} --force" "force flag"
expect_reject "deploy ${good_sha^^}" "uppercase sha"
expect_reject "deploy ${good_sha:0:39}" "short sha"
expect_reject "rollback capital; reboot" "rollback injection"
expect_reject "rollback postgres" "rollback database"
expect_reject "rollback capital extra" "rollback extra"
expect_reject "status --help" "status extra"
expect_reject "" "empty"
expect_reject "$(printf 'deploy %s\nrm -rf ~' "$good_sha")" "newline"

run_entry "deploy ${orphan_sha}"
[[ "$entry_rc" -ne 0 ]] || fail "non-main sha was accepted"
[[ ! -f "$stamp" ]] || fail "non-main sha executed deploy.sh"
printf '%s\n' "$entry_out" | grep -q "not reachable from origin/main" || fail "missing ancestry error: ${entry_out}"

run_entry "deploy ${good_sha}"
[[ "$entry_rc" -eq 0 ]] || fail "main sha rejected: ${entry_out}"
grep -q -- "--sha" "$stamp" || fail "deploy.sh was not exec'd with --sha: $(cat "$stamp")"
grep -q "$good_sha" "$stamp" || fail "stamp missing sha: $(cat "$stamp")"
if grep -q "rm -rf" "$stamp"; then
  fail "stamp contains the original command"
fi

run_entry "rollback capital"
[[ "$entry_rc" -eq 0 ]] || fail "rollback capital rejected: ${entry_out}"
assert_eq "$(cat "$stamp")" "capital" "rollback argv"

status_py init "$good_sha"
run_entry "status"
[[ "$entry_rc" -eq 0 ]] || fail "status rejected: ${entry_out}"
printf '%s\n' "$entry_out" | grep -q '"tooling_drift"' || fail "status did not print status.json"

echo "superseded, paused, drift"
fx="${TMP}/fx-repo"
git init -b main "$fx" >/dev/null
git -C "$fx" config user.email "deploy-test@example.com"
git -C "$fx" config user.name "deploy-test"
mkdir -p "${fx}/infrastructure/deploy"
cp infrastructure/deploy/ssh-entry.sh infrastructure/deploy/deploy.sh infrastructure/deploy/rollback.sh \
  infrastructure/deploy/lib.sh infrastructure/deploy/apps.conf infrastructure/deploy/status.py \
  "${fx}/infrastructure/deploy/"
git -C "$fx" add infrastructure/deploy
git -C "$fx" commit -m base >/dev/null
fx_bare="${TMP}/fx-bare"
git -c init.defaultBranch=main init --bare "$fx_bare" >/dev/null
git -C "$fx" remote add origin "$fx_bare"
git -C "$fx" push -q origin main
old_sha="$(git -C "$fx" rev-parse HEAD)"
echo newer >"${fx}/README"
git -C "$fx" add README
git -C "$fx" commit -m newer >/dev/null
git -C "$fx" push -q origin main
new_sha="$(git -C "$fx" rev-parse HEAD)"

stage="${TMP}/installed"
mkdir -p "$stage"
cp infrastructure/deploy/ssh-entry.sh infrastructure/deploy/deploy.sh infrastructure/deploy/rollback.sh \
  infrastructure/deploy/lib.sh infrastructure/deploy/apps.conf infrastructure/deploy/status.py \
  "$stage/"
chmod +x "${stage}/deploy.sh" "${stage}/ssh-entry.sh" "${stage}/rollback.sh" "${stage}/status.py"

: >"$DOCKER_LOG"
status_py init "$new_sha"
set +e
super_out="$(PATH="${mock_bin}:${PATH}" KODAMA_REPO="$fx" bash "${stage}/deploy.sh" --sha "$old_sha" 2>&1)"
super_rc=$?
set -e
[[ "$super_rc" -eq 0 ]] || fail "superseded deploy failed: ${super_out}"
printf '%s\n' "$super_out" | grep -q "superseded by ${new_sha}" || fail "missing superseded line: ${super_out}"
printf '%s\n' "$super_out" | grep -q "KODAMA_OVERALL superseded" || fail "missing superseded overall"
assert_eq "$(git -C "$fx" rev-parse HEAD)" "$new_sha" "superseded moved HEAD"
if [[ -s "$DOCKER_LOG" ]]; then
  fail "superseded deploy invoked docker: $(cat "$DOCKER_LOG")"
fi

: >"$DOCKER_LOG"
status_py init "$new_sha"
printf 'manual: holding\n' >"$KODAMA_PAUSE_FILE"
set +e
pause_out="$(PATH="${mock_bin}:${PATH}" KODAMA_REPO="$fx" bash "${stage}/deploy.sh" --sha "$new_sha" 2>&1)"
pause_rc=$?
set -e
[[ "$pause_rc" -ne 0 ]] || fail "PAUSED deploy should fail"
printf '%s\n' "$pause_out" | grep -q "PAUSED is set" || fail "missing PAUSED refusal: ${pause_out}"
printf '%s\n' "$pause_out" | grep -q "KODAMA_OVERALL paused" || fail "missing paused overall"
if [[ -s "$DOCKER_LOG" ]]; then
  fail "paused deploy invoked docker: $(cat "$DOCKER_LOG")"
fi
rm -f "$KODAMA_PAUSE_FILE"

echo '# marker' >>"${stage}/apps.conf"
status_py init "$new_sha"
: >"$DOCKER_LOG"
set +e
drift_out="$(PATH="${mock_bin}:${PATH}" KODAMA_REPO="$fx" bash "${stage}/deploy.sh" --sha "$new_sha" 2>&1)"
drift_rc=$?
set -e
[[ "$drift_rc" -eq 0 ]] || fail "drift deploy failed: ${drift_out}"
printf '%s\n' "$drift_out" | grep -q "WARNING: tooling drift:" || fail "missing drift warning: ${drift_out}"
printf '%s\n' "$drift_out" | grep -q "Not auto-installing" || fail "drift warning must say it will not install"
assert_eq "$(status_py get tooling_drift)" "true" "tooling_drift should be true"
grep -q "# marker" "${stage}/apps.conf" || fail "drift replaced the installed apps.conf"
if git -C "$fx" show "${new_sha}:infrastructure/deploy/apps.conf" | grep -q "# marker"; then
  fail "fixture commit was rewritten"
fi
if [[ -s "$DOCKER_LOG" ]]; then
  fail "drift check invoked docker: $(cat "$DOCKER_LOG")"
fi

echo "step summary"
summary_log="${TMP}/summary.log"
cat >"$summary_log" <<EOF
WARNING: tooling drift: infrastructure/deploy/apps.conf at ${new_sha} differs from the installed copy. Re-run install.sh on kodama-ai. Not auto-installing.
KODAMA_OVERALL success
KODAMA_SUMMARY_BEGIN
KODAMA_APP monitoring success ${new_sha}
KODAMA_APP capital migrate_failed ${old_sha}
KODAMA_SUMMARY_END
EOF
summary_out="${TMP}/summary.md"
DEPLOY_LOG="$summary_log" GITHUB_STEP_SUMMARY="$summary_out" python3 infrastructure/deploy/render-summary.py
grep -q "Overall: \`success\`" "$summary_out" || fail "summary missing overall: $(cat "$summary_out")"
grep -q "| capital | migrate_failed | \`${old_sha}\` |" "$summary_out" || fail "summary missing capital row"
grep -q "Tooling drift" "$summary_out" || fail "summary missing drift note"
empty_out="${TMP}/empty-summary.md"
DEPLOY_LOG="${TMP}/missing-log" GITHUB_STEP_SUMMARY="$empty_out" python3 infrastructure/deploy/render-summary.py
grep -q "No per-app summary was printed." "$empty_out" || fail "empty summary: $(cat "$empty_out")"

echo "workflows stay push-based"
if grep -n 'pull_request_target\|StrictHostKeyChecking=no' .github/workflows/ci.yml .github/workflows/deploy.yml; then
  fail "workflow uses a forbidden trigger or host-key setting"
fi
if grep -n 'uses: .*@v' .github/workflows/ci.yml .github/workflows/deploy.yml; then
  fail "workflow action is not pinned by commit SHA"
fi

echo "deploy.test.sh ok"
echo "DRY_RUN_SAVED ${TMP}/dry-run.txt"
