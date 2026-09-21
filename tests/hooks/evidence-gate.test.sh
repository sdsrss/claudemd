#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# evidence-gate.test.sh — G1b (docs/spec-optimization-roadmap-2026-09-21.md §7).
#
# The detector this replaces failed at precision 0.17 by reading prose for
# evidence, so the assertions that matter are the ones proving this one reads
# STRUCTURE: the same Done claim must go silent or fire depending only on what
# the transcript holds, with the prose held constant. Each tier gets a positive,
# and the two FP-control arms (no code edit, `[PARTIAL]`) get a negative.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/evidence-gate.sh"

# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

TMP_HOME=$(mktemp -d -t claudemd-eg-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/projects/test"
TRANSCRIPT="$HOME/.claude/projects/test/session.jsonl"

DONE_CLAIM='Done: rewrote the parser. Checked: it works now.'

export EVIDENCE_GATE=1

# --- transcript builders ----------------------------------------------------
row_edit() { jq -cn --arg f "$1" '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_e",name:"Edit",input:{file_path:$f}}]}}'; }
row_bash() { jq -cn --arg i "$1" --arg c "$2" '{type:"assistant",message:{content:[{type:"tool_use",id:$i,name:"Bash",input:{command:$c}}]}}'; }
row_result() { jq -cn --arg i "$1" --arg t "$2" --argjson e "${3:-false}" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:$i,is_error:$e,content:$t}]}}'; }
row_read_result() { jq -cn --arg i "$1" --arg t "$2" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:$i,is_error:false,content:$t}]}}'; }
row_text() { jq -cn --arg t "$1" '{type:"assistant",message:{content:[{type:"text",text:$t}]}}'; }

run_hook() {
  local msg="$1"
  jq -cn --arg m "$msg" --arg t "$TRANSCRIPT" \
    '{hook_event_name:"Stop",session_id:"eg",last_assistant_message:$m,transcript_path:$t}' \
    | bash "$HOOK" 2>&1
}

log_rows() {
  [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || {
    echo 0
    return
  }
  jq -r 'select(.hook=="evidence-gate") | .event' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | wc -l | tr -d ' '
}
reset_log() { rm -f "$HOME/.claude/logs/claudemd.jsonl"; }

# --- Case 0: default OFF (§13.3) --------------------------------------------
{
  row_edit /p/src/a.js
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(EVIDENCE_GATE=0 bash -c "jq -cn --arg m '$DONE_CLAIM' --arg t '$TRANSCRIPT' '{hook_event_name:\"Stop\",session_id:\"eg\",last_assistant_message:\$m,transcript_path:\$t}' | bash '$HOOK' 2>&1")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "0: default OFF → silent (behaviour-layer hooks ship off, §EXT §13.3)"
else
  ng "0: fired without the opt-in flag: $OUT"
fi

# --- Case 1: no evidence at all → advisory ----------------------------------
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"Iron Law #2"* && "$OUT" == *"no command output at all"* && "$(log_rows)" == "1" ]]; then
  ok "1: Done claim + code edit + nothing run → advisory, one rule-hits row"
else
  ng "1: expected the no-command-output advisory, got: $OUT (rows $(log_rows))"
fi
V=$(jq -r 'select(.hook=="evidence-gate") | "\(.event) \(.spec_section) \(.extra.verdict)"' "$HOME/.claude/logs/claudemd.jsonl" | head -n1)
if [[ "$V" == "evidence-advisory §iron-law-2 no-command-output" ]]; then
  ok "1b: row carries the event, the section and the verdict ($V)"
else
  ng "1b: unexpected row: $V"
fi

# --- Case 2 (T2 positive): a test runner ran after the edit → silent --------
{
  row_edit /p/src/a.js
  row_bash tu_b1 "npm test"
  row_result tu_b1 "Tests: 42 passed, 0 failed"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "2: T2 — runner output after the last edit → silent"
else
  ng "2: fired despite runner output: $OUT"
fi

# --- Case 3 (T1 positive): the smoke entry point ran → silent ---------------
{
  row_edit /p/src/a.js
  row_bash tu_b2 "npm run smoke"
  row_result tu_b2 "some project-specific output with no runner words in it"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "3: T1 — the G1a smoke entry counts on the COMMAND, not on output wording"
else
  ng "3: smoke run did not satisfy the gate: $OUT"
fi

# --- Case 4 (T3): a command ran, but nothing that verifies → advisory -------
{
  row_edit /p/src/a.js
  row_bash tu_b3 "git status --porcelain"
  row_result tu_b3 " M src/a.js"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"none of them produced test / typecheck / build output"* && "$(log_rows)" == "1" ]]; then
  ok "4: T3 — git status is a command, not verification → advisory names the difference"
else
  ng "4: expected the command-but-no-runner advisory, got: $OUT"
fi

# --- Case 5: evidence BEFORE the last edit does not count -------------------
{
  row_bash tu_b4 "npm test"
  row_result tu_b4 "Tests: 42 passed, 0 failed"
  row_edit /p/src/a.js
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"no command output at all"* ]]; then
  ok "5: a green run BEFORE the last edit is not evidence about that edit"
else
  ng "5: counted pre-edit evidence: $OUT"
fi

