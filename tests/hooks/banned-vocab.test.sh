#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/banned-vocab-check.sh"
FIX="$HERE/../fixtures/events"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

FAIL=0

assert_pass() {
  local name="$1" fix="$2" extra="${3:-}"
  local out
  out=$(eval "$extra bash \"$HOOK\"" < "$fix" 2>&1)
  if [[ -z "$out" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected empty stdout, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

assert_deny() {
  local name="$1" fix="$2"
  local out decision
  out=$(bash "$HOOK" < "$fix" 2>&1)
  decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
  if [[ "$decision" == "deny" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected deny, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

assert_pass "1: non-Bash Edit → pass" "$FIX/edit-tool.json"
assert_pass "2: git log → pass" "$FIX/bash-git-log.json"
assert_pass "3: clean commit → pass" "$FIX/bash-commit-clean.json"
assert_deny "4: EN significantly → deny" "$FIX/bash-commit-banned-en.json"
assert_deny "5: 中文 显著提升 → deny" "$FIX/bash-commit-banned-zh.json"
assert_pass "6: [allow-banned-vocab] escape → pass" "$FIX/bash-commit-with-escape.json"
assert_pass "7: DISABLE_CLAUDEMD_HOOKS=1 → pass" \
  "$FIX/bash-commit-banned-en.json" "DISABLE_CLAUDEMD_HOOKS=1"
assert_pass "8: DISABLE_BANNED_VOCAB_HOOK=1 → pass" \
  "$FIX/bash-commit-banned-en.json" "DISABLE_BANNED_VOCAB_HOOK=1"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'it should work now'"},"cwd":"/tmp"}
EOF
assert_deny "9: should work hedge → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'cache layer is 70% faster'"},"cwd":"/tmp"}
EOF
assert_deny "10: 70% faster baseline-less → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'cache: 380ms to 95ms latency'"},"cwd":"/tmp"}
EOF
assert_pass "11: baselined ratio → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
echo 'not json' > "$TMP_FIX"
assert_pass "12: malformed JSON stdin → fail-open pass" "$TMP_FIX"
rm -f "$TMP_FIX"

# --- baseline-context exemption (v0.1.8) ---

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'perf: rendering 240ms → 72ms (70% faster)'"},"cwd":"/tmp"}
EOF
assert_pass "13: ratio + → baseline → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'fix: it should work → now verified'"},"cwd":"/tmp"}
EOF
assert_deny "14: hedge + → does NOT escape deny (ratio-only exemption)" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m '缓存: 380ms → 95ms (70% 更快)'"},"cwd":"/tmp"}
EOF
assert_pass "15: 中文 ratio + → baseline → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

if (( FAIL > 0 )); then
  echo "Tests: $((15 - FAIL))/15 passed"
  exit 1
fi
echo "Tests: 15/15 passed"
