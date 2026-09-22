#!/usr/bin/env bash
# branch-prune.sh — PostToolUse(Bash) hook. After a command that can land a
# branch on the default branch (git merge / pull / fetch / push, gh pr merge),
# deletes the local branches whose content is already there.
#
# Why: nothing else ever does. On 2026-09-22 two repos held 15 local branches
# besides main: 8 were `worktree-agent-*` names left by Claude Code's worktree
# isolation, and 10 of the 15 had their content on main already. One of the
# two also held 6 remote-tracking refs for branches the remote had deleted.
#
# What counts as "already there", and what is never touched, is decided by
# scripts/housekeeping.js (see its USAGE): an ancestor of the default branch
# or origin/<default>, or patch-equivalent to it (rebase / squash merge); never
# the default branch or a branch checked out in any worktree; an ancestor that
# never moved since creation is left alone. Local git only — no fetch, no
# remote deletion. Every deletion is reported with its sha so
# `git branch <name> <sha>` restores it.
#
# Kill-switches:
#   DISABLE_BRANCH_PRUNE_HOOK=1 — this hook
#   DISABLE_CLAUDEMD_HOOKS=1    — global

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch BRANCH_PRUNE || exit 0

EVENT=$(hook_read_event) || exit 0
# Cheap pre-filter on the raw event before any jq spawn: this runs on every
# Bash call and almost none of them mention a merge.
[[ "$EVENT" =~ (merge|pull|fetch|push) ]] || exit 0

hook_require_jq || { hook_record_failopen branch-prune jq-missing; exit 0; }
hook_read_bash_fields branch-prune "$EVENT" || exit 0
[[ "$HOOK_TOOL_NAME" == "Bash" ]] || exit 0

TRIGGER='(^|[^[:alnum:]_-])(git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(merge|pull|fetch|push)|gh[[:space:]]+pr[[:space:]]+merge)([[:space:]]|$)'
[[ "$HOOK_CMD" =~ $TRIGGER ]] || exit 0

hook_read_telemetry_ids "$EVENT"
CWD="${EVENT_CWD:-$PWD}"
[[ -d "$CWD" ]] || exit 0
command -v node >/dev/null 2>&1 || { hook_record_failopen branch-prune prereq-missing; exit 0; }

# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true
if ! declare -f platform_timeout >/dev/null 2>&1; then
  hook_record_failopen branch-prune prereq-missing
  exit 0
fi

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/housekeeping.js"
OUT=$(platform_timeout 8 node "$SCRIPT" branches --apply --cwd="$CWD" 2>/dev/null) || exit 0
N=$(printf '%s' "$OUT" | jq -r '.deleted | length' 2>/dev/null) || exit 0
[[ "$N" =~ ^[0-9]+$ ]] && ((N > 0)) || exit 0

LIST=$(printf '%s' "$OUT" | jq -r '[.deleted[] | "\(.name) \(.sha[0:12]) (\(.why))"] | join(", ")')
DEF=$(printf '%s' "$OUT" | jq -r '.defaultBranch')
MSG="[claudemd] branch-prune: deleted $N local branch(es) whose content is already on $DEF: $LIST. Restore any with \`git branch <name> <sha>\`. Disable: DISABLE_BRANCH_PRUNE_HOOK=1."
hook_record branch-prune branch-prune-applied "{\"deleted\":$N}" '' "$SESSION_ID" "$TOOL_USE_ID"
jq -cn --arg m "$MSG" '{suppressOutput: true, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}' 2>/dev/null
exit 0
