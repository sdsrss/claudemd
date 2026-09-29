#!/usr/bin/env bash
# test-failure-debug.sh — PostToolUseFailure hook (Bash), opt-in.
#
# Injects the `debug` spec module at the moment a test run fails, once per
# session. Tier 2 (spec-module-inject.sh) reaches debug.md only through the
# user's words ("fix the bug", 报错): in 70 historical sessions with a failed
# test run, 44 had no prompt matching the debug trigger at or before the first
# failure (tasks/specs/test-failure-debug.md). That module carries the rule for
# exactly this moment — the same failure signature three times means stop
# patching and diagnose — and it was not in context when the loop started.
#
# Why PostToolUseFailure: a Bash call that exits non-zero fires it and NOT
# PostToolUse. Measured on Claude Code 2.1.284 (2026-09-29): `ls /nonexistent`
# under a hook registered for both events fired PostToolUseFailure only, with
# `error` = "Exit code 2\n<stderr>", and the model quoted back a token from its
# additionalContext.
#
# Once per session, shared with tier 2: the same modinj-<sid>.list, so a module
# tier 2 already injected is not injected again, a module injected here is not
# injected again by tier 2, and session-start clears the list on compaction.
#
# Opt-in: DEBUG_ON_TEST_FAILURE=1 (default OFF), per §EXT §13.3 for a
# behaviour-layer hook. Checked before sourcing anything: this hook runs on every
# failed Bash call.
#
# Kill-switches:
#   DISABLE_TEST_FAILURE_DEBUG_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1          — global

set -uo pipefail

[[ "${DEBUG_ON_TEST_FAILURE:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/spec-module.sh" || exit 0

hook_kill_switch TEST_FAILURE_DEBUG || exit 0
hook_require_jq || { hook_record_failopen test-failure-debug jq-missing; exit 0; }

EVENT=$(hook_read_event) || exit 0
FIELDS=$(hook_jq_field test-failure-debug "$EVENT" '[.tool_name // "", (.is_interrupt // false | tostring), .session_id // ""] | @tsv') || exit 0
IFS=$'\t' read -r TOOL INTERRUPT SESSION_ID <<<"$FIELDS"
[[ "$TOOL" == Bash && "$INTERRUPT" != true ]] || exit 0
[[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# A test RUNNER at command position, not any verifier: a failed lint or
# typecheck is not the red-green loop debug.md is about, and `grep pytest src`
# is not a test run. The runner set is the one tasks/specs/test-failure-debug.md
# counted the reach with; command position is the start of the text or of a
# line, or after ; & | ( or a backtick, past any of npx / bunx / pnpm|yarn exec /
# uv|poetry run / timeout N / env / NAME=value.
_nl=$'\n'
TEST_CMD_RE="(^|[;&|(\`${_nl}])[[:space:]]*((npx|bunx|env|(pnpm|yarn)[[:space:]]+exec|(uv|poetry)[[:space:]]+run|timeout[[:space:]]+[0-9.]+[smh]?|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)[[:space:]]+)*((npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?test[[:alnum:]:_-]*|pytest|python3?[[:space:]]+-m[[:space:]]+(pytest|unittest)|jest|vitest|mocha|node[[:space:]]+--test|cargo[[:space:]]+test|go[[:space:]]+test|make[[:space:]]+test|rspec|ctest|(gradle|mvn|dotnet)[[:space:]]+test|bash[[:space:]]+[^[:space:]]*tests/[^[:space:]]+|[^[:space:]]*run-all\.sh)([[:space:];&|)]|\$)"
[[ "$CMD" =~ $TEST_CMD_RE ]] || exit 0

MOD="$HOME/.claude/spec-modules/debug.md"
[[ -f "$MOD" ]] || exit 0
STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
SEEN="$STATE_DIR/modinj-$SESSION_ID.list"
grep -qx debug "$SEEN" 2>/dev/null && exit 0

specmod_entry debug "$(specmod_body "$MOD")" "injected because a test run just failed"
printf 'debug\n' >>"$SEEN" 2>/dev/null || true

hook_record test-failure-debug module-inject '{"modules":"debug","trigger":"test-failure"}' '§2.2-modules' "$SESSION_ID" 2>/dev/null || true
jq -cn --arg c "$SPECMOD_ENTRY" '{suppressOutput: true, hookSpecificOutput: {hookEventName: "PostToolUseFailure", additionalContext: $c}}'
exit 0
