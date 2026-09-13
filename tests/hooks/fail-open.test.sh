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

# One list, one EXIT trap, for every sandbox this suite creates. It used to be a
# single trap over TMP_HOME only, while `fresh_home()` below made a NEW directory
# per case and removed none of them — one leak per assertion, which is where most
# of the 150-250 stray $TMPDIR dirs a day came from (2026-09-02 audit R11-38).
# sandbox_new assigns through a global rather than stdout on purpose: a command
# substitution runs in a subshell, so `d=$(sandbox_new)` would append to a copy of
# SANDBOXES that dies with it and register nothing.
SANDBOXES=()
cleanup_sandboxes() { [[ ${#SANDBOXES[@]} -gt 0 ]] && rm -rf "${SANDBOXES[@]}"; return 0; }
trap cleanup_sandboxes EXIT
sandbox_new() {
  SANDBOX_OUT=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || return 1
  SANDBOXES+=("$SANDBOX_OUT")
}
sandbox_new || { echo "FAIL: mktemp -d failed"; exit 1; }
TMP_HOME="$SANDBOX_OUT"
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
  sandbox_new || { echo "FAIL: mktemp -d failed"; exit 1; }
  TMP_CASE="$SANDBOX_OUT"
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
sandbox_new || exit 1
STUB_HOOKS="$SANDBOX_OUT"
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

# T21: an UNSET $HOME must not swallow a verdict the hook already computed.
#
# Every hook runs `set -uo pipefail`, and dozens of expansions across this family
# read `$HOME` with no default — so an unset HOME is a FATAL, not a degrade.
# THREE deny-capable gates reach one of those expansions above their own
# `hook_deny`: the analysis finished and matched, the process died on the unbound
# variable, and it exited 1 with EMPTY stdout. Claude Code reads a non-zero hook
# exit as a non-blocking error, so the command ran — the gate not enforced, with a
# raw `HOME: unbound variable` printed on every Bash tool call.
#
# The two rows in T21_CASES die in the deny TELEMETRY, one line up. The third,
# ship-baseline-check, dies in its own `STATE_DIR=` near the top of the deny path,
# nowhere near a record call — which is why it gets its own block below rather
# than a third row, and why it is worth a case at all: it proves the subject is
# any unguarded `$HOME` between analysis and verdict, not one call site. It had no
# test until the 0.88.0 pre-tag review asked which gates the release actually
# restored and the answer was one more than every comment claimed.
#
# The shape is not new: the v0.23.7 note in pre-bash-safety-check.sh records the
# same one (bash 3.2 aborting on `declare -A` before `hook_deny`), and the line
# it left behind — "hook_deny below blocks regardless of the telemetry outcome"
# — is the claim this case exists to keep true. Telemetry must not be able to
# abort enforcement, whatever kills it.
#
# Reachable without contrivance: a systemd unit with no `User=`, a container
# ENTRYPOINT under a numeric UID, `env -i`, a scrubbed CI shell.
#
# Each case runs BOTH arms. The HOME-set arm is the control: a fix that made
# these hooks deny unconditionally would pass the unset arm and is caught here.
t21_probe() {  # $1=hook file  $2=command  -> sets T21_OUT / T21_ERR / T21_RC
  local hook="$1" cmd="$2" ev
  ev=$(jq -cn --arg c "$cmd" \
    '{session_id:"qa-t21",transcript_path:"/nonexistent.jsonl",cwd:".",hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c}}')
  T21_ERR=$(mktemp "${TMPDIR:-/tmp}/claudemd-t21-XXXXXX") || return 1
  SANDBOXES+=("$T21_ERR")
  if [[ "${3:-}" == "nohome" ]]; then
    T21_OUT=$(printf '%s' "$ev" | env -u HOME bash "$HOOKS_DIR/$hook" 2>"$T21_ERR")
  else
    T21_OUT=$(printf '%s' "$ev" | bash "$HOOKS_DIR/$hook" 2>"$T21_ERR")
  fi
  T21_RC=$?
  T21_ERR=$(cat "$T21_ERR" 2>/dev/null)
}
# `rm -rf $X` → §8-rm-rf-var; the banned word → §10-V. Both are deny rows whose
# telemetry call precedes hook_deny, which is the sequence under test.
T21_CASES="pre-bash-safety-check.sh|rm -rf \$QA_T21_DIR
banned-vocab-check.sh|git commit -m \"significantly faster\""
while IFS='|' read -r t21_hook t21_cmd; do
  [[ -n "$t21_hook" ]] || continue
  t21_probe "$t21_hook" "$t21_cmd" nohome
  if printf '%s' "$T21_OUT" | grep -q '"permissionDecision":"deny"'; then
    ok "T21 $t21_hook still denies with HOME unset"
  else
    ng "T21 $t21_hook LOST its deny with HOME unset (rc=$T21_RC, stdout='$T21_OUT', stderr='$T21_ERR')"
  fi
  # Emptiness, not just the absence of "unbound variable": the label promises
  # silence and the hook fires on EVERY Bash tool call, so any stderr at all is
  # session noise. Measured 0 bytes for all three T21 gates in both arms; a tool
  # warning appearing here later is a finding someone should look at, not
  # something a narrower assertion should absorb (0.88.0 pre-tag review, Low-14).
  if [[ -n "$T21_ERR" ]]; then
    ng "T21 $t21_hook wrote to the user's session stderr with HOME unset: $T21_ERR"
  else
    ok "T21 $t21_hook stays quiet on stderr with HOME unset"
  fi
  # Control arm: the same command with HOME set must still deny, so the case
  # cannot be satisfied by a hook that denies everything.
  t21_probe "$t21_hook" "$t21_cmd"
  if printf '%s' "$T21_OUT" | grep -q '"permissionDecision":"deny"'; then
    ok "T21 control: $t21_hook denies with HOME set"
  else
    ng "T21 control: $t21_hook did not deny with HOME set (rc=$T21_RC, stderr='$T21_ERR')"
  fi
done <<EOF
$T21_CASES
EOF
# T21-sb: the third deny-capable gate. Needs a `gh` that reports a red run and a
# git work tree for the known-red-marker read, so it cannot ride the loop above.
# Measured on 9dc08d2: rc=1, 0 bytes stdout, `ship-baseline-check.sh:260: HOME:
# unbound variable` — the §7 gate waves the push through. Here it must deny.
# Assign INSIDE the success arm. `sandbox_new` leaves SANDBOX_OUT untouched when
# its mktemp fails, so an unconditional `T21_SB="${SANDBOX_OUT:-}"` after it would
# inherit the PREVIOUS sandbox — `$STUB_HOOKS`, already removed above — and the
# `-n` skip below could never fire: the block would `ng` and then run anyway
# against a recreated stale path (0.88.0 pre-tag review, Low-13).
if sandbox_new; then
  T21_SB="$SANDBOX_OUT"
else
  ng "T21-sb mktemp failed"
  T21_SB=""
fi
if [[ -n "$T21_SB" ]]; then
  mkdir -p "$T21_SB/bin" "$T21_SB/repo"
  # One completed+failure run: the shape ship-baseline-check reads as red CI.
  cat > "$T21_SB/bin/gh" <<'GHSTUB'
#!/usr/bin/env bash
echo '[{"databaseId":9,"status":"completed","conclusion":"failure","displayTitle":"CI","url":"https://example/9"}]'
GHSTUB
  chmod +x "$T21_SB/bin/gh"
  # A clean HEAD, so the `known-red baseline:` override is NOT in play and the
  # deny under test is the ordinary one. Its own repo, not the suite's cwd: the
  # real HEAD would make this case depend on whatever the last commit said.
  ( cd "$T21_SB/repo" && git init -q \
      && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "clean commit" ) \
    || ng "T21-sb could not build the fixture repo"
  t21_sb() {  # $1 = "nohome" to drop HOME
    local ev errf
    ev=$(jq -cn '{session_id:"qa-t21-sb",transcript_path:"/nonexistent.jsonl",cwd:"/tmp",hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:"git push origin main"}}')
    errf=$(mktemp "${TMPDIR:-/tmp}/claudemd-t21sb-XXXXXX") || return 1
    SANDBOXES+=("$errf")
    if [[ "${1:-}" == nohome ]]; then
      T21_OUT=$(cd "$T21_SB/repo" && printf '%s' "$ev" | env -u HOME PATH="$T21_SB/bin:$PATH" bash "$HOOKS_DIR/ship-baseline-check.sh" 2>"$errf")
    else
      T21_OUT=$(cd "$T21_SB/repo" && printf '%s' "$ev" | env PATH="$T21_SB/bin:$PATH" bash "$HOOKS_DIR/ship-baseline-check.sh" 2>"$errf")
    fi
    T21_RC=$?
    T21_ERR=$(cat "$errf" 2>/dev/null)
  }
  t21_sb nohome
  if printf '%s' "$T21_OUT" | grep -q '"permissionDecision":"deny"'; then
    ok "T21 ship-baseline-check still denies a red-CI push with HOME unset"
  else
    ng "T21 ship-baseline-check LOST its §7 deny with HOME unset (rc=$T21_RC, stdout='$T21_OUT', stderr='$T21_ERR')"
  fi
  if [[ -n "$T21_ERR" ]]; then
    ng "T21 ship-baseline-check wrote to the user's session stderr with HOME unset: $T21_ERR"
  else
    ok "T21 ship-baseline-check stays quiet on stderr with HOME unset"
  fi
  t21_sb
  if printf '%s' "$T21_OUT" | grep -q '"permissionDecision":"deny"'; then
    ok "T21 control: ship-baseline-check denies the same push with HOME set"
  else
    ng "T21 control: ship-baseline-check did not deny with HOME set (rc=$T21_RC, stderr='$T21_ERR') — fixture no longer reads as red CI"
  fi
fi

# Negative control: a clean command must still be ALLOWED with HOME unset, or
# "denies with HOME unset" above would be satisfied by a hook that denies on the
# fail path too.
t21_probe pre-bash-safety-check.sh 'ls -la' nohome
if [[ -z "$T21_OUT" ]]; then
  ok "T21 negative control: a safe command is not denied with HOME unset"
else
  ng "T21 negative control: safe command produced output with HOME unset: $T21_OUT"
fi

# T22: the invariant T21 rests on, pinned at the source.
#
# T21 proves two hooks survive an unset HOME today. What makes that true for all
# fifteen is a single line — `: "${HOME:=}"` in hook-common.sh — which every hook
# inherits by sourcing that file BEFORE it expands $HOME. Nothing enforces the
# ordering. A sixteenth hook that reads $HOME above its source line, or one that
# does not source hook-common at all, reopens the fail-open for itself, and the
# symptom is the one this whole case exists for: a gate that stops enforcing and
# writes no record of having stopped.
#
# Comment lines are blanked (not deleted) before the scan so line numbers stay
# aligned with the file — pre-bash-safety-check.sh documents the whitelist as
# "Whitelists $HOME, $PWD" on line 5, forty lines above its source, and a scan
# that counted it reported the one hook that is fine as the one that is broken.
# `${HOME:-}` / `${HOME:=}` are their own guard and are not a finding.
T22_HOOKS=0
for f in "$HOOKS_DIR"/*.sh; do
  [[ -f "$f" ]] || continue
  T22_HOOKS=$((T22_HOOKS + 1))
  t22_name=$(basename "$f")
  t22_stripped=$(sed -E 's/^[[:space:]]*#.*$//' "$f")
  t22_src=$(printf '%s\n' "$t22_stripped" | grep -n 'source .*hook-common\.sh' | head -1 | cut -d: -f1)
  t22_use=$(printf '%s\n' "$t22_stripped" | grep -nE '\$\{?HOME\b' | grep -vE '\$\{HOME:[-=]' | head -1 | cut -d: -f1)
  if [[ -z "$t22_use" ]]; then
    ok "T22 $t22_name never expands \$HOME"
  elif [[ -z "$t22_src" ]]; then
    ng "T22 $t22_name expands \$HOME at line $t22_use but never sources hook-common.sh — nothing binds HOME for it"
  elif (( t22_src < t22_use )); then
    ok "T22 $t22_name sources hook-common (L$t22_src) before its first \$HOME (L$t22_use)"
  else
    ng "T22 $t22_name expands \$HOME at line $t22_use, ABOVE its hook-common source at line $t22_src — an unset HOME is fatal there"
  fi
done
# Floor: the loop must have had subjects. An empty HOOKS_DIR glob would print
# nothing and pass, which is the shape run-all.sh's suite-count floors exist for.
if (( T22_HOOKS >= 15 )); then
  ok "T22 scanned $T22_HOOKS hook(s) (floor 15)"
else
  ng "T22 scanned only $T22_HOOKS hook(s) — the glob matched nothing or the layer moved"
fi
# And the bind itself must precede the lib sourcing inside hook-common.sh, or the
# leaf libs it pulls in are evaluated with HOME still unbound.
T22_COMMON="$HOOKS_DIR/lib/hook-common.sh"
t22_bind=$(grep -n '^: "\${HOME:=}"' "$T22_COMMON" | head -1 | cut -d: -f1)
t22_leaf=$(grep -n '^source .*rule-hits\.sh' "$T22_COMMON" | head -1 | cut -d: -f1)
if [[ -n "$t22_bind" && -n "$t22_leaf" ]] && (( t22_bind < t22_leaf )); then
  ok "T22 hook-common binds HOME (L$t22_bind) before sourcing rule-hits.sh (L$t22_leaf)"
else
  ng "T22 hook-common must bind HOME before sourcing its leaf libs (bind=${t22_bind:-absent} leaf=${t22_leaf:-absent})"
fi

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
