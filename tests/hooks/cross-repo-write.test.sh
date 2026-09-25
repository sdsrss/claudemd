#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# cross-repo-write.test.sh — tasks/specs/cross-repo-write.md success-criteria 3.
#
# The hook is advisory, so what this suite establishes is WHICH calls it speaks
# on. The two baseline incidents are the positive set: an Edit into another
# repo, and `cd <other repo> && git <write>`. The negative set is what sessions
# do across repos every day without writing: git reads, their own worktrees and
# submodules, scratch and memory paths. A row for each side, because an
# advisory that fires on reads is one the agent learns to ignore.
#
# Fixture repos are bare directory shapes (`.git` dir, or a `.git` file with a
# `gitdir:` line) — the hook never spawns git, so neither does the suite.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/cross-repo-write-check.sh"
# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

BASE=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX")
# The hook skips anything under /tmp/claude-* (Claude Code's scratchpad root).
# A suite launched from inside a session can inherit a TMPDIR there, which
# would put every fixture repo under the exclusion and turn each advisory row
# into a silent one for the wrong reason.
case "$BASE" in
  /tmp/claude-*)
    rm -rf "${BASE:?}"
    BASE=$(mktemp -d /tmp/claudemd-test-XXXXXX)
    ;;
esac
trap 'rm -rf "${BASE:?}"' EXIT
export HOME="$BASE/home"
mkdir -p "$HOME/.claude/logs"
# The hook's own TMPDIR exclusion is pointed at a subdir, so the fixture repos
# (siblings of it) are NOT excluded while the exclusion row still has a target.
HOOK_TMPDIR="$BASE/tmpdir"
mkdir -p "$HOOK_TMPDIR"

R="$BASE/repos"
mkrepo() { mkdir -p "$1/.git" "$1/src"; }
mkrepo "$R/alpha"
mkrepo "$R/beta"
mkrepo "$HOME/proj"
mkdir -p "$R/plain/src"
# Worktrees: a `.git` FILE naming <common>/.git/worktrees/<n>.
mkdir -p "$R/alpha/.git/worktrees/wt" "$R/alpha-wt/src"
printf 'gitdir: %s\n' "$R/alpha/.git/worktrees/wt" > "$R/alpha-wt/.git"
mkdir -p "$R/beta/.git/worktrees/bw" "$R/beta-wt/src"
printf 'gitdir: %s\n' "$R/beta/.git/worktrees/bw" > "$R/beta-wt/.git"
# Submodule of alpha, with the RELATIVE gitdir git writes for one.
mkdir -p "$R/alpha/.git/modules/sub" "$R/alpha/sub"
printf 'gitdir: ../.git/modules/sub\n' > "$R/alpha/sub/.git"
# Repos under the two excluded roots: the exclusion must hold even where a repo
# exists, or the row would pass on "no repo found" instead.
mkrepo "$HOME/.claude/mem"
mkrepo "$HOOK_TMPDIR/sbx"
# A repo whose root has a space in it, for quoted and escaped operands.
mkrepo "$R/my repo"
# Quote characters inside a path are part of it.
mkrepo "$R/bob's repo"
mkrepo "$R/alpha/vendor/o'lib"
# A worktree of alpha's own submodule: its gitdir sits under
# alpha/.git/modules/sub/worktrees/<n>, with a `commondir` of ../..
mkdir -p "$R/alpha/.git/modules/sub/worktrees/w" "$R/subwt/src"
printf '../..\n' > "$R/alpha/.git/modules/sub/worktrees/w/commondir"
printf 'gitdir: %s\n' "$R/alpha/.git/modules/sub/worktrees/w" > "$R/subwt/.git"
# Bare-repo worktree layout: `git clone --bare proj.git` + `git worktree add`.
# Each worktree's gitdir is proj.git/worktrees/<n>, NOT under a `.git/`, and
# git writes a `commondir` there pointing at the shared repo.
for w in main feat; do
  mkdir -p "$R/proj.git/worktrees/$w" "$R/proj/$w/src"
  printf '../..\n' > "$R/proj.git/worktrees/$w/commondir"
  printf 'gitdir: %s\n' "$R/proj.git/worktrees/$w" > "$R/proj/$w/.git"
