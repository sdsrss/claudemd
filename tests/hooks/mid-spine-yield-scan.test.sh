#!/usr/bin/env bash
# mid-spine-yield-scan.test.sh — v0.15.0 P2 #1 (a-mini) hook coverage.
# Verifies opt-in gate, mid-SPINE-yield detection, FP mitigations, kill-switch,
# per-session dedup.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/mid-spine-yield-scan.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/.claudemd-state"

FAIL=0
PASS=0
SID_SEQ=0

# Build a transcript jsonl from a sequence of role/payload entries.
#   seed_transcript turn1_role turn1_payload turn2_role turn2_payload ...
# role ∈ {user, assistant, assistant-tool}.
#   user payload     = plain user text
#   assistant payload = assistant text (no tool_use)
#   assistant-tool payload = assistant text (tool_use present marker)
seed_transcript() {
  local tx
  tx=$(mktemp)
  while (( $# > 0 )); do
    local role="$1" payload="$2"; shift 2
    case "$role" in
      user)
        jq -cn --arg t "$payload" \
          '{type:"user",message:{content:$t}}' >> "$tx"
        ;;
      assistant)
        jq -cn --arg t "$payload" \
          '{type:"assistant",message:{content:[{type:"text",text:$t}]}}' >> "$tx"
        ;;
      assistant-tool)
        # Tool_use in content; text body $payload as the prose portion.
        jq -cn --arg t "$payload" \
          '{type:"assistant",message:{content:[{type:"text",text:$t},{type:"tool_use",name:"Edit",input:{file_path:"/tmp/x"}}]}}' >> "$tx"
        ;;
    esac
  done
  printf '%s' "$tx"
}

drive() {
  local transcript="$1" extra_env="${2:-}"
  SID_SEQ=$(( SID_SEQ + 1 ))
  local sid="test-mid-spine-$SID_SEQ"
  local fix
  fix=$(mktemp)
  jq -cn --arg p "$transcript" --arg s "$sid" \
    '{session_id:$s,transcript_path:$p}' > "$fix"
  if [[ -n "$extra_env" ]]; then
    eval "$extra_env" bash "$HOOK" < "$fix" 2>/tmp/midspine-stderr-$$
  else
    bash "$HOOK" < "$fix" 2>/tmp/midspine-stderr-$$
  fi
  local rc=$?
  STDERR=$(cat /tmp/midspine-stderr-$$); rm -f /tmp/midspine-stderr-$$ "$fix"
  return $rc
}

# 1: default OFF — silent regardless of content.
TX=$(seed_transcript \
  user "fix the bug" \
  assistant-tool "Let me run the test." \
  user "继续")
unset MID_SPINE_YIELD_SCAN
drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 1 default OFF → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 1 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 2: opt-in but missing transcript → silent (fail-open).
fix=$(mktemp)
jq -cn '{session_id:"test-no-tx"}' > "$fix"
MID_SPINE_YIELD_SCAN=1 bash "$HOOK" < "$fix" 2>/tmp/se-$$
rc=$?; STDERR=$(cat /tmp/se-$$); rm -f /tmp/se-$$ "$fix"
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 2 opt-in + missing transcript → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 2 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# 3: clean four-section + 继续 → silent (prev turn was a proper report).
TX=$(seed_transcript \
  user "ship it" \
  assistant-tool "Working on it..." \
  assistant $'Done: shipped v0.1.0 (tests/foo.test.js: 5 passed).\nNot done: (none)\nFailed: (none)\nUncertain: (none)' \
  user "继续")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 3 prev turn had four-section report → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 3 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 4: tool-call prev + 继续 → mid-spine-advisory (TP signal).
TX=$(seed_transcript \
  user "fix the bug" \
  assistant-tool "Let me check the file." \
  user "继续")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§11-mid-spine-yield'; then
  echo "PASS: 4 tool-call prev + 继续 → mid-spine-yield advisory"; PASS=$((PASS+1))
else
  echo "FAIL: 4 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 5: prev had [AUTH REQUIRED] → silent (legitimate yield).
