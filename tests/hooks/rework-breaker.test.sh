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

# Opt-in flag for every driving call below (§13.3 default-OFF). Case 0 pins the
# default itself.
export REWORK_BREAKER=1

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

# --- Case 0: default OFF (no opt-in) ----------------------------------------
# §EXT §13.3: a behaviour-layer hook ships default-OFF for FP collection. Eight
# edits with the flag unset must produce nothing at all.
reset_state
DEF_OUT=""
for _ in 1 2 3 4 5 6 7 8; do
  DEF_OUT="$DEF_OUT$(REWORK_BREAKER=0 bash -c "jq -cn '{session_id:\"s0\",tool_name:\"Edit\",tool_input:{file_path:\"/p/src/a.js\"}}' | bash '$HOOK' 2>/dev/null")"
done
if [[ -z "$DEF_OUT" && "$(log_rows)" == "0" ]]; then
  ok "0: default OFF → silent, no rule-hits row, no state written"
else
  ng "0: fired without the opt-in flag (out: $DEF_OUT, rows: $(log_rows))"
fi

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

# --- Case 14 (pre-ship H3): concurrent edits ---------------------------------
# Claude Code issues several Edit/Write calls in one assistant message, so their
# PostToolUse hooks run at the same time. The first version appended and then
# re-read the file to count, which is a read-modify-check race: the pre-ship
# review measured 1, 3, 3, 5, 2 and 3 firings across six trials of 16
# concurrent edits, where the answer is exactly 2 (at 8 and at 16). Both
# directions are wrong — a duplicate nag, and a threshold crossed by two
# processes that neither of them observes.
reset_state
CONC_OUT="$TMP_HOME/conc.out"
: > "$CONC_OUT"
for _ in $(seq 1 16); do
  ( fire sC /p/src/hot.js >> "$CONC_OUT" 2>/dev/null ) &
done
wait
CONC_FIRINGS=$(grep -c 'additionalContext' "$CONC_OUT" 2>/dev/null || echo 0)
LEDGER_C=$(find "$HOME/.claude/.claudemd-state" -maxdepth 1 -name 'rework-sC.counts' 2>/dev/null | head -n1)
LEDGER_LINES=$(wc -l < "$LEDGER_C" 2>/dev/null | tr -d ' ')
if [[ "$LEDGER_LINES" == "16" && "$CONC_FIRINGS" == "2" ]]; then
  ok "14: 16 concurrent edits to one file → exactly 2 advisories (8 and 16), ledger 16 lines"
else
  ng "14: concurrency wrong — $CONC_FIRINGS advisory/ies over $LEDGER_LINES ledger line(s), expected 2 over 16"
fi
# And the counts named are the two multiples, not the same one twice.
CONC_COUNTS=$(grep -oE 'at least [0-9]+ times' "$CONC_OUT" 2>/dev/null | grep -oE '[0-9]+' | sort -n | tr '\n' ',')
if [[ "$CONC_COUNTS" == "8,16," ]]; then
  ok "14b: the two advisories name 8 and 16, not one multiple twice"
else
  ng "14b: advisories named [$CONC_COUNTS], expected [8,16,]"
fi

# --- Case 15 (pre-ship L1): non-code files are not this hook's subject -------
# The injected line quotes §1 "reproduce the failure, name the cause". That is
# advice about code; on the eighth edit to a markdown file it is noise wearing a
# spec citation.
reset_state
DOCS_OUT=""
for _ in 1 2 3 4 5 6 7 8 9; do
  DOCS_OUT="$DOCS_OUT$(fire sD /p/docs/NOTES.md)"
done
if [[ -z "$DOCS_OUT" && "$(log_rows)" == "0" ]]; then
  ok "15: nine edits to a markdown file → silent"
else
  ng "15: quoted §1 root-cause at a docs file (out: $DOCS_OUT)"
fi
# Control: the same count on a code file still fires, so case 15 is measuring
# the extension filter and not a broken harness.
reset_state
CODE_OUT=""
for _ in 1 2 3 4 5 6 7 8; do CODE_OUT="$CODE_OUT$(fire sE /p/src/a.ts)"; done
if [[ "$CODE_OUT" == *"at least 8 times"* ]]; then
  ok "15b: control — the same eight edits to a .ts file do fire"
else
  ng "15b: the extension filter also silenced a code file: $CODE_OUT"
fi

# --- Case 16 (pre-ship L2): an unwritable ledger must not leak to stderr -----
reset_state
RO_STATE="$HOME/.claude/.claudemd-state"
mkdir -p "$RO_STATE"
: > "$RO_STATE/rework-sF.counts"
chmod 444 "$RO_STATE/rework-sF.counts"
RO_ERR=$(jq -cn '{session_id:"sF",tool_name:"Edit",tool_input:{file_path:"/p/src/a.js"}}' | bash "$HOOK" 2>&1 >/dev/null)
RO_RC=$?
chmod 644 "$RO_STATE/rework-sF.counts" 2>/dev/null || true
if [[ -z "$RO_ERR" && "$RO_RC" == "0" ]]; then
  ok "16: an unwritable ledger fails open silently (no shell redirection error on stderr)"
else
  ng "16: leaked to stderr on an unwritable ledger (rc=$RO_RC): $RO_ERR"
fi

# --- Case 17: the claim-file set is the invariant the fix establishes --------
# The reviewer's point: at higher concurrency one process can win two multiples
# and announce only the higher one, so the ADVISORY count is not invariant
# while the CLAIM set is. Assert the thing that is actually guaranteed.
reset_state
for _ in $(seq 1 24); do ( fire sG /p/src/hot.js >/dev/null 2>&1 ) & done
wait
CLAIMS=$(find "$HOME/.claude/.claudemd-state" -maxdepth 1 -name 'rework-sG.fired-*' 2>/dev/null \
  | sed 's/.*-//' | sort -n | tr '\n' ',')
if [[ "$CLAIMS" == "8,16,24," ]]; then
  ok "17: 24 concurrent edits claim exactly the multiples 8, 16 and 24 — once each"
else
  ng "17: claim set was [$CLAIMS], expected [8,16,24,]"
fi

echo
claudemd_assert_summary