done
# A bare-layout worktree whose `.git` line ends in CRLF (a tool that writes
# CRLF): with the CR kept, `<gitdir>/commondir` is not found and the path
# resolves to no repo at all.
mkdir -p "$R/proj.git/worktrees/crlf" "$R/proj/crlf/src"
printf '../..\n' > "$R/proj.git/worktrees/crlf/commondir"
printf 'gitdir: %s\r\n' "$R/proj.git/worktrees/crlf" > "$R/proj/crlf/.git"

LOG="$HOME/.claude/logs/claudemd.jsonl"
SEQ=0
next_sid() {
  SEQ=$((SEQ + 1))
  SID="s$SEQ"
}

# file_ev TOOL PATH CWD SID — an Edit/Write/NotebookEdit event.
file_ev() {
  local key=file_path
  [[ "$1" == NotebookEdit ]] && key=notebook_path
  jq -cn --arg t "$1" --arg p "$2" --arg c "$3" --arg s "$4" --arg k "$key" \
    '{session_id:$s,tool_use_id:"toolu_x",tool_name:$t,cwd:$c,tool_input:{($k):$p}}'
}
# bash_ev CMD CWD SID
bash_ev() {
  jq -cn --arg x "$1" --arg c "$2" --arg s "$3" \
    '{session_id:$s,tool_use_id:"toolu_x",tool_name:"Bash",cwd:$c,tool_input:{command:$x}}'
}
# run EVENT — the hook opted in, with the fixture TMPDIR. Echoes stdout.
run() {
  printf '%s' "$1" | CROSS_REPO_WRITE=1 TMPDIR="$HOOK_TMPDIR" bash "$HOOK" 2>/dev/null
}
ctx() { printf '%s' "$1" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }
rows() {
  [[ -f "$LOG" ]] || {
    echo 0
    return
  }
  jq -r --arg s "$1" 'select(.hook=="cross-repo-write" and .session_id==$s) | .event' "$LOG" 2>/dev/null \
    | wc -l | tr -d ' '
}

# expect_advisory NAME OUT TARGET OWN — an advisory naming both repos, and NOT a verdict.
expect_advisory() {
  local name="$1" out="$2" target="$3" own="$4" c dec ev
  c=$(ctx "$out")
  dec=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)
  ev=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName // ""' 2>/dev/null)
  if [[ "$c" == *"$target"* && "$c" == *"$own"* && "$dec" == none && "$ev" == PreToolUse ]]; then
    ok "$name"
  else
    ng "$name (expected an advisory naming $target and $own with no decision; got: ${out:-<silent>})"
  fi
}
expect_silent() {
  if [[ -z "$2" ]]; then ok "$1"; else ng "$1 (expected silent, got: $2)"; fi
}

# --- X0: default OFF ---------------------------------------------------------
next_sid
OUT=$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$SID" | TMPDIR="$HOOK_TMPDIR" bash "$HOOK" 2>/dev/null)
if [[ -z "$OUT" && ! -f "$LOG" ]]; then
  ok "X0 default OFF: an Edit into another repo is silent and writes no rule-hits row"
else
  ng "X0 fired without CROSS_REPO_WRITE=1 (out: ${OUT:-<none>}, log exists: $([[ -f "$LOG" ]] && echo yes || echo no))"
fi

# --- X1-X5: file tools, own vs other repo, repeat suppression ------------------
next_sid
expect_silent "X1 Edit inside the own repo" "$(run "$(file_ev Edit "$R/alpha/src/f" "$R/alpha" "$SID")")"

