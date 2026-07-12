#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# fail-open.test.sh — Round-6: lock the hook-fail-open observability contract.
#
# Pre-fix: hooks silently `exit 0` when prerequisites were missing (jq absent,
# malformed event JSON, patterns file unreadable). Operators couldn't tell
# "hook bypassed silently" from "hook didn't fire" — biased §13.1 audit data.
# Fix: hook_record_failopen <hook> <reason> emits a `fail-open` row to
# rule-hits.jsonl with rate-limiting (1 row per (hook,reason) per 60s).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$HERE/../../hooks" && pwd)"

TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"

PASS=0; FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
ng() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# T1: empty stdin → bad-event fail-open recorded.
rm -rf "$TMP_HOME/.claude"
mkdir -p "$TMP_HOME/.claude/logs"
echo "" | bash "$HOOKS_DIR/banned-vocab-check.sh" >/dev/null 2>&1
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="banned-vocab" and .event=="fail-open" and .extra.reason=="bad-event" and .spec_section=="§hooks-fail-open")' "$LOG" >/dev/null 2>&1; then
  ok "T1 empty stdin records fail-open reason=bad-event"
else
  ng "T1 empty stdin did not record fail-open (log: $(cat "$LOG" 2>/dev/null))"
fi

# T2: rate-limit — second invocation within 60s does NOT emit a second row.
echo "" | bash "$HOOKS_DIR/banned-vocab-check.sh" >/dev/null 2>&1
COUNT=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
if [[ "$COUNT" == "1" ]]; then
  ok "T2 rate-limit suppresses second fail-open within 60s (count=1)"
else
  ng "T2 rate-limit failed: log has $COUNT lines, expected 1"
fi

# T3: different reason (force a different state file) → emits separately.
# Simulate by deleting the rate-limit marker for bad-event, then driving a
# patterns-missing condition (rename patterns file). Direct lib call to keep
# the test deterministic — exercises hook_record_failopen contract.
rm -f "$TMP_HOME/.claude/.claudemd-state/failopen-banned-vocab-bad-event.ts"
bash -c "source '$HOOKS_DIR/lib/hook-common.sh'; hook_record_failopen banned-vocab patterns-missing"
COUNT2=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
if [[ "$COUNT2" == "2" ]]; then
  ok "T3 distinct reason emits separate row (count=2)"
else
  ng "T3 distinct reason did not emit: log has $COUNT2 lines, expected 2"
fi

# T4: kill switch — DISABLE_RULE_HITS_LOG=1 must suppress fail-open emission.
rm -f "$LOG" "$TMP_HOME/.claude/.claudemd-state/"*.ts
bash -c "source '$HOOKS_DIR/lib/hook-common.sh'; DISABLE_RULE_HITS_LOG=1 hook_record_failopen banned-vocab bad-event"
if [[ ! -f "$LOG" ]] || [[ "$(wc -l < "$LOG" 2>/dev/null)" == "0" ]]; then
  ok "T4 DISABLE_RULE_HITS_LOG=1 suppresses fail-open"
else
  ng "T4 DISABLE_RULE_HITS_LOG=1 did not suppress (log: $(cat "$LOG" 2>/dev/null))"
fi

# T5-T7 (roadmap OBS-1, 2026-07-12 audit): the three safety-critical hooks
# (§8 pre-bash-safety / §11 memory-read / §7 ship-baseline) must ALSO record
# fail-open on a bad event, not silently `exit 0`. A jq-less or malformed-stdin
# environment otherwise turns the hardest gates into silent no-ops the §13.1
# audit can't distinguish from "rule never fired". banned-vocab already models
# this (T1); these lock the same contract on the safety hooks.
check_bad_event_failopen() {  # $1=hook-file $2=hook-name $3=label
  rm -rf "$TMP_HOME/.claude"; mkdir -p "$TMP_HOME/.claude/logs"
  echo "" | bash "$HOOKS_DIR/$1" >/dev/null 2>&1
  if [[ -f "$LOG" ]] && jq -e --arg h "$2" \
       'select(.hook==$h and .event=="fail-open" and .extra.reason=="bad-event" and .spec_section=="§hooks-fail-open")' \
       "$LOG" >/dev/null 2>&1; then
    ok "$3 records fail-open reason=bad-event"
  else
    ng "$3 did not record fail-open (log: $(cat "$LOG" 2>/dev/null))"
  fi
}
check_bad_event_failopen pre-bash-safety-check.sh pre-bash-safety   "T5 pre-bash-safety empty stdin"
check_bad_event_failopen memory-read-check.sh    memory-read-check  "T6 memory-read-check empty stdin"
check_bad_event_failopen ship-baseline-check.sh  ship-baseline      "T7 ship-baseline empty stdin"

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
