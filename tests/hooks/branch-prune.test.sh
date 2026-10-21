#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/branch-prune.sh"
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || exit 1
trap 'rm -rf "${SANDBOX:?}"' EXIT
export HOME="$SANDBOX/home"
mkdir -p "$HOME/.claude/.claudemd-state"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

REPO="$SANDBOX/repo"
# A clone of a bare remote. `feat` was merged into main and then deleted on the
# remote, so its upstream reads [gone] — the only state this hook lists.
# `wip` is pushed and not merged; `local-only` has no upstream at all.
# (The hook only lists; case 4b runs the command it suggests.)
fresh_repo() {
  rm -rf "${SANDBOX:?}/remote.git" "${SANDBOX:?}/seed" "${REPO:?}"
  git init -q --bare -b main "$SANDBOX/remote.git"
  (
    mkdir -p "$SANDBOX/seed" && cd "$SANDBOX/seed" || exit 1
    git init -q -b main && echo a >a && git add a && git commit -q -m a
    git remote add origin "$SANDBOX/remote.git" && git push -q origin main
  )
  git clone -q "$SANDBOX/remote.git" "$REPO"
  (
    cd "$REPO" || exit 1
    git checkout -q -b feat && echo b >b && git add b && git commit -q -m b
    git push -q -u origin feat
    git checkout -q main && git merge -q --ff-only feat && git push -q origin main
    git push -q origin --delete feat && git fetch -q --prune
    git checkout -q -b wip && echo c >c && git add c && git commit -q -m c
    git push -q -u origin wip
    git checkout -q main && git branch local-only
  )
}
# The hint is given once per session for an unchanged branch set, so a case
# that needs it again for the same set passes its own session id.
evt() { jq -cn --arg c "$1" --arg cwd "$REPO" --arg s "${2:-branch-prune-test}" '{session_id:$s,tool_name:"Bash",tool_input:{command:$c},tool_response:{},cwd:$cwd}'; }
has_branch() { [[ -n "$(git -C "$REPO" branch --list "$1")" ]]; }