next_sid
S3=$SID
OUT=$(run "$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$S3")")
expect_advisory "X2 Edit into another repo names both repos" "$OUT" beta alpha
assert_contains "X2 message gives the worktree remedy" "git worktree add" "$(ctx "$OUT")"

OUT=$(run "$(file_ev Write "$R/beta/src/g" "$R/alpha" "$S3")")
expect_silent "X3 a second write into the same repo, same session, is not re-announced" "$OUT"
assert_eq "X3 but both hits are recorded" 2 "$(rows "$S3")"
FIRSTS=$(jq -r --arg s "$S3" 'select(.hook=="cross-repo-write" and .session_id==$s) | .extra.first' "$LOG" | tr '\n' ,)
assert_eq "X3 rows mark the first hit only" "true,false," "$FIRSTS"

next_sid
expect_advisory "X4 a different session is told again" "$(run "$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$SID")")" beta alpha

next_sid
expect_advisory "X5 NotebookEdit reads notebook_path" "$(run "$(file_ev NotebookEdit "$R/beta/src/n.ipynb" "$R/alpha" "$SID")")" beta alpha

# --- X6-X8: worktrees and submodules -------------------------------------------
next_sid
expect_silent "X6a own worktree → own repo" "$(run "$(file_ev Edit "$R/alpha/src/f" "$R/alpha-wt" "$SID")")"
next_sid
expect_silent "X6b own repo → own worktree" "$(run "$(file_ev Edit "$R/alpha-wt/src/f" "$R/alpha" "$SID")")"
next_sid
expect_advisory "X7 another repo's worktree is that repo" "$(run "$(file_ev Edit "$R/beta-wt/src/f" "$R/alpha" "$SID")")" beta alpha
next_sid
expect_silent "X8 own submodule (relative gitdir) is the own repo" "$(run "$(file_ev Edit "$R/alpha/sub/f" "$R/alpha" "$SID")")"
next_sid
expect_silent "X6f a worktree of the own submodule is the own repo" "$(run "$(file_ev Edit "$R/subwt/src/f" "$R/alpha" "$SID")")"
next_sid
expect_advisory "X6g a CRLF gitdir line still resolves" "$(run "$(file_ev Edit "$R/proj/crlf/src/f" "$R/alpha" "$SID")")" proj alpha
next_sid
expect_silent "X6c bare-repo layout: a sibling worktree is the own repo" "$(run "$(file_ev Edit "$R/proj/feat/src/f" "$R/proj/main" "$SID")")"
next_sid
expect_silent "X6d bare-repo layout: cd into a sibling worktree and commit" "$(run "$(bash_ev "cd $R/proj/feat && git commit -m x" "$R/proj/main" "$SID")")"
next_sid
expect_advisory "X6e bare-repo layout: still another repo from alpha" "$(run "$(file_ev Edit "$R/proj/feat/src/f" "$R/alpha" "$SID")")" proj alpha

# --- X9: exclusions, each on a path that IS inside a repo ------------------------
next_sid
expect_silent "X9a under ~/.claude" "$(run "$(file_ev Write "$HOME/.claude/mem/src/x.md" "$R/alpha" "$SID")")"
next_sid
expect_silent "X9b under TMPDIR" "$(run "$(file_ev Write "$HOOK_TMPDIR/sbx/src/x" "$R/alpha" "$SID")")"
next_sid
ln -s "$HOOK_TMPDIR/sbx" "$R/tmplink"
expect_silent "X9d a symlink whose physical path is under TMPDIR" "$(run "$(file_ev Write "$R/tmplink/src/x" "$R/alpha" "$SID")")"
# /var/tmp: a real repo there, so the row fails if the exclusion goes. The
# replay's only false positives were throwaway repos under /var/tmp.
VT=$(mktemp -d /var/tmp/claudemd-test-XXXXXX)
# /tmp/claude-*: Claude Code's scratchpad root, which stays there when TMPDIR
# points elsewhere (run() points it at HOOK_TMPDIR). A real repo, as above.
CT=$(mktemp -d /tmp/claude-xrtest-XXXXXX)
trap 'rm -rf "${BASE:?}" "${VT:?}" "${CT:?}"' EXIT
mkrepo "$VT/sbx"
mkrepo "$CT/sbx"
next_sid
expect_silent "X9e under /var/tmp" "$(run "$(file_ev Write "$VT/sbx/src/x" "$R/alpha" "$SID")")"
next_sid
expect_silent "X9f under /tmp/claude-*" "$(run "$(file_ev Write "$CT/sbx/src/x" "$R/alpha" "$SID")")"
next_sid
expect_silent "X9c a path in no repo" "$(run "$(file_ev Write "$R/plain/src/x" "$R/alpha" "$SID")")"

