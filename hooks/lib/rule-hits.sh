#!/usr/bin/env bash
# rule-hits.sh — append-only JSONL log for §13.1 self-audit data.

# rule_hits_append HOOK EVENT EXTRA_JSON [SPEC_SECTION] [SESSION_ID] [TOOL_USE_ID]
#   HOOK        — hook name (banned-vocab, ship-baseline, ...)
#   EVENT       — see docs/RULE-HITS-SCHEMA.md "Events" table for the
#                 canonical list (kept in sync via tests/hooks/contract.test.sh).
#   EXTRA       — JSON value (object | null | string). "null" if none.
#   SECTION     — optional spec section identifier for §0.1/§13.1/§13.2
#                 promotion and demotion accounting. See docs/RULE-HITS-SCHEMA.md
#                 "Spec section taxonomy" table. Empty arg → null in JSONL row.
#                 Hooks that aren't enforcing a spec rule (session-start
#                 bootstrap, version-sync) leave it empty.
#   SESSION_ID  — optional Claude Code session identifier (extracted from
#                 stdin EVENT JSON `.session_id`). Empty arg → null in row.
#                 Added v0.9.33.
#   TOOL_USE_ID — optional per-invocation tool use ID (CC stdin `.tool_use_id`,
#                 format `toolu_[alnum]`). Empty arg → null in row. Only
#                 PreToolUse / PostToolUse events carry this; Stop /
#                 SessionStart / SessionEnd / UserPromptSubmit do not.
#                 Added v0.9.34 to enable audit `unique_invocations` dedup.
#                 Dedup key (extended v0.23.21) is (ts, hook, session_id,
#                 tool_use_id, event, extra): BYTE-IDENTICAL rows twice ⇒ true
#                 single-invocation double-fire (registration / lib bug);
#                 different tool_use_id at same ts ⇒ Claude fast-retry after
#                 deny, not a duplicate. NOTE multi-emit hooks (pre-bash-safety
#                 logs one row per matched pattern in a compound command)
#                 legitimately repeat (ts, hook, session_id, tool_use_id) with
#                 differing extra — the event+extra key keeps those distinct;
#                 a byte-identical residual can still come from one command
#                 repeating the same pattern, so confirm against the source
#                 command before calling a pre-bash-safety `_real` a bug.
rule_hits_append() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0

  local hook="${1:-unknown}"
  local event="${2:-unknown}"
  local extra="${3:-null}"
  local section="${4:-}"
  local session_id="${5:-}"
  local tool_use_id="${6:-}"

  # Reserved test sentinel. `t` is the fixture session_id used across most of
  # the hook test suite. The suite sandboxes HOME so its writes are disposable,
  # but ad-hoc *manual* hook invocations in the real $HOME with a fixture event
  # were leaking these into production telemetry (309 rows / 11.5% of the log
  # as of the 2026-06-03 impact audit), inflating deny counts ~2x and obscuring
  # real signal. Real CC session_ids are UUIDs, never `t`; the few tests that
  # assert on log content use distinct ids (e.g. sess35, and the `test`
  # sentinel for transcript-*-scan) — so dropping `t` is invisible to every
  # real caller and every test.
  [[ "$session_id" == "t" ]] && return 0

  # Project: encode to match Claude Code's ~/.claude/projects/<encoded>/
  # convention — CC replaces every non-`[a-zA-Z0-9-]` char with `-`, so
  # `tr -c 'a-zA-Z0-9-' '-'` is the exact transform. The earlier `tr '/._'`
  # only handled the three chars seen in this maintainer's cwds and mis-encoded
  # the project field for any path with another special char (telemetry then
  # attributed those rows to the wrong / a non-existent project). For `/._`-only
  # paths the forms are identical. See hooks/memory-read-check.sh for the
  # matching consumer + bug-history note. Empty string when neither var is set.
  local project_raw="${CLAUDE_PROJECT_DIR:-${PWD:-}}"
  local project=""
  [[ -n "$project_raw" ]] && project=$(printf '%s' "$project_raw" | tr -c 'a-zA-Z0-9-' '-')

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
  # Numeric-guard: a non-integer env value (user typo) would make
  # `$((max_mb * ...))` an unbound-variable crash under `set -u`, and because
  # this runs before the JSONL write, the telemetry row would be silently lost.
  [[ "$max_mb" =~ ^[0-9]+$ ]] || max_mb=5
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
    --arg tool_use_id "$tool_use_id" \
    --arg section "$section" \
    --argjson extra "$extra" \
    '{ts: $ts, hook: $hook, event: $event, project: $project,
      session_id: (if $session_id == "" then null else $session_id end),
      tool_use_id: (if $tool_use_id == "" then null else $tool_use_id end),
      spec_section: (if $section == "" then null else $section end),
      extra: $extra}' \
    2>/dev/null >> "$log_file" || return 0
}
