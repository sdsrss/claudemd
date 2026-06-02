#!/usr/bin/env bash
# memory-coverage-scan.test.sh — v0.13.0 Stop hook tests.
# Asserts: trigger-token counting (lesson + decision), mem_save offset
# (silences when present), threshold gating, per-session dedup, opt-in gate,
# kill-switch, telemetry shape.

set -uo pipefail

# Hermeticity (feedback_hook_env_test_hermeticity): npm test inherits the
# operator's settings.json env. If MEMORY_COVERAGE_SCAN=1 is set there (the
# v0.23.8 local-dogfood opt-in), Case 6 "opt-in OFF → silent" inherits =1 and
# fires the advisory instead of staying silent. Clear it so each case controls
# the gate explicitly. Same precedent as banned-vocab/transcript-structure tests.
unset MEMORY_COVERAGE_SCAN

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/memory-coverage-scan.sh"
TMP_HOME=$(mktemp -d -t claudemd-memcov-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"
RULE_LOG="$HOME/.claude/logs/claudemd.jsonl"

FAIL=0
ok() { echo "PASS: $1"; }
ng() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# Build a transcript with N assistant text lines + optional tool_use entries.
# Args: $1 = transcript path, $2 = text body (multi-line OK), $3 = tool_use json array (or empty)
build_transcript() {
  local path="$1" text="$2" tool_uses="${3:-[]}"
  : > "$path"
  jq -cn --arg t "$text" --argjson tu "$tool_uses" \
    '{type:"assistant", message:{content: ([{type:"text", text:$t}] + ($tu | map({type:"tool_use", name:.name, input:.input})))}}' \
    >> "$path"
}

mkevent() {
  local sess="$1" transcript="$2"
  jq -cn --arg s "$sess" --arg t "$transcript" \
    '{hook_event_name:"Stop", session_id:$s, transcript_path:$t}'
}

# Case 1: 3+ lesson tokens, no mem_save → advisory + rule-hits row
SESS="sess1"; TP="$TMP_HOME/t1.jsonl"
build_transcript "$TP" "Lesson learned: API failed. Turns out config was wrong. Gotcha: env not set."
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if echo "$OUT" | grep -qF "memory-coverage" && [[ -f "$RULE_LOG" ]] && \
   jq -e 'select(.hook=="memory-coverage-scan" and .event=="coverage-advisory" and .spec_section=="§11-mem-coverage" and .extra.lesson >= 3)' "$RULE_LOG" >/dev/null 2>&1; then
  ok "1 three lesson tokens → advisory + rule-hits row"
else
  ng "1 (stderr: $OUT)"
fi

# Case 2: 3+ decision tokens (中文), no mem_save → advisory
SESS="sess2"; TP="$TMP_HOME/t2.jsonl"
build_transcript "$TP" "非默认 选择 A 不选 B。\n因为这样所以稳定。\n非默认 again."
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if echo "$OUT" | grep -qF "memory-coverage" && [[ -f "$RULE_LOG" ]] && \
   jq -e 'select(.extra.decision >= 2)' "$RULE_LOG" >/dev/null 2>&1; then
  ok "2 中文 decision tokens → advisory"
else
  ng "2 (stderr: $OUT)"
fi

# Case 3: only 1 token (below threshold) → silent
SESS="sess3"; TP="$TMP_HOME/t3.jsonl"
build_transcript "$TP" "One lesson about caching."
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "3 below threshold → silent, no log row"
else
  ng "3 expected silent (stderr: $OUT)"
fi

# Case 4: 3+ tokens BUT mem_save tool_use present → silent
SESS="sess4"; TP="$TMP_HOME/t4.jsonl"
build_transcript "$TP" "lesson lesson lesson" \
  '[{"name":"mcp__plugin_claude-mem-lite_mem__mem_save","input":{"content":"x"}}]'
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "4 mem_save tool_use offsets trigger → silent"
else
  ng "4 expected silent (stderr: $OUT)"
fi

# Case 5: 3+ tokens BUT `claude-mem-lite save` Bash invocation → silent
SESS="sess5"; TP="$TMP_HOME/t5.jsonl"
build_transcript "$TP" "gotcha gotcha gotcha" \
  '[{"name":"Bash","input":{"command":"claude-mem-lite save \"x\""}}]'
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "5 claude-mem-lite save Bash offsets trigger → silent"
else
  ng "5 expected silent (stderr: $OUT)"
fi

# Case 6: opt-in OFF (MEMORY_COVERAGE_SCAN unset) → silent
SESS="sess6"; TP="$TMP_HOME/t6.jsonl"
build_transcript "$TP" "lesson lesson lesson lesson"
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "6 opt-in OFF → silent (default off)"
else
  ng "6 expected silent (stderr: $OUT)"
fi

# Case 7: kill-switch DISABLE_MEMORY_COVERAGE_HOOK=1 → silent
SESS="sess7"; TP="$TMP_HOME/t7.jsonl"
build_transcript "$TP" "lesson lesson lesson lesson"
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 DISABLE_MEMORY_COVERAGE_HOOK=1 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "7 kill-switch → silent"
else
  ng "7 expected silent (stderr: $OUT)"
fi

# Case 8: per-session dedup — second Stop in same session is silent
SESS="sess8"; TP="$TMP_HOME/t8.jsonl"
build_transcript "$TP" "lesson lesson lesson"
rm -f "$RULE_LOG"
OUT1=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
ROW_COUNT_1=$(wc -l < "$RULE_LOG" 2>/dev/null || echo 0)
OUT2=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
ROW_COUNT_2=$(wc -l < "$RULE_LOG" 2>/dev/null || echo 0)
if echo "$OUT1" | grep -qF "memory-coverage" && [[ -z "$OUT2" ]] && [[ "$ROW_COUNT_1" == "$ROW_COUNT_2" ]]; then
  ok "8 per-session dedup (sentinel suppresses 2nd Stop)"
else
  ng "8 dedup failed: out1='$OUT1' out2='$OUT2' rows1=$ROW_COUNT_1 rows2=$ROW_COUNT_2"
fi

# Case 9: missing transcript_path → silent fail-open
SESS="sess9"
OUT=$(jq -cn --arg s "$SESS" '{hook_event_name:"Stop", session_id:$s}' \
      | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]]; then
  ok "9 missing transcript_path → fail-open silent"
