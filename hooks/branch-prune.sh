#!/usr/bin/env bash
# branch-prune.sh — PostToolUse + PostToolUseFailure(Bash) hook, ADVISORY. It
# deletes nothing itself; it hands the session the command that does.
#
# 1. After a command that can land a branch on the default branch (git merge /
#    pull / fetch / push, gh pr merge; PostToolUse only), tells the session
#    which local branches are merged and to delete them with the `git branch
#    -d` command it gives, leaving out any the project keeps. Spec v8.1.0 core
#    §7 Git asks a session to delete a branch it merged; this line also covers
#    merged branches left by earlier sessions.
# 2. Spec v8.3.0: `git branch -d` refuses a branch whose work landed as other
#    commits (a rebase merge, a cherry-pick, a squash), so those were left to
#    the user: in one week 29 branches -d refuses were deleted with -D
#    (tasks/specs/landed-branch-cleanup.md). Such a `landed` branch — its work
#    is on the default branch byte for byte, after the fork point and at the
#    same place: a copy of each commit (`git patch-id --verbatim`), one squash
#    commit equal to its whole change, or its own tip — is listed by (1)
#    when its remote branch was deleted or it is worktree-agent-*, with a
#    checked `git branch -D` command; and after any `git branch -d` command
#    (both events: one that exits 0 can still have left a branch), every
#    branch it named that is still there gets a verdict: landed, with that
#    command, or kept, with the commits that have no copy, for the session to
#    name under open items. Core §7 lets a session use -D only through this
#    command.
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
# on this line, re-checks merged-ness and use at the moment it deletes. The -D
# command keeps git's in-use checks and first compares each branch tip with
# the commit judged here, so a branch that moved since is left alone.
#
# What is listed is decided by scripts/housekeeping.js (see its USAGE): a
# branch whose upstream the remote deleted (`[gone]`) and whose tip is on the
# local default branch, plus worktree-agent-* branches on it, each one a
# branch `git branch -d` deletes in the cwd's checkout. One only on
# origin/<default> is listed after the merge or pull that brings it onto the
# local default branch (167). Never the default branch, a worktree checkout or a symbolic ref;
# worktree-agent-* aside, never a branch whose upstream still exists or one
# with no upstream (a branch with none is judged only when a -d names it);
# nothing while a rebase or bisect is in progress in a worktree it can see.
# Silent when there is nothing to list.
#
# Bounded: at most CAP names, in the list and in the command, then "(+M more)".
# Both used to carry every name, and 150 merged branches made 10,841 characters
# of additionalContext (the suite's case 8), past the 10,000 Claude Code keeps
# inline. And once per session for an unchanged set (the claim below): the
# same hint used to repeat on every merge, pull, fetch or push. A changed set —
# the listed ones deleted, a new one merged — is hinted again, so the next CAP
# follow. A verdict on a refused -d is not claimed: it answers that command.
#
# Known limits: the trigger reads the command TEXT, so a commit message that
# mentions `git pull` fires it; the listing inspects the event's cwd, not a
# repo named by `git -C` or a `cd` (a -d's `-C` is followed, and a -d after a
# `cd` without an absolute `-C` is not judged); a -d inside a here-doc body
# reads as one; a branch name the shell would expand ($, a glob) is not judged.
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
# Bash call and almost none of them mention a merge or a branch.
[[ "$EVENT" =~ (merge|pull|fetch|push|branch) ]] || exit 0

hook_require_jq || { hook_record_failopen branch-prune jq-missing; exit 0; }
hook_read_bash_fields branch-prune "$EVENT" || exit 0
[[ "$HOOK_TOOL_NAME" == "Bash" ]] || exit 0

