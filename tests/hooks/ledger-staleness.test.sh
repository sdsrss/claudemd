#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# ledger-staleness.test.sh — G7 (iii)
# (docs/spec-optimization-roadmap-2026-09-21.md §7, the Stop arm of G7).
#
# The claim under test is "this session did code work and did not record it in
# the ledger". Both halves are read from the TRANSCRIPT's structure, so the
# assertions that matter hold everything else constant and move one row:
# case 1 and case 2 differ by a single Edit on the ledger file and must differ
# in verdict. A control that only proves the hook CAN fire proves nothing about
# what makes it stop.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/ledger-staleness.sh"

# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

TMP_HOME=$(mktemp -d -t claudemd-ls-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/projects/test"
TRANSCRIPT="$HOME/.claude/projects/test/session.jsonl"

PROJ="$TMP_HOME/proj"
mkdir -p "$PROJ/tasks"
LEDGER="$PROJ/tasks/demo-ledger.md"
write_ledger() {
  printf '# ledger\n\n## Goal\n\ng\n\n## Decisions\n\nd\n\n## Next\n\nn\n' > "$LEDGER"
}
write_ledger

export LEDGER_STALENESS=1

# --- transcript builders ----------------------------------------------------
row_edit() { jq -cn --arg f "$1" '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_e",name:"Edit",input:{file_path:$f}}]}}'; }
row_write() { jq -cn --arg f "$1" '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_w",name:"Write",input:{file_path:$f}}]}}'; }
row_text() { jq -cn --arg t "$1" '{type:"assistant",message:{content:[{type:"text",text:$t}]}}'; }

run_hook() {
  jq -cn --arg c "${1-$PROJ}" --arg t "${2-$TRANSCRIPT}" \
    '{hook_event_name:"Stop",session_id:"ls1",cwd:$c,transcript_path:$t}' \
    | bash "$HOOK" 2>&1
}

log_rows() {
  [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || {
    echo 0
    return
  }
  jq -r 'select(.hook=="ledger-staleness") | .event' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | wc -l | tr -d ' '
}
reset_log() { rm -f "$HOME/.claude/logs/claudemd.jsonl"; }

# --- Case 0: default OFF (§13.3) --------------------------------------------
{
  row_edit /p/src/a.js
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(LEDGER_STALENESS=0 bash -c "jq -cn --arg c '$PROJ' --arg t '$TRANSCRIPT' '{hook_event_name:\"Stop\",session_id:\"ls1\",cwd:\$c,transcript_path:\$t}' | bash '$HOOK' 2>&1")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "0: default OFF → silent (behaviour-layer hooks ship off, §EXT §13.3)"
else
  ng "0: fired without the opt-in flag: $OUT"
fi

# --- Case 1: code edits, ledger untouched → advisory -------------------------
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"ledger"* && "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "1: code edits + an active ledger nobody wrote to → advisory, one rule-hits row"
else
  ng "1: expected the staleness advisory naming the ledger, got: $OUT (rows $(log_rows))"
fi
V=$(jq -r 'select(.hook=="ledger-staleness") | "\(.event) \(.spec_section) \(.extra.edits)"' "$HOME/.claude/logs/claudemd.jsonl" | head -n1)
if [[ "$V" == "ledger-stale-advisory §11-ledger 1" ]]; then
  ok "1b: row carries the event, the section and the code-edit count ($V)"
else
  ng "1b: unexpected row: $V"
fi

# --- Case 2: the SAME transcript plus one Edit on the ledger → silent --------
# The discriminating control. Everything above is held constant; one row moves.
{
  row_edit /p/src/a.js
  row_edit "$LEDGER"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "2: one Edit on the ledger silences the identical transcript"
else
  ng "2: fired although the ledger was edited this session: $OUT"
fi

# --- Case 2b: Write counts as writing it, not only Edit ----------------------
{
  row_edit /p/src/a.js
  row_write "$LEDGER"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "2b: Write on the ledger silences it too"
else
  ng "2b: Write on the ledger did not count: $OUT"
fi

# --- Case 2c: a DIFFERENT ledger file does not count -------------------------
# Basename-matched against the ledger this hook actually resolved. A write to
# some other task's ledger is not a record of this one's work — and it cannot
# be the resolved one, because writing it would have made it the newest.
{
  row_edit /p/src/a.js
  row_edit "$PROJ/tasks/other-ledger.md"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "2c: an edit to another task's ledger does not count as writing this one"
else
  ng "2c: a foreign ledger silenced the gate: $OUT (rows $(log_rows))"
fi

# --- Case 3: no code edit → silent (FP control: docs / L0 / L1-copy work) ----
{
  row_edit /p/docs/readme.md
  row_edit /p/notes.txt
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "3: a session that edited no code file never fires (docs-only work)"
else
  ng "3: fired on a session with no code edit: $OUT"
fi

# --- Case 4: no ledger under cwd → silent ------------------------------------
{
  row_edit /p/src/a.js
  row_text "some work"
} > "$TRANSCRIPT"
NOLEDGER="$TMP_HOME/noledger"
mkdir -p "$NOLEDGER/tasks"
reset_log
OUT=$(run_hook "$NOLEDGER")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "4: no ledger file under cwd → the convention is not in use here, silent"
else
  ng "4: fired without a ledger: $OUT"
fi

# --- Case 4b: no tasks/ dir at all → silent ----------------------------------
NOTASKS="$TMP_HOME/notasks"
mkdir -p "$NOTASKS"
reset_log
OUT=$(run_hook "$NOTASKS")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "4b: no tasks/ directory → silent"
else
  ng "4b: fired with no tasks/ directory: $OUT"
fi

# --- Case 5: an abandoned ledger past the age bound → silent -----------------
touch -t 200001010000 "$LEDGER"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "5: a ledger older than CLAUDEMD_LEDGER_MAX_AGE_DAYS is an old task, not this one"
else
  ng "5: fired on an abandoned ledger: $OUT"
fi
# Control for case 5: the same file, current mtime, fires. Without this the
# assertion above passes for any reason at all, including a broken glob.
write_ledger
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "5b: control — the same ledger with a current mtime does fire"
else
  ng "5b: control failed, the age bound was not what silenced case 5: $OUT"
fi

# --- Case 6: window bound ----------------------------------------------------
# The code edit is pushed out of the tail window by filler rows. Under-reporting
# is the intended direction: an edit older than the window reads as no edit.
{
  row_edit /p/src/a.js
  for i in $(seq 1 30); do row_text "filler $i"; done
} > "$TRANSCRIPT"
# The knob is exported inside a subshell, never as a `VAR=x run_hook` prefix:
# bash 3.2 (the macOS leg) keeps an assignment made in front of a FUNCTION call
# after the call returns, so the next case would inherit it silently.
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=10; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "6: a code edit older than the tail window reads as no edit, silent"
else
  ng "6: read past its own window: $OUT"
fi
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=40; run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "6b: control — the same transcript with a window that reaches the edit fires"
else
  ng "6b: control failed, the window was not what silenced case 6: $OUT"
fi
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=notanumber; run_hook)
if [[ "$OUT" == *"demo-ledger.md"* ]]; then
  ok "6c: a non-numeric window falls back to the default instead of reaching awk"
else
  ng "6c: non-numeric window changed the verdict: $OUT"
fi

# --- Case 7: kill-switches ---------------------------------------------------
{
  row_edit /p/src/a.js
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(export DISABLE_LEDGER_STALENESS_HOOK=1; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "7: DISABLE_LEDGER_STALENESS_HOOK=1 → silent"
else
  ng "7: kill-switch ignored: $OUT"
fi
reset_log
OUT=$(export DISABLE_CLAUDEMD_HOOKS=1; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "8: DISABLE_CLAUDEMD_HOOKS=1 → silent"
else
  ng "8: global kill-switch ignored: $OUT"
fi

# --- Case 9: fail-open shapes ------------------------------------------------
reset_log
OUT=$(printf 'not json at all\n' | bash "$HOOK" 2>&1)
RC=$?
if [[ -z "$OUT" && "$RC" == "0" ]]; then
  ok "9: malformed event → exit 0, nothing on stdout or stderr"
else
  ng "9: malformed event produced rc=$RC out=$OUT"
fi
reset_log
OUT=$(printf '{}\n' | bash "$HOOK" 2>&1)
RC=$?
if [[ -z "$OUT" && "$RC" == "0" ]]; then
  ok "9b: empty event object → exit 0, silent"
else
  ng "9b: empty event produced rc=$RC out=$OUT"
fi
reset_log
OUT=$(run_hook "$PROJ" "$TMP_HOME/does-not-exist.jsonl")
FO=$(jq -r 'select(.hook=="ledger-staleness" and .event=="fail-open") | .extra.reason' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | head -n1)
if [[ -z "$OUT" && "$FO" == "transcript-missing" ]]; then
  ok "9c: a missing transcript records fail-open rather than guessing"
else
  ng "9c: expected a transcript-missing fail-open row, got out=$OUT row=$FO"
fi
reset_log
OUT=$(jq -cn --arg t "$TRANSCRIPT" '{hook_event_name:"Stop",session_id:"ls1",transcript_path:$t}' | bash "$HOOK" 2>&1)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "9d: an event with no cwd → silent (there is no project to resolve a ledger in)"
else
  ng "9d: fired with no cwd: $OUT"
fi

claudemd_assert_summary
