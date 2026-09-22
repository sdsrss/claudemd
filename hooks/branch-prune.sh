#!/usr/bin/env bash
# branch-prune.sh — PostToolUse(Bash) hook. After a command that can land a
# branch on the default branch (git merge / pull / fetch / push, gh pr merge),
# deletes local branches that were merged and whose remote branch is gone.
#
# Why: nothing else ever does. On 2026-09-22 two repos held 15 local branches
# besides main: 8 were `worktree-agent-*` names left by Claude Code's worktree
# isolation, and 10 of the 15 had their content on main already. One of the
# two also held 6 remote-tracking refs for branches the remote had deleted.
#
# What is deleted is decided by scripts/housekeeping.js (see its USAGE): a
# branch whose upstream the remote deleted (`[gone]`) and whose tip is on the
# default branch or origin/<default>, plus worktree-agent-* branches on it.
# Never the default branch, a worktree checkout, a branch whose upstream still
# exists, or one with no upstream; nothing at all while a rebase or bisect is in
# progress. Local git only — no fetch, no remote deletion. Each deletion is
# reported with the sha that recreates the ref, unless the 8 s ceiling below
# kills the run mid-way (then some may be deleted unreported).
#
# Known limits: the trigger reads the command TEXT, so a commit message that
# mentions `git pull` fires it; and it prunes the event's cwd, not a repo named
# by `git -C` or a `cd`. Both only change WHEN the gone-and-merged rule runs,
# never what it may delete.
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

LIST=$(printf '%s' "$OUT" | jq -r '[.deleted[] | "\(.name) \(.sha)"] | join(", ")')
DEF=$(printf '%s' "$OUT" | jq -r '.defaultBranch')
MSG="[claudemd] branch-prune: deleted $N local branch(es) already on $DEF whose remote branch was deleted (or worktree-agent-*): $LIST. Recreate any with \`git branch <name> <sha>\`. Disable: DISABLE_BRANCH_PRUNE_HOOK=1."
hook_record branch-prune branch-prune-applied "{\"deleted\":$N}" '' "$SESSION_ID" "$TOOL_USE_ID"
jq -cn --arg m "$MSG" '{suppressOutput: true, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}' 2>/dev/null
exit 0
