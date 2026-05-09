#!/usr/bin/env bash
# session-summary.sh — Stop hook (v0.8.0 R-N4).
#
# At session end, summarize this session's deny + bypass-escape-hatch counts
# from rule-hits.jsonl and write to ~/.claude/.claudemd-state/last-session-
# summary.json. session-start-check.sh reads it next session and emits a
# one-line `additionalContext` banner so the agent sees its own recent
# tendency without an explicit /claudemd-audit invocation.
#
# Why a separate hook (not folded into residue-audit / sandbox-disposal):
# residue/sandbox already write `~/.claude/.claudemd-state/*` for their own
# baselines; mixing concerns would couple summary-write to advisory behavior
# the user can disable independently. Per §9 Simplicity: smallest diff,
# fewest files — but here "fewest files" loses to single-responsibility.
#
# Fail-open on any hiccup. Stop hooks cannot block the session anyway.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# v0.9.13: platform_stat_mtime is the cross-platform stat wrapper. v0.8.0 →
# v0.9.12 omitted this source line, so the `command -v platform_stat_mtime`
# guard below silently failed and SINCE_TS was always empty → every call
# took the 24h fallback path. Verified post-fix: with platform.sh sourced,
# SUMMARY_REF mtime drives the window as designed.
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch SESSION_SUMMARY || exit 0
hook_require_jq || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
SUMMARY_FILE="$STATE_DIR/last-session-summary.json"
# v0.9.13: session-summary owns its own sentinel. Earlier versions read
# session-start.ref mtime, which sandbox-disposal-check.sh also writes during
# the same Stop event. Stop hooks fire in parallel (empirical: last summary's
# `since` == `ts - 24h` exactly, which only the 24h fallback below can produce
# — meaning session-summary stat'd session-start.ref before sandbox-disposal
# had touched it, hit `[[ -f ]]` false, and fell through). Worse, a future CC
# harness running Stop hooks serially in declaration order (sandbox first /
# summary last) would always see fresh mtime → empty window → banner gone.
# Self-owned sentinel decouples both failure modes.
SUMMARY_REF="$STATE_DIR/session-summary.lastrun"

LOG_FILE="$HOME/.claude/logs/claudemd.jsonl"
[[ -f "$LOG_FILE" ]] || exit 0

# Window: from SUMMARY_REF mtime (last session-summary touch) to now. First
# run after install (no sentinel) or pruned state → 24h fallback.
SINCE_TS=""
if [[ -f "$SUMMARY_REF" ]] && command -v platform_stat_mtime >/dev/null 2>&1; then
  smtime=$(platform_stat_mtime "$SUMMARY_REF" 2>/dev/null || true)
  if [[ -n "$smtime" ]]; then
    SINCE_TS=$(date -u -d "@$smtime" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
      || date -u -r "$smtime" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
      || true)
  fi
fi
if [[ -z "$SINCE_TS" ]]; then
  # GNU `date -d`, BSD `date -v`. Try GNU first; on failure fall back.
  SINCE_TS=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || echo "1970-01-01T00:00:00Z")
fi

# Aggregate session-window rows. Two-stage pipe: outer `jq -R 'try fromjson
# catch empty'` parses each line and silently drops corrupt rows; inner
# `jq -s` slurps the stream into an array for the aggregation. Earlier
# attempt used `--slurpfile` with `<(...)` and tried `$log[0]` — but
# --slurpfile already wraps the file's stream into a single array, so
# `$log[0]` was the first row not the array. The pipe form is unambiguous.
# top_section is the most-cited spec_section among events that contributed to
# the banner counts (deny + bypass-escape-hatch + warn). Restricting by both
# event type AND non-null spec_section keeps housekeeping events (bootstrap,
# version-sync, upstream-banner, pass*) out of the (unset) bucket — pre-fix
# they dominated whenever a session had >50 ops events vs ≤50 rule events,
# making the banner always read `top: (unset)` regardless of actual rule
# activity. (v0.9.12 fix.)
SUMMARY=$(jq -R 'try fromjson catch empty' "$LOG_FILE" 2>/dev/null \
  | jq -s -c --arg since "$SINCE_TS" '
      map(select(.ts >= $since))
      | (length) as $total
      | (map(select(.event == "deny")) | length) as $denies
      | (map(select(.event == "bypass-escape-hatch")) | length) as $bypasses
      | (map(select(.event == "warn")) | length) as $warns
      | (map(select(.event == "deny" or .event == "bypass-escape-hatch" or .event == "warn") | select(.spec_section != null))
         | group_by(.spec_section)
         | map({section: .[0].spec_section, n: length})
         | sort_by(-.n)
         | (.[0].section // null)) as $top_section
      | {
          ts: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
          since: $since,
          total: $total,
          denies: $denies,
          bypasses: $bypasses,
          warns: $warns,
          top_section: $top_section
        }
    ' 2>/dev/null) || exit 0

# Always advance SUMMARY_REF before any early-exit so the next window starts
# from this Stop, not the previous one. Otherwise a no-event session would
# silently extend the next session's window indefinitely.
touch "$SUMMARY_REF" 2>/dev/null || true

# Skip writing when nothing happened — banner would be empty anyway.
total=$(printf '%s' "$SUMMARY" | jq -r '.total // 0' 2>/dev/null)
[[ -n "$total" && "$total" -gt 0 ]] || exit 0

# Atomic write: tmp → rename. SessionStart reading mid-write would see
# partial JSON otherwise.
TMP="$SUMMARY_FILE.tmp.$$"
printf '%s\n' "$SUMMARY" > "$TMP" 2>/dev/null && mv -f "$TMP" "$SUMMARY_FILE" 2>/dev/null || rm -f "$TMP" 2>/dev/null

exit 0