# --- X10-X11: path resolution --------------------------------------------------
next_sid
expect_advisory "X10a relative path resolves against cwd" "$(run "$(file_ev Edit "../beta/src/f" "$R/alpha" "$SID")")" beta alpha
next_sid
expect_advisory "X10b a .. walk into another repo" "$(run "$(file_ev Edit "$R/alpha/../beta/src/f" "$R/alpha" "$SID")")" beta alpha
next_sid
expect_silent "X10c a .. walk back into the own repo" "$(run "$(file_ev Edit "$R/beta/../alpha/src/f" "$R/alpha" "$SID")")"
next_sid
expect_advisory "X10d a file that does not exist yet, in a dir that does not either" "$(run "$(file_ev Write "$R/beta/new/dir/f" "$R/alpha" "$SID")")" beta alpha
next_sid
expect_advisory "X10e an apostrophe inside the target path is kept" "$(run "$(file_ev Edit "$R/bob's repo/src/f" "$R/alpha" "$SID")")" "bob's repo" alpha
next_sid
expect_silent "X10f a nested repo with an apostrophe, edited from inside itself" "$(run "$(file_ev Edit "$R/alpha/vendor/o'lib/f" "$R/alpha/vendor/o'lib" "$SID")")"
next_sid
expect_silent "X11 cwd in no repo: nothing to compare" "$(run "$(file_ev Edit "$R/beta/src/f" "$R/plain" "$SID")")"

# --- X12: allowlist ------------------------------------------------------------
next_sid
OUT=$(printf '%s' "$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$SID")" \
  | CROSS_REPO_WRITE=1 CROSS_REPO_WRITE_ALLOW="/nonexistent:$R/beta" TMPDIR="$HOOK_TMPDIR" bash "$HOOK" 2>/dev/null)
expect_silent "X12 an allowlisted repo gets no message" "$OUT"
AL=$(jq -r --arg s "$SID" 'select(.hook=="cross-repo-write" and .session_id==$s) | .extra.allowlisted' "$LOG" 2>/dev/null)
assert_eq "X12 but the hit is recorded as allowlisted" true "$AL"

# --- X13-X14: kill switches and fail-open ----------------------------------------
next_sid
OUT=$(printf '%s' "$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$SID")" \
  | CROSS_REPO_WRITE=1 DISABLE_CROSS_REPO_WRITE_HOOK=1 TMPDIR="$HOOK_TMPDIR" bash "$HOOK" 2>/dev/null)
expect_silent "X13a DISABLE_CROSS_REPO_WRITE_HOOK=1" "$OUT"
OUT=$(printf '%s' "$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$SID")" \
  | CROSS_REPO_WRITE=1 DISABLE_CLAUDEMD_HOOKS=1 TMPDIR="$HOOK_TMPDIR" bash "$HOOK" 2>/dev/null)
expect_silent "X13b DISABLE_CLAUDEMD_HOOKS=1" "$OUT"
OUT=$(printf 'not json' | CROSS_REPO_WRITE=1 bash "$HOOK" 2>&1)
RC=$?
if [[ -z "$OUT" && $RC -eq 0 ]]; then ok "X14 malformed event: exit 0, silent"; else ng "X14 (rc $RC, out: $OUT)"; fi

