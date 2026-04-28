#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/pre-bash-safety-check.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

FAIL=0

assert_pass() {
  local name="$1" cmd="$2" extra="${3:-}"
  local fix out
  fix=$(mktemp)
  jq -cn --arg c "$cmd" '{session_id:"t",tool_name:"Bash",tool_input:{command:$c}}' > "$fix"
  out=$(eval "$extra bash \"$HOOK\"" < "$fix" 2>&1)
  rm -f "$fix"
  if [[ -z "$out" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected empty stdout, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

assert_deny() {
  local name="$1" cmd="$2"
  local fix out decision
  fix=$(mktemp)
  jq -cn --arg c "$cmd" '{session_id:"t",tool_name:"Bash",tool_input:{command:$c}}' > "$fix"
  out=$(bash "$HOOK" < "$fix" 2>&1)
  rm -f "$fix"
  decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
  if [[ "$decision" == "deny" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected deny, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

# --- non-trigger paths ---
assert_pass "1: non-Bash Edit tool → pass" "" \
  "echo '{\"session_id\":\"t\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"/tmp/x\"}}' |"
assert_pass "2: git status → pass"             "git status"
assert_pass "3: rm -rf /tmp/foo (literal path) → pass" "rm -rf /tmp/foo"
assert_pass "4: rm -f file.txt (no -r flag, no var) → pass" "rm -f file.txt"

# --- pattern 1: rm -rf with variable expansion ---
assert_deny "5: rm -rf \$WORK_DIR (bare) → deny"      'rm -rf $WORK_DIR'
assert_deny "6: rm -rf \"\$WORK_DIR\" (quoted) → deny" 'rm -rf "$WORK_DIR"'
assert_deny "7: rm -rf \${WORK_DIR} (braced) → deny"   'rm -rf ${WORK_DIR}'
assert_deny "8: rm -fr \$VAR (flag-order swap) → deny" 'rm -fr $VAR'
assert_deny "9: rm -rfv \$VAR (extra flag) → deny"     'rm -rfv $VAR'
assert_deny "10: rm -Rf \$VAR (uppercase) → deny"      'rm -Rf $VAR'

# --- pattern 1: whitelist + escape ---
assert_pass "11: rm -rf \$HOME/cache → pass (HOME whitelist)"   'rm -rf $HOME/cache'
assert_pass "12: rm -rf \$TMPDIR/x → pass (TMPDIR whitelist)"   'rm -rf $TMPDIR/x'
assert_pass "13: rm -rf \$PWD/build → pass (PWD whitelist)"     'rm -rf $PWD/build'
assert_pass "14: rm -rf \$VAR [allow-rm-rf-var] → pass (escape)" 'rm -rf $VAR [allow-rm-rf-var]'

# --- pattern 2: npx unpinned ---
assert_deny "15: npx prettier → deny (bare unpinned)"           "npx prettier"
assert_deny "16: npx @types/node → deny (scoped unpinned)"      "npx @types/node"
assert_deny "17: npx -p create-react-app foo → deny (-p unpinned)" "npx -p create-react-app foo"

# --- pattern 2: pinned + local + flags + escape ---
assert_pass "18: npx prettier@3.0.0 → pass (pinned)"            "npx prettier@3.0.0"
assert_pass "19: npx @types/node@20 → pass (scoped+pin)"        "npx @types/node@20"
assert_pass "20: npx pkg@latest → pass (latest tag)"            "npx pkg@latest"
assert_pass "21: npx ./local.tgz → pass (local path)"           "npx ./local.tgz"
assert_pass "22: npx /abs/path.tgz → pass (abs local path)"     "npx /abs/path.tgz"
assert_pass "23: npx --help → pass (flag only)"                 "npx --help"
assert_pass "24: npx -v → pass (short flag only)"               "npx -v"
assert_pass "25: npx prettier [allow-npx-unpinned] → pass"      "npx prettier [allow-npx-unpinned]"

# --- kill switches ---
assert_pass "26: DISABLE_PRE_BASH_SAFETY_HOOK=1 → pass" 'rm -rf $X' "DISABLE_PRE_BASH_SAFETY_HOOK=1"
assert_pass "27: DISABLE_CLAUDEMD_HOOKS=1 → pass"        'npx pkg'   "DISABLE_CLAUDEMD_HOOKS=1"

# --- malformed input fail-open ---
TMP_FIX=$(mktemp)
echo 'not json' > "$TMP_FIX"
out=$(bash "$HOOK" < "$TMP_FIX" 2>&1)
rm -f "$TMP_FIX"
if [[ -z "$out" ]]; then
  echo "PASS: 28 malformed JSON stdin → fail-open pass"
else
  echo "FAIL: 28 (got: $out)"
  FAIL=$((FAIL + 1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((28 - FAIL))/28 passed"
  exit 1
fi
echo "Tests: 28/28 passed"
