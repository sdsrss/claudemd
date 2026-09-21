#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# rework-breaker.test.sh — G2 (docs/spec-optimization-roadmap-2026-09-21.md §7).
#
# The threshold is pre-registered at 8 and the hook is advisory, so what this
# suite has to establish is that the COUNT is right: both sides of the boundary
# (7 silent, 8 fires), per-file rather than per-session, per-session rather than
# global, and the re-fire cadence. A counter that fires one edit early is worse
# than no counter — it trains the reader to ignore the line.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/rework-breaker.sh"

# One assertion vocabulary for bash suites (audit R11-27): ok/ng both count, so
# the tally at the bottom means the same thing it means in every other suite.
# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

TMP_HOME=$(mktemp -d -t claudemd-rwb-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"

# Drive one Edit/Write event. Echoes the hook's stdout.
fire() {
  local sid="$1" file="$2" tool="${3:-Edit}"
  jq -cn --arg s "$sid" --arg f "$file" --arg t "$tool" \
    '{session_id:$s,tool_name:$t,tool_use_id:"toolu_x",tool_input:{file_path:$f}}' \
    | bash "$HOOK" 2>/dev/null
}

# Count rule-hits rows this hook wrote.
log_rows() {
  [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || {
    echo 0
    return
  }
  jq -r 'select(.hook=="rework-breaker") | .event' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null \
    | wc -l | tr -d ' '
}

reset_state() {
  rm -rf "$HOME/.claude/.claudemd-state" "$HOME/.claude/logs/claudemd.jsonl"
  mkdir -p "$HOME/.claude/logs"
}

# --- Case 1: below the threshold is silent ----------------------------------
reset_state
SEVEN_OUT=""
for _ in 1 2 3 4 5 6 7; do
  SEVEN_OUT="$SEVEN_OUT$(fire s1 /p/src/a.js)"
done
if [[ -z "$SEVEN_OUT" && "$(log_rows)" == "0" ]]; then
  ok "1: 7 edits to one file → silent, no rule-hits row"
else
  ng "1: fired below the pre-registered threshold (out: $SEVEN_OUT, rows: $(log_rows))"
fi

# --- Case 2: the 8th edit fires, with the count and the path in the text -----
OUT=$(fire s1 /p/src/a.js)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
EVENT_NAME=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.hookEventName // ""' 2>/dev/null)
if [[ "$EVENT_NAME" == "PostToolUse" ]] && [[ "$CTX" == *"/p/src/a.js"* ]] && [[ "$CTX" == *" 8 times"* ]]; then
  ok "2: the 8th edit injects PostToolUse additionalContext naming the file and the count"
else
  ng "2: 8th edit did not inject the expected context (event: $EVENT_NAME, ctx: $CTX)"
fi
# The envelope must be exactly one JSON object, or Claude Code drops the whole
# payload silently (docs/HOOK-PROTOCOL.md).
if printf '%s' "$OUT" | jq -e . >/dev/null 2>&1 && [[ "$(printf '%s' "$OUT" | jq -s 'length')" == "1" ]]; then
  ok "2b: stdout is exactly one JSON object"
else
  ng "2b: stdout is not a single JSON object: $OUT"
fi
if [[ "$(printf '%s' "$OUT" | jq -r '.suppressOutput')" == "true" ]]; then
  ok "2c: suppressOutput keeps it out of the terminal"
else
  ng "2c: suppressOutput not set"
fi
if [[ "$(log_rows)" == "1" ]]; then
  ok "2d: exactly one rework-advisory row written"
else
  ng "2d: expected 1 rule-hits row, got $(log_rows)"
fi
EXTRA=$(jq -r 'select(.hook=="rework-breaker") | "\(.event) \(.spec_section) \(.extra.edits) \(.extra.threshold)"' \
  "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | head -n1)
if [[ "$EXTRA" == "rework-advisory §1-root-cause 8 8" ]]; then
  ok "2e: row carries event, section and the counts the audit needs ($EXTRA)"
else
  ng "2e: unexpected row shape: $EXTRA"
fi

# --- Case 3: 9..15 silent again, 16 fires (multiple-of-threshold cadence) ----
MID_OUT=""
for _ in 9 10 11 12 13 14 15; do
  MID_OUT="$MID_OUT$(fire s1 /p/src/a.js)"
done
OUT16=$(fire s1 /p/src/a.js)
CTX16=$(printf '%s' "$OUT16" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
if [[ -z "$MID_OUT" && "$CTX16" == *" 16 times"* ]]; then
  ok "3: silent for 9-15, fires again at 16 with the escalated count"
else
  ng "3: cadence wrong (9-15 out: $MID_OUT, 16 ctx: $CTX16)"
fi

# --- Case 4: the tally is per FILE, not per session --------------------------
reset_state
SPREAD=""
for f in a b c d e f g h; do
  SPREAD="$SPREAD$(fire s2 "/p/src/$f.js")"
done
if [[ -z "$SPREAD" && "$(log_rows)" == "0" ]]; then
  ok "4: 8 edits spread over 8 files → silent (the count is per file)"
else
  ng "4: fired on 8 different files (out: $SPREAD, rows: $(log_rows))"
fi

# --- Case 5: the tally is per SESSION, not global ----------------------------
reset_state
for _ in 1 2 3 4; do fire s3 /p/src/a.js >/dev/null; done
CROSS=""
for _ in 1 2 3 4; do CROSS="$CROSS$(fire s4 /p/src/a.js)"; done
if [[ -z "$CROSS" && "$(log_rows)" == "0" ]]; then
  ok "5: 4+4 edits to the same path in two sessions → silent (no pooling)"
else
  ng "5: pooled across sessions (out: $CROSS, rows: $(log_rows))"
fi

# --- Case 6: Write counts toward the same tally as Edit ----------------------
reset_state
for _ in 1 2 3 4 5 6 7; do fire s5 /p/src/a.js Edit >/dev/null; done
OUTW=$(fire s5 /p/src/a.js Write)
if [[ "$(printf '%s' "$OUTW" | jq -r '.hookSpecificOutput.additionalContext // ""')" == *" 8 times"* ]]; then
  ok "6: a Write is the 8th edit — a rewrite is rework"
else
  ng "6: Write did not count toward the tally"
fi

# --- Case 7: tools that are not Edit/Write are ignored -----------------------
reset_state
IGN=""
for _ in 1 2 3 4 5 6 7 8 9; do IGN="$IGN$(fire s6 /p/src/a.js Read)"; done
if [[ -z "$IGN" && "$(log_rows)" == "0" ]]; then
  ok "7: nine Read calls on one path → silent"
else
  ng "7: counted a non-editing tool (out: $IGN, rows: $(log_rows))"
fi

# --- Case 8: an event with no session_id is not counted ----------------------
reset_state
NOSID=""
for _ in 1 2 3 4 5 6 7 8 9; do
  NOSID="$NOSID$(jq -cn '{tool_name:"Edit",tool_input:{file_path:"/p/src/a.js"}}' | bash "$HOOK" 2>/dev/null)"
done
if [[ -z "$NOSID" ]]; then
  ok "8: no session_id → no tally (pooling every window into one count is worse than silence)"
else
  ng "8: counted an event with no session_id: $NOSID"
fi

# --- Case 9: per-hook kill-switch -------------------------------------------
reset_state
KS=""
for _ in 1 2 3 4 5 6 7 8; do
  KS="$KS$(DISABLE_REWORK_BREAKER_HOOK=1 bash -c "jq -cn '{session_id:\"s7\",tool_name:\"Edit\",tool_input:{file_path:\"/p/src/a.js\"}}' | bash '$HOOK' 2>/dev/null")"
done
if [[ -z "$KS" && "$(log_rows)" == "0" ]]; then
  ok "9: DISABLE_REWORK_BREAKER_HOOK=1 silences it"
else
  ng "9: kill-switch did not silence (out: $KS, rows: $(log_rows))"
fi

# --- Case 10: plugin-wide kill-switch ---------------------------------------
reset_state
GK=""
for _ in 1 2 3 4 5 6 7 8; do
  GK="$GK$(DISABLE_CLAUDEMD_HOOKS=1 bash -c "jq -cn '{session_id:\"s8\",tool_name:\"Edit\",tool_input:{file_path:\"/p/src/a.js\"}}' | bash '$HOOK' 2>/dev/null")"
done
if [[ -z "$GK" && "$(log_rows)" == "0" ]]; then
  ok "10: DISABLE_CLAUDEMD_HOOKS=1 silences it"
else
  ng "10: plugin-wide kill-switch did not silence (out: $GK, rows: $(log_rows))"
fi

# --- Case 11: fail-open on malformed / empty input ---------------------------
reset_state
BAD_OUT=$(printf '%s' 'not json at all' | bash "$HOOK" 2>&1)
BAD_RC=$?
EMPTY_OUT=$(printf '' | bash "$HOOK" 2>&1)
EMPTY_RC=$?
NOFIELD_OUT=$(printf '%s' '{"session_id":"s9","tool_name":"Edit"}' | bash "$HOOK" 2>&1)
NOFIELD_RC=$?
if [[ "$BAD_RC" == "0" && "$EMPTY_RC" == "0" && "$NOFIELD_RC" == "0" ]] \
  && [[ -z "$BAD_OUT$EMPTY_OUT$NOFIELD_OUT" ]]; then
  ok "11: malformed / empty / field-less events exit 0 and emit nothing"
else
  ng "11: fail-open broke (rc $BAD_RC/$EMPTY_RC/$NOFIELD_RC, out: $BAD_OUT$EMPTY_OUT$NOFIELD_OUT)"
fi

# --- Case 12: the state file is the documented name, and one line per edit ---
reset_state
for _ in 1 2 3; do fire s10 /p/src/a.js >/dev/null; done
LEDGER=$(find "$HOME/.claude/.claudemd-state" -maxdepth 1 -name 'rework-*.counts' 2>/dev/null | head -n1)
if [[ -n "$LEDGER" && "$(wc -l < "$LEDGER" | tr -d ' ')" == "3" ]]; then
  ok "12: writes rework-<sid>.counts, one line per edit (the name docs/ARCHITECTURE.md documents)"
else
  ng "12: unexpected state file: '$LEDGER' with $(wc -l < "${LEDGER:-/dev/null}" 2>/dev/null | tr -d ' ') line(s)"
fi

# --- Case 13: a path with a space / newline does not corrupt the tally -------
# The ledger is keyed by checksum precisely so these cannot split a line.
reset_state
WEIRD='/p/my src/a b.js'
for _ in 1 2 3 4 5 6 7; do fire s11 "$WEIRD" >/dev/null; done
OUTW2=$(fire s11 "$WEIRD")
if [[ "$(printf '%s' "$OUTW2" | jq -r '.hookSpecificOutput.additionalContext // ""')" == *"$WEIRD"*" 8 times"* ]]; then
  ok "13: a path containing spaces counts correctly and is quoted from the event"
else
  ng "13: space-bearing path miscounted: $OUTW2"
fi

echo
claudemd_assert_summary
