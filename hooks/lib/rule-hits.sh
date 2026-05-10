#!/usr/bin/env bash
# rule-hits.sh — append-only JSONL log for §13.1 self-audit data.

# rule_hits_append HOOK EVENT EXTRA_JSON [SPEC_SECTION] [SESSION_ID]
#   HOOK       — hook name (banned-vocab, ship-baseline, ...)
#   EVENT      — see docs/RULE-HITS-SCHEMA.md "Events" table for the
#                canonical list (kept in sync via tests/hooks/contract.test.sh).
#   EXTRA      — JSON value (object | null | string). "null" if none.
#   SECTION    — optional spec section identifier for §0.1/§13.1/§13.2
#                promotion and demotion accounting. See docs/RULE-HITS-SCHEMA.md
#                "Spec section taxonomy" table. Empty arg → null in JSONL row.
#                Hooks that aren't enforcing a spec rule (session-start
#                bootstrap, version-sync) leave it empty.
#   SESSION_ID — optional Claude Code session identifier (extracted from
#                stdin EVENT JSON `.session_id`). Empty arg → null in row.
#                Added v0.10.0 to disambiguate hook double-fire vs fast-retry
#                patterns in audit data; same (ts, hook) row twice with the
#                same session_id implies a single CC invocation triggered the
#                hook twice (registration / lib bug); different session_ids
#                imply concurrent sessions or fast-retry across sessions.
rule_hits_append() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0

  local hook="${1:-unknown}"
  local event="${2:-unknown}"
  local extra="${3:-null}"
  local section="${4:-}"
  local session_id="${5:-}"

  # Project: encoded with `/`, `.`, AND `_` → `-` to match Claude Code's
  # ~/.claude/projects/<encoded>/ convention. CC encodes every non-`[a-zA-Z0-9-]`
  # char; `tr '/._'` covers the three observed in real cwds. See
  # hooks/memory-read-check.sh for the matching consumer + bug-history note.
  # Empty string when neither var is set.
  local project_raw="${CLAUDE_PROJECT_DIR:-${PWD:-}}"
  local project=""
  [[ -n "$project_raw" ]] && project=$(printf '%s' "$project_raw" | tr '/._' '-')

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
  # Concurrency: two hooks firing within the same ms can both observe
  # `size > threshold` and both race `mv -f file .1`. One rotation wins, one
  # is a no-op on an already-moved file; at worst one log line is lost to
  # the race. Acceptable under the fail-open contract — flock would add a
  # dependency for a ~0.01% occurrence.
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
    --arg project "$project" \
    --arg session_id "$session_id" \
    --arg section "$section" \
    --argjson extra "$extra" \
    '{ts: $ts, hook: $hook, event: $event, project: $project,
      session_id: (if $session_id == "" then null else $session_id end),
      spec_section: (if $section == "" then null else $section end),
      extra: $extra}' \
    2>/dev/null >> "$log_file" || return 0
}
