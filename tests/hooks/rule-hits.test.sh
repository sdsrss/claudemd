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
LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$LINES" == "1" ]] || { echo "FAIL: expected 1 line, got $LINES"; exit 1; }
jq -e '.hook == "banned-vocab" and .event == "deny"' "$LOG" >/dev/null \
  || { echo "FAIL: row missing expected fields"; exit 1; }

# Case 2: extra JSON
run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":4521}'\'''
SECOND=$(tail -n 1 "$LOG")
echo "$SECOND" | jq -e '.extra.run_id == 4521' >/dev/null \
  || { echo "FAIL: extra not preserved"; exit 1; }

# Case 3: DISABLE_RULE_HITS_LOG suppresses
LINE_BEFORE=$(wc -l < "$LOG" | tr -d ' ')
DISABLE_RULE_HITS_LOG=1 run 'rule_hits_append banned-vocab deny null'
LINE_AFTER=$(wc -l < "$LOG" | tr -d ' ')
[[ "$LINE_BEFORE" == "$LINE_AFTER" ]] || { echo "FAIL: log appended despite kill-switch"; exit 1; }

# Case 4: size-capped rotation — grow log past max, next append rotates.
# Use CLAUDEMD_LOG_MAX_MB=0 + ~1KB log so any non-empty file triggers rotate.
# (0*1024*1024 = 0 bytes threshold; real log is ~100 bytes, so size > 0 → rotate.)
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
run 'rule_hits_append banned-vocab deny null'
PRE_LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$PRE_LINES" == "2" ]] || { echo "FAIL: setup expected 2 lines, got $PRE_LINES"; exit 1; }
CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
# After rotation: primary has 1 new line, .1 holds the 2 old ones.
POST_LINES=$(wc -l < "$LOG" | tr -d ' ')
ROTATED_LINES=$(wc -l < "$LOG.1" | tr -d ' ')
[[ "$POST_LINES" == "1" ]] || { echo "FAIL: post-rotation primary expected 1 line, got $POST_LINES"; exit 1; }
[[ "$ROTATED_LINES" == "2" ]] || { echo "FAIL: .1 expected 2 lines, got $ROTATED_LINES"; exit 1; }

# Case 5: second rotation pushes .1 to .2, drops any prior .2.
echo '{"stale":true}' > "$LOG.2"
CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
# .2 now holds what .1 held before; prior .2 is gone.
[[ -f "$LOG.2" ]] || { echo "FAIL: .2 missing after second rotation"; exit 1; }
NEW_TWO_LINES=$(wc -l < "$LOG.2" | tr -d ' ')
[[ "$NEW_TWO_LINES" == "2" ]] || { echo "FAIL: .2 expected 2 lines (old .1 content), got $NEW_TWO_LINES"; exit 1; }
grep -q '"stale":true' "$LOG.2" && { echo "FAIL: stale .2 content not evicted"; exit 1; }

# Case 6: under threshold → no rotation.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
CLAUDEMD_LOG_MAX_MB=5 run 'rule_hits_append banned-vocab deny null'
[[ -f "$LOG.1" ]] && { echo "FAIL: rotated despite being under threshold"; exit 1; }
UNDER_LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$UNDER_LINES" == "2" ]] || { echo "FAIL: under-threshold expected 2 lines, got $UNDER_LINES"; exit 1; }

echo "All cases passed"
