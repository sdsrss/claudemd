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

echo ""
echo "session-end-check: $([[ $FAIL -eq 0 ]] && echo PASS || echo "FAIL ($FAIL assertion(s))")"
exit $FAIL
