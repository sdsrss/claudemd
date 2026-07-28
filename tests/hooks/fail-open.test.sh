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

# T8-T11 (2026-07-28 audit H1): the reasons that IMPLY jq is unusable were the
# two this instrumentation could never actually record. `rule_hits_append` built
# every row with `jq -cn`, so `jq-missing` set its rate-limit marker and wrote
# ZERO rows — the fail-open layer was inoperative in exactly the condition it
# exists to observe, and T1-T7 never caught it because they all drive
# `bad-event` with a WORKING jq. A hook whose jq is broken (stub earlier on
# PATH, corrupt binary, missing shared lib, OOM) must still leave a row.
#
# `jq -r` on a broken jq exits non-zero, so `TOOL=""` used to route into the
# ordinary "not a Bash call" early exit — indistinguishable from "rule not
# applicable". These lock the distinction.

# A PATH with the tools the hooks need but WITHOUT jq. Symlink farm, because
# `command -v jq` is the guard under test — shadowing jq can't express absence.
NOJQ_BIN="$TMP_HOME/nojq-bin"; mkdir -p "$NOJQ_BIN"
for _t in bash sh cat date printf sed grep tr wc mkdir stat mv rm cp ln head tail \
          cut sort uniq awk find dirname basename id hostname touch ls env; do
  _p=$(command -v "$_t" 2>/dev/null) && ln -sf "$_p" "$NOJQ_BIN/$_t" 2>/dev/null
done
BROKEN_BIN="$TMP_HOME/brokenjq-bin"; mkdir -p "$BROKEN_BIN"
printf '#!/usr/bin/env bash\necho "jq: error (simulated broken jq)" >&2\nexit 3\n' > "$BROKEN_BIN/jq"
chmod +x "$BROKEN_BIN/jq"

# The broken-jq arm MUST feed a well-formed event: empty stdin trips the
# `hook_read_event` empty check and records `bad-event` before any parse runs,
# so it can never reach the jq-failure path (first draft of these cases did
# exactly that and mis-reported the fix as broken).
VALID_EVENT='{"session_id":"failopen-jq","tool_name":"Bash","tool_input":{"command":"echo hi"},"cwd":"/tmp"}'

# $1=hook-file $2=hook-name $3=expected-reason $4=path-mode(absent|broken) $5=label
check_jq_failopen() {
  rm -rf "$TMP_HOME/.claude"; mkdir -p "$TMP_HOME/.claude/logs"
  if [[ "$4" == "absent" ]]; then
    echo "" | PATH="$NOJQ_BIN" bash "$HOOKS_DIR/$1" >/dev/null 2>&1
  else
    printf '%s' "$VALID_EVENT" | PATH="$BROKEN_BIN:$PATH" bash "$HOOKS_DIR/$1" >/dev/null 2>&1
  fi
  # Assertions run with the REAL jq (PATH scoped to the hook invocation above).
  if [[ -f "$LOG" ]] && jq -e --arg h "$2" --arg r "$3" \
       'select(.hook==$h and .event=="fail-open" and .extra.reason==$r and .spec_section=="§hooks-fail-open")' \
       "$LOG" >/dev/null 2>&1; then
    ok "$5 records fail-open reason=$3"
  else
    ng "$5 did not record fail-open reason=$3 (log: $(cat "$LOG" 2>/dev/null))"
  fi
}

check_jq_failopen banned-vocab-check.sh    banned-vocab    jq-missing absent "T8 banned-vocab jq absent"
check_jq_failopen pre-bash-safety-check.sh pre-bash-safety jq-missing absent "T9 pre-bash-safety jq absent"
check_jq_failopen pre-bash-safety-check.sh pre-bash-safety jq-broken  broken "T10 pre-bash-safety jq broken"
check_jq_failopen memory-read-check.sh     memory-read-check jq-broken broken "T11 memory-read-check jq broken"

# T12: the row emitted without jq must still be valid JSON with every field the
# schema declares — a hand-built fallback row is exactly where escaping and
# field-drift bugs hide. Parse it back with the real jq.
rm -rf "$TMP_HOME/.claude"; mkdir -p "$TMP_HOME/.claude/logs"
echo "" | PATH="$NOJQ_BIN" bash "$HOOKS_DIR/banned-vocab-check.sh" >/dev/null 2>&1
# `jq -e … "$LOG"` alone parses the file as a VALUE STREAM, so it would pass on a
# row containing embedded newlines — i.e. it would not test the one-object-per-line
# contract this fallback exists to preserve. Assert the line count too.
T12_LINES=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
if [[ "$T12_LINES" == "1" ]] && jq -e 'select(has("ts") and has("hook") and has("event") and has("project")
          and has("session_id") and has("tool_use_id") and has("spec_section")
          and has("hook_version") and has("extra"))' "$LOG" >/dev/null 2>&1; then
  ok "T12 jq-less fallback row is ONE line of valid JSON with all 9 schema fields"
else
  ng "T12 fallback row malformed, multi-line ($T12_LINES), or missing fields (log: $(cat "$LOG" 2>/dev/null))"
fi

# T13: a multi-line `extra` must never become a multi-line "row". Several callers
# build extra with `jq -s .` (uncompacted), and the fallback pastes extra verbatim,
# so one embedded newline would split a row into partial lines and corrupt a log
# whose entire contract is one object per line. Pre-guard, the first-byte sniff
# (`'{'*`) accepted it. Driven through the lib directly — no hook produces this
# shape deterministically, which is exactly why it needs pinning.
rm -rf "$TMP_HOME/.claude"; mkdir -p "$TMP_HOME/.claude/logs"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append hookML evML '{
  \"a\": 1,
  \"b\": 2
}' '§x'" 2>/dev/null
ML_LINES=$(wc -l < "$LOG" 2>/dev/null | tr -d ' ')
if [[ "$ML_LINES" == "1" ]] && jq -e . "$LOG" >/dev/null 2>&1; then
  ok "T13 multi-line extra degrades to one valid line"
else
  ng "T13 multi-line extra produced $ML_LINES line(s) / invalid JSON (log: $(cat "$LOG" 2>/dev/null))"
fi

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
