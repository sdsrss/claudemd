#!/usr/bin/env bash
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/hook-common.sh"
FAIL=0

run_case() {
  local name="$1" expected="$2" actual
  actual=$(eval "$3" 2>&1)
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# hook_kill_switch
run_case "kill_switch plugin-wide" "BLOCKED" \
  "DISABLE_CLAUDEMD_HOOKS=1 bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

run_case "kill_switch per-hook" "BLOCKED" \
  "DISABLE_BANNED_VOCAB_HOOK=1 bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

run_case "kill_switch not set" "OPEN" \
  "unset DISABLE_CLAUDEMD_HOOKS DISABLE_BANNED_VOCAB_HOOK; bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

# hook_require_jq
run_case "require_jq present" "YES" \
  "bash -c 'source $LIB; hook_require_jq && echo YES || echo NO'"

# hook_read_event
run_case "read_event stdin" '{"foo":1}' \
  "echo '{\"foo\":1}' | bash -c 'source $LIB; hook_read_event'"

run_case "read_event empty" "" \
  "echo '' | bash -c 'source $LIB; hook_read_event' 2>/dev/null"

# hook_deny
run_case "deny emits json" "deny" \
  "bash -c 'source $LIB; hook_deny test-hook \"reason text\"' | jq -r .hookSpecificOutput.permissionDecision"

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
