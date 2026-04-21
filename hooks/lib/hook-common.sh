#!/usr/bin/env bash
# hook-common.sh — fail-open library for claudemd hooks.
# All functions return safely; callers can exit 0 silently on non-zero return.

# hook_kill_switch NAME
#   returns 0 to proceed, 1 to short-circuit.
hook_kill_switch() {
  [[ "${DISABLE_CLAUDEMD_HOOKS:-0}" == "1" ]] && return 1
  local var="DISABLE_${1}_HOOK"
  [[ "${!var:-0}" == "1" ]] && return 1
  return 0
}

# hook_require_jq — returns 0 if jq is on PATH, 1 otherwise.
hook_require_jq() {
  command -v jq >/dev/null 2>&1
}

# hook_read_event — reads stdin JSON to stdout; empty stdout on error.
hook_read_event() {
  local input
  input=$(cat 2>/dev/null) || return 1
  [[ -n "$input" ]] || return 1
  printf '%s' "$input"
}

# hook_deny HOOK_NAME REASON — emits PreToolUse deny JSON, exits 0.
hook_deny() {
  local _hook="$1" reason="$2"
  jq -cn --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }' 2>/dev/null
  exit 0
}

# hook_record HOOK EVENT [EXTRA_JSON]
#   Appends to rule-hits jsonl via rule-hits.sh (sourced lazily).
hook_record() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=/dev/null
  source "$lib_dir/rule-hits.sh" 2>/dev/null || return 0
  rule_hits_append "$@"
}
