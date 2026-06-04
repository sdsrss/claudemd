#!/usr/bin/env bash
# session-end-check.test.sh — tests for v0.9.27 R-N10 SessionEnd hook
# enforcing core §11 "Session-exit mid-SPINE" HARD self-rule.
#
# Detection: between the last `user` transcript entry and the end of the
# transcript, count mutation tool_use (Edit/Write/NotebookEdit) and
# validate signals (Bash matching test-runner / lint / `git commit` /
# `git push` patterns). Mutations > 0 AND validates == 0 → write
# tasks/<slug>-paused.md + stderr warn + rule-hits row.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/session-end-check.sh"

TMP_HOME=$(mktemp -d -t claudemd-session-end-XXXXXX)
TMP_CWD=$(cd "$(mktemp -d -t claudemd-cwd-XXXXXX)" && pwd -P)
trap 'rm -rf "$TMP_HOME" "$TMP_CWD"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/.claudemd-state"
LOG="$HOME/.claude/logs/claudemd.jsonl"

FAIL=0
ok() { echo "PASS: $1"; }
ng() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# Transcript fixture builder. Each call appends a JSONL line.
make_transcript() {
  local f="$1"; shift
  : > "$f"
  for line in "$@"; do
    printf '%s\n' "$line" >> "$f"
  done
}

# Common JSONL shapes for the 3 entry kinds we exercise.
USER_MSG='{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Do X"}]}}'
TR_OK='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'
edit_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"a.js","old_string":"x","new_string":"y"}}]}}'
write_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"b.js","content":"x"}}]}}'
test_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"node --test tests/"}}]}}'
commit_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"git commit -m fix"}}]}}'
push_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"git push origin main"}}]}}'
read_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.js"}}]}}'

run_hook() {
  local transcript="$1"
  local event
  event=$(printf '{"hook_event_name":"SessionEnd","session_id":"x","transcript_path":"%s","cwd":"%s"}' \
    "$transcript" "$TMP_CWD")
  printf '%s' "$event" | bash "$HOOK" 2>"$TMP_HOME/stderr"
}

# Reset CWD tasks/ between cases.
reset_cwd() {
  rm -rf "$TMP_CWD/tasks"
  mkdir -p "$TMP_CWD/tasks"
}

# --- Case 1: Edit + Bash(test) → no warn, no paused.md -----------------------
reset_cwd
T="$TMP_HOME/case1.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$test_call" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]] && ! grep -q "mid-SPINE" "$TMP_HOME/stderr" 2>/dev/null; then
  ok "Case 1: Edit + test-runner → no warn, no paused.md"
else
  ng "Case 1: false-positive (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null), stderr=$(cat "$TMP_HOME/stderr"))"
fi

# --- Case 2: Edit only → warn + paused.md ------------------------------------
reset_cwd
T="$TMP_HOME/case2.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null && grep -q "mid-SPINE" "$TMP_HOME/stderr" 2>/dev/null; then
  ok "Case 2: Edit alone → warn + paused.md"
else
  ng "Case 2: missed (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null), stderr=$(cat "$TMP_HOME/stderr"))"
fi

# --- Case 3: Edit + Bash(git commit) → no warn (commit is validate signal) ---
reset_cwd
T="$TMP_HOME/case3.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$commit_call" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 3: Edit + git commit → no warn (commit validates)"
else
  ng "Case 3: false-positive (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null))"
fi

# --- Case 4: Write only → warn + paused.md ----------------------------------
reset_cwd
T="$TMP_HOME/case4.jsonl"
make_transcript "$T" "$USER_MSG" "$write_call" "$TR_OK"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
  ok "Case 4: Write alone → paused.md"
else
  ng "Case 4: missed (no paused.md, stderr=$(cat "$TMP_HOME/stderr"))"
fi

# --- Case 5: Read only → no warn (no mutations, read-only session) -----------
reset_cwd
T="$TMP_HOME/case5.jsonl"
make_transcript "$T" "$USER_MSG" "$read_call" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 5: Read-only session → no warn"
else
  ng "Case 5: false-positive on read-only (paused.md=$(ls "$TMP_CWD/tasks"))"
fi

# --- Case 6: Edit + Bash(push) → no warn (push is validate signal) -----------
reset_cwd
T="$TMP_HOME/case6.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$push_call" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 6: Edit + git push → no warn"
else
  ng "Case 6: false-positive (paused.md=$(ls "$TMP_CWD/tasks"))"
fi

# --- Case 7: kill-switch ------------------------------------------------------
reset_cwd
T="$TMP_HOME/case7.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
event=$(printf '{"hook_event_name":"SessionEnd","session_id":"x","transcript_path":"%s","cwd":"%s"}' \
  "$T" "$TMP_CWD")
DISABLE_SESSION_END_CHECK_HOOK=1 bash -c "printf '%s' '$event' | bash '$HOOK' 2>/dev/null"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 7: DISABLE_SESSION_END_CHECK_HOOK=1 → no write"
else
  ng "Case 7: kill-switch ignored (paused.md=$(ls "$TMP_CWD/tasks"))"
