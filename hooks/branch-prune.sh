#!/usr/bin/env bash
# branch-prune.sh — PostToolUse(Bash) hook, ADVISORY. After a command that can
# land a branch on the default branch (git merge / pull / fetch / push, gh pr
# merge), tells the session which local branches are merged and to delete them
# with the `git branch -d` command it gives, leaving out any the project keeps.
# Spec v8.1.0 core §7 Git asks a session to delete a branch it merged; this line
# also covers merged branches left by earlier sessions. It deletes nothing
# itself.
#
# Why: nothing ever reminded anyone. On 2026-09-22 two repos held 15 local
# branches besides main: 8 were `worktree-agent-*` names left by Claude Code's
# worktree isolation, and 10 of the 15 had their content on main already. One
# of the two also held 6 remote-tracking refs for branches the remote had
# deleted.
#
# Why advisory: the first 0.93.0 build deleted, and three pre-tag review rounds
# each found a new way that delete removed something in use or not merged (see
# scripts/housekeeping.js, "Report-only"). `git branch -d`, run by whoever acts
# on this line, re-checks merged-ness and use at the moment it deletes.
#
# What is listed is decided by scripts/housekeeping.js (see its USAGE): a
# branch whose upstream the remote deleted (`[gone]`) and whose tip is on the
# default branch or origin/<default>, plus worktree-agent-* branches on it.
# Never the default branch, a worktree checkout or a symbolic ref;
# worktree-agent-* aside, never a branch whose upstream still exists or one
# with no upstream; nothing while a rebase or bisect is in progress in a
# worktree it can see. Silent when there is nothing to list.
#
# Bounded: at most CAP names, in the list and in the command, then "(+M more)".
# Both used to carry every name, and 150 merged branches made 10,841 characters
# of additionalContext (the suite's case 8), past the 10,000 Claude Code keeps
# inline. And once per session for an unchanged set (the claim below): the
# same hint used to repeat on every merge, pull, fetch or push. A changed set —
# the listed ones deleted, a new one merged — is hinted again, so the next CAP
# follow.
#
# Known limits: the trigger reads the command TEXT, so a commit message that
# mentions `git pull` fires it; and it inspects the event's cwd, not a repo
# named by `git -C` or a `cd`.
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
OUT=$(platform_timeout 8 node "$SCRIPT" branches --cwd="$CWD" 2>/dev/null) || exit 0
N=$(printf '%s' "$OUT" | jq -r '.deletable | length' 2>/dev/null) || exit 0
[[ "$N" =~ ^[0-9]+$ ]] && ((N > 0)) || exit 0

# Once per session per set. The claim is an O_CREAT|O_EXCL create (as in
# cross-repo-write-check.sh), keyed by the session and a cksum of the cwd and
# every listed name, so concurrent calls hint once and a changed set hints
# again. With no session id or no HOME there is nothing to key on, and every
# call hints. /claudemd-clean-residue reaps the claims past its retention window.
if [[ -n "$SESSION_ID" && -n "$HOME" ]]; then
  KEY=$( (printf '%s\n' "$CWD" && printf '%s' "$OUT" | jq -r '.deletable[].name') | cksum 2>/dev/null | awk '{print $1"-"$2}')
  STATE_DIR="$HOME/.claude/.claudemd-state"
  SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
  if [[ -n "$KEY" ]] && mkdir -p "$STATE_DIR" 2>/dev/null; then
    (set -C; : >"$STATE_DIR/branch-prune-${SAFE_SID}-${KEY}") 2>/dev/null || exit 0
  fi
fi

# The command is built by jq's @sh, never by interpolation: git accepts `$( )`,
# braces, `;` and a leading `-` in branch names and anything in a directory
# name, and this line exists to be pasted into a shell. Unquoted, a branch
# named `{-D,wip}` brace-expanded into `branch -d -D wip` and force-deleted
# unmerged work, and `$(…)` in a name or the cwd ran (0.93.0 claims review
# H1/M1). `--` ends option parsing for a name that starts with `-`.
CAP=10
NAMES=$(printf '%s' "$OUT" | jq -r --argjson c "$CAP" '[.deletable[:$c][].name] | join(", ")')
DEF=$(printf '%s' "$OUT" | jq -r '.defaultBranch')
CMD=$(printf '%s' "$OUT" | jq -r --arg cwd "$CWD" --argjson c "$CAP" '"git -C \($cwd | @sh) branch -d -- \([.deletable[:$c][].name] | @sh)"')
MORE=""
REST=""
if ((N > CAP)); then
  MORE=" (+$((N - CAP)) more)"
  REST=" The command covers the $CAP listed; once they are deleted, the next merge, pull, fetch or push lists the others."
fi
MSG="[claudemd] branch-prune: $N local branch(es) are on $DEF (or origin/$DEF) and their remote branch was deleted, or are worktree-agent-* on it: $NAMES$MORE. They are merged: delete them with \`$CMD\` (leave out any the project keeps), run with $DEF checked out — -d re-checks that each is merged (into its upstream if it has one, else HEAD) and not checked out anywhere, and refuses otherwise.$REST The user can turn this hint off with DISABLE_BRANCH_PRUNE_HOOK=1."
hook_record branch-prune branch-prune-advisory "{\"deletable\":$N}" '' "$SESSION_ID" "$TOOL_USE_ID"
jq -cn --arg m "$MSG" '{suppressOutput: true, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}' 2>/dev/null
exit 0
