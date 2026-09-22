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
if [[ "$OUT" == *"none of them was a test / typecheck / build runner"* && "$(log_rows)" == "1" ]]; then
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

# --- Case 15 (pre-ship H1): the verdict line lands at the END of the output ---
# Every common runner prints its summary last. A head-truncated read of the
# result therefore misses exactly the line that carries the evidence, and the
# hook nags a correct claim — the expensive direction for an advisory.
LONG_PAD=$(head -c 2000 /dev/zero | tr '\0' 'x')
{
  row_edit /p/src/a.js
  row_bash tu_long "npm test"
  row_result tu_long "$LONG_PAD Tests: 18/18 passed"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ -z "$OUT" ]]; then
  ok "15: a runner summary 2000 chars into the output still counts as evidence"
else
  ng "15: nagged a claim backed by a real run whose summary is not in the first bytes: $OUT"
fi

# --- Case 16 (pre-ship H2): silent-success verifiers ------------------------
# tsc / eslint print NOTHING when clean, and the runner NAME lives in the
# command, not in the output. Matching runner names against the output made
# `lint + typecheck` — the literal §7 L1 row — read as "no evidence".
EG_QUIET_OK=1
eg_quiet_case() {
  {
    row_edit /p/src/a.js
    row_bash tu_q "$1"
    row_result tu_q "$2"
    row_text "$DONE_CLAIM"
  } > "$TRANSCRIPT"
  local o
  o=$(run_hook "$DONE_CLAIM")
  if [[ -n "$o" ]]; then
    EG_QUIET_OK=0
    echo "      still fires for: $1"
  fi
}
reset_log
eg_quiet_case "npx tsc --noEmit" ""
eg_quiet_case "npx eslint ." ""
eg_quiet_case "npx prettier --check ." "All matched files use Prettier code style!"
eg_quiet_case "go test ./..." "ok  	github.com/acme/foo	0.012s"
eg_quiet_case "cargo clippy --all-targets" ""
if [[ "$EG_QUIET_OK" == "1" ]]; then
  ok "16: a verifier that exits clean with no output is evidence — the command says so"
else
  ng "16: at least one silent-success verifier still reads as no-evidence"
fi

# Control for case 16: widening to the command must not make EVERY command
# count. `git status` is still not verification.
{
  row_edit /p/src/a.js
  row_bash tu_ctl "git status --porcelain"
  row_result tu_ctl " M src/a.js"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"none of them was a test / typecheck / build runner"* ]]; then
  ok "16b: control — git status is still not a verifier after the widening"
else
  ng "16b: the command-side widening swallowed the T3 arm: $OUT"
fi

# --- Case 17 (pre-ship M4): a backgrounded run's output arrives on BashOutput --
# `Bash(run_in_background)` answers its own call with "Command running in
# background"; the real output comes later on a BashOutput tool_use with a
# different id. Joining only on Bash ids discarded it, so verifying in the
# background read as no verification at all.
{
  row_edit /p/src/a.js
  row_bash tu_bg "npm test &"
  row_result tu_bg "Command running in background with ID: bash_1"
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_bo",name:"BashOutput",input:{bash_id:"bash_1"}}]}}'
  row_result tu_bo "Tests: 12 passed, 12 total"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ -z "$OUT" ]]; then
  ok "17: a BashOutput carrying the runner verdict counts as evidence"
else
  ng "17: background verification still reads as no-evidence: $OUT"
fi

# Control: a BashOutput carrying nothing runner-shaped must NOT count. The
# BashOutput is indexed with an empty command on purpose — only its output can
# satisfy T2, because we know what it printed and not what was run.
{
  row_edit /p/src/a.js
  row_bash tu_bg2 "./long-thing &"
  row_result tu_bg2 "Command running in background with ID: bash_2"
  jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_bo2",name:"BashOutput",input:{bash_id:"bash_2"}}]}}'
  row_result tu_bo2 "still working on it"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ "$OUT" == *"none of them was a test / typecheck / build runner"* ]]; then
  ok "17b: control — a BashOutput with no runner verdict is still not evidence"
