#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
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

TMP_HOME=$(mktemp -d -t claudemd-session-end-XXXXXX) || { echo "FAIL: mktemp -d failed"; exit 1; }
# Two steps, not `TMP_CWD=$(cd "$(mktemp -d …)" && pwd -P)`. That one-liner fails
# OPEN: on mktemp failure the substitution is empty, `cd ""` returns 0, and
# `pwd -P` prints the CURRENT directory — the EXIT trap then `rm -rf`s the repo.
TMP_CWD=$(mktemp -d -t claudemd-cwd-XXXXXX) || { echo "FAIL: mktemp -d failed"; exit 1; }
TMP_CWD=$(cd "$TMP_CWD" && pwd -P) || { echo "FAIL: cannot resolve $TMP_CWD"; exit 1; }
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
# Real CC writes a human-typed prompt as STRING content (not an array). The
# array-only USER_MSG above masked a bug where jq `any(.type=="text")` threw
# "Cannot iterate over string" on this shape, erroring the whole filter under
# 2>/dev/null and silently no-op'ing the hook in every real session.
USER_MSG_STR='{"type":"user","message":{"role":"user","content":"修复这个 bug"}}'
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

# --- Case 2b: STRING-content user msg + Edit only → warn + paused.md ---------
# Regression: the real-CC string-content prompt shape must still find the last
# user message, slice forward, and detect the unvalidated mutation. Pre-fix
# this silently no-op'd (jq iterate-over-string error swallowed by 2>/dev/null).
reset_cwd
T="$TMP_HOME/case2b.jsonl"
make_transcript "$T" "$USER_MSG_STR" "$edit_call" "$TR_OK"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null && grep -q "mid-SPINE" "$TMP_HOME/stderr" 2>/dev/null; then
  ok "Case 2b: string-content user + Edit → warn + paused.md"
else
  ng "Case 2b: string-content user missed (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null), stderr=$(cat "$TMP_HOME/stderr"))"
fi

# --- Case 2c: STRING-content user msg + Edit + test → no warn ----------------
# The string-shape path must also correctly count validates (not just bail).
reset_cwd
T="$TMP_HOME/case2c.jsonl"
make_transcript "$T" "$USER_MSG_STR" "$edit_call" "$TR_OK" "$test_call" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 2c: string-content user + Edit + test → no warn"
else
  ng "Case 2c: false-positive (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null))"
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

