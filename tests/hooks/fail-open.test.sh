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

# T14 (2026-08-16 audit H-1): a TRUNCATED single-line extra with intact outer
# braces must not pass the guard verbatim. Under a jq that works once then
# fails, six call sites wrap a possibly-empty jq fragment in a literal brace
# pair, producing exactly `{"matched":}` / `{"matched":[}` — the first/last
# char sniff accepted both and appended an unparseable line, failing at the
# very property the guard's comment claimed ("rejects a truncated payload").
# Drive the pure function directly; assert via a real jq parse-back.
t14_case() {
  local label="$1" payload="$2" want="$3" row got
  # Payload travels as $1 into the child shell — inlining it into the -c
  # string mangles quotes (the first run of this test did exactly that).
  row=$(bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; _rule_hits_fallback_row \
    '2026-01-01T00:00:00Z' hookT14 evT14 projT14 '' '' '' '' \"\$1\"" bash "$payload")
  if ! got=$(printf '%s' "$row" | jq -c '.extra' 2>/dev/null); then
    ng "T14 $label: fallback row is not parseable JSON (row: $row)"
    return
  fi
  if [[ "$got" == "$want" ]]; then
    ok "T14 $label: extra -> $want"
  else
    ng "T14 $label: expected extra $want, got $got (row: $row)"
  fi
}
t14_case 'truncated value {"matched":}'    '{"matched":}'  'null'
t14_case 'truncated array {"matched":[}'   '{"matched":[}' 'null'
t14_case 'dangling comma {"a":1,}'         '{"a":1,}'      'null'
t14_case 'mid-payload dangling separator'  '{"missing":,"n":2}' 'null'
t14_case 'valid object preserved'          '{"a":1}'       '{"a":1}'
t14_case 'legit empty-array field preserved' '{"missing":[],"n":2}' '{"missing":[],"n":2}'
t14_case 'empty object preserved'          '{}'            '{}'
t14_case 'empty array preserved'           '[]'            '[]'
t14_case 'nested empty value preserved'    '{"a":{}}'      '{"a":{}}'

# --- T15-T20 (2026-08-29 audit R10-06): silent bail-outs on deny paths -------
#
# Three deny-capable hooks reached `exit 0` past the point where they had
# already decided the command was in scope, and recorded nothing. The §13.1
# audit reads such a hook as "never fired" rather than "could not evaluate" —
# the same OBS gap 0.68.2 and 0.69.0 each closed one batch of.

# Fresh HOME per case: hook_record_failopen rate-limits one row per
# (hook,reason) per 60s via a state file, so a shared HOME would swallow the
# second assertion of the same reason and pass vacuously.
fresh_home() {
  TMP_CASE=$(mktemp -d)
  export HOME="$TMP_CASE"
  mkdir -p "$HOME/.claude/logs"
  CASE_LOG="$HOME/.claude/logs/claudemd.jsonl"
}
has_failopen() {  # <hook> <reason>
  jq -e --arg h "$1" --arg r "$2" \
    'select(.hook==$h and .event=="fail-open" and .extra.reason==$r)' \
    "$CASE_LOG" >/dev/null 2>&1
}

# A hooks/ copy whose platform.sh sources cleanly but defines nothing — the
# truncated-mid-definition shape, not a deleted file. `source` returns 0 for it,
# which is precisely why the exit code was never sufficient evidence.
STUB_HOOKS=$(mktemp -d) || exit 1
cp -R "$HOOKS_DIR/." "$STUB_HOOKS/"
printf '# truncated mid-definition\nplatform_' > "$STUB_HOOKS/lib/platform.sh"

# T15: ship-baseline — platform_timeout absent. Pre-fix the `|| true` source let
# it through and `platform_timeout gh run list` exited 127, which the trailing
# `|| exit 0` turned into a silent ALLOW on a red-CI push.
fresh_home
printf '%s\n' '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"/tmp"}' \
  | bash "$STUB_HOOKS/ship-baseline-check.sh" >/dev/null 2>&1
has_failopen ship-baseline prereq-missing \
  && ok "T15 ship-baseline records fail-open when platform_timeout is undefined" \
  || ng "T15 ship-baseline did not record prereq-missing (log: $(cat "$CASE_LOG" 2>/dev/null))"

# T16: sandbox-disposal — the one hook that used to `source platform.sh || exit 0`
# outright, above its own kill switch and with no row.
fresh_home
printf '%s\n' '{"session_id":"t","cwd":"/tmp"}' \
  | bash "$STUB_HOOKS/sandbox-disposal-check.sh" >/dev/null 2>&1