else
  ng "17b: an empty-signal BashOutput satisfied the gate: $OUT"
fi

# --- Case 18 (pre-ship L4): a tab in the output must not truncate the scan ----
# awk splits the stream on tabs, so an untranslated tab in the result body cut
# `rtxt` at the first one — go test's own output is tab-separated.
{
  row_edit /p/src/a.js
  row_bash tu_tab "./run-checks"
  row_result tu_tab "$(printf 'header\tcolumn\tnoise')  Tests: 9 passed"
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$DONE_CLAIM")
if [[ -z "$OUT" ]]; then
  ok "18: a verdict after a tab is still seen (tabs normalised before awk splits)"
else
  ng "18: tab truncated the output scan: $OUT"
fi

# --- Case 19 (pre-ship M3): the completion shapes this corpus actually uses ---
# A replay of this project's 22 transcripts matched their final assistant
# message ONCE. A detector that cannot see the corpus collects nothing in 30
# days, which makes the §13.3 promotion decision uninterpretable.
{
  row_edit /p/src/a.js
  row_text "x"
} > "$TRANSCRIPT"
reset_log
EG_SHAPES_OK=1
for msg in '发布完成。' '清理完成。' '审核完成,报告已生成' '**v0.78.0 已发布。**' 'v0.75.0 已实现' '**Shipped: v0.84.1.**'; do
  O=$(run_hook "$msg")
  [[ "$O" == *"Iron Law #2"* ]] || {
    EG_SHAPES_OK=0
    echo "      shape not detected: $msg"
  }
done
if [[ "$EG_SHAPES_OK" == "1" ]]; then
  ok "19: the corpus's own completion shapes (完成。/ 已发布 / 已实现 / Shipped:) register"
else
  ng "19: at least one real completion shape is still invisible"
fi

# Control: widening a CLAIM detector costs false positives, so prose that is
# merely ABOUT finishing must still not register.
EG_NEG_OK=1
for msg in '我还没完成这件事,下一步是先复现' 'Not done: the marketplace gate.' 'I will finish this after the review.'; do
  O=$(run_hook "$msg")
  [[ -z "$O" ]] || {
    EG_NEG_OK=0
    echo "      false claim detected in: $msg"
  }
done
if [[ "$EG_NEG_OK" == "1" ]]; then
  ok "19b: control — prose about not-finishing is not a completion claim"
else
  ng "19b: the widening produced a false completion claim"
fi

# --- Case 20: CommonJS extensions count as code edits (v0.91.0) -------------
# Until v0.91.0 this regex omitted `.cjs` and `.cts`, which rework-breaker.sh
# has carried since v0.90.0, while a comment in each file said the three copies
# were one list. A CommonJS-only session therefore read as "no code edit" here
# and as code work next door. tests/scripts/code-ext-parity.test.js now holds
# the three to each other; this case is the behavioural half on this hook.
EG_CJS_OK=1
for ext in cjs cts; do
  {
    row_edit "/p/src/mod.$ext"
    row_text "$DONE_CLAIM"
  } > "$TRANSCRIPT"
  reset_log
  O=$(run_hook "$DONE_CLAIM")
  [[ "$O" == *"Iron Law #2"* ]] || {
    EG_CJS_OK=0
    echo "      .$ext edit did not register as a code edit"
  }
done
if [[ "$EG_CJS_OK" == "1" ]]; then
  ok "20: .cjs and .cts edits register as code work (parity with rework-breaker.sh)"
else
  ng "20: a CommonJS session still reads as no-code-edit"
fi
# Control: an extension outside the list still reads as no code edit, so case
# 20 is about those two extensions and not about everything matching.
{
  row_edit /p/docs/readme.md
  row_text "$DONE_CLAIM"
} > "$TRANSCRIPT"
reset_log
O=$(run_hook "$DONE_CLAIM")
if [[ -z "$O" && "$(log_rows)" == "0" ]]; then
  ok "20b: control — a .md edit is still not code work"
else
  ng "20b: the widening swallowed a non-code extension: $O"
fi

echo
claudemd_assert_summary
