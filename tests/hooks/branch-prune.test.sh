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
# A repo with one branch fully merged into main (fast-forward) and one not.
fresh_repo() {
  rm -rf "${REPO:?}"
  mkdir -p "$REPO"
  (
    cd "$REPO" || exit 1
    git init -q -b main
    echo a >a && git add a && git commit -q -m a
    git checkout -q -b feat && echo b >b && git add b && git commit -q -m b
    git checkout -q main && git merge -q --ff-only feat
    git checkout -q -b wip && echo c >c && git add c && git commit -q -m c
    git checkout -q main
  )
}
evt() { jq -cn --arg c "$1" --arg cwd "$REPO" '{session_id:"branch-prune-test",tool_name:"Bash",tool_input:{command:$c},tool_response:{},cwd:$cwd}'; }
has_branch() { [[ -n "$(git -C "$REPO" branch --list "$1")" ]]; }

# Case 1: a command that is not a merge does nothing.
fresh_repo
OUT=$(evt 'ls -la' | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && has_branch feat && ok "1 non-trigger silent" || ng "1 (out: $OUT)"

# Case 2: `git merge-base` names merge but is not one.
OUT=$(evt 'git merge-base main feat' | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && has_branch feat && ok "2 merge-base is not a trigger" || ng "2 (out: $OUT)"

# Case 3: kill switch.
OUT=$(evt 'git merge feat' | DISABLE_BRANCH_PRUNE_HOOK=1 bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && has_branch feat && ok "3 kill switch" || ng "3 (out: $OUT)"

# Case 4: a merge prunes the merged branch, keeps the unmerged one, and says
# which, with the sha that restores it.
SHA=$(git -C "$REPO" rev-parse feat)
OUT=$(evt 'git merge feat' | bash "$HOOK" 2>/dev/null)
if ! has_branch feat && has_branch wip &&
  printf '%s' "$OUT" | jq -e --arg s "${SHA:0:12}" '.suppressOutput == true and (.hookSpecificOutput.additionalContext | test("feat " + $s))' >/dev/null 2>&1; then
  ok "4 merged branch pruned with restore sha, unmerged kept"
else
  ng "4 (out: $OUT; branches: $(git -C "$REPO" branch --format='%(refname:short)' | tr '\n' ' '))"
fi

# Case 5: other trigger spellings reach the prune.
for cmd in 'git pull --ff-only' 'git -C . fetch origin' 'gh pr merge 12 --squash' 'cd x && git push origin main'; do
  fresh_repo
  evt "$cmd" | bash "$HOOK" >/dev/null 2>&1
  has_branch feat && ng "5 trigger not recognised: $cmd" || ok "5 trigger: $cmd"
done

# Case 6: outside a git repo the hook is silent and exits 0.
OUT=$(jq -cn --arg cwd "$SANDBOX" '{session_id:"branch-prune-test",tool_name:"Bash",tool_input:{command:"git pull"},cwd:$cwd}' | bash "$HOOK" 2>&1)
RC=$?
[[ $RC -eq 0 && -z "$OUT" ]] && ok "6 non-repo cwd silent" || ng "6 (rc $RC, out: $OUT)"

claudemd_assert_summary