has_failopen sandbox-disposal prereq-missing \
  && ok "T16 sandbox-disposal records fail-open when platform_find_newer is undefined" \
  || ng "T16 sandbox-disposal did not record prereq-missing (log: $(cat "$CASE_LOG" 2>/dev/null))"

# T17/T18: memory-read-check — post-trigger, the transcript and the index are
# located through the cwd encoding, which has drifted twice. Both misses looked
# identical to "this project has no memories".
mrc_event() {
  printf '{"session_id":"s1","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"%s"}\n' "$1"
}
fresh_home
ENC=$(printf '%s' "/work/proj" | tr -c 'a-zA-Z0-9-' '-')
mkdir -p "$HOME/.claude/projects/$ENC/memory"
printf -- '- [Ship lessons](feedback_ship.md) `[ship, release, push]` — x\n' \
  > "$HOME/.claude/projects/$ENC/memory/MEMORY.md"
mrc_event "/work/proj" | bash "$HOOKS_DIR/memory-read-check.sh" >/dev/null 2>&1
has_failopen memory-read-check transcript-missing \
  && ok "T17 memory-read-check records fail-open when the transcript is absent" \
  || ng "T17 memory-read-check did not record transcript-missing (log: $(cat "$CASE_LOG" 2>/dev/null))"

fresh_home
mkdir -p "$HOME/.claude/projects/$ENC"
: > "$HOME/.claude/projects/$ENC/s1.jsonl"
mrc_event "/work/proj" | bash "$HOOKS_DIR/memory-read-check.sh" >/dev/null 2>&1
has_failopen memory-read-check mem-index-missing \
  && ok "T18 memory-read-check records fail-open when MEMORY.md is absent" \
  || ng "T18 memory-read-check did not record mem-index-missing (log: $(cat "$CASE_LOG" 2>/dev/null))"

# T19: banned-vocab Path 2 — same transcript lookup, same silence.
fresh_home
printf '%s\n' '{"session_id":"s1","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"/work/proj"}' \
  | bash "$HOOKS_DIR/banned-vocab-check.sh" >/dev/null 2>&1
has_failopen banned-vocab transcript-missing \
  && ok "T19 banned-vocab records fail-open when the transcript is absent" \
  || ng "T19 banned-vocab did not record transcript-missing (log: $(cat "$CASE_LOG" 2>/dev/null))"

rm -rf "$STUB_HOOKS"
unset HOME; export HOME="$TMP_HOME"

# T20: class gate. Derive the subject set from source — a deny-capable hook that
# sources platform.sh must ASSERT a platform_* symbol before relying on one.
# Naming the two hooks that had the gap would be a list written against the same
# blind spot that produced it (the trigger-view-parity lesson).
T20_SUBJECTS=()
for f in "$HOOKS_DIR"/*.sh; do
  grep -q 'hook_deny' "$f" || continue
  grep -q 'platform\.sh' "$f" || continue
  T20_SUBJECTS+=("$f")
done
# Floor of 1 was weaker than the finding it encodes (two hooks carried the gap),
# so a derivation that collapsed to one would still have passed
# (0.70.0 pre-tag review, LOW-3). ship-baseline can deny; sandbox-disposal is
# advisory and therefore NOT in this set — the floor counts deny-capable hooks
# only, and today that is exactly one, so it is asserted as an equality against
# a named expectation rather than a floor that cannot bite.
if (( ${#T20_SUBJECTS[@]} == 1 )) && [[ "$(basename "${T20_SUBJECTS[0]}")" == "ship-baseline-check.sh" ]]; then
  ok "T20 subject set is exactly {ship-baseline-check.sh} (deny-capable + sources platform.sh)"
else
  ng "T20 subject set changed: expected exactly {ship-baseline-check.sh}, got [${T20_SUBJECTS[*]+${T20_SUBJECTS[*]}}] — a new deny-capable platform.sh consumer needs its own symbol assertion"
fi
for f in ${T20_SUBJECTS[@]+"${T20_SUBJECTS[@]}"}; do
  if grep -q 'declare -f platform_' "$f"; then
    ok "T20 $(basename "$f") asserts a platform_* symbol before use"
  else
    ng "T20 $(basename "$f") sources platform.sh and can deny, but never asserts the symbol"
  fi
done

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