TRIGGER='(^|[^[:alnum:]_-])(git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(merge|pull|fetch|push)|gh[[:space:]]+pr[[:space:]]+merge)([[:space:]]|$)'
# A gate only: housekeeping.js `refused` parses the segments for real.
DELETE_TRIGGER='(^|[^[:alnum:]_-])git[[:space:]][^;&|]*branch[[:space:]][^;&|]*-(d|-delete)'
LIST=0
REFUSED=0
[[ "$HOOK_CMD" =~ $TRIGGER ]] && LIST=1
[[ "$HOOK_CMD" =~ $DELETE_TRIGGER ]] && REFUSED=1
((LIST || REFUSED)) || exit 0
# PostToolUseFailure: a merge or pull that failed landed nothing to list.
EVENT_NAME=$(printf '%s' "$EVENT" | jq -r '.hook_event_name // "PostToolUse"' 2>/dev/null)
[[ "$EVENT_NAME" == PostToolUseFailure ]] && LIST=0
((LIST || REFUSED)) || exit 0

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
# Both node runs share the hooks.json timeout (10 s).
BUDGET=8
((LIST && REFUSED)) && BUDGET=4
CAP=10
# The checked -D command for a list of landed branches, one `[ tip = sha ] &&
# git branch -D` per branch, joined with `;`. Built by jq's @sh, never by
# interpolation (case 7 / 11h below).
DCMD_JQ='[.landed[:$c][] | "[ \"$(git -C \((.repo // $cwd) | @sh) rev-parse -q --verify \("refs/heads/" + .name | @sh))\" = \(.sha | @sh) ] && git -C \((.repo // $cwd) | @sh) branch -D -- \(.name | @sh)"] | join("; ")'
# Each landed branch with what its work is on the default branch as: copies of
# its commits, one squash commit, or its own tip. The first A/B said "every
# commit has one there" of a squash too; 4 of 5 sessions checked that, found
# it false and ran nothing.
LNAMES_JQ='[.landed[:$c][] | .name + " (" + (if .how == "per-commit" then "each of its \(.commits) commit(s) has an identical copy there" elif .how == "squash" then "its whole change equals commit \(.via[0:12]) there, a squash" else "its tip is on it" end) + ")"] | join(", ")'
MSG=""

if ((REFUSED)); then
  RES=$(printf '%s' "$HOOK_CMD" | platform_timeout "$BUDGET" node "$SCRIPT" refused --cwd="$CWD" 2>/dev/null) || RES=""
  L=$(printf '%s' "$RES" | jq -r '.landed | length' 2>/dev/null) || L=""
  K=$(printf '%s' "$RES" | jq -r '.kept | length' 2>/dev/null) || K=""
  if [[ "$L" =~ ^[0-9]+$ && "$K" =~ ^[0-9]+$ ]] && ((L + K > 0)); then
    ONTO=$(printf '%s' "$RES" | jq -r '[.landed[].onto, .kept[].onto] | unique | if length == 1 then .[0] else "the default branch" end')
    MSG="\`git branch -d\` left $((L + K)) branch(es) in place."
    U=$(printf '%s' "$RES" | jq -r '.unjudged // 0' 2>/dev/null)
    [[ "$U" =~ ^[0-9]+$ ]] && ((U > 0)) && MSG+=" $U more it named were not judged (at most 20 per command)."
    if ((L > 0)); then
      NAMES=$(printf '%s' "$RES" | jq -r --argjson c "$CAP" "$LNAMES_JQ")
      LCMD=$(printf '%s' "$RES" | jq -r --arg cwd "$CWD" --argjson c "$CAP" "$DCMD_JQ")
      MORE=""
      ((L > CAP)) && MORE=" (+$((L - CAP)) more; the command covers the $CAP listed)"
      MSG+=" $L of them have their work on $ONTO byte for byte (\`git patch-id --verbatim\`): $NAMES$MORE. Delete them with \`$LCMD\` — each part runs \`git branch -D\` only while that branch's tip is still the commit judged here."
    fi
    if ((K > 0)); then
      KEPT=$(printf '%s' "$RES" | jq -r --argjson c "$CAP" '[.kept[:$c][] | .name + " (" + (
        if .reason == "not-on-default" then
          "commits with no identical copy there: " + ([.unmatched[] | .sha + " \"" + (.subject | .[0:80]) + "\""] | join("; ")) +
          (if .missingCount > (.unmatched | length) then " (+\(.missingCount - (.unmatched | length)) more)" else "" end)
        elif .reason == "merge-commits" then "it has merge commits"
        elif .reason == "too-far" then "it forked more than 500 commits back"
        elif .reason == "unrelated" then "it shares no history with it"
        elif .reason == "partial-clone" then "the repository is a partial clone, and comparing would fetch from its remote"
        else "it could not be compared: git 2.40 or later is needed, or a git command failed" end) + ")"] | join(", ")')
      ((K > CAP)) && KEPT+=" (+$((K - CAP)) more)"
      MSG+=" Not on $ONTO: $KEPT. Keep these and name them under open items; do not force-delete them."
    fi
    hook_record branch-prune branch-prune-refused-advisory "{\"landed\":$L,\"kept\":$K}" '' "$SESSION_ID" "$TOOL_USE_ID"
  fi
fi