# --- Case 6: an errored result is not evidence ------------------------------
{
  row_edit /p/src/a.js
  row_bash tu_b5 "npm test"
  row_result tu_b5 "Tests: 41 passed, 1 failed" true
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"no command output at all"* ]]; then
  ok "6: a red run is not evidence for a Done claim (is_error → not counted)"
else
  ng "6: an errored result satisfied the gate: $OUT"
fi

# --- Case 7: a tool_result that is not a Bash result does not count ---------
{
  row_edit /p/src/a.js
  row_read_result tu_notbash "Tests: 42 passed — this is the CONTENT OF A FILE, not a command"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"no command output at all"* ]]; then
  ok "7: runner-looking text in a Read result is not command output (join on tool_use_id)"
else
  ng "7: a non-Bash result satisfied the gate: $OUT"
fi

# --- Case 8 (FP control): no code edit → never fires ------------------------
{
  row_edit /p/docs/notes.md
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "8: a docs-only session never triggers (this is what keeps L0 / L1-copy out)"
else
  ng "8: fired on a docs-only session: $OUT"
fi

# --- Case 9 (FP control): a [PARTIAL] claim → never fires -------------------
{
  row_edit /p/src/a.js
  row_text "x"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "Done: wired the parser. [PARTIAL: no smoke entry in this project]")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "9: a [PARTIAL] claim is the sanctioned honest form and earns no nag"
else
  ng "9: fired on a [PARTIAL] claim: $OUT"
fi

# --- Case 10: no completion claim → never fires -----------------------------
reset_log
OUT=$(run_hook "Here is what I found so far; I have not finished.")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "10: no Done claim → nothing to check"
else
  ng "10: fired without a completion claim: $OUT"
fi

# --- Case 11: the claim shapes the Round-14 audit found invisible -----------
reset_log
SHAPES_OK=1
for msg in '**Done**: shipped it.' '### Done' '- **Done:** shipped it.' '## Done' '完成: 改好了'; do
  O=$(run_hook "$msg")
  [[ "$O" == *"Iron Law #2"* ]] || {
    SHAPES_OK=0
    echo "      shape not detected: $msg"
  }
done
if [[ "$SHAPES_OK" == "1" ]]; then
  ok "11: **Done** / ### Done / - **Done:** / ## Done / 完成: all register as claims"
else
  ng "11: at least one completion-claim spelling is invisible to the detector"
fi

# --- Case 12: kill-switches -------------------------------------------------
reset_log
K1=$(DISABLE_EVIDENCE_GATE_HOOK=1 bash -c "jq -cn --arg m '$DONE_CLAIM' --arg t '$TRANSCRIPT' '{hook_event_name:\"Stop\",session_id:\"eg\",last_assistant_message:\$m,transcript_path:\$t}' | EVIDENCE_GATE=1 bash '$HOOK' 2>&1")
K2=$(DISABLE_CLAUDEMD_HOOKS=1 bash -c "jq -cn --arg m '$DONE_CLAIM' --arg t '$TRANSCRIPT' '{hook_event_name:\"Stop\",session_id:\"eg\",last_assistant_message:\$m,transcript_path:\$t}' | EVIDENCE_GATE=1 bash '$HOOK' 2>&1")
if [[ -z "$K1$K2" && "$(log_rows)" == "0" ]]; then
  ok "12: per-hook and plugin-wide kill-switches both silence it"
else
  ng "12: a kill-switch did not silence (per-hook: $K1, global: $K2)"
fi

# --- Case 13: fail-open ------------------------------------------------------
reset_log
B1=$(printf '%s' 'not json' | bash "$HOOK" 2>&1)
R1=$?
B2=$(printf '' | bash "$HOOK" 2>&1)
R2=$?
B3=$(jq -cn --arg m "$DONE_CLAIM" '{hook_event_name:"Stop",last_assistant_message:$m,transcript_path:"/nope/missing.jsonl"}' | bash "$HOOK" 2>&1)
R3=$?
if [[ "$R1" == "0" && "$R2" == "0" && "$R3" == "0" && -z "$B1$B2$B3" ]]; then
  ok "13: malformed / empty / missing-transcript events exit 0 and say nothing"
else
  ng "13: fail-open broke (rc $R1/$R2/$R3, out: $B1$B2$B3)"
fi
if jq -e 'select(.hook=="evidence-gate" and .event=="fail-open" and .extra.reason=="transcript-missing")' \
  "$HOME/.claude/logs/claudemd.jsonl" >/dev/null 2>&1; then
  ok "13b: the missing-transcript bailout records a fail-open row rather than vanishing"
else
  ng "13b: no transcript-missing fail-open row was written"
fi

# --- Case 14: the window bound is honoured ----------------------------------
# A code edit older than the window reads as "no code edit" and the hook stays
# silent. Pinned so the under-reporting direction is a decision, not a surprise.
{
  row_edit /p/src/a.js
  for i in $(seq 1 30); do row_text "filler turn $i"; done
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(EVIDENCE_GATE_WINDOW=5 run_hook "$DONE_CLAIM")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "14: a code edit outside the tail window → silent, not a guess"
else
  ng "14: fired with the edit outside the window: $OUT"
fi
OUT=$(EVIDENCE_GATE_WINDOW=100 run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"Iron Law #2"* ]]; then
  ok "14b: the same transcript with a window that reaches the edit → advisory (control)"
else
  ng "14b: widening the window changed nothing — the bound is not what case 14 measured"
fi

echo
claudemd_assert_summary
