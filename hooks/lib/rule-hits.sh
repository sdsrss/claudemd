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

  # Size-capped rotation. Over CLAUDEMD_LOG_MAX_MB (default 5) → rotate to
  # .1, pushing any existing .1 to .2 (drop .2). Two rotations retained =
  # one headroom between rotate and next overflow, bounded growth at
  # ~3× max_mb on disk. `/claudemd-audit` currently reads only the primary
  # file, so rotations beyond .1 are effectively archived (read-only).
  # `stat -c` is GNU, `-f` is BSD — try both, default to 0 if neither works
  # (fail-safe: no rotation better than wrong rotation on an unknown stat).
  local max_mb="${CLAUDEMD_LOG_MAX_MB:-5}"
  local max_bytes=$((max_mb * 1024 * 1024))
  if [[ -f "$log_file" ]]; then
    local size
    size=$(stat -c %s "$log_file" 2>/dev/null || stat -f %z "$log_file" 2>/dev/null || echo 0)
    if (( size > max_bytes )); then
      [[ -f "$log_file.1" ]] && mv -f "$log_file.1" "$log_file.2" 2>/dev/null
      mv -f "$log_file" "$log_file.1" 2>/dev/null
    fi
  fi

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
