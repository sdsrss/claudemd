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
evt() { jq -cn --arg c "$1" --arg cwd "$REPO" '{session_id:"branch-prune-test",tool_name:"Bash",tool_input:{command:$c},tool_response:{},cwd:$cwd}'; }
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

# Case 4b: the command the advisory hands over actually works on the default
# branch — extracted from the message and run as-is.
CMD=$(printf '%s' "$CTX" | sed -n 's/.*via `\(git -C .* branch -d [^`]*\)`.*/\1/p')
if [[ -n "$CMD" ]] && eval "$CMD" >/dev/null 2>&1 && ! has_branch feat && has_branch wip; then
  ok "4b suggested command deletes exactly the listed branch"
else
  ng "4b (cmd: $CMD)"
fi

# Case 5: other trigger spellings reach the listing.
for cmd in 'git pull --ff-only' 'git -C . fetch origin' 'gh pr merge 12 --squash' 'cd x && git push origin main'; do
  fresh_repo
  OUT=$(evt "$cmd" | bash "$HOOK" 2>/dev/null)
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
CMD=$(printf '%s' "$CTX" | sed -n 's/.*via `\(git -C .* branch -d [^`]*\)`.*/\1/p')
( cd "$SANDBOX" && eval "$CMD" ) >/dev/null 2>&1
LEFT=$(git -C "$HOSTILE" branch --format='%(refname:short)' | sort | tr '\n' ' ')
if [[ -n "$CMD" && ! -e "$SANDBOX/PWNED_BR" && ! -e "$SANDBOX/PWNED_CWD" && ! -e "$HOSTILE/PWNED_BR" && "$LEFT" == "main wip " ]]; then
  ok "7 hostile names/path: nothing executed, only the listed branches deleted"
else
  ng "7 (cmd: $CMD; left: $LEFT; pwned-files: $(ls -d "$SANDBOX"/PWNED_* "$HOSTILE"/PWNED_* 2>/dev/null | tr "\n" " "))"
fi

claudemd_assert_summary
