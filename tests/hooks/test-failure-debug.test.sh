#!/usr/bin/env bash
# test-failure-debug.test.sh — debug.md injected when a test run fails
# (tasks/specs/test-failure-debug.md). Runs against the repo's built modules in a
# sandbox HOME, so the module under test is the shipped one.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
HOOK="$REPO/hooks/test-failure-debug.sh"
INJ="$REPO/hooks/spec-module-inject.sh"
TMP_HOME=$(mktemp -d -t claudemd-tfd-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/spec-modules" "$HOME/.claude/logs"
cp "$REPO"/spec/spec-modules/*.md "$HOME/.claude/spec-modules/"
LOG="$HOME/.claude/logs/claudemd.jsonl"

# shellcheck source=tests/lib/assert.sh
source "$HERE/../lib/assert.sh"

fail_event() { # COMMAND SESSION [INTERRUPT] [TOOL]
  jq -cn --arg c "$1" --arg s "$2" --argjson i "${3:-false}" --arg t "${4:-Bash}" \
    '{hook_event_name:"PostToolUseFailure", tool_name:$t, tool_input:{command:$c}, tool_use_id:"tu1", error:"Exit code 1\nFAIL", is_interrupt:$i, session_id:$s, cwd:"/work/p"}'
}
ctx() { jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }
run() { DEBUG_ON_TEST_FAILURE=1 bash "$HOOK" 2>/dev/null; }

# 1. default OFF: a failing test run injects nothing without the opt-in.
O1=$(fail_event 'npm test' s1 | bash "$HOOK" 2>/dev/null)
[[ -z "$O1" ]] && ok "1 opt-in unset: silent" || ng "1 emitted without opt-in: ${O1:0:80}"

# 2. opted in, a failing test run injects debug.md, wrapped, on the right event.
O2=$(fail_event 'npm test' s2 | run)
C2=$(ctx <<<"$O2")
if [[ "$(jq -r '.hookSpecificOutput.hookEventName' <<<"$O2")" == PostToolUseFailure ]] \
   && grep -q '^<spec-module name="debug">$' <<<"$C2" && grep -q 'injected because a command that runs tests just failed' <<<"$C2" \
   && ! grep -q '<!-- generated from' <<<"$C2" && grep -qx debug "$HOME/.claude/.claudemd-state/modinj-s2.list"; then
  ok "2 a failing npm test injects debug.md once and records it in the session list"
else ng "2 wrong: event=$(jq -r '.hookSpecificOutput.hookEventName' <<<"$O2" 2>/dev/null) ctx=${C2:0:120}"; fi

# 3. once per session.
O3=$(fail_event 'npm test' s2 | run)
[[ -z "$O3" ]] && ok "3 a second failure in the same session injects nothing" || ng "3 re-injected"

# 4. shared with tier 2 in both directions: a session tier 2 already gave debug.md
# gets nothing here, and after this hook injected it tier 2 does not inject it again.
jq -cn '{prompt:"fix the bug in parser.js", session_id:"s4", cwd:"/work/p"}' | bash "$INJ" >/dev/null 2>&1
O4=$(fail_event 'pytest -q' s4 | run)
fail_event 'pytest -q' s4b | run >/dev/null
T4=$(jq -cn '{prompt:"fix the bug in parser.js", session_id:"s4b", cwd:"/work/p"}' | bash "$INJ" 2>/dev/null | ctx)
if [[ -z "$O4" ]] && ! grep -q 'name="debug"' <<<"$T4"; then
  ok "4 one debug.md per session whichever hook injects it first"
else ng "4 double injection: after-tier2=${O4:0:60} tier2-after=${T4:0:60}"; fi

# 5. which failures count: test runners do, other commands and a lint do not.
BAD5=0; N5=0
for c in 'npm run test:scripts' 'bash tests/hooks/foo.test.sh' 'node --test tests/a.test.js' 'cd pkg && npx vitest run' \
  'python3 -m pytest -x' 'cargo test --lib' 'go test ./...' 'bash tests/run-all.sh 2>&1 | tail -5' $'cd pkg\nnpm test' \
  'timeout 120 pytest -q' 'CI=1 npx jest --ci'; do
  N5=$((N5+1)); [[ -n "$(fail_event "$c" "s5p$N5" | run | ctx)" ]] || { ng "5 test runner missed: $c"; BAD5=1; }
done
N5=0
for c in 'ls /nonexistent' 'npm run lint' 'npx eslint .' 'git commit -m "fix tests"' 'grep -r pytest src' 'cat latest.txt' \
  'echo "run npm test later"'; do
  N5=$((N5+1)); [[ -z "$(fail_event "$c" "s5n$N5" | run)" ]] || { ng "5 non-test failure injected: $c"; BAD5=1; }
done
[[ $BAD5 == 0 ]] && ok "5 test-runner failures inject; ls, lint, git and grep failures do not"

# 6. an interrupt is not a failing test; a non-Bash tool is out of scope.
O6=$(fail_event 'npm test' s6 true | run)
O6B=$(fail_event 'npm test' s6b false Edit | run)
[[ -z "$O6" && -z "$O6B" ]] && ok "6 interrupts and non-Bash failures are ignored" || ng "6 int=${O6:0:40} edit=${O6B:0:40}"

# 7. kill switch after opt-in.
O7=$(fail_event 'npm test' s7 | DISABLE_TEST_FAILURE_DEBUG_HOOK=1 DEBUG_ON_TEST_FAILURE=1 bash "$HOOK" 2>/dev/null)
[[ -z "$O7" ]] && ok "7 DISABLE_TEST_FAILURE_DEBUG_HOOK=1 silences it" || ng "7 kill switch ignored"

# 8. telemetry names the module and the trigger.
if jq -e 'select(.hook=="test-failure-debug" and .event=="module-inject" and .spec_section=="§2.2-modules" and .extra.modules=="debug" and .extra.trigger=="test-failure")' "$LOG" >/dev/null 2>&1; then
  ok "8 a module-inject row carries modules=debug, trigger=test-failure"
else ng "8 no row: $(tail -1 "$LOG" 2>/dev/null)"; fi

# 9. no installed module: silent, exit 0.
mv "$HOME/.claude/spec-modules" "$HOME/.claude/spec-modules.off"
O9=$(fail_event 'npm test' s9 | run); RC9=$?
mv "$HOME/.claude/spec-modules.off" "$HOME/.claude/spec-modules"
[[ -z "$O9" && "$RC9" == 0 ]] && ok "9 no debug.md installed: silent" || ng "9 rc=$RC9 out=${O9:0:40}"

# 10. no temp file writable (D#417): bash 3.2 read the event's fields from a
# here-string, a temp file, and with none writable `set -u` ended the hook on
# "TOOL: unbound variable" before it injected anything. stderr joins stdout, so
# an error line also fails the parse. Discriminates under bash 5.0 and earlier
# (bash32-runtime.sh, macOS CI): 5.1+ sends a short here-string through a pipe.
O10=$(fail_event 'npm test' s10 | (trap '' XFSZ; ulimit -f 0; DISABLE_RULE_HITS_LOG=1 DEBUG_ON_TEST_FAILURE=1 bash "$HOOK" 2>&1))
if grep -q '^<spec-module name="debug">$' < <(ctx <<<"$O10"); then
  ok "10 no temp file writable: a failing test run still injects debug.md"
else ng "10 no temp file writable: ${O10:0:200}"; fi

# 11. A chained command's exit status can be another segment's: when
# `npm test && git push` fails, the push may be what failed, and when
# `cd /nonexistent && npm test` fails the tests never ran. The injected reason
# says what the hook knows — a command that runs tests failed.
C11=$(fail_event 'npm test && git push' s11 | run | ctx)
if [[ "$C11" == *"injected because a command that runs tests just failed"* && "$C11" != *"a test run just failed"* ]]; then
  ok "11 a chained command's failure is not called a failed test run"
else ng "11 reason text: $(printf '%s' "$C11" | head -n 1)"; fi

# 12. An empty module injects nothing and leaves the session's slot open.
cp "$HOME/.claude/spec-modules/debug.md" "$HOME/debug.md.keep"
printf -- '---\nname: debug\n---\n\n' > "$HOME/.claude/spec-modules/debug.md"
O12=$(fail_event 'npm test' s12 | run)
cp "$HOME/debug.md.keep" "$HOME/.claude/spec-modules/debug.md"
O12B=$(fail_event 'npm test' s12 | run | ctx)
if [[ -z "$O12" ]] && grep -q 'name="debug"' < <(printf '%s' "$O12B"); then
  ok "12 an empty debug.md injects nothing, and the real one still gets in later"
else ng "12 empty=${O12:0:80} later=${O12B:0:80}"; fi

# 13. Concurrent failures in one session inject once. Failing Bash calls in one
# assistant message run this hook in parallel, and each read the list before
# any of them had appended to it.
D13="$HOME/c13"; mkdir -p "$D13"
fail_event 'npm test' s13 > "$D13/ev"
for k in 1 2 3 4 5 6 7 8; do
  ( DEBUG_ON_TEST_FAILURE=1 bash "$HOOK" < "$D13/ev" > "$D13/out$k" 2>/dev/null ) &
done
wait
N13=0
for k in 1 2 3 4 5 6 7 8; do [[ -s "$D13/out$k" ]] && N13=$((N13 + 1)); done
L13=$(grep -cx debug "$HOME/.claude/.claudemd-state/modinj-s13.list" 2>/dev/null)
[[ "$N13" == 1 && "$L13" == 1 ]] && ok "13 eight concurrent failures inject debug.md once" || ng "13 injected $N13 times, list has $L13 debug lines"

# 14. A session list that cannot be written: the redirect error must not reach
# stderr (it was opened before `2>/dev/null` applied), and the module still goes in.
mkdir -p "$HOME/.claude/.claudemd-state/modinj-s14.list"
E14=$(fail_event 'npm test' s14 | DEBUG_ON_TEST_FAILURE=1 bash "$HOOK" 2>&1 >/dev/null)
O14=$(fail_event 'npm test' s14b | run | ctx)
[[ -z "$E14" && -n "$O14" ]] && ok "14 an unwritable session list writes nothing to stderr" || ng "14 stderr: $E14"

# 15. A lock left by a hook killed between taking and releasing it (a timeout)
# blocked debug.md for the rest of the session (0.113.3 pre-tag review). The
# lock is held for one grep and one append, so one older than a minute is stale.
touch "$HOME/.claude/.claudemd-state/modinj-s15.debug-lock"
touch -t 200001010000 "$HOME/.claude/.claudemd-state/modinj-s15.debug-lock"
O15=$(fail_event 'npm test' s15 | run | ctx)
[[ -n "$O15" ]] && ok "15 a lock older than a minute does not block the injection" || ng "15 stale lock blocked debug.md"

claudemd_assert_summary