# --- X15: Bash git writes into another repo ---------------------------------------
# One fresh session per row, so repeat suppression cannot make a row pass.
WROTE=0
WROWS=0
for c in \
  "cd $R/beta && git commit -m x" \
  "cd \"$R/beta\"; git push origin main" \
  "git -C $R/beta switch -c feat" \
  "cd $R/beta && git branch -f x HEAD" \
  "cd $R/beta && git branch newname" \
  "cd $R/beta && git reset --keep HEAD~1" \
  "cd $R/beta && git tag -a v1 -m x" \
  "cd $R/beta && git tag v1" \
  "cd $R/beta && git stash" \
  "cd $R/beta && git stash pop" \
  "cd $R/beta && git worktree add ../x" \
  "cd $R/beta && git pull" \
  "cd $R/beta && git push origin --delete old" \
  "cd $R/beta && git add f && git commit -q -m x" \
  "cd $R/beta && GIT_EDITOR=true git rebase main" \
  "(cd $R/beta && git checkout main)" \
  "cd $R/beta; git -c user.name=x commit -m y" \
  "git -C $R/beta-wt commit -m x" \
  "cd $R/beta && git log -1; git cherry-pick abc" \
  "cd $R/beta && git merge feat" \
  "git -C $R/beta revert HEAD" \
  "cd $R/beta && git rm f" \
  "cd $R/beta && git mv a b" \
  "cd $R/beta && git restore f" \
  "cd $R/beta && git am p.patch" \
  "cd $R/beta && git apply p.diff" \
  "cd $R/beta && git clean -fd" \
  "cd -P $R/beta && git commit -m x" \
  "cd -- $R/beta && git commit -m x" \
  "cd \"$R/my repo\" && git commit -m x" \
  "(cd $R/beta && BR=\$(git branch --show-current) && git push origin \$BR)" \
  "(cd $R/beta && V=\$(cat VERSION) && git tag v\$V)" \
  "cd \"$R/beta\"/src && git commit -m x" \
  "cd '$R/beta'/src && git commit -m x" \
  "cd -eP $R/beta && git commit -m x" \
  "git -C \"$R/beta\" commit -m x" \
  "cd -P \"$R/my repo\" && git commit -m x"; do
  WROWS=$((WROWS + 1))
  next_sid
  OUT=$(run "$(bash_ev "$c" "$R/alpha" "$SID")")
  C=$(ctx "$OUT")
  if [[ "$C" == *beta* || "$C" == *"my repo"* ]]; then WROTE=$((WROTE + 1)); else echo "  X15 silent on: $c"; fi
done
if ((WROTE == WROWS && WROWS >= 37)); then
  ok "X15 every git write into another repo is announced ($WROWS rows)"
else
  ng "X15 ($WROTE of $WROWS write rows announced)"
fi

next_sid
expect_advisory "X16 ~ in a cd target expands to HOME" "$(run "$(bash_ev "cd ~/proj && git commit -m x" "$R/alpha" "$SID")")" proj alpha