fi

# --- Case 8: missing transcript_path → fail-open silently --------------------
reset_cwd
event='{"hook_event_name":"SessionEnd","session_id":"x"}'
printf '%s' "$event" | bash "$HOOK" 2>"$TMP_HOME/stderr"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]] && [[ ! -s "$TMP_HOME/stderr" ]]; then
  ok "Case 8: missing transcript → fail-open"
else
  ng "Case 8: not silent (paused.md=$(ls "$TMP_CWD/tasks"), stderr=$(cat "$TMP_HOME/stderr"))"
fi

# --- Case 9: rule-hits row appended ------------------------------------------
reset_cwd
echo -n '' > "$LOG"
T="$TMP_HOME/case9.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
run_hook "$T"
if [[ -s "$LOG" ]] && grep -q '"hook":"session-end-check"' "$LOG" && grep -q '"event":"warn"' "$LOG"; then
  ok "Case 9: rule-hits row written for warn event"
else
  ng "Case 9: no rule-hits row (log=$(cat "$LOG"))"
fi

# --- Case 10 (v0.19.2 B1): L2+ session → batch-cadence counter increments ---
# This session has a deny event in rule-hits log → L2+. Counter starts at 0,
# should become 1 after hook runs. Use CLAUDEMD_BATCH_THRESHOLD=3 to keep test
# fast (assert behavior before threshold trip in this case).
reset_cwd
echo -n '' > "$LOG"
# Pre-seed rule-hits with a deny event tagged to session id "s10".
printf '%s\n' '{"ts":"2026-05-21T00:00:00Z","hook":"banned-vocab","event":"deny","session_id":"s10","spec_section":"§10-V","extra":null}' > "$LOG"
T="$TMP_HOME/case10.jsonl"
make_transcript "$T" "$USER_MSG"   # no mutations → mid-SPINE block does NOT fire
event=$(jq -cn --arg t "$T" --arg c "$TMP_CWD" --arg s "s10" \
  '{hook_event_name:"SessionEnd", transcript_path:$t, cwd:$c, session_id:$s}')
rm -f "$HOME/.claude/.claudemd-state/l2-task-counter"
printf '%s' "$event" | CLAUDEMD_BATCH_THRESHOLD=3 bash "$HOOK" 2>"$TMP_HOME/stderr.10"
COUNTER10=$(cat "$HOME/.claude/.claudemd-state/l2-task-counter" 2>/dev/null || echo "?")
if [[ "$COUNTER10" == "1" ]] && [[ ! -s "$TMP_HOME/stderr.10" ]]; then
  ok "Case 10 (B1): L2+ session → counter 0 → 1, no advisory yet"
else
  ng "Case 10: counter=$COUNTER10 stderr=$(cat "$TMP_HOME/stderr.10")"
fi

# --- Case 11 (v0.19.2 B1): counter trips threshold → advisory + reset to 0 ---
# Pre-seed counter to threshold-1 (= 2 when threshold=3) so the next L2+
# session trips it. Assert stderr contains the §13.2 cadence banner AND
# counter file content is "0" after the run AND a rule-hits row was appended
# with event=batch-cadence-advisory and spec_section=§13.2-batch-review.
reset_cwd
echo -n '' > "$LOG"
printf '%s\n' '{"ts":"2026-05-21T00:00:00Z","hook":"banned-vocab","event":"deny","session_id":"s11","spec_section":"§10-V","extra":null}' > "$LOG"
T="$TMP_HOME/case11.jsonl"
make_transcript "$T" "$USER_MSG"
event=$(jq -cn --arg t "$T" --arg c "$TMP_CWD" --arg s "s11" \
  '{hook_event_name:"SessionEnd", transcript_path:$t, cwd:$c, session_id:$s}')
printf '2' > "$HOME/.claude/.claudemd-state/l2-task-counter"
printf '%s' "$event" | CLAUDEMD_BATCH_THRESHOLD=3 bash "$HOOK" 2>"$TMP_HOME/stderr.11"
COUNTER11=$(cat "$HOME/.claude/.claudemd-state/l2-task-counter" 2>/dev/null || echo "?")
if [[ "$COUNTER11" == "0" ]] \
   && grep -q "§13.2 batch-review cadence" "$TMP_HOME/stderr.11" \
   && grep -q '"event":"batch-cadence-advisory"' "$LOG" \
   && grep -q '"spec_section":"§13.2-batch-review"' "$LOG"; then
  ok "Case 11 (B1): threshold trip → advisory + counter reset + audit row"
else
  ng "Case 11: counter=$COUNTER11 stderr=$(cat "$TMP_HOME/stderr.11") log_tail=$(tail -1 "$LOG")"
fi