else
  ng "9 expected silent (stderr: $OUT)"
fi

# Case 10: threshold override via MEMORY_COVERAGE_THRESHOLD=5 — 4 tokens silent
SESS="sess10"; TP="$TMP_HOME/t10.jsonl"
build_transcript "$TP" "lesson lesson lesson lesson"
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 MEMORY_COVERAGE_THRESHOLD=5 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "10 threshold override (5) suppresses 4-token session"
else
  ng "10 expected silent (stderr: $OUT)"
fi

# Case 11: empty assistant text (only file-history-snapshot lines) → silent
SESS="sess11"; TP="$TMP_HOME/t11.jsonl"
echo '{"type":"file-history-snapshot","snapshot":{}}' > "$TP"
rm -f "$RULE_LOG"
OUT=$(mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" 2>&1 >/dev/null)
if [[ -z "$OUT" ]] && [[ ! -f "$RULE_LOG" ]]; then
  ok "11 no assistant text → silent"
else
  ng "11 expected silent (stderr: $OUT)"
fi

# Case 12: telemetry shape — extra.total = lesson + decision
SESS="sess12"; TP="$TMP_HOME/t12.jsonl"
build_transcript "$TP" "lesson 1\ngotcha 2\n非默认 selection\n选 X 不选 Y"
rm -f "$RULE_LOG"
mkevent "$SESS" "$TP" | MEMORY_COVERAGE_SCAN=1 bash "$HOOK" >/dev/null 2>&1
if [[ -f "$RULE_LOG" ]] && \
   jq -e '.extra | (.total == (.lesson + .decision)) and (.threshold == 3) and (.mem_saves == 0)' "$RULE_LOG" >/dev/null 2>&1; then
  ok "12 telemetry shape: total = lesson + decision, threshold + mem_saves"
else
  LAST=$(tail -n 1 "$RULE_LOG" 2>/dev/null || echo MISSING)
  ng "12 telemetry shape wrong (last: $LAST)"
fi

if (( FAIL > 0 )); then
  echo "Tests: $((12 - FAIL))/12 passed"
  exit 1
fi
echo "Tests: 12/12 passed"