# Case 1: a command that is not a merge does nothing.
fresh_repo
OUT=$(evt 'ls -la' | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && ok "1 non-trigger silent" || ng "1 (out: $OUT)"

# Case 2: `git merge-base` names merge but is not one.
OUT=$(evt 'git merge-base main feat' | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && has_branch feat && ok "2 merge-base is not a trigger" || ng "2 (out: $OUT)"

# Case 2b: a word merely ending in "git" is not git (leading boundary).
OUT=$(evt 'legit pull request notes' | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && ok "2b leading word boundary" || ng "2b (out: $OUT)"

# Case 3: kill switch.
OUT=$(evt 'git merge feat' | DISABLE_BRANCH_PRUNE_HOOK=1 bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && has_branch feat && ok "3 kill switch" || ng "3 (out: $OUT)"

# Case 4: a merge lists the gone-and-merged branch — and deletes nothing. The
# pushed-unmerged branch and the one with no upstream are not listed.
OUT=$(evt 'git merge feat' | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
if has_branch feat && has_branch wip && has_branch local-only &&
  printf '%s' "$OUT" | jq -e '.suppressOutput == true' >/dev/null 2>&1 &&
  [[ "$CTX" == *"branch -d -- 'feat'"* && "$CTX" != *wip* && "$CTX" != *local-only* ]]; then
  ok "4 lists feat only, deletes nothing"
else
  ng "4 (ctx: $CTX; branches: $(git -C "$REPO" branch --format='%(refname:short)' | tr '\n' ' '))"
fi

# Case 4c: the line tells the session to delete the listed branches, leaving
# out any the project keeps — not to leave them as the user's call (spec v8.1.0
# core §7 Git) — and keeps git's re-check and the kill switch.
if [[ "$CTX" == *"They are merged: delete them with \`git -C "* && "$CTX" != *"If the user wants"* &&
  "$CTX" == *"leave out any the project keeps"* && "$CTX" == *"refuses otherwise"* &&
  "$CTX" == *"DISABLE_BRANCH_PRUNE_HOOK=1"* ]]; then
  ok "4c the line says to delete them, with the re-check and the kill switch"
else
  ng "4c (ctx: $CTX)"
fi

# Case 4b: the command the advisory hands over actually works on the default
# branch — extracted from the message and run as-is.
CMD=$(printf '%s' "$CTX" | sed -n 's/.*delete them with `\(git -C .* branch -d [^`]*\)`.*/\1/p')
if [[ -n "$CMD" ]] && eval "$CMD" >/dev/null 2>&1 && ! has_branch feat && has_branch wip; then
  ok "4b suggested command deletes exactly the listed branch"
else
  ng "4b (cmd: $CMD)"
fi

# Case 5: other trigger spellings reach the listing.
N5=0
for cmd in 'git pull --ff-only' 'git -C . fetch origin' 'gh pr merge 12 --squash' 'cd x && git push origin main'; do
  fresh_repo
  N5=$((N5 + 1))
  OUT=$(evt "$cmd" "branch-prune-test-5-$N5" | bash "$HOOK" 2>/dev/null)
  [[ "$OUT" == *"branch -d -- 'feat'"* ]] && ok "5 trigger: $cmd" || ng "5 trigger not recognised: $cmd"
done

# Case 6: outside a git repo the hook is silent and exits 0.
OUT=$(jq -cn --arg cwd "$SANDBOX" '{session_id:"branch-prune-test",tool_name:"Bash",tool_input:{command:"git pull"},cwd:$cwd}' | bash "$HOOK" 2>&1)
RC=$?
[[ $RC -eq 0 && -z "$OUT" ]] && ok "6 non-repo cwd silent" || ng "6 (rc $RC, out: $OUT)"

# Case 7 (claims review H1/M1): hostile branch names and a hostile repo path.
# Git accepts `evil$(touch${IFS}PWNED_BR)` and `{-D,wip}` as branch names and
# `$(...)` in a directory name. The suggested command, pasted into a shell,
# must run nothing, expand nothing, and delete only the listed branches — in
# particular `{-D,wip}` must not brace-expand into `-D wip` and force-delete
# the unmerged `wip`.
HOSTILE="$SANDBOX/"'r$(touch${IFS}PWNED_CWD)'
rm -rf "${SANDBOX:?}/remote.git" "${SANDBOX:?}/seed"
git init -q --bare -b main "$SANDBOX/remote.git"
( mkdir -p "$SANDBOX/seed" && cd "$SANDBOX/seed" && git init -q -b main && echo a >a && git add a &&
  git commit -q -m a && git remote add origin "$SANDBOX/remote.git" && git push -q origin main )
git clone -q "$SANDBOX/remote.git" "$HOSTILE"
(
  cd "$HOSTILE" || exit 1
  for b in 'evil$(touch${IFS}PWNED_BR)' '{-D,wip}'; do
    git checkout -q -b "$b" && echo "$b" >>f && git add f && git commit -q -m "$b" && git push -q -u origin "$b"
    git checkout -q main && git merge -q --ff-only "$b" && git push -q origin main && git push -q origin --delete "$b"
  done
  git fetch -q --prune
  git checkout -q -b wip && echo w >w && git add w && git commit -q -m w && git push -q -u origin wip
  git checkout -q main
)
OUT=$(jq -cn --arg cwd "$HOSTILE" '{session_id:"branch-prune-test",tool_name:"Bash",tool_input:{command:"git pull"},cwd:$cwd}' | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
CMD=$(printf '%s' "$CTX" | sed -n 's/.*delete them with `\(git -C .* branch -d [^`]*\)`.*/\1/p')
( cd "$SANDBOX" && eval "$CMD" ) >/dev/null 2>&1
LEFT=$(git -C "$HOSTILE" branch --format='%(refname:short)' | sort | tr '\n' ' ')
if [[ -n "$CMD" && ! -e "$SANDBOX/PWNED_BR" && ! -e "$SANDBOX/PWNED_CWD" && ! -e "$HOSTILE/PWNED_BR" && "$LEFT" == "main wip " ]]; then
  ok "7 hostile names/path: nothing executed, only the listed branches deleted"
else
  ng "7 (cmd: $CMD; left: $LEFT; pwned-files: $(ls -d "$SANDBOX"/PWNED_* "$HOSTILE"/PWNED_* 2>/dev/null | tr "\n" " "))"
fi

# Case 8: 150 merged branches. The hint listed every name twice (the list and
# the command): 10,841 characters of additionalContext on this fixture, past the
# 10,000 Claude Code keeps inline. It now names the first 10 in both places
# plus "(+140 more)", and the command it hands over deletes exactly those 10.
fresh_repo
git -C "$REPO" branch -q -d feat
for i in $(seq 1 150); do
  printf 'create refs/heads/worktree-agent-a%016d main\n' "$i"
done | git -C "$REPO" update-ref --stdin
OUT=$(evt 'git pull' bp-8 | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
CMD=$(printf '%s' "$CTX" | sed -n 's/.*delete them with `\(git -C .* branch -d [^`]*\)`.*/\1/p')
LISTED=$(printf '%s' "$CTX" | grep -o 'worktree-agent-a[0-9]*, ' | wc -l | tr -d ' ')
if [[ ${#CTX} -lt 10000 && "$CTX" == *"150 local branch(es)"* && "$CTX" == *"worktree-agent-a0000000000000010 (+140 more)."* &&
  "$LISTED" == 9 && "$CMD" == *"'worktree-agent-a0000000000000010'" && "$CMD" != *"a0000000000000011"* ]]; then
  ok "8 150 merged branches: 10 names and +140 more, ${#CTX} characters"
else
  ng "8 (length ${#CTX}; listed+comma $LISTED; cmd: ${CMD:0:200}; ctx head: ${CTX:0:300})"
fi

# Case 9: once per session for an unchanged set. The same session's next
# merge, pull, fetch or push says nothing; once the set changes (the 10 above
# deleted) it lists the next 10; another session gets the hint for the set it
# finds.
OUT=$(evt 'git fetch' bp-8 | bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "9a same session, same set: no second hint" || ng "9a (out: ${OUT:0:200})"
( cd "$SANDBOX" && eval "$CMD" ) >/dev/null 2>&1
LEFT=$(git -C "$REPO" branch --list 'worktree-agent-*' | wc -l | tr -d ' ')
OUT=$(evt 'git push' bp-8 | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
if [[ "$LEFT" == 140 && "$CTX" == *"140 local branch(es)"* && "$CTX" == *": worktree-agent-a0000000000000011, "* && "$CTX" == *"(+130 more)."* ]]; then
  ok "9b the command deleted exactly 10; the changed set is hinted again, from the 11th"
else
  ng "9b (left $LEFT; ctx head: ${CTX:0:300})"
fi
OUT=$(evt 'git push' bp-9c | bash "$HOOK" 2>/dev/null)
[[ "$OUT" == *"140 local branch(es)"* ]] && ok "9c another session gets the hint for the same set" || ng "9c (out: ${OUT:0:200})"
# 9d: one claim per (session, set) hinted, each in the shape
# scripts/clean-residue.js reaps (branch-prune-<sid>-<cksum>-<len>).
CLAIMS=""
for f in "$HOME/.claude/.claudemd-state"/branch-prune-*; do
  [[ -e "$f" ]] && CLAIMS+="${f##*/}"$'\n'
done
CLAIMS=${CLAIMS%$'\n'}
N8=$(printf '%s\n' "$CLAIMS" | grep -c '^branch-prune-bp-8-')
BAD=$(printf '%s\n' "$CLAIMS" | grep -cvE '^branch-prune-.+-[0-9]+-[0-9]+$')
[[ "$N8" == 2 && "$BAD" == 0 ]] && ok "9d one claim per hinted set, each in the shape clean-residue reaps" ||
  ng "9d (bp-8 claims $N8, malformed $BAD: $CLAIMS)"
# 9e: a claim that cannot be written is no reason to stay silent (0.113.3
# pre-tag review M1): with the state dir read-only the hint never came, in any
# session, and nothing said why. Only a claim that exists means "told".
chmod 555 "$HOME/.claude/.claudemd-state"
OUT=$(evt 'git push' bp-9e | bash "$HOOK" 2>/dev/null)
chmod 755 "$HOME/.claude/.claudemd-state"
[[ "$OUT" == *"140 local branch(es)"* ]] && ok "9e an unwritable state dir still gets the hint" || ng "9e (out: ${OUT:0:200})"

# Case 10 (167): feat merged on the remote and fetched, local main one commit
# behind. On main, `git branch -d feat` refuses ("not fully merged") and
# suggests -D, so a hint naming it hands over a command that fails. Nothing is
# hinted until main has it; then the line names it as on main and its command
# deletes it.
fresh_repo
git -C "$REPO" reset -q --hard HEAD~1
BEHIND=$(evt 'git fetch --prune' bp-10 | bash "$HOOK" 2>/dev/null)
git -C "$REPO" merge -q --ff-only origin/main
OUT=$(evt 'git pull' bp-10 | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
CMD=$(printf '%s' "$CTX" | sed -n 's/.*delete them with `\(git -C .* branch -d [^`]*\)`.*/\1/p')
if [[ -z "$BEHIND" && "$CTX" == *"1 local branch(es) are on main and their remote branch was deleted, or are worktree-agent-* on it: feat."* ]] &&
  eval "$CMD" >/dev/null 2>&1 && ! has_branch feat; then
  ok "10 a branch only on origin/main is hinted once main has it, and the command deletes it"
else
  ng "10 (while behind: ${BEHIND:0:200}; after: ${CTX:0:200}; cmd: $CMD)"
fi

# ---- landed (spec v8.3.0): branches -d refuses whose commits are all on main ----

# Two branches with no upstream, as a session that cherry-picks agent work
# leaves them: fix/pick's commits land on main byte for byte, fix/edit's one
# commit lands with other bytes. `git branch -d` refuses both.
pick_repo() {
  fresh_repo
  (
    cd "$REPO" || exit 1
    git checkout -q -b fix/pick && echo p1 >p1 && git add p1 && git commit -q -m 'add p1' &&
      echo p2 >p2 && git add p2 && git commit -q -m 'add p2'
    git checkout -q main && git checkout -q -b fix/edit && echo e1 >e1 && git add e1 && git commit -q -m 'add e1'
    git checkout -q main && echo m >m && git add m && git commit -q -m 'main moves on'
    git cherry-pick main..fix/pick >/dev/null
    echo 'e1 changed' >e1 && git add e1 && git commit -q -m 'add e1, changed'
  )
}
fevt() { jq -cn --arg c "$1" --arg cwd "${3:-$REPO}" --arg s "${2:-branch-prune-test}" '{session_id:$s,hook_event_name:"PostToolUseFailure",tool_name:"Bash",tool_input:{command:$c},error:"Exit code 1",cwd:$cwd}'; }
dcmd() { printf '%s' "$1" | sed -n 's/.*Delete them with `\([^`]*branch -D[^`]*\)`.*/\1/p'; }

# Case 11: a refused `git branch -d` (PostToolUseFailure) gets a verdict per
# branch: the landed one with a checked -D command, the other kept with the
# commit that has no copy on main.
pick_repo
git -C "$REPO" branch -d fix/pick fix/edit >/dev/null 2>&1
OUT=$(fevt 'git branch -d fix/pick fix/edit' bp-11 | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
EVN=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.hookEventName // ""' 2>/dev/null)
D11=$(dcmd "$CTX")
if has_branch fix/pick && has_branch fix/edit && [[ "$EVN" == PostToolUseFailure &&
  "$CTX" == *'`git branch -d` left 2 branch(es) in place.'* &&
  "$CTX" == *"1 of them have their work on main byte for byte: fix/pick (each of its 2 commit(s) has an identical copy there)."* &&
  "$D11" == *"branch -D -- 'fix/pick'"* && "$D11" != *fix/edit* &&
  "$CTX" == *'Not on main: fix/edit (commits with no identical copy there: '*' "add e1")'* &&
  "$CTX" == *"Keep these and name them under open items; do not force-delete them."* &&
  "$CTX" == *"DISABLE_BRANCH_PRUNE_HOOK=1"* ]]; then
  ok "11 refused -d: landed one gets a -D command, the edited one is kept with its commit"
else
  ng "11 (event: $EVN; ctx: $CTX)"
fi

# Case 11b: the handed-over command deletes the landed branch and nothing else.
if [[ -n "$D11" ]] && (cd "$SANDBOX" && eval "$D11") >/dev/null 2>&1 && ! has_branch fix/pick && has_branch fix/edit; then
  ok "11b the -D command deletes exactly the landed branch"
else
  ng "11b (cmd: $D11)"
fi

# Case 11c: a branch that moved after the verdict is not deleted: the command
# compares the tip with the commit it judged.
pick_repo
OUT=$(fevt 'git branch -d fix/pick' bp-11c | bash "$HOOK" 2>/dev/null)
D11C=$(dcmd "$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)")
NEWTIP=$(git -C "$REPO" commit-tree -p fix/pick -m 'new work' "fix/pick^{tree}")
git -C "$REPO" update-ref refs/heads/fix/pick "$NEWTIP"
(cd "$SANDBOX" && eval "$D11C") >/dev/null 2>&1
if [[ -n "$D11C" ]] && has_branch fix/pick && [[ "$(git -C "$REPO" rev-parse fix/pick)" == "$NEWTIP" ]]; then
  ok "11c a branch with a new commit since the verdict is left alone"
else
  ng "11c (cmd: $D11C)"
fi

# Case 11d: the same verdict after a command that exits 0 (PostToolUse), and
# nothing after a -d that deleted everything it named.
pick_repo
OUT=$(evt 'git branch -d fix/pick || true' bp-11d | bash "$HOOK" 2>/dev/null)
[[ "$OUT" == *"branch -D -- 'fix/pick'"* ]] && ok "11d PostToolUse: -d || true still gets the verdict" || ng "11d (out: ${OUT:0:300})"
git -C "$REPO" branch -q -d feat
OUT=$(evt 'git branch -d feat' bp-11d2 | bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "11d2 a -d that deleted its branch: silent" || ng "11d2 (out: ${OUT:0:300})"

# Case 11e: kill switch; a failed pull or merge gets no listing; -D and other
# git commands are not read as a refused -d.
OUT=$(fevt 'git branch -d fix/pick' bp-11e | DISABLE_BRANCH_PRUNE_HOOK=1 bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && ok "11e kill switch silences the refused path" || ng "11e (out: ${OUT:0:200})"
fresh_repo
OUT=$(fevt 'git pull' bp-11f | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && has_branch feat && ok "11f a failed pull lists nothing" || ng "11f (out: ${OUT:0:200})"
pick_repo
N11=0
for cmd in 'git branch -D fix/pick' 'git log fix/pick' 'git branch -d -r origin/fix/pick' 'echo git branch -d fix/pick'; do
  N11=$((N11 + 1))
  OUT=$(fevt "$cmd" "bp-11g-$N11" | bash "$HOOK" 2>&1)
  [[ -z "$OUT" ]] && ok "11g not a refused -d: $cmd" || ng "11g ($cmd: ${OUT:0:200})"
done

# Case 11h: hostile landed names and repo path: the -D command runs nothing,
# expands nothing and deletes only the landed branches.
HOSTILE2="$SANDBOX/"'h$(touch${IFS}PWNED_CWD2)'
rm -rf "${HOSTILE2:?}"
git init -q -b main "$HOSTILE2"
(
  cd "$HOSTILE2" || exit 1
  echo a >a && git add a && git commit -q -m a
  for b in 'evil$(touch${IFS}PWNED_BR2)' '{-D,wip2}'; do
    git checkout -q -b "$b" main && echo "$b" >"f${#b}" && git add . && git commit -q -m "$b"
  done
  git checkout -q -b wip2 main && echo w >w && git add w && git commit -q -m w
  git checkout -q main && echo m >m && git add m && git commit -q -m m
  for b in 'evil$(touch${IFS}PWNED_BR2)' '{-D,wip2}'; do git cherry-pick "main..$b" >/dev/null; done
)
CMD11H="git branch -d 'evil\$(touch\${IFS}PWNED_BR2)' '{-D,wip2}'"
OUT=$(fevt "$CMD11H" bp-11h "$HOSTILE2" | bash "$HOOK" 2>/dev/null)
D11H=$(dcmd "$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)")
(cd "$SANDBOX" && eval "$D11H") >/dev/null 2>&1
LEFT=$(git -C "$HOSTILE2" branch --format='%(refname:short)' | sort | tr '\n' ' ')
if [[ -n "$D11H" && "$LEFT" == "main wip2 " ]] && ! ls "$SANDBOX"/PWNED_* "$HOSTILE2"/PWNED_* >/dev/null 2>&1; then
  ok "11h hostile landed names/path: nothing executed, only the landed branches deleted"
else
  ng "11h (cmd: $D11H; left: $LEFT)"
fi

# Case 11i: a kept branch with more than 3 commits missing shows 3 and the
# count of the rest.
pick_repo
(
  cd "$REPO" || exit 1
  git checkout -q -b fix/many main~2
  for i in 1 2 3 4; do echo "$i" >"many$i" && git add "many$i" && git commit -q -m "many $i"; done
  git checkout -q main
)
OUT=$(fevt 'git branch -d fix/many' bp-11i | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
SHOWN=$(printf '%s' "$CTX" | grep -o '"many [0-9]"' | wc -l | tr -d ' ')
[[ "$SHOWN" == 3 && "$CTX" == *'(+1 more))'* && "$CTX" != *"Delete them with"* ]] && ok "11i 3 missing commits shown, +1 more counted" || ng "11i (shown $SHOWN; ctx: $CTX)"

# Case 11j: a squash says what it is — the branch's commits have no copies of
# their own on main, its whole change does — and names that commit (the
# first A/B: 4 of 5 sessions checked the per-commit claim, found it false and
# did not run the command).
fresh_repo
(
  cd "$REPO" || exit 1
  git checkout -q -b sq && echo s1 >s && git add s && git commit -q -m s1 && echo s2 >>s && git commit -q -am s2
  git checkout -q main && git merge -q --squash sq && git commit -q -m 'squash sq'
)
SQ=$(git -C "$REPO" rev-parse main)
OUT=$(fevt 'git branch -d sq' bp-11j | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
[[ "$CTX" == *": sq (its whole change equals commit ${SQ:0:12} there, a squash)."* && "$CTX" != *"each of its"* ]] &&
  ok "11j a squash is named as one, with the commit it equals" || ng "11j (ctx: $CTX)"

# Case 11k: a partial clone is not judged, and the line says why instead of
# blaming the git version (0.116.0 review M3, L2/L8).
rm -rf "${SANDBOX:?}/psrc" "${SANDBOX:?}/partial"
(
  mkdir -p "$SANDBOX/psrc" && cd "$SANDBOX/psrc" || exit 1
  git init -q -b main && git config uploadpack.allowFilter true
  echo a >a && git add a && git commit -q -m a
  git checkout -q -b feat && echo f >f && git add f && git commit -q -m f
  git checkout -q main && echo o >o && git add o && git commit -q -m o && git cherry-pick feat >/dev/null
)
git clone -q --no-checkout --filter=blob:none "file://$SANDBOX/psrc" "$SANDBOX/partial"
git -C "$SANDBOX/partial" branch -q feat origin/feat
OUT=$(fevt 'git branch -d feat' bp-11k "$SANDBOX/partial" | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
[[ "$CTX" == *"Not on main: feat (the repository is a partial clone, and comparing would fetch from its remote)."* && "$CTX" != *"Delete them with"* ]] &&
  ok "11k a partial clone is kept with its reason" || ng "11k (ctx: $CTX)"

# Case 11l: git 2.39 has `patch-id --verbatim` but not `merge-tree
# --merge-base`. The line said the cherry-picked commits had no identical copy;
# it says the branch could not be compared (pre-tag review round 2 M3).
pick_repo
mkdir -p "$SANDBOX/git239"
printf '#!/bin/sh\nfor a in "$@"; do case "$a" in --merge-base=*) exit 129;; esac; done\nexec %s "$@"\n' \
  "'$(command -v git)'" >"$SANDBOX/git239/git"
chmod +x "$SANDBOX/git239/git"
OUT=$(fevt 'git branch -d fix/pick' bp-11l | PATH="$SANDBOX/git239:$PATH" bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
[[ "$CTX" == *"Not on main: fix/pick (it could not be compared: git 2.40 or later is needed, a git command failed, or no temp directory could be made)."* &&
  "$CTX" != *"Delete them with"* && "$CTX" != *"no identical copy"* ]] &&
  ok "11l a git without merge-tree --merge-base reads as not compared" || ng "11l (ctx: $CTX)"

# Case 11m: origin/HEAD names a branch with no local copy, and a shallow clone
# stops before the fork point. Both said "it shares no history with it" (round 4).
pick_repo
git -C "$REPO" update-ref refs/remotes/origin/trunk main
git -C "$REPO" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/trunk
OUT=$(fevt 'git branch -d fix/pick' bp-11m | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
[[ "$CTX" == *"Not on trunk: fix/pick (there is no local trunk branch to compare it with)."* && "$CTX" != *"Delete them with"* ]] &&
  ok "11m no local default branch is named as the reason" || ng "11m (ctx: $CTX)"
fresh_repo
(
  cd "$REPO" || exit 1
  git checkout -q -b old main~1 && echo o >o && git add o && git commit -q -m o && git push -q origin old
  git checkout -q main && for i in 1 2; do echo "$i" >"s$i" && git add "s$i" && git commit -q -m "s$i"; done
  git push -q origin main
)
rm -rf "${SANDBOX:?}/shallow"
git clone -q --depth 2 --no-single-branch "file://$SANDBOX/remote.git" "$SANDBOX/shallow"
git -C "$SANDBOX/shallow" branch -q old origin/old
OUT=$(fevt 'git branch -d old' bp-11n "$SANDBOX/shallow" | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
[[ "$CTX" == *"Not on main: old (the clone is shallow and holds no commit it shares with it)."* ]] &&
  ok "11n a shallow clone short of the fork point is named as the reason" || ng "11n (ctx: $CTX)"

# Case 12: after a pull, a [gone] branch that was rebase-merged on the remote
# is listed as landed with the checked -D command, beside the merged one -d
# deletes; the branch with no upstream stays unlisted.
rebased_repo() {
  fresh_repo
  (
    cd "$REPO" || exit 1
    git checkout -q -b feat2 && echo f2 >f2 && git add f2 && git commit -q -m 'add f2' && git push -q -u origin feat2
    git checkout -q main && echo m2 >m2 && git add m2 && git commit -q -m 'main moves on'
    git cherry-pick main..feat2 >/dev/null && git push -q origin main
    git push -q origin --delete feat2 && git fetch -q --prune
  )
}
rebased_repo
OUT=$(evt 'git pull' bp-12 | bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
D12=$(dcmd "$CTX")
if [[ "$CTX" == *"branch -d -- 'feat'"* && "$CTX" == *"1 local branch(es) have their work on main byte for byte and their remote branch was deleted, or are worktree-agent-*: feat2 (each of its 1 commit(s) has an identical copy there)."* &&
  "$D12" == *"branch -D -- 'feat2'"* && "$CTX" != *local-only* ]] &&
  (cd "$SANDBOX" && eval "$D12") >/dev/null 2>&1 && ! has_branch feat2 && has_branch wip && has_branch local-only; then
  ok "12 a rebase-merged [gone] branch is listed as landed and its command deletes it"
else
  ng "12 (cmd: $D12; ctx: $CTX)"
fi

# Case 12b: with no temp directory the landed branch cannot be compared, and
# the merged one is still listed. The judgement threw and the hook printed
# nothing, where 0.115.0 listed feat (round 4).
rebased_repo
OUT=$(evt 'git pull' bp-12b | TMPDIR="$SANDBOX/no-such-dir" bash "$HOOK" 2>/dev/null)
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
[[ "$CTX" == *"branch -d -- 'feat'"* && "$CTX" != *feat2* ]] &&
  ok "12b no temp directory: the merged branch is still listed" || ng "12b (ctx: $CTX)"

# Case 13: the handed-over -D command passes this plugin's own Bash gate.
pick_repo
OUT=$(fevt 'git branch -d fix/pick' bp-13 | bash "$HOOK" 2>/dev/null)
D13=$(dcmd "$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)")
GATE=$(jq -cn --arg c "$D13" --arg cwd "$REPO" '{session_id:"bp-13",hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' |
  bash "$HERE/../../hooks/pre-bash-safety-check.sh" 2>/dev/null)
[[ -n "$D13" && "$GATE" != *'"deny"'* ]] && ok "13 pre-bash-safety allows the -D command" || ng "13 (cmd: $D13; gate: ${GATE:0:300})"

claudemd_assert_summary
