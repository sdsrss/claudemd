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

# hook_is_readonly_bash CMD
#   Returns 0 if CMD is "definitely read-only and side-effect free" — caller
#   may safely exit 0 without running heavier hook logic. Returns 1 (proceed)
#   in all uncertain cases. Conservative by design: false negatives are free
#   (just do more work), false positives could skip a real safety check.
#
#   Used by R-N5 fast-path (v0.8.3, opt-in BASH_READONLY_FAST_PATH=1) in the
#   four PreToolUse:Bash hooks. When the flag is OFF, callers do not invoke
#   this function and behavior is byte-identical to v0.8.2.
#
#   Reject criteria — any of these → return 1:
#     * Shell metacharacters introducing a second command, redirect, or
#       substitution: ; | & > < ` $( ${ \n
#     * First token not in the safe-reader whitelist
#     * For `git`: subcommand not in the read-only subcommand whitelist
#       (excludes branch / tag / config because those have destructive
#       sub-flags like -d/-D/-m/-c)
hook_is_readonly_bash() {
  local cmd="$1"
  case "$cmd" in
    *';'*|*'|'*|*'&'*|*'>'*|*'<'*|*'`'*) return 1 ;;
    *'$('*|*'${'*) return 1 ;;
    *$'\n'*) return 1 ;;
  esac
  # Trim leading whitespace, take first token via parameter expansion (no fork).
  local trimmed="${cmd#"${cmd%%[![:space:]]*}"}"
  local first="${trimmed%%[[:space:]]*}"
  case "$first" in
    ls|cat|head|tail|wc|stat|date|pwd|echo|printf|sleep|file|which|type|env|basename|dirname|realpath|true|false)
      return 0 ;;
    git)
      local rest="${trimmed#git}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      local sub="${rest%%[[:space:]]*}"
      case "$sub" in
        log|status|diff|show|rev-parse|rev-list|describe|blame|reflog|ls-files|ls-tree|cat-file|remote)
          return 0 ;;
      esac
      ;;
  esac
  return 1
}