# --- Case 12 (v0.19.2 B1): DISABLE_BATCH_CADENCE_ADVISORY=1 → no counter ----
# Sub-feature kill-switch must suppress the counter increment AND the advisory.
# The hook's other behavior (mid-SPINE warn) is unaffected — but case 12 has
# no mutations so mid-SPINE doesn't fire either; we just verify advisory off.
reset_cwd
echo -n '' > "$LOG"
printf '%s\n' '{"ts":"2026-05-21T00:00:00Z","hook":"banned-vocab","event":"deny","session_id":"s12","spec_section":"§10-V","extra":null}' > "$LOG"
T="$TMP_HOME/case12.jsonl"
make_transcript "$T" "$USER_MSG"
event=$(jq -cn --arg t "$T" --arg c "$TMP_CWD" --arg s "s12" \
  '{hook_event_name:"SessionEnd", transcript_path:$t, cwd:$c, session_id:$s}')
# Pre-seed at threshold-1 — without the kill-switch this WOULD trip.
printf '2' > "$HOME/.claude/.claudemd-state/l2-task-counter"
printf '%s' "$event" | CLAUDEMD_BATCH_THRESHOLD=3 DISABLE_BATCH_CADENCE_ADVISORY=1 bash "$HOOK" 2>"$TMP_HOME/stderr.12"
COUNTER12=$(cat "$HOME/.claude/.claudemd-state/l2-task-counter" 2>/dev/null || echo "?")
if [[ "$COUNTER12" == "2" ]] \
   && ! grep -q "§13.2 batch-review cadence" "$TMP_HOME/stderr.12" \
   && ! grep -q '"event":"batch-cadence-advisory"' "$LOG"; then
  ok "Case 12 (B1): DISABLE_BATCH_CADENCE_ADVISORY=1 → counter untouched, no advisory"
else
  ng "Case 12: counter=$COUNTER12 (expected 2), stderr=$(cat "$TMP_HOME/stderr.12")"
fi

# --- Case 13 (v0.19.2 B1): non-L2+ session (no qualifying events) → counter unchanged
# Rule-hits log has only `pass` / `bypass-escape-hatch` events — neither
# qualifies as L2+. Counter must stay at its prior value (pre-seed 0).
reset_cwd
echo -n '' > "$LOG"
printf '%s\n' '{"ts":"2026-05-21T00:00:00Z","hook":"ship-baseline","event":"pass","session_id":"s13","spec_section":"§7-ship-baseline","extra":null}' >> "$LOG"
printf '%s\n' '{"ts":"2026-05-21T00:00:00Z","hook":"banned-vocab","event":"bypass-escape-hatch","session_id":"s13","spec_section":"§10-V","extra":{"token":"allow-banned-vocab"}}' >> "$LOG"
T="$TMP_HOME/case13.jsonl"
make_transcript "$T" "$USER_MSG"
event=$(jq -cn --arg t "$T" --arg c "$TMP_CWD" --arg s "s13" \
  '{hook_event_name:"SessionEnd", transcript_path:$t, cwd:$c, session_id:$s}')
rm -f "$HOME/.claude/.claudemd-state/l2-task-counter"
printf '%s' "$event" | CLAUDEMD_BATCH_THRESHOLD=3 bash "$HOOK" 2>"$TMP_HOME/stderr.13"
# Counter file should NOT have been created (no L2+ hits → no increment branch).
if [[ ! -f "$HOME/.claude/.claudemd-state/l2-task-counter" ]] \
   && [[ ! -s "$TMP_HOME/stderr.13" ]]; then
  ok "Case 13 (B1): non-L2+ session (pass/bypass only) → counter untouched"
else
  ng "Case 13: counter exists=$(test -f "$HOME/.claude/.claudemd-state/l2-task-counter" && echo yes || echo no), value=$(cat "$HOME/.claude/.claudemd-state/l2-task-counter" 2>/dev/null), stderr=$(cat "$TMP_HOME/stderr.13")"
fi

# --- Case 14 (v0.23.11): a Bash command that merely MENTIONS a validate verb
# inside a quoted string / comment must NOT count as a validation. Pre-fix the
# detector was a bare substring test, so `echo "TODO: git commit later"`
# suppressed the mid-SPINE checkpoint despite zero real validation.
reset_cwd
echo_commit_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"echo \"TODO: git commit later\""}}]}}'
T="$TMP_HOME/case14.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$echo_commit_call" "$TR_OK"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null && grep -q "mid-SPINE" "$TMP_HOME/stderr" 2>/dev/null; then
  ok "Case 14: echo mentioning 'git commit' does NOT count as validate → paused.md written"
else
  ng "Case 14: substring FN — checkpoint suppressed by a mere mention (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null))"
fi

# --- Case 15 (FP guard for Case 14's anchor): a REAL test after `&&` still validates.
reset_cwd
chained_test_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"cd pkg && npm test"}}]}}'
T="$TMP_HOME/case15.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$chained_test_call" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 15: real 'cd pkg && npm test' still validates → no warn"
else
  ng "Case 15: anchor too strict — real chained validate missed (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null))"
fi

echo ""
echo "session-end-check: $([[ $FAIL -eq 0 ]] && echo PASS || echo "FAIL ($FAIL assertion(s))")"
exit $FAIL
