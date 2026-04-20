#!/usr/bin/env bash
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/rule-hits.sh"
TMP_HOME=$(mktemp -d)
trap 'rm -rf "$TMP_HOME"' EXIT

export HOME="$TMP_HOME"
LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"

run() { bash -c "source $LIB; $*"; }

# Case 1: basic append
run 'rule_hits_append banned-vocab deny null'
[[ -f "$LOG" ]] || { echo "FAIL: log file not created"; exit 1; }
LINES=$(wc -l < "$LOG")
[[ "$LINES" == "1" ]] || { echo "FAIL: expected 1 line, got $LINES"; exit 1; }
jq -e '.hook == "banned-vocab" and .event == "deny"' "$LOG" >/dev/null \
  || { echo "FAIL: row missing expected fields"; exit 1; }

# Case 2: extra JSON
run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":4521}'\'''
SECOND=$(tail -n 1 "$LOG")
echo "$SECOND" | jq -e '.extra.run_id == 4521' >/dev/null \
  || { echo "FAIL: extra not preserved"; exit 1; }

# Case 3: DISABLE_RULE_HITS_LOG suppresses
LINE_BEFORE=$(wc -l < "$LOG")
DISABLE_RULE_HITS_LOG=1 run 'rule_hits_append banned-vocab deny null'
LINE_AFTER=$(wc -l < "$LOG")
[[ "$LINE_BEFORE" == "$LINE_AFTER" ]] || { echo "FAIL: log appended despite kill-switch"; exit 1; }

echo "All cases passed"