if ((LIST)); then
  OUT=$(platform_timeout "$BUDGET" node "$SCRIPT" branches --cwd="$CWD" 2>/dev/null) || OUT=""
  N=$(printf '%s' "$OUT" | jq -r '.deletable | length' 2>/dev/null) || N=""
  L=$(printf '%s' "$OUT" | jq -r '.landed | length' 2>/dev/null) || L=""
  if [[ "$N" =~ ^[0-9]+$ && "$L" =~ ^[0-9]+$ ]] && ((N + L > 0)); then
    # Once per session per set. The claim is an O_CREAT|O_EXCL create (as in
    # cross-repo-write-check.sh), keyed by the session and a cksum of the cwd and
    # every listed name, so concurrent calls hint once and a changed set hints
    # again. With no session id or no HOME there is nothing to key on, and every
    # call hints. Only a claim that EXISTS means this session was told: one that
    # cannot be written (an unwritable state dir) hints, as cross-repo-write does.
    # /claudemd-clean-residue reaps the claims past its retention window.
    CLAIMED=0
    if [[ -n "$SESSION_ID" && -n "$HOME" ]]; then
      KEY=$( (printf '%s\n' "$CWD" && printf '%s' "$OUT" | jq -r '(.deletable[].name), (.landed[] | "landed:" + .name)') | cksum 2>/dev/null | awk '{print $1"-"$2}')
      STATE_DIR="$HOME/.claude/.claudemd-state"
      SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
      if [[ -n "$KEY" ]] && mkdir -p "$STATE_DIR" 2>/dev/null; then
        BP_CLAIM="$STATE_DIR/branch-prune-${SAFE_SID}-${KEY}"
        if ! (set -C; : >"$BP_CLAIM") 2>/dev/null && [[ -e "$BP_CLAIM" ]]; then CLAIMED=1; fi
      fi
    fi
    if ((CLAIMED == 0)); then
      DEF=$(printf '%s' "$OUT" | jq -r '.defaultBranch')
      LISTMSG=""
      if ((N > 0)); then
        # The command is built by jq's @sh, never by interpolation: git accepts `$( )`,
        # braces, `;` and a leading `-` in branch names and anything in a directory
        # name, and this line exists to be pasted into a shell. Unquoted, a branch
        # named `{-D,wip}` brace-expanded into `branch -d -D wip` and force-deleted
        # unmerged work, and `$(…)` in a name or the cwd ran (0.93.0 claims review
        # H1/M1). `--` ends option parsing for a name that starts with `-`.
        NAMES=$(printf '%s' "$OUT" | jq -r --argjson c "$CAP" '[.deletable[:$c][].name] | join(", ")')
        CMD=$(printf '%s' "$OUT" | jq -r --arg cwd "$CWD" --argjson c "$CAP" '"git -C \($cwd | @sh) branch -d -- \([.deletable[:$c][].name] | @sh)"')
        MORE=""
        REST=""
        if ((N > CAP)); then
          MORE=" (+$((N - CAP)) more)"
          REST=" The command covers the $CAP listed; once they are deleted, the next merge, pull, fetch or push lists the others."
        fi
        LISTMSG="$N local branch(es) are on $DEF and their remote branch was deleted, or are worktree-agent-* on it: $NAMES$MORE. They are merged: delete them with \`$CMD\` (leave out any the project keeps), run with $DEF checked out — -d re-checks that each is merged (into its upstream if it has one, else HEAD) and not checked out anywhere, and refuses otherwise.$REST"
      fi
      if ((L > 0)); then
        NAMES=$(printf '%s' "$OUT" | jq -r --argjson c "$CAP" "$LNAMES_JQ")
        LCMD=$(printf '%s' "$OUT" | jq -r --arg cwd "$CWD" --argjson c "$CAP" "$DCMD_JQ")
        MORE=""
        ((L > CAP)) && MORE=" (+$((L - CAP)) more; the command covers the $CAP listed)"
        [[ -n "$LISTMSG" ]] && LISTMSG+=" "
        LISTMSG+="$L local branch(es) have their work on $DEF byte for byte (\`git patch-id --verbatim\`) and their remote branch was deleted, or are worktree-agent-*: $NAMES$MORE. \`git branch -d\` refuses these. Delete them with \`$LCMD\` (leave out any the project keeps) — each part runs \`git branch -D\` only while that branch's tip is still the commit judged here."
      fi
      [[ -n "$MSG" ]] && MSG+=" "
      MSG+="$LISTMSG"
      hook_record branch-prune branch-prune-advisory "{\"deletable\":$N,\"landed\":$L}" '' "$SESSION_ID" "$TOOL_USE_ID"
    fi
  fi
fi

[[ -n "$MSG" ]] || exit 0
MSG="[claudemd] branch-prune: $MSG The user can turn this hint off with DISABLE_BRANCH_PRUNE_HOOK=1."
[[ "$EVENT_NAME" == PostToolUseFailure ]] || EVENT_NAME=PostToolUse
jq -cn --arg m "$MSG" --arg e "$EVENT_NAME" '{suppressOutput: true, hookSpecificOutput: {hookEventName: $e, additionalContext: $m}}' 2>/dev/null
exit 0