# --- X17: Bash reads and own-repo writes stay silent --------------------------------
QUIET=0
QROWS=0
for c in \
  "cd $R/beta && git log --oneline -3" \
  "cd $R/beta && git status --short" \
  "git -C $R/beta show HEAD" \
  "cd $R/beta && git branch -a --contains abc" \
  "cd $R/beta && git branch --show-current" \
  "cd $R/beta && git branch" \
  "cd $R/beta && git branch -vv" \
  "cd $R/beta && git tag | grep -c ." \
  "cd $R/beta && git tag -l 'v*'" \
  "cd $R/beta && git tag --points-at HEAD" \
  "cd $R/beta && git tag --sort=-creatordate | head -3" \
  "cd $R/beta && git stash list" \
  "cd $R/beta && git merge-base --is-ancestor a b" \
  "cd $R/beta && git merge-tree --write-tree a b" \
  "cd $R/beta && git fetch origin" \
  "cd $R/beta && git worktree list" \
  "git commit -m x" \
  "cd $R/alpha-wt && git commit -m x" \
  "cd $R/alpha/sub && git commit -m x" \
  "cd $R/beta && git log -1; cd $R/alpha && git commit -m x" \
  "cd $R/plain && git commit -m x" \
  "cd \$X && git commit -m x" \
  "cd $HOOK_TMPDIR/sbx && git commit -m x" \
  $'cat <<EOF\ncd '"$R"$'/beta && git commit -m x\nEOF' \
  "echo cd $R/beta; git commit -m x" \
  "cd $R/beta && git branch 2> /dev/null" \
  "cd $R/beta && git branch > /dev/null" \
  "cd $R/beta && git tag > tags.txt" \
  "cd $R/beta && git branch # list" \
  "cd $R/beta && git tag --verify v1" \
  "cd $R/beta && git log -1; cd \$X && git commit -m x" \
  "cd $R/beta && git log -1; git -C \$X commit -m x"; do
  QROWS=$((QROWS + 1))
  next_sid
  OUT=$(run "$(bash_ev "$c" "$R/alpha" "$SID")")
  if [[ -z "$OUT" ]]; then QUIET=$((QUIET + 1)); else echo "  X17 spoke on: $c"; fi
done
if ((QUIET == QROWS && QROWS >= 32)); then
  ok "X17 reads, own worktrees/submodules, excluded and unknown targets stay silent ($QROWS rows)"
else
  ng "X17 ($((QROWS - QUIET)) of $QROWS control rows spoke)"
fi

# --- X18: one command, two targets --------------------------------------------------
next_sid
OUT=$(run "$(bash_ev "cd $R/alpha-wt && git commit -m a; cd $R/beta && git push" "$R/alpha" "$SID")")
expect_advisory "X18 the other-repo write is found after an own-worktree write" "$OUT" beta alpha

# --- X22: documented limits, pinned as they are -----------------------------------------
# The CHANGELOG lists these as known limits: subshells are not tracked, and a
# `git -C` path with spaces or a `\ `-escaped path is not re-joined. Two
# attempts to track them each added a new miss, so they stay simple.
# Pinned so a change to them is a decision, not a drift.
LIMIT_MISS=0
for c in \
  "(cd $R/beta && git push)" \
  "git -C \"$R/my repo\" commit -m x" \
  "cd $R/my\\ repo && git commit -m x"; do
  next_sid
  [[ -z "$(run "$(bash_ev "$c" "$R/alpha" "$SID")")" ]] && LIMIT_MISS=$((LIMIT_MISS + 1))
done
assert_eq "X22a known misses stay missed (subshell tail, -C with spaces, escaped space)" 3 "$LIMIT_MISS"
next_sid
OUT=$(run "$(bash_ev "(cd $R/beta && git stash list)" "$R/alpha" "$SID")")
expect_advisory "X22c known misread: a read touching the closing ) is taken for a write" "$OUT" beta alpha
next_sid
OUT=$(run "$(bash_ev "(cd $R/beta && git log -1) && git commit -m own" "$R/alpha" "$SID")")
expect_advisory "X22b known false advisory: a subshell's cd is taken to persist" "$OUT" beta alpha