# --- Case 16 (v0.62.0 pre-tag review): a validate BEFORE the mutation does not
# validate it. `npm test` → `Edit` must still write the checkpoint. Order
# independence was latent (any validate anywhere in the slice suppressed) and
# went live when the shared turn-boundary predicate stopped treating an isMeta
# `!command` caveat row as a boundary — correct in itself, but it widened the
# slice so the earlier `npm test` began landing inside it.
reset_cwd
test_then_edit_test='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm test"}}]}}'
meta_caveat='{"type":"user","isMeta":true,"message":{"role":"user","content":"Caveat: The messages below were generated by the user while running a local command."}}'
T="$TMP_HOME/case16.jsonl"
make_transcript "$T" "$USER_MSG" "$test_then_edit_test" "$TR_OK" "$meta_caveat" "$edit_call" "$TR_OK"
run_hook "$T"
if [[ -n "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 16: validate BEFORE the mutation does not suppress the checkpoint"
else
  ng "Case 16: checkpoint suppressed by a pre-mutation validate (order-independent count)"
fi

# --- Case 17 (FP guard for Case 16): validate AFTER the mutation still suppresses.
reset_cwd
T="$TMP_HOME/case17.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$test_then_edit_test" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 17: validate AFTER the mutation still counts → no checkpoint"
else
  ng "Case 17: post-mutation validate no longer suppresses (over-correction)"
fi


# --- Case 18 (hook-root ground truth): a SessionEnd invocation records the
# real plugin root into a sandbox HOME carrying no prior record — the
# fallback path for a session whose SessionStart hook never ran (disabled, or
# a session that started before this writer shipped).
reset_cwd
RESOLVED_PLUGIN_ROOT="$(cd "$HERE/../.." && pwd)"
HOOKROOT_STATE="$HOME/.claude/.claudemd-state/hook-root.json"
rm -f "$HOOKROOT_STATE"
T="$TMP_HOME/case18.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
run_hook "$T"
if [[ -f "$HOOKROOT_STATE" ]] && grep -qF "\"root\":\"$RESOLVED_PLUGIN_ROOT\"" "$HOOKROOT_STATE" 2>/dev/null; then
  ok "Case 18: SessionEnd records the real plugin root with no prior record"
else
  ng "Case 18: SessionEnd did not record the plugin root (state: $(cat "$HOOKROOT_STATE" 2>/dev/null))"
fi

# --- Case 19 (converge round 9): the checkpoint must not tell the user it saw
# zero validations when it saw one. Case 16 pins the BEHAVIOUR of a validate
# that precedes the mutation — the checkpoint still fires, correctly. Nothing
# pinned the SENTENCE the user then reads, and it was left behind by the same
# change: `validates` is reset to 0 by each mutation, so it counts validations
# AFTER the last mutation, while the prose read as a count over the whole
# slice. A maintainer who ran the suite and then edited one file was told the
# session contained no test run at all.
reset_cwd
T="$TMP_HOME/case19.jsonl"
make_transcript "$T" "$USER_MSG" "$test_then_edit_test" "$TR_OK" "$edit_call" "$TR_OK"
run_hook "$T"
PAUSED_MD=$(compgen -G "$TMP_CWD/tasks/*-paused.md" 2>/dev/null | head -1)
if [[ -z "$PAUSED_MD" ]]; then
  ng "Case 19: control failed — this shape must still write a checkpoint (Case 16)"
elif grep -qF '0 VALIDATE signals' "$PAUSED_MD"; then
  ng "Case 19: checkpoint claims '0 VALIDATE signals' after a validate ran in the slice"
elif ! grep -qi 'after the last mutation' "$PAUSED_MD"; then
  ng "Case 19: checkpoint does not say the count is scoped to after the last mutation"
else
  ok "Case 19: checkpoint describes the validate count it actually computed"
fi

# --- Case 20 (analysis 2026-09-26 B1): a Bash command that modified a file is
# a mutation. Claude Code records the files on the result row as bashEditDiff,
# and under Opus 5.5 most edits take that route, so a checkpoint keyed on
# Edit/Write alone never fired for those sessions.
bash_edit_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tb","name":"Bash","input":{"command":"python3 - <<PY"}}]}}'
# The edited file sits inside the project (TMP_CWD): only those count (Case 25).
TR_BASH_EDIT='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tb","content":""}]},"toolUseResult":{"stdout":"","bashEditDiff":{"files":[{"filePath":"__ROOT__/src/c.py","hunks":[]}]}}}'
TR_BASH_EDIT=${TR_BASH_EDIT//__ROOT__/$TMP_CWD}
TR_BASH_PLAIN='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tb","content":""}]},"toolUseResult":{"stdout":""}}'
reset_cwd
T="$TMP_HOME/case20.jsonl"
make_transcript "$T" "$USER_MSG" "$bash_edit_call" "$TR_BASH_EDIT"
run_hook "$T"
PAUSED_MD=$(compgen -G "$TMP_CWD/tasks/*-paused.md" 2>/dev/null | head -1)
if [[ -n "$PAUSED_MD" ]] && grep -qF "Bash: $TMP_CWD/src/c.py" "$PAUSED_MD"; then
  ok "Case 20: a Bash file edit with no validation → checkpoint naming the file"
else
  ng "Case 20: bashEditDiff mutation missed (paused.md=$(ls "$TMP_CWD/tasks" 2>/dev/null))"
fi
# Case 20e (D#96 L1): "Last mutation tool call(s)" keeps the LAST three files
# in the order Claude Code recorded them. jq's `unique` sorted the paths, so a
# command that changed z, a, m, b listed b, m, z (140 of 8,306 real windows).
TR_BASH_ORDER='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tb","content":""}]},"toolUseResult":{"stdout":"","bashEditDiff":{"files":[{"filePath":"__ROOT__/z.py","hunks":[]}],"changedFiles":["__ROOT__/z.py","__ROOT__/a.py","__ROOT__/m.py","__ROOT__/b.py"]}}}'
TR_BASH_ORDER=${TR_BASH_ORDER//__ROOT__/$TMP_CWD}
reset_cwd
T="$TMP_HOME/case20c.jsonl"
make_transcript "$T" "$USER_MSG" "$bash_edit_call" "$TR_BASH_ORDER"
run_hook "$T"
PAUSED_MD=$(compgen -G "$TMP_CWD/tasks/*-paused.md" 2>/dev/null | head -1)
LISTED=$(grep -oE "^- Bash: .*" "$PAUSED_MD" 2>/dev/null | sed "s|- Bash: $TMP_CWD/||" | tr '\n' ' ')
if [[ "$LISTED" == "a.py m.py b.py " ]]; then
  ok "Case 20e: the paused list keeps the recorded order (a m b), each file once"
else
  ng "Case 20e: paused list is '$LISTED', expected 'a.py m.py b.py '"
fi
# Control: the SAME Bash call whose result carries no bashEditDiff is not a
# mutation, so Case 20 is about the recorded edit and not about Bash calls.
reset_cwd
T="$TMP_HOME/case20b.jsonl"
make_transcript "$T" "$USER_MSG" "$bash_edit_call" "$TR_BASH_PLAIN"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 20b: control — a Bash call with no recorded edit is not a mutation"
else
  ng "Case 20b: a plain Bash call wrote a checkpoint"
fi
# Edit then test in ONE command validates itself: the join places the mutation
# before that command's own validate test.
bash_edit_test_call='{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tb","name":"Bash","input":{"command":"python3 - <<PY && node --test tests/"}}]}}'
reset_cwd
T="$TMP_HOME/case20c.jsonl"
make_transcript "$T" "$USER_MSG" "$bash_edit_test_call" "$TR_BASH_EDIT"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 20c: edit + test runner in one Bash command → validated, no checkpoint"
else
  ng "Case 20c: an edit-then-test command read as unvalidated"
fi
# And a test run BEFORE the Bash edit does not validate it.
reset_cwd
T="$TMP_HOME/case20d.jsonl"
make_transcript "$T" "$USER_MSG" "$test_call" "$TR_OK" "$bash_edit_call" "$TR_BASH_EDIT"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
  ok "Case 20d: a test run before the Bash edit does not validate it"
else
  ng "Case 20d: an earlier validate suppressed a later Bash-edit checkpoint"
fi

# --- Case 21 (review L7): an assistant row whose content is a STRING, not an
# array. `[] + "text"` threw inside the flatten, jq exited under 2>/dev/null,
# RESULT came back empty and the hook exited 0 — no checkpoint for the edit
# that preceded it.
ASSIST_STR='{"type":"assistant","message":{"role":"assistant","content":"plain text reply"}}'
reset_cwd
T="$TMP_HOME/case21.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$ASSIST_STR"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
  ok "Case 21: a string-content assistant row does not blind the checkpoint"
else
  ng "Case 21: string-content assistant row suppressed the checkpoint"
fi

# --- Case 22 (0.99.0 pre-tag review M1): changedFiles is the complete list ---
TR_BASH_CF='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tb","content":""}]},"toolUseResult":{"stdout":"","bashEditDiff":{"files":[],"moreFiles":1,"changedFiles":["__ROOT__/src/cf.py"]}}}'
TR_BASH_CF=${TR_BASH_CF//__ROOT__/$TMP_CWD}
reset_cwd
T="$TMP_HOME/case22.jsonl"
make_transcript "$T" "$USER_MSG" "$bash_edit_call" "$TR_BASH_CF"
run_hook "$T"
PAUSED_MD=$(compgen -G "$TMP_CWD/tasks/*-paused.md" 2>/dev/null | head -1)
if [[ -n "$PAUSED_MD" ]] && grep -qF "Bash: $TMP_CWD/src/cf.py" "$PAUSED_MD"; then
  ok "Case 22: a file named only in changedFiles is a mutation"
else
  ng "Case 22: changedFiles-only Bash edit missed"
fi

# --- Case 23 (0.99.0 pre-tag review M4): no row shape may blind the hook -----
# Each shape is appended after an unvalidated Edit; every one must still leave
# the checkpoint. Before the fix each made jq error under 2>/dev/null.
SHAPE_I=0
for SHAPE in \
  '{"type":"assistant","message":"x"}' \
  '{"type":"assistant","message":{"content":["x"]}}' \
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t9","name":"Bash","input":"ls"}]}}' \
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":5,"name":"Bash","input":{"command":"ls"}}]}}' \
  '5' '"x"' '[1]' \
  '{"type":"user","message":"x","toolUseResult":{"stdout":""}}' \
  '{"type":"user","message":{"content":["x"]},"toolUseResult":{"stdout":""}}'; do
  SHAPE_I=$((SHAPE_I + 1))
  reset_cwd
  T="$TMP_HOME/case23-$SHAPE_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$SHAPE"
  run_hook "$T"
  if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
    ok "Case 23.$SHAPE_I: checkpoint survives row shape $SHAPE"
  else
    ng "Case 23.$SHAPE_I: row shape $SHAPE suppressed the checkpoint"
  fi
done

# --- Case 23b (D#96, 0.99.0 second review M3): the turn's own prompt is a text
# block whose `text` is not a string. is_user_turn's join() threw on it, so the
# hook wrote no checkpoint; 0 of 21,620 real text blocks have this shape, and the
# JS twin (transcript-user-turn.js) already reads it as ''.
SHAPE_I=0
for SHAPE in \
  '{"type":"user","message":{"content":[{"type":"text","text":{"a":1}}]}}' \
  '{"type":"user","message":{"content":[{"type":"text","text":["x"]}]}}'; do
  SHAPE_I=$((SHAPE_I + 1))
  reset_cwd
  T="$TMP_HOME/case23b-$SHAPE_I.jsonl"
  make_transcript "$T" "$SHAPE" "$edit_call" "$TR_OK"
  run_hook "$T"
  if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
    ok "Case 23b.$SHAPE_I: checkpoint survives a non-string prompt text $SHAPE"
  else
    ng "Case 23b.$SHAPE_I: non-string prompt text $SHAPE suppressed the checkpoint"
  fi
done

# --- Case 24 (claude-mem-lite session 8b475d66): real validation commands are
# run through a runner prefix, an env assignment, `timeout`, or a subshell. The
# command-position anchor used to require the tool name itself there, so
# `npx vitest run` — the most frequent validate head in 30,372 local Bash
# commands — never counted, and a vitest repo got a checkpoint after every
# green run. Each command below follows an unvalidated Edit and must validate it.
bash_call() { jq -cn --arg c "$1" '{type:"assistant",message:{role:"assistant",content:[{type:"tool_use",id:"t1",name:"Bash",input:{command:$c}}]}}'; }
V_I=0
for V_CMD in \
  'npx vitest run tests/a.test.mjs' \
  'cd /r && npx eslint .' \
  'npm run test:coverage' \
  'npm run -s lint' \
  'FOO=1 npm test' \
  '(timeout 900 cargo test --lib > log 2>&1)' \
  'python3 -m pytest -q' \
  'node --require ./t.cjs --test tests/x.js' \
  'npx --no-install prettier --check .' \
  'pnpm lint' \
  'make test-js'; do
  V_I=$((V_I + 1))
  reset_cwd
  T="$TMP_HOME/case24-$V_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$(bash_call "$V_CMD")" "$TR_OK"
  run_hook "$T"
  if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
    ok "Case 24.$V_I: '$V_CMD' validates"
  else
    ng "Case 24.$V_I: '$V_CMD' did not count as a validation"
  fi
done
# Controls: a mention of the same verbs, or a runner doing something that is not
# a check, still leaves the checkpoint. Without these the loop above would pass
# for a regex that matched everything.
N_I=0
for N_CMD in \
  'echo "npx vitest"' \
  'grep -n "npm run\|npm test" README.md' \
  'npm run format' \
  'npx prettier --write .' \
  'npm install eslint' \
  "python3 - <<'PY'"$'\n'"s=s.replace(a,b)"$'\n'"PY"; do
  N_I=$((N_I + 1))
  reset_cwd
  T="$TMP_HOME/case24n-$N_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$(bash_call "$N_CMD")" "$TR_OK"
  run_hook "$T"
  if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
    ok "Case 24n.$N_I: control '$N_CMD' is not a validation"
  else
    ng "Case 24n.$N_I: control '$N_CMD' read as a validation"
  fi
done

# --- Case 25 (claude-mem-lite session 8b475d66): only a change to the project
# is a mutation. The session committed, then edited an auto-memory file under
# ~/.claude/projects/*/memory/, and the hook wrote a checkpoint claiming 12
# unvalidated mutations — no test run in the project can validate a note.
edit_at() { jq -cn --arg p "$1" '{type:"assistant",message:{role:"assistant",content:[{type:"tool_use",id:"t1",name:"Edit",input:{file_path:$p,old_string:"x",new_string:"y"}}]}}'; }
P_I=0
for P_PATH in \
  "$HOME/.claude/projects/x/memory/y.md" \
  "/tmp/claude-1000/-p/0b0e8a8c-0000-4000-8000-000000000000/scratchpad/n.md" \
  "$TMP_HOME/elsewhere/repo/z.js"; do
  P_I=$((P_I + 1))
  reset_cwd
  T="$TMP_HOME/case25-$P_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$commit_call" "$TR_OK" "$(edit_at "$P_PATH")" "$TR_OK"
  run_hook "$T"
  if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
    ok "Case 25.$P_I: a post-commit edit outside the project ($P_PATH) is not a mutation"
  else
    ng "Case 25.$P_I: an edit outside the project ($P_PATH) wrote a checkpoint"
  fi
done
# Control: the same sequence ending in an edit INSIDE the project still writes it.
reset_cwd
T="$TMP_HOME/case25c.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$commit_call" "$TR_OK" "$(edit_at "$TMP_CWD/src/z.js")" "$TR_OK"
run_hook "$T"
PAUSED_MD=$(compgen -G "$TMP_CWD/tasks/*-paused.md" 2>/dev/null | head -1)
if [[ -n "$PAUSED_MD" ]] && grep -qF "Edit: $TMP_CWD/src/z.js" "$PAUSED_MD"; then
  ok "Case 25c: control — a post-commit edit inside the project still writes the checkpoint"
else
  ng "Case 25c: an in-project edit after the commit was missed"
fi
# The Bash channel takes the same filter: a bashEditDiff naming only a memory
# file is not a mutation, while the in-project one (Case 20) is.
TR_BASH_MEM=${TR_BASH_EDIT//$TMP_CWD\/src\/c.py/$HOME/.claude/projects/x/memory/y.md}
reset_cwd
T="$TMP_HOME/case25b.jsonl"
make_transcript "$T" "$USER_MSG" "$commit_call" "$TR_OK" "$bash_edit_call" "$TR_BASH_MEM"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 25b: a Bash edit of a memory file only is not a mutation"
else
  ng "Case 25b: a Bash edit outside the project wrote a checkpoint"
fi
# The exclusion zones hold even when a root CONTAINS them — a session run from
# $HOME, or one whose CLAUDE_PROJECT_DIR is /tmp. Cases 25.1/25.2 alone pass on
# the root check without ever reaching the zone arm (mutation: drop the zone
# test and they stay green), so the root here is widened to cover each zone.
Z_I=0
for Z in \
  "$HOME|$HOME/.claude/projects/x/memory/y.md" \
  "/tmp|/tmp/claude-1000/-p/0b0e8a8c-0000-4000-8000-000000000000/scratchpad/n.md"; do
  Z_I=$((Z_I + 1))
  reset_cwd
  T="$TMP_HOME/case25e-$Z_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$commit_call" "$TR_OK" "$(edit_at "${Z#*|}")" "$TR_OK"
  CLAUDE_PROJECT_DIR="${Z%%|*}" run_hook "$T"
  if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
    ok "Case 25e.$Z_I: root ${Z%%|*} contains the zone, the edit of ${Z#*|} is still excluded"
  else
    ng "Case 25e.$Z_I: root ${Z%%|*} let an edit of ${Z#*|} count as a mutation"
  fi
done
# A session whose own project lives under ~/.claude keeps its edits counted: the
# exclusion covers paths outside the root, not a root inside the zone.
CLAUDE_ROOT="$HOME/.claude/proj"
mkdir -p "$CLAUDE_ROOT"
T="$TMP_HOME/case25d.jsonl"
make_transcript "$T" "$USER_MSG" "$(edit_at "$CLAUDE_ROOT/a.js")" "$TR_OK"
printf '%s' "$(jq -cn --arg t "$T" --arg c "$CLAUDE_ROOT" '{hook_event_name:"SessionEnd",session_id:"x",transcript_path:$t,cwd:$c}')" \
  | bash "$HOOK" 2>/dev/null
if compgen -G "$CLAUDE_ROOT/tasks/*-paused.md" >/dev/null; then
  ok "Case 25d: a project rooted under ~/.claude still counts its own edits"
else
  ng "Case 25d: an in-project edit was dropped because the project sits under ~/.claude"
fi

# --- Case 26: the reported count is the changes made AFTER the last validation.
# The headline used to be every mutation in the slice: a session that ran the
# suite and committed, then touched one more file, was told "N unvalidated" for
# N changes of which N-1 were covered, and the "last 3" list showed validated
# files beside the open one. Replaying 196 local transcripts, 5 of the 10 that
# wrote a checkpoint over-reported (54 reported against 27 open).
reset_cwd
echo -n '' > "$LOG"
T="$TMP_HOME/case26.jsonl"
make_transcript "$T" "$USER_MSG" "$(edit_at "$TMP_CWD/a.js")" "$TR_OK" "$test_call" "$TR_OK" \
  "$(edit_at "$TMP_CWD/b.js")" "$TR_OK" "$(edit_at "$TMP_CWD/c.js")" "$TR_OK"
run_hook "$T"
PAUSED_MD=$(compgen -G "$TMP_CWD/tasks/*-paused.md" 2>/dev/null | head -1)
if [[ -z "$PAUSED_MD" ]]; then
  ng "Case 26: control failed — edits after the last validation must still write a checkpoint"
else
  grep -qF '2 unvalidated change(s) after the last validation (3 in this turn)' "$TMP_HOME/stderr" \
    && ok "Case 26a: stderr leads with the 2 open changes and gives the turn's 3 as context" \
    || ng "Case 26a: stderr count wrong ($(cat "$TMP_HOME/stderr"))"
  grep -qF '**2 change(s) after the last validation**' "$PAUSED_MD" \
    && ok "Case 26b: paused.md headline is the open count" \
    || ng "Case 26b: paused.md headline is not the open count"
  if grep -qF "Edit: $TMP_CWD/b.js" "$PAUSED_MD" && grep -qF "Edit: $TMP_CWD/c.js" "$PAUSED_MD" \
     && ! grep -qF "Edit: $TMP_CWD/a.js" "$PAUSED_MD"; then
    ok "Case 26c: the list holds the open changes b and c, not the validated a"
  else
    ng "Case 26c: list wrong ($(sed -n '/## Unvalidated/,/## Source/p' "$PAUSED_MD" | tr '\n' '|'))"
  fi
  jq -e 'select(.hook == "session-end-check" and .event == "warn") | .extra | .open == 2 and .mutations == 3' "$LOG" >/dev/null \
    && ok "Case 26d: rule-hits row carries open 2 beside the unchanged mutations 3" \
    || ng "Case 26d: rule-hits extra wrong ($(grep session-end-check "$LOG"))"
fi

# --- Case 27 (0.100.0 pre-tag review F6/F7, D#102): recognizer gaps. Each of
# these runs a test suite, and each left a false checkpoint: option-taking
# `timeout`, `env` / `nice` wrappers, a quoted assignment value, npm's own
# options before the verb, `uv run`, and `bash -c '…'`, which 0.99.0 matched
# before the command-position anchor went in.
V_I=0
for V_CMD in \
  'timeout -k 5 120 npm test' \
  'env CI=1 npm test' \
  'nice -n 10 npm test' \
  'FOO="a b" npm test' \
  'npm --prefix pkg test' \
  'npm -w pkg run test' \
  'uv run pytest -q' \
  "bash -c 'cd x && npm test'" \
  'npm test tests/foo.test.js' \
  'npm test "pattern"' \
  'npm test # comment' \
  'npm --silent test'; do
  V_I=$((V_I + 1))
  reset_cwd
  T="$TMP_HOME/case27-$V_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$(bash_call "$V_CMD")" "$TR_OK"
  run_hook "$T"
  if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
    ok "Case 27.$V_I: '$V_CMD' validates"
  else
    ng "Case 27.$V_I: '$V_CMD' did not count as a validation"
  fi
done
# Controls: a script whose NAME merely contains a keyword (publish:latest holds
# "test"), and a `bash -c` whose inner command only mentions one.
N_I=0
for N_CMD in \
  'npm run publish:latest' \
  'pnpm run release-latest' \
  "bash -c 'echo npm test'" \
  'env FOO=1 npm run build' \
  'npm --prefix test install' \
  'npm -w test install' \
  'npm --workspace t ci' \
  'npm -C test ls' \
  'npm --prefix test --no-audit install' \
  'npm -w test --if-present run build' \
  'npm -C test -- install' \
  'npm --prefix test 2>&1 install' \
  'npm --prefix test|cat' \
  'npm -w test && echo done'; do
  N_I=$((N_I + 1))
  reset_cwd
  T="$TMP_HOME/case27n-$N_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$(bash_call "$N_CMD")" "$TR_OK"
  run_hook "$T"
  if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
    ok "Case 27n.$N_I: control '$N_CMD' is not a validation"
  else
    ng "Case 27n.$N_I: control '$N_CMD' read as a validation"
  fi
done

# --- Case 28 (0.100.0 pre-tag review F8, D#102): root and path shape. With a
# root of `/` every absolute path is in the project (the trailing-slash strip
# made the root empty, so none was); a `..` walk out of the root is not in it.
reset_cwd
T="$TMP_HOME/case28a.jsonl"
make_transcript "$T" "$USER_MSG" "$commit_call" "$TR_OK" "$(edit_at "/etc/claudemd-case28.conf")" "$TR_OK"
CLAUDE_PROJECT_DIR="/" run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
  ok "Case 28a: with root /, an edit of /etc/… after the commit is a mutation"
else
  ng "Case 28a: root / counted no absolute path"
fi
reset_cwd
T="$TMP_HOME/case28b.jsonl"
make_transcript "$T" "$USER_MSG" "$commit_call" "$TR_OK" "$(edit_at "$TMP_CWD/../elsewhere/x.js")" "$TR_OK"
run_hook "$T"
if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
  ok "Case 28b: an edit of <root>/../elsewhere/x.js is outside the project"
else
  ng "Case 28b: a .. walk out of the root counted as a mutation"
fi
reset_cwd
T="$TMP_HOME/case28c.jsonl"
make_transcript "$T" "$USER_MSG" "$commit_call" "$TR_OK" "$(edit_at "$TMP_CWD/src/../src/x.js")" "$TR_OK"
run_hook "$T"
if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
  ok "Case 28c: control — a .. that stays inside the root is still a mutation"
else
  ng "Case 28c: normalising dropped an in-project edit"
fi

# --- Case 29 (D#102 F7 remainder): `env -u NAME` takes a value, and a runner
# called by its node_modules/.bin path is the runner. Real shape, ~7 times in
# claude-mem-lite sessions: `env -u CLAUDE_MEM_DIR ./node_modules/.bin/vitest run`.
V_I=0
for V_CMD in \
  'env -u CLAUDE_MEM_DIR ./node_modules/.bin/vitest run' \
  'env -u A -u B bash tests/run-all.sh' \
  'env --unset FOO npm test' \
  'node_modules/.bin/jest --ci'; do
  V_I=$((V_I + 1))
  reset_cwd
  T="$TMP_HOME/case29-$V_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$(bash_call "$V_CMD")" "$TR_OK"
  run_hook "$T"
  if [[ -z "$(ls -A "$TMP_CWD/tasks" 2>/dev/null)" ]]; then
    ok "Case 29.$V_I: '$V_CMD' validates"
  else
    ng "Case 29.$V_I: '$V_CMD' did not count as a validation"
  fi
done
# Controls: NAME after `env -u` / `--unset` is a variable name even when it
# spells a runner, env's first non-option word is the command (so `env echo
# npm test` runs echo), a non-runner under node_modules/.bin, and a commit in
# another repo (git -C), which validates nothing in this project and stays
# unrecognised on purpose. The first three fail if env's arm swallows any word.
N_I=0
for N_CMD in \
  'env -u vitest npm install' \
  'env --unset jest ls' \
  'env -u FOO echo npm test' \
  'env -u FOO npm run build' \
  './node_modules/.bin/tsx build.ts' \
  'git -C ../other commit -m x'; do
  N_I=$((N_I + 1))
  reset_cwd
  T="$TMP_HOME/case29n-$N_I.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK" "$(bash_call "$N_CMD")" "$TR_OK"
  run_hook "$T"
  if compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null; then
    ok "Case 29n.$N_I: control '$N_CMD' is not a validation"
  else
    ng "Case 29n.$N_I: control '$N_CMD' read as a validation"
  fi
done

# --- Case 30 (converge round 14): tasks/ exists but cannot be written -------
# The write of paused.md was never checked: stderr still announced
# "paused.md → <path>", bash's own "Permission denied" leaked beside it, and
# the rule-hits row named a file that did not exist.
if [[ $(id -u) -eq 0 ]]; then
  ok "Case 30: unwritable tasks/ (skipped — root writes through mode 555)"
else
  reset_cwd
  chmod 555 "$TMP_CWD/tasks"
  echo -n '' > "$LOG"
  T="$TMP_HOME/case30.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
  run_hook "$T"
  chmod 755 "$TMP_CWD/tasks"
  ERR30=$(cat "$TMP_HOME/stderr")
  ROW30=$(grep '"hook":"session-end-check"' "$LOG" | tail -1)
  if ! compgen -G "$TMP_CWD/tasks/*-paused.md" >/dev/null \
     && [[ "$ERR30" != *"paused.md →"* && "$ERR30" != *"Permission denied"* ]] \
     && [[ "$ERR30" == *"mid-SPINE session-exit: 1 unvalidated change(s)"* && "$ERR30" == *"could not write"* ]] \
     && jq -e '.extra.paused == null and .extra.open == 1' <<<"$ROW30" >/dev/null 2>&1; then
    ok "Case 30: an unwritable tasks/ is reported as unwritten, not as a checkpoint"
  else
    ng "Case 30: (stderr=$ERR30; row=$ROW30)"
  fi
  # 30b (0.107.1 pre-tag review M1): the checkpoint path is fixed per session,
  # so a resumed session's second SessionEnd targets the file the first one
  # wrote — which the user may have edited and made read-only. A write that
  # fails to open it must leave it alone; the cleanup is for a file this run
  # created, not for one it found.
  reset_cwd
  P30="$TMP_CWD/tasks/session-end-x-paused.md"
  printf 'USER NOTES: remaining work, verify with npm test\n' > "$P30"
  chmod 444 "$P30"
  echo -n '' > "$LOG"
  T="$TMP_HOME/case30b.jsonl"
  make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
  run_hook "$T"
  ERR30B=$(cat "$TMP_HOME/stderr")
  if [[ "$(cat "$P30" 2>/dev/null)" == "USER NOTES: remaining work, verify with npm test" ]] \
     && [[ "$ERR30B" == *"could not write"* && "$ERR30B" != *"paused.md →"* ]] \
     && jq -e '.extra.paused == null' <<<"$(grep '"hook":"session-end-check"' "$LOG" | tail -1)" >/dev/null 2>&1; then
    ok "Case 30b: an existing checkpoint that cannot be overwritten is kept"
  else
    ng "Case 30b: existing read-only checkpoint lost (exists=$([[ -e "$P30" ]] && echo y || echo n); stderr=$(cat "$TMP_HOME/stderr"))"
  fi
  chmod 644 "$P30" 2>/dev/null || true
fi

# --- Case 31 (round-14 delta review M1/L6): a write that fails part-way ------
# `cat > "$PAUSED"` truncated an existing checkpoint before writing, so a write
# that failed part-way (ENOSPC / EDQUOT / EFBIG) left half a new file where the
# user's bytes were, while stderr said no checkpoint lists the changes. A
# file-size limit stands in for a full disk, and it has to hit the checkpoint
# write and nothing before it. bash 3.2 (macOS /bin/bash, and the CI runtime
# gate) writes every here-doc to a temp file, including the two hook-common.sh
# programs read at source time (~1.4 KB each), so `ulimit -f 1` stopped the
# hook there. The limit is 4 KiB, and three edits with ~3,000-character
# targets make the checkpoint ~10 KB, so under bash 3.2 its own here-doc temp
# file fails and under 5.x the `cat` writing it does: either way, part-way.
LONG31=$(printf 'd%.0s' $(seq 1 3000))
big_edit31() { printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t%s","name":"Edit","input":{"file_path":"src/%s%s.js","old_string":"x","new_string":"y"}}]}}' "$1" "$LONG31" "$1"; }
TR31='{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}'
reset_cwd
P31="$TMP_CWD/tasks/session-end-x-paused.md"
printf 'USER NOTES: remaining work, verify with npm test\n' > "$P31"
echo -n '' > "$LOG"
T31="$TMP_HOME/case31.jsonl"
make_transcript "$T31" "$USER_MSG" "$(big_edit31 1)" "$TR31" "$(big_edit31 2)" "$TR31" "$(big_edit31 3)" "$TR31"
( ulimit -f 4; run_hook "$T31" )
ERR31=$(cat "$TMP_HOME/stderr")
ROW31=$(grep '"hook":"session-end-check"' "$LOG" | tail -1)
LEFT31=$(ls -A "$TMP_CWD/tasks")
if [[ "$(cat "$P31")" == "USER NOTES: remaining work, verify with npm test" ]] \
   && [[ "$LEFT31" == "session-end-x-paused.md" ]] \
   && [[ "$ERR31" == *"could not write"* && "$ERR31" != *"paused.md →"* ]] \
   && jq -e '.extra.paused == null and .extra.open == 3' <<<"$ROW31" >/dev/null 2>&1; then
  ok "Case 31: a write that fails part-way leaves the existing checkpoint's bytes"
else
  ng "Case 31: (content=$(head -c 60 "$P31"); tasks=$LEFT31; stderr=$ERR31; row=$ROW31)"
fi

# 31b: the same existing checkpoint, a write that succeeds — it is replaced
# (a resumed session's second SessionEnd rewrites its own file) and nothing
# else is left in tasks/. Its mode is the one a newly created file gets under
# the umask, not mktemp's 600. The umask is pinned to 022: under 077 both
# would be 600, and a hook that skipped the chmod would pass.
reset_cwd
printf 'OLD CHECKPOINT\n' > "$P31"
T="$TMP_HOME/case31b.jsonl"
make_transcript "$T" "$USER_MSG" "$edit_call" "$TR_OK"
rm -f "$TMP_HOME/mode-ref"
( umask 022; run_hook "$T"; : > "$TMP_HOME/mode-ref" )
MODE31=$(ls -l "$P31" | cut -c1-10)
MODE_REF=$(ls -l "$TMP_HOME/mode-ref" | cut -c1-10)
if grep -q '^# Paused — mid-SPINE session exit detected' "$P31" \
   && [[ "$(ls -A "$TMP_CWD/tasks")" == "session-end-x-paused.md" ]] \
   && [[ "$(cat "$TMP_HOME/stderr")" == *"paused.md → $P31"* ]] \
   && [[ "$MODE31" == "$MODE_REF" ]]; then
  ok "Case 31b: a successful write replaces the existing checkpoint, leaving nothing beside it"
else
  ng "Case 31b: (content=$(head -c 60 "$P31"); tasks=$(ls -A "$TMP_CWD/tasks"); mode=$MODE31 vs $MODE_REF; stderr=$(cat "$TMP_HOME/stderr"))"
fi

# 31c (delta review L6): `[[ -e ]]` is false for a dangling symlink, so the old
# failure path took the link for a file this run created and removed it, after
# writing half a checkpoint into the link's target. A failed write touches
# neither. The stderr check is the reach assertion: a hook that stopped before
# the write would leave the link alone too.
reset_cwd
ln -s "$TMP_CWD/link-target" "$P31"
( ulimit -f 4; run_hook "$T31" )
if [[ -L "$P31" && ! -e "$TMP_CWD/link-target" ]] \
   && [[ "$(ls -A "$TMP_CWD/tasks")" == "session-end-x-paused.md" ]] \
   && [[ "$(cat "$TMP_HOME/stderr")" == *"could not write $P31"* ]]; then
  ok "Case 31c: a failed write leaves a dangling symlink at the path, and its target, alone"
else
  ng "Case 31c: (link=$([[ -L "$P31" ]] && echo kept || echo removed); target=$([[ -e "$TMP_CWD/link-target" ]] && echo written || echo absent); stderr=$(cat "$TMP_HOME/stderr"))"
fi
rm -f "$TMP_CWD/link-target"

# 31d: a DIRECTORY at the checkpoint path cannot be written. A rename onto it
# would move the new file inside it instead, and report a checkpoint at a
# path that is a directory.
reset_cwd
mkdir "$P31"
run_hook "$T"
if [[ -z "$(ls -A "$P31")" ]] \
   && [[ "$(ls -A "$TMP_CWD/tasks")" == "session-end-x-paused.md" ]] \
   && [[ "$(cat "$TMP_HOME/stderr")" == *"could not write"* ]]; then
  ok "Case 31d: a directory at the checkpoint path is reported as unwritten and left empty"
else
  ng "Case 31d: (dir=$(ls -A "$P31"); tasks=$(ls -A "$TMP_CWD/tasks"); stderr=$(cat "$TMP_HOME/stderr"))"
fi

echo ""
echo "session-end-check:$([[ $FAIL -eq 0 ]] && echo PASS || echo "FAIL ($FAIL assertion(s))")"
exit $FAIL
