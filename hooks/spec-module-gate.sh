#!/usr/bin/env bash
# spec-module-gate — PreToolUse(Bash): before a release command, check that
# the `ship` spec module reached this session (tasks/specs/spec-modules.md,
# tier 3). Release command = `git tag` creating a tag, `git push` of tags,
# `gh release create`, `npm publish` (not --dry-run). Reached = injected by
# spec-module-inject.sh this session, or Read (tool or Bash reader) — the
# same read test the §11 memory gate uses (hook_memfile_was_read).
#
# Modes (SPEC_MODULE_GATE), per §EXT §13.3's stages for a new behaviour hook:
#   log (default)  record a `module-unread` row, print nothing
#   advisory       also tell the model which module to read; allow
#   deny           refuse the command until the module is read
#   off            do nothing
# Kill switch: DISABLE_SPEC_MODULE_GATE_HOOK=1.
set -uo pipefail
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
source "$LIB_DIR/hook-common.sh" || exit 0
source "$LIB_DIR/platform.sh" 2>/dev/null || true
hook_kill_switch SPEC_MODULE_GATE || exit 0
MODE="${SPEC_MODULE_GATE:-log}"
case "$MODE" in log | advisory | deny) ;; *) exit 0 ;; esac
hook_require_jq || { hook_record_failopen spec-module-gate jq-missing; exit 0; }

MODULE="$HOME/.claude/spec-modules/ship.md"
[[ -f "$MODULE" ]] || exit 0

EVENT=$(hook_read_event) || exit 0
CMD=$(hook_jq_field spec-module-gate "$EVENT" '.tool_input.command // ""') || exit 0
[[ -n "$CMD" ]] || exit 0
VIEW=$(printf '%s' "$CMD" | hook_trigger_view)
RELEASE_RE='(^|[;&|(]|&&|\|\|)[[:space:]]*(git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?tag[[:space:]]+(-a[[:space:]]+|-s[[:space:]]+|-m[[:space:]]+[^[:space:]]+[[:space:]]+)*v?[0-9]|git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push[[:space:]].*(--tags|[[:space:]]v[0-9][0-9.]*([[:space:];&|)]|$))|gh[[:space:]]+release[[:space:]]+create|npm[[:space:]]+publish)'
[[ "$VIEW" =~ $RELEASE_RE ]] || exit 0
[[ "$VIEW" =~ npm[[:space:]]+publish && "$VIEW" =~ --dry-run && ! "$VIEW" =~ (git[[:space:]].*tag|gh[[:space:]]+release) ]] && exit 0

SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TRANSCRIPT=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
if [[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] && grep -qx ship "$HOME/.claude/.claudemd-state/modinj-$SESSION_ID.list" 2>/dev/null; then
  exit 0
fi
if [[ -n "$TRANSCRIPT" ]] && hook_memfile_was_read "$TRANSCRIPT" "$MODULE"; then
  exit 0
fi

MSG="[claudemd] system-injected: this is a release command and the ship spec module has not been read this session. Read ~/.claude/spec-modules/ship.md (core §2.2) before tagging, releasing or publishing, then run the command again."
# Verdict first, telemetry second: a fatal inside hook_record must not be able
# to swallow the deny (the §8 gate's lesson, memory #106).
case "$MODE" in
  advisory)
    jq -cn --arg c "$MSG" '{hookSpecificOutput: {hookEventName: "PreToolUse", additionalContext: $c}}'
    ;;
  deny)
    jq -cn --arg r "$MSG The user can turn this check off with DISABLE_SPEC_MODULE_GATE_HOOK=1." \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}'
    ;;
esac
hook_record spec-module-gate module-unread "$(jq -cn --arg m "$MODE" '{module: "ship", mode: $m}' 2>/dev/null || echo 'null')" '§2.2-modules' "$SESSION_ID" 2>/dev/null || true
exit 0
