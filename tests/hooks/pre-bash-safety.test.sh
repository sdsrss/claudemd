#!/usr/bin/env bash
# pre-bash-safety hook tests — corpus-driven.
# Cases live in tests/fixtures/bash-safety/corpus.tsv (label / note / cmd / env).
# This runner loads the corpus and drives the hook for each row, asserting
# allow vs deny by label. The corpus is the single source of truth for
# regression cases; new cases go in the .tsv, not here.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/pre-bash-safety-check.sh"
CORPUS="$HERE/../fixtures/bash-safety/corpus.tsv"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
# Hermeticity (per feedback_hook_env_test_hermeticity): BASH_SAFETY_INDIRECT_CALL
# is user-tunable via ~/.claude/settings.json env block; if set there it inherits
# into npm test and silently flips default-ON deny cases to pass.
unset BASH_SAFETY_INDIRECT_CALL

if [[ ! -f "$CORPUS" ]]; then
  echo "FAIL: corpus missing at $CORPUS"; exit 1
fi

PASS=0; FAIL=0

run_case() {
  local label="$1" note="$2" cmd="$3" env="$4"
  # __NL__ marker → LF (heredoc cases). Other backslash sequences pass through.
  cmd="${cmd//__NL__/$'\n'}"
  local fix out decision
  fix=$(mktemp)
  jq -cn --arg c "$cmd" '{session_id:"t",tool_name:"Bash",tool_input:{command:$c}}' > "$fix"
  if [[ -n "$env" ]]; then
    out=$(env "$env" bash "$HOOK" < "$fix" 2>&1)
  else
    out=$(bash "$HOOK" < "$fix" 2>&1)
  fi
  rm -f "$fix"

  case "$label" in
    pass)
      if [[ -z "$out" ]]; then
        PASS=$((PASS + 1))
      else
        echo "FAIL [pass]: $note (got: $out)"
        FAIL=$((FAIL + 1))
      fi
      ;;
    deny)
      decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
      if [[ "$decision" == "deny" ]]; then
        PASS=$((PASS + 1))
      else
        echo "FAIL [deny]: $note (expected deny, got: $out)"
        FAIL=$((FAIL + 1))
      fi
      ;;
    *)
      echo "FAIL [bad-label]: $note (label=$label)"
      FAIL=$((FAIL + 1))
      ;;
  esac
}

# Drive the corpus.
while IFS=$'\t' read -r label note cmd env || [[ -n "$label" ]]; do
  # Skip blanks and comment lines (corpus comments start with `#`).
  [[ -z "$label" ]] && continue
  [[ "$label" == \#* ]] && continue
  run_case "$label" "$note" "$cmd" "${env:-}"
done < "$CORPUS"

# Inline edge case: malformed-JSON stdin must fail-open silently. Not a
# corpus case — corpus is "given valid event, hook produces correct
# allow/deny"; this exercises the parser robustness path.
TMP_FIX=$(mktemp)
echo 'not json' > "$TMP_FIX"
out=$(bash "$HOOK" < "$TMP_FIX" 2>&1)
rm -f "$TMP_FIX"
if [[ -z "$out" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: malformed JSON stdin should fail-open (got: $out)"
  FAIL=$((FAIL + 1))
fi

# === v0.9.30: spec §8 NPX lockfile/local resolution (cwd-aware) ===
# Filesystem-state cases don't fit the corpus model (TSV is shape-only).
# Inline cases below set up real lockfiles + node_modules dirs and pass cwd
# in the event payload, exercising npx_pkg_locally_resolved.

run_cwd_case() {
  local label="$1" note="$2" cmd="$3" cwd="$4"
  local fix; fix=$(mktemp)
  jq -cn --arg c "$cmd" --arg w "$cwd" \
    '{session_id:"t",tool_name:"Bash",cwd:$w,tool_input:{command:$c}}' > "$fix"
  local out; out=$(bash "$HOOK" < "$fix" 2>&1)
  rm -f "$fix"
  case "$label" in
    pass)
      if [[ -z "$out" ]]; then PASS=$((PASS + 1))
      else echo "FAIL [pass-cwd]: $note (got: $out)"; FAIL=$((FAIL + 1)); fi ;;
    deny)
      local decision; decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
      if [[ "$decision" == "deny" ]]; then PASS=$((PASS + 1))
      else echo "FAIL [deny-cwd]: $note (expected deny, got: $out)"; FAIL=$((FAIL + 1)); fi ;;
  esac
}

SANDBOX=$(mktemp -d)
trap 'rm -rf "$TMP_HOME" "$SANDBOX"' EXIT

# Fixture 1: project with vitest in node_modules (local)
mkdir -p "$SANDBOX/with-local/node_modules/vitest"
echo '{}' > "$SANDBOX/with-local/node_modules/vitest/package.json"

# Fixture 2: project with package-lock.json mentioning vitest as installed dep
mkdir -p "$SANDBOX/with-npm-lock"
cat > "$SANDBOX/with-npm-lock/package-lock.json" <<'EOF'
{
  "name": "demo", "version": "1.0.0", "lockfileVersion": 3,
  "packages": {
    "": {"name": "demo", "version": "1.0.0", "dependencies": {"vitest": "^1.0.0"}},
    "node_modules/vitest": {"version": "1.6.0", "resolved": "https://registry.npmjs.org/vitest/-/vitest-1.6.0.tgz"}
  }
}
EOF

# Fixture 3: project with pnpm-lock.yaml mentioning vitest
mkdir -p "$SANDBOX/with-pnpm-lock"
cat > "$SANDBOX/with-pnpm-lock/pnpm-lock.yaml" <<'EOF'
lockfileVersion: '6.0'
packages:
  /vitest@1.6.0:
    resolution: {integrity: sha512-xxx}
EOF

# Fixture 4: project with yarn.lock mentioning vitest
mkdir -p "$SANDBOX/with-yarn-lock"
cat > "$SANDBOX/with-yarn-lock/yarn.lock" <<'EOF'
vitest@^1.6.0:
  version "1.6.0"
  resolved "https://registry.yarnpkg.com/vitest/-/vitest-1.6.0.tgz"
EOF

# Fixture 5: empty project (no lockfile, no node_modules)
mkdir -p "$SANDBOX/empty"

run_cwd_case pass "v0.9.30: npx vitest with local node_modules/vitest"   "npx vitest run tests/" "$SANDBOX/with-local"
run_cwd_case pass "v0.9.30: npx vitest with package-lock.json entry"     "npx vitest run"        "$SANDBOX/with-npm-lock"
run_cwd_case pass "v0.9.30: npx vitest with pnpm-lock.yaml entry"        "npx vitest"            "$SANDBOX/with-pnpm-lock"
run_cwd_case pass "v0.9.30: npx vitest with yarn.lock entry"             "npx vitest --watch"    "$SANDBOX/with-yarn-lock"
run_cwd_case deny "v0.9.30: npx vitest in empty cwd (no lockfile/local)" "npx vitest"            "$SANDBOX/empty"
run_cwd_case deny "v0.9.30: npx vitest with cwd field empty (fallback)"  "npx vitest"            ""

TOTAL=$((PASS + FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
