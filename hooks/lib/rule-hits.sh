#!/usr/bin/env bash
# rule-hits.sh — append-only JSONL log for §13.1 self-audit data.

# rule_hits_append HOOK EVENT EXTRA_JSON
#   HOOK  — hook name (banned-vocab, ship-baseline, ...)
#   EVENT — pass | deny | bypass-env | bypass-escape-hatch | warn | error
#   EXTRA — JSON value (object | null | string). "null" if none.
rule_hits_append() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0

  local hook="${1:-unknown}"
  local event="${2:-unknown}"
  local extra="${3:-null}"

  local log_dir="$HOME/.claude/logs"
  local log_file="$log_dir/claudemd.jsonl"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  jq -cn \
    --arg ts "$ts" \
    --arg hook "$hook" \
    --arg event "$event" \
    --argjson extra "$extra" \
    '{ts: $ts, hook: $hook, event: $event, extra: $extra}' \
    2>/dev/null >> "$log_file" || return 0
}