TX=$(seed_transcript \
  user "delete the table" \
  assistant-tool "[AUTH REQUIRED op:drop-table scope:db.users risk:destructive-data-loss]" \
  user "继续")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 5 prev had [AUTH REQUIRED] → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 5 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 6: prev had [PARTIAL:] → silent (legitimate partial-completion signal).
TX=$(seed_transcript \
  user "do thing X" \
  assistant-tool "Done: did part of X. [PARTIAL: missing-baseline]" \
  user "继续")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 6 prev had [PARTIAL:] → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 6 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 7: long-form user message starting with 继续 → silent (not short continuation tell).
TX=$(seed_transcript \
  user "first task" \
  assistant-tool "Looking at code..." \
  user "继续讨论一下设计方案，看看是否要走另一个分支并请你帮我整理 trade-offs")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 7 long-form user msg starting with 继续 → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 7 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 8: kill-switch suppresses despite opt-in.
TX=$(seed_transcript \
  user "fix" \
  assistant-tool "checking..." \
  user "继续")
DISABLE_MID_SPINE_YIELD_HOOK=1 MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 8 kill-switch suppresses despite opt-in"; PASS=$((PASS+1))
else
  echo "FAIL: 8 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 9: per-session dedup. Same session ID drives twice → second is silent.
TX=$(seed_transcript \
  user "fix" \
  assistant-tool "checking..." \
  user "继续")
fix=$(mktemp)
jq -cn --arg p "$TX" '{session_id:"dedup-test",transcript_path:$p}' > "$fix"
MID_SPINE_YIELD_SCAN=1 bash "$HOOK" < "$fix" 2>/tmp/dedup-stderr1-$$
rc1=$?; ERR1=$(cat /tmp/dedup-stderr1-$$); rm -f /tmp/dedup-stderr1-$$
MID_SPINE_YIELD_SCAN=1 bash "$HOOK" < "$fix" 2>/tmp/dedup-stderr2-$$
rc2=$?; ERR2=$(cat /tmp/dedup-stderr2-$$); rm -f /tmp/dedup-stderr2-$$ "$fix" "$TX"
if [[ "$rc1" -eq 0 && "$rc2" -eq 0 ]] && \
   echo "$ERR1" | grep -q '§11-mid-spine-yield' && \
   [[ -z "$ERR2" ]]; then
  echo "PASS: 9 per-session dedup (1st emits, 2nd silent)"; PASS=$((PASS+1))
else
  echo "FAIL: 9 (rc=$rc1/$rc2, err1='$ERR1', err2='$ERR2')"; FAIL=$((FAIL+1))
fi

# 10: multiple yields in one session → single advisory with count > 1 in log.
TX=$(seed_transcript \
  user "first" \
  assistant-tool "checking part 1..." \
  user "继续" \
  assistant-tool "checking part 2..." \
  user "next")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§11-mid-spine-yield'; then
  # Verify the log row carries count >= 2 in extra.
  if [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] && \
     jq -e 'select(.hook == "mid-spine-yield-scan" and .event == "mid-spine-advisory" and (.extra.count // 0) >= 2)' \
       "$HOME/.claude/logs/claudemd.jsonl" >/dev/null 2>&1; then
    echo "PASS: 10 multi-yield session records count >= 2"; PASS=$((PASS+1))
  else
    echo "FAIL: 10 log row missing count>=2 (log: $(cat "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null))"; FAIL=$((FAIL+1))
  fi
else
  echo "FAIL: 10 stderr did not include §11-mid-spine-yield (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 11: prev assistant has tool_use AND four-section report (rare but possible:
# Edit followed by Done report in same turn) → silent.
TX=$(seed_transcript \
  user "fix" \
  assistant-tool $'I patched scripts/x.js.\n\nDone: fixed null-deref (tests/x.test.js: 7 passed).\nNot done: (none)\nFailed: (none)\nUncertain: (none)' \
  user "继续")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 11 prev had tool+report → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 11 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

# 12: 'next' continuation pattern (EN) → fires same as CN.
TX=$(seed_transcript \
  user "first" \
  assistant-tool "running tests..." \
  user "next")
MID_SPINE_YIELD_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§11-mid-spine-yield'; then
  echo "PASS: 12 EN 'next' continuation fires"; PASS=$((PASS+1))
else
  echo "FAIL: 12 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi
rm -f "$TX"

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
