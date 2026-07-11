#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# bash-readonly-skip.test.sh — tests for v0.8.3 R-N5 readonly fast-path.
# Covers (a) hook_is_readonly_bash classification and (b) end-to-end:
# with BASH_READONLY_FAST_PATH=1, all 4 PreToolUse:Bash hooks short-circuit
# on read-only commands; with the flag OFF, behavior is unchanged from v0.8.2.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$HERE/../../hooks/lib/hook-common.sh"
BANNED="$HERE/../../hooks/banned-vocab-check.sh"
PRE_SAFETY="$HERE/../../hooks/pre-bash-safety-check.sh"
SHIP="$HERE/../../hooks/ship-baseline-check.sh"
MEM="$HERE/../../hooks/memory-read-check.sh"

FAIL=0
ok() { echo "PASS: $1"; }
ng() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# Classification: read-only commands → readonly=YES
classify() {
  local cmd="$1"
  bash -c "source $LIB; hook_is_readonly_bash '$cmd' && echo YES || echo NO"
}

# --- Classifier: pure read-only commands -------------------------------------
[[ "$(classify 'ls')" == "YES" ]] && ok "1: bare ls" || ng "1: bare ls (got $(classify 'ls'))"
[[ "$(classify 'ls -la')" == "YES" ]] && ok "2: ls -la" || ng "2: ls -la"
[[ "$(classify 'cat /etc/hosts')" == "YES" ]] && ok "3: cat path" || ng "3: cat path"
[[ "$(classify 'pwd')" == "YES" ]] && ok "4: pwd" || ng "4: pwd"
[[ "$(classify 'echo hi')" == "YES" ]] && ok "5: echo" || ng "5: echo"
[[ "$(classify 'git log')" == "YES" ]] && ok "6: git log" || ng "6: git log"
[[ "$(classify 'git status')" == "YES" ]] && ok "7: git status" || ng "7: git status"
[[ "$(classify 'git diff HEAD~1')" == "YES" ]] && ok "8: git diff" || ng "8: git diff"
[[ "$(classify 'git rev-parse HEAD')" == "YES" ]] && ok "9: git rev-parse" || ng "9: git rev-parse"

# --- Classifier: shell-meta → NO (could chain destructive commands) ---------
[[ "$(classify 'ls; rm -rf /')" == "NO" ]] && ok "10: semicolon" || ng "10: semicolon"
[[ "$(classify 'ls | grep x')" == "NO" ]] && ok "11: pipe" || ng "11: pipe"
[[ "$(classify 'ls && true')" == "NO" ]] && ok "12: amp" || ng "12: amp"
[[ "$(classify 'cat foo > bar')" == "NO" ]] && ok "13: redirect out" || ng "13: redirect out"
[[ "$(classify 'cat < foo')" == "NO" ]] && ok "14: redirect in" || ng "14: redirect in"
[[ "$(classify 'echo $(rm -rf /)')" == "NO" ]] && ok "15: cmd-sub" || ng "15: cmd-sub"
[[ "$(classify 'echo `rm -rf /`')" == "NO" ]] && ok "16: backtick" || ng "16: backtick"

# --- Classifier: non-whitelisted first token → NO ---------------------------
[[ "$(classify 'rm foo')" == "NO" ]] && ok "17: rm not whitelisted" || ng "17: rm"
[[ "$(classify 'npm install')" == "NO" ]] && ok "18: npm not whitelisted" || ng "18: npm"
[[ "$(classify 'curl http://x')" == "NO" ]] && ok "19: curl not whitelisted" || ng "19: curl"
# v0.23.11 re-audit: `env <cmd>` executes an arbitrary command → must NOT be
# readonly (was a fast-path bypass of all 4 PreToolUse:Bash enforcement hooks).
[[ "$(classify 'env rm -rf /tmp/x')" == "NO" ]] && ok "19b: env rm not readonly (exec wrapper)" || ng "19b: env rm classified readonly (bypass!)"
[[ "$(classify 'env npx pkg')" == "NO" ]] && ok "19c: env npx not readonly" || ng "19c: env npx classified readonly"

# --- Classifier: git destructive subcommands → NO ---------------------------
[[ "$(classify 'git commit -m foo')" == "NO" ]] && ok "20: git commit" || ng "20: git commit"
[[ "$(classify 'git push origin main')" == "NO" ]] && ok "21: git push" || ng "21: git push"
[[ "$(classify 'git branch -d feat')" == "NO" ]] && ok "22: git branch (-d destructive)" || ng "22: git branch -d"
[[ "$(classify 'git tag v1')" == "NO" ]] && ok "23: git tag (mutates refs)" || ng "23: git tag"
[[ "$(classify 'git config user.email')" == "NO" ]] && ok "24: git config (-c can write)" || ng "24: git config"

# --- End-to-end: 4 hooks short-circuit when flag ON + cmd is readonly -------
# Use a readonly cmd shape that would otherwise FALSELY trigger the hook's
# filter — we want to prove the fast-path gate runs BEFORE the filter.