# --- X20: allowlist entries that are not absolute -----------------------------------
# settings.json `env` values are literal: `~` and `$HOME` arrive unexpanded. The
# hook expands a leading `~/` or `$HOME/`, ignores any other relative entry, and
# must never spin on one (it did: `${d%/*}` on a slash-free string is itself).
# shellcheck source=../../hooks/lib/platform.sh
source "$HERE/../../hooks/lib/platform.sh"
allow_run() {
  printf '%s' "$1" | CROSS_REPO_WRITE=1 CROSS_REPO_WRITE_ALLOW="$2" TMPDIR="$HOOK_TMPDIR" \
    platform_timeout 5 bash "$HOOK" 2>/dev/null
}
next_sid
OUT=$(allow_run "$(file_ev Edit "$R/beta/src/f" "$R/alpha" "$SID")" 'beta:~/nothere:$HOME/nothere')
RC=$?
assert_eq "X20a relative allowlist entries: the hook exits 0" 0 "$RC"
expect_advisory "X20a and the hit is still announced" "$OUT" beta alpha
# Silence alone would also be what a killed hook prints, so each row also
# needs the allowlisted rule-hits row the hook writes only when it finishes.
# shellcheck disable=SC2088  # the literal, unexpanded forms ARE the input
for entry in '~/proj' '$HOME/proj' '${HOME}/proj'; do
  next_sid
  OUT=$(allow_run "$(file_ev Edit "$HOME/proj/src/f" "$R/alpha" "$SID")" "$entry")
  AL=$(jq -r --arg s "$SID" 'select(.hook=="cross-repo-write" and .session_id==$s) | .extra.allowlisted' "$LOG" 2>/dev/null)
  if [[ -z "$OUT" && "$AL" == true ]]; then
    ok "X20b allowlist entry $entry is expanded and matches"
  else
    ng "X20b allowlist entry $entry (out: ${OUT:-<silent>}, allowlisted row: ${AL:-<none>})"
  fi
done
# A relative HOME reaches the same walk through `cd ~`. Run from BASE, so the
# relative log path lands inside the sandbox.
next_sid
EV=$(bash_ev "cd ~ && git commit -m x" "$R/alpha" "$SID")
(cd "$BASE" && printf '%s' "$EV" | HOME=relhome CROSS_REPO_WRITE=1 TMPDIR="$HOOK_TMPDIR" \
  platform_timeout 5 bash "$HOOK" >/dev/null 2>&1)
assert_eq "X20d a relative HOME does not hang the hook" 0 "$?"

# --- X21: an unreadable .git file is silent on stderr ------------------------------
mkdir -p "$R/unr/src"
printf 'gitdir: %s\n' "$R/beta/.git/worktrees/x" > "$R/unr/.git"
chmod 000 "$R/unr/.git"
if [[ -r "$R/unr/.git" ]]; then
  ok "X21 skipped: running as a user who can read mode-000 files"
else
  next_sid
  ERR=$(printf '%s' "$(file_ev Edit "$R/unr/src/f" "$R/alpha" "$SID")" \
    | CROSS_REPO_WRITE=1 TMPDIR="$HOOK_TMPDIR" bash "$HOOK" 2>&1 >/dev/null)
  assert_eq "X21 an unreadable .git file writes nothing to stderr" "" "$ERR"
fi
chmod 600 "$R/unr/.git"

# --- X19: default path is free --------------------------------------------------------
# The opt-in check runs before hook-common is sourced: with the flag unset the
# hook must not reach jq at all. A PATH jq shim counts spawns.
SHIM="$BASE/shim"
mkdir -p "$SHIM"
printf '#!/usr/bin/env bash\necho x >> "%s/jq.count"\nexec "%s" "$@"\n' "$BASE" "$(command -v jq)" > "$SHIM/jq"
chmod +x "$SHIM/jq"
next_sid
EV=$(bash_ev "cd $R/beta && git commit -m x" "$R/alpha" "$SID")
printf '%s' "$EV" | PATH="$SHIM:$PATH" bash "$HOOK" >/dev/null 2>&1
if [[ ! -f "$BASE/jq.count" ]]; then
  ok "X19 default OFF spawns no jq"
else
  ng "X19 default OFF spawned jq $(wc -l < "$BASE/jq.count") time(s)"
fi

echo
claudemd_assert_summary
