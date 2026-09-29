#!/usr/bin/env bash
# verify-log.sh — PostToolUse hook (Bash), opt-in, log only (R3;
# tasks/specs/wtree-evidence.md).
#
# Records, for every SUCCESSFUL verification command, the working-tree content
# fingerprint it ran on (hooks/lib/wtree.sh). evidence-gate.sh records the
# fingerprint at each completion claim beside its own verdict. An offline pass
# (scripts/offline-eval/wtree-verdicts.mjs) then asks whether the claimed
# content was ever verified — a question that does not care which channel
# edited the files. evidence-gate's current verdict reads the transcript for
# edits, and a file rewritten through a Bash heredoc is only visible to it when
# Claude Code records bashEditDiff (64-83% of Opus 5.5 edits go through Bash).
#
# PostToolUse fires only when the call exited 0 (a non-zero exit fires
# PostToolUseFailure instead). That is not the same as a passing run: a runner
# piped into `tail` exits with tail's status. So a run whose output reports
# failures (FAIL_OUT_RE) is not logged either. What counts as verification is
# evidence-gate's own T1/T2 (hooks/lib/verify-cmd.sh): the command names a smoke
# entry or a runner, or its output carries a runner verdict.
#
# Nothing here decides anything. Rows go to the claudemd log as `verify-run`.
#
# Opt-in: EVIDENCE_WTREE=1 (default OFF). Side effect of the fingerprint,
# disclosed in wtree.sh: modified and untracked, non-ignored file contents (and
# tree objects) enter .git/objects as unreachable objects until `git gc` prunes
# them, by default after two weeks.
#
# Kill-switches:
#   DISABLE_VERIFY_LOG_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1  — global

set -uo pipefail

[[ "${EVIDENCE_WTREE:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true
# shellcheck source=/dev/null
source "$LIB_DIR/verify-cmd.sh" || exit 0

hook_kill_switch VERIFY_LOG || exit 0
hook_require_jq || { hook_record_failopen verify-log jq-missing; exit 0; }

EVENT=$(hook_read_event) || exit 0
FIELDS=$(hook_jq_field verify-log "$EVENT" '[.tool_name // "", .session_id // "", .tool_use_id // "", .cwd // ""] | @tsv') || exit 0
IFS=$'\t' read -r TOOL SESSION_ID TOOL_USE_ID CWD <<<"$FIELDS"
[[ "$TOOL" == Bash && -n "$CWD" && -d "$CWD" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

OUT=$(printf '%s' "$EVENT" | jq -r '(.tool_response.stdout // "") | .[0:20000]' 2>/dev/null)
TIER=""
if [[ "$CMD" =~ $T1_CMD_RE ]]; then
  TIER=T1
elif [[ "$CMD" =~ $T2_CMD_RE ]]; then
  TIER=T2
else
  printf '%s' "$OUT" | grep -Eq "$T2_OUT_RE" && TIER=T2-output
fi
[[ -n "$TIER" ]] || exit 0
# Exit 0 is not a pass (header): skip a run whose output reports failures.
ERR=$(printf '%s' "$EVENT" | jq -r '(.tool_response.stderr // "") | .[0:20000]' 2>/dev/null)
printf '%s\n%s' "$OUT" "$ERR" | grep -Eq "$FAIL_OUT_RE" && exit 0

WTREE=$(platform_timeout 2 bash -c 'source "$1/wtree.sh" && wtree_hash "$2"' _ "$LIB_DIR" "$CWD" 2>/dev/null) || WTREE=""
[[ -n "$WTREE" ]] || exit 0
CMD_KEY=$(printf '%s' "$CMD" | cksum | awk '{print $1}')

hook_record verify-log verify-run "$(jq -cn --arg t "$TIER" --arg k "$CMD_KEY" --arg w "$WTREE" '{tier:$t, cmd_key:$k, wtree:$w}' 2>/dev/null || echo null)" '§iron-law-2' "$SESSION_ID" "$TOOL_USE_ID" 2>/dev/null || true
exit 0