# pre-bash-safety: `cat /tmp/foo` would never trip the rm/npx detectors,
# but proves no spurious work runs. Run with no jq detection on stderr.
EVENT='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"cat /tmp/x"},"cwd":"/tmp"}'
OUT=$(BASH_READONLY_FAST_PATH=1 echo "$EVENT" | bash "$PRE_SAFETY" 2>&1)
[[ -z "$OUT" ]] && ok "25: pre-bash-safety silent on readonly + flag ON" || ng "25: pre-bash-safety not silent (got: $OUT)"

# ship-baseline: a `git log` cmd would not match the `git push` filter even
# without the fast-path; this just confirms no error from the fast-path branch.
EVENT='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git log -1"},"cwd":"/tmp"}'
OUT=$(BASH_READONLY_FAST_PATH=1 echo "$EVENT" | bash "$SHIP" 2>&1)
[[ -z "$OUT" ]] && ok "26: ship-baseline silent on readonly + flag ON" || ng "26: ship-baseline not silent (got: $OUT)"

# banned-vocab: `git status` is readonly, would already pass the git-commit
# filter; fast-path makes the exit even cheaper (no grep on filter). Verify
# no error.
EVENT='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git status"},"cwd":"/tmp"}'
OUT=$(BASH_READONLY_FAST_PATH=1 echo "$EVENT" | bash "$BANNED" 2>&1)
[[ -z "$OUT" ]] && ok "27: banned-vocab silent on readonly + flag ON" || ng "27: banned-vocab not silent (got: $OUT)"

# memory-read-check: `ls` would not match the trigger regex either way, but
# fast-path skips the regex entirely.
EVENT='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"ls -la"},"cwd":"/tmp"}'
OUT=$(BASH_READONLY_FAST_PATH=1 echo "$EVENT" | bash "$MEM" 2>&1)
[[ -z "$OUT" ]] && ok "28: memory-read silent on readonly + flag ON" || ng "28: memory-read not silent (got: $OUT)"

# --- Non-readonly cmds: deny path intact regardless of flag state -----------
# v0.20.0 NOTE: default flipped from opt-in OFF to opt-out ON. Cases 29-30
# verify that the deny path is unaffected by the flag for NON-readonly cmds
# (the only ones that can carry banned vocab in commit messages anyway).
# `git commit` is not in the readonly whitelist (see Case 20 above), so the
# fast-path branch never activates on it — flag state doesn't matter.

# Default env (post v0.20.0 = fast-path ON) — git commit with banned vocab
# is NOT readonly, so the fast-path skip MUST NOT engage; deny fires.
EVENT="{\"session_id\":\"t\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m 'significantly improved'\"},\"cwd\":\"/tmp\"}"
DENY=$(echo "$EVENT" | bash "$BANNED" 2>&1 | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DENY" == "deny" ]] && ok "29: post-v0.20.0 default ON → non-readonly git commit still denies" || ng "29: default state deny missing (got '$DENY')"

# Explicit opt-in =1 (legacy form) — same non-readonly cmd must still deny.
DENY=$(BASH_READONLY_FAST_PATH=1 echo "$EVENT" | bash "$BANNED" 2>&1 | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DENY" == "deny" ]] && ok "30: flag explicit ON does not skip non-readonly cmds" || ng "30: flag ON skipped a non-readonly cmd (got '$DENY')"

# --- v0.20.0 default flip: env-shape regression cases -----------------------

# Case 31: explicit opt-out via =0 — non-readonly cmd must still deny (the
# opt-out only affects the fast-path skip, never the deny path).
DENY=$(BASH_READONLY_FAST_PATH=0 echo "$EVENT" | bash "$BANNED" 2>&1 | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DENY" == "deny" ]] && ok "31 (v0.20.0): explicit opt-out =0 keeps deny path active on non-readonly cmd" || ng "31: opt-out broke deny path (got '$DENY')"

# Case 32: default (no env) + readonly cmd → silent. Pre-v0.20.0 this also
# happened to be silent (filter didn't match `ls`), but the path was the
# slow one. We can't directly observe the path from output, but absence of
# error stdout + clean exit is the contract.
EVENT_RO='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"ls -la"},"cwd":"/tmp"}'
OUT=$(echo "$EVENT_RO" | bash "$BANNED" 2>&1)
[[ -z "$OUT" ]] && ok "32 (v0.20.0): default (env unset) + readonly cmd → silent (banned-vocab)" || ng "32: default silent broken (got: $OUT)"

# Case 33: explicit opt-out (=0) + readonly cmd → still silent. Verifies the
# opt-out doesn't accidentally surface stderr noise on the slow path.
OUT=$(BASH_READONLY_FAST_PATH=0 echo "$EVENT_RO" | bash "$BANNED" 2>&1)
[[ -z "$OUT" ]] && ok "33 (v0.20.0): opt-out =0 + readonly cmd → still silent (slow path)" || ng "33: opt-out introduced noise (got: $OUT)"

if (( FAIL > 0 )); then
  echo "Tests: $((35 - FAIL))/35 passed"
  exit 1
fi
echo "Tests: 35/35 passed"
