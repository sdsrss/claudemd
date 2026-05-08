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

# Case 7: project field — CLAUDE_PROJECT_DIR encoded with `/` and `.` → `-`.
rm -rf "$TMP_HOME/.claude/logs"
CLAUDE_PROJECT_DIR=/work/my.project run 'rule_hits_append banned-vocab deny null'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.project == "-work-my-project"' >/dev/null \
  || { echo "FAIL: Case 7 project encoding wrong (got: $(echo "$LAST" | jq -r .project))"; exit 1; }

# Case 8: project field falls back to PWD when CLAUDE_PROJECT_DIR unset.
rm -rf "$TMP_HOME/.claude/logs"
unset_run() { unset CLAUDE_PROJECT_DIR; bash -c "source $LIB; $*"; }
(cd "$TMP_HOME" && unset_run 'rule_hits_append banned-vocab deny null')
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.project | length > 0' >/dev/null \
  || { echo "FAIL: Case 8 project field empty under PWD fallback (got: $LAST)"; exit 1; }

# Case 9: existing 'extra' payload still preserved alongside new project field.
rm -rf "$TMP_HOME/.claude/logs"
CLAUDE_PROJECT_DIR=/p run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":99}'\'''
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.project == "-p" and .extra.run_id == 99' >/dev/null \
  || { echo "FAIL: Case 9 project + extra both required (got: $LAST)"; exit 1; }

# Case 10 (v0.7.0): spec_section 4th positional arg lands as `spec_section`
# field, populated only when non-empty (omitted arg → null).
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null "§10-V"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.spec_section == "§10-V"' >/dev/null \
  || { echo "FAIL: Case 10 spec_section not threaded through (got: $LAST)"; exit 1; }

# Case 11: omitted spec_section arg → null in JSONL row (back-compat for
# meta hooks like session-start bootstrap / version-sync that aren't
# enforcing a spec rule).
run 'rule_hits_append session-start bootstrap null'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.spec_section == null' >/dev/null \
  || { echo "FAIL: Case 11 omitted section should be null (got: $LAST)"; exit 1; }

# Case 12: empty-string spec_section arg also normalizes to null (defends
# against accidental `hook_record h e null ""` becoming an empty-string row,
# which would muddle audit `bySection` `(unset)` bucket attribution).
run 'rule_hits_append banned-vocab deny null ""'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.spec_section == null' >/dev/null \
  || { echo "FAIL: Case 12 empty spec_section should normalize to null (got: $LAST)"; exit 1; }

echo "All cases passed"
