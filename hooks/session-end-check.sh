#!/usr/bin/env bash
# session-end-check.sh — SessionEnd hook (v0.9.27 R-N10).
#
# Mechanizes core §11 "Session-exit mid-SPINE" HARD self-rule. At session
# termination, scan the transcript JSONL for mutation tool_use entries
# (Edit / Write / NotebookEdit, plus files a Bash command modified per
# `toolUseResult.bashEditDiff`) since the last user-input message — only
# files inside the project count, never ~/.claude/ or the session
# scratchpad — and count VALIDATE signals (Bash with test-runner / lint /
# typecheck / git commit / git push patterns) after the last mutation.
# If changes are still open after the last validation, less the files git
# reports unchanged from HEAD by the end (D#433, below):
# write a `<cwd>/tasks/<slug>-paused.md` checkpoint, stderr a one-line
# warn, and append a `warn` row to rule-hits.jsonl under §11-session-exit.
#
# Non-blocking by design — SessionEnd cannot block exit anyway, and the
# value is filesystem-side: paused.md is found in the next session,
# stderr surfaces in the user's terminal on exit, rule-hits drives audit.
#
# Detection scope: tail -n 200 of transcript JSONL is the working window.
# Single jq pass: find last user-input message line (text content, not
# tool_result), slice forward, flatten tool_use entries from assistant
# turns, classify by name + Bash-command-pattern.
#
# Validate patterns (at a command position; VALIDATE_RE below):
#   node [opts] --test, pytest, unittest, mypy, jest, vitest, npm test,
#   npm/pnpm/yarn/bun run <test|lint|typecheck|check|smoke|verify|validate…>,
#   go test, cargo test/clippy/check/nextest/fmt --check, make <test|lint|check…>,
#   bash tests/, tsc, vue-tsc, eslint, prettier --check, biome check,
#   ruff, clippy, shellcheck                            — test/lint chain
#   git commit, git push                                — finalization-as-validate
#   each may follow `(`, `time`, `env [-u NAME]`, VAR=value, `timeout N`, a
#   runner (npx, pnpm/yarn/npm exec, bunx, python -m), or node_modules/.bin/
#
# Kill-switch: DISABLE_SESSION_END_CHECK_HOOK=1
# Fail-open on any hiccup.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch SESSION_END_CHECK || exit 0

# Beside SessionStart's own call to the same writer: a session whose
# SessionStart hook was switched off (or one that started before this feature
# shipped) still gets its real root recorded here. Reuses LIB_DIR — already
# resolved from BASH_SOURCE above — rather than a second resolution.
# LIB_DIR is hooks/lib, so the plugin root is two levels up, not one. Placed
# before the jq requirement below: this write needs none of it.
PLUGIN_ROOT="$(cd "$LIB_DIR/../.." && pwd)"
# No sid here, and saying so beats reaching for one that does not exist: this
# runs before the event is parsed, and `CLAUDE_SESSION_ID` — what this argument
# used to be — is a variable Claude Code never exports, so it read as an empty
# string on every invocation and blanked the recorded sid (round-16 M-1 /
# round-17 HK-M3). hook_record_plugin_root carries the recorded one forward when
# handed nothing.
hook_record_plugin_root "$PLUGIN_ROOT" "" 2>/dev/null || true

hook_require_jq || { hook_record_failopen session-end-check jq-missing; exit 0; }
# platform_timeout bounds the git calls that settle open changes (D#433).
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

EVENT=$(hook_read_event) || exit 0
TRANSCRIPT=$(hook_jq_field session-end-check "$EVENT" '.transcript_path // ""') || exit 0
CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // "unknown"' 2>/dev/null)

[[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] || exit 0
[[ -n "$CWD" ]] || CWD="$PWD"

# Project roots. Only a file under one of these is a mutation: an edit to Claude
# Code's own notes (~/.claude/projects/*/memory/), the session scratchpad, or
# another repo is not a change the project's test run could validate, and it
# used to reset the validate count after a clean commit (claude-mem-lite session
# 8b475d66 checkpointed "12 unvalidated mutations" on one memory-file edit). The
# roots are a union — cwd as given and resolved, its git toplevel, and
# CLAUDE_PROJECT_DIR — because a missed root drops real edits and an extra one
# only keeps counting them, the safe side for this checkpoint.
ROOTS=("$CWD")
_r=$(cd "$CWD" 2>/dev/null && pwd -P) && ROOTS+=("$_r")
GIT_TOP=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) && ROOTS+=("$GIT_TOP") || GIT_TOP=""
[[ -n "${CLAUDE_PROJECT_DIR:-}" ]] && ROOTS+=("$CLAUDE_PROJECT_DIR")
ROOTS_JSON=$(printf '%s\n' "${ROOTS[@]}" | jq -R . | jq -sc 'map(select(startswith("/")))' 2>/dev/null) || ROOTS_JSON='[]'

# Validate command, anchored at a command position (see the comment at its use).
# Between the anchor and the tool name it admits what real commands put there:
# a subshell `(`, `time`, VAR=value assignments, `timeout [-opts] N`, and a
# runner (npx [-opts], pnpm/yarn/npm exec, bunx, python -m). The list was built
# from a replay over 30,372 local Bash commands (2026-09-26), where `npx vitest`
# led the heads the tool-name-only anchor missed. `npm test` needs a word end so
# a quoted mention (`grep "…\|npm test"`) no longer reads as one; `npm run`
# scripts count when the name carries test/lint/typecheck/check/smoke/verify/
# validate. Value classes exclude \n so a heredoc body's `s=…` line cannot chain
# into the next one.
_W='[^ \t\n;&|]'
_OPT="([ \t]+-${_W}+([ \t]+[^- \t\n;&|]${_W}*)?)*"
# A script counts when one of its [:._-]-separated name segments is a check
# word: test:unit, lint:js, ci-test. A substring does not: publish:latest holds
# "test" and ran as a validation until the 0.100.0 review (D#102).
_SCRIPT="(${_W}*[:._-])?(test|lint|typecheck|check|smoke|verify|validate)([:._-]${_W}*)?([ \t\n;&|)<>]|\$)"
# An assignment value may be quoted (FOO="a b"); quotes stop at a newline.
# npm's own options: the ones that take a value always consume the next word
# (in `npm --prefix test install` the `test` is --prefix's value), every other
# option is a switch. The switch branch excludes the value-taking names, so a
# backtrack cannot re-read `--prefix` as a switch and its value as the verb.
# The pattern is only ever run by jq (Oniguruma), which has lookahead.
# (B2 review F7 and its delta review M1/L2.)
# `env -u NAME` consumes NAME (the switch branch excludes -u/--unset so a
# backtrack cannot re-read NAME as the command), and a runner may be called
# as ./node_modules/.bin/<runner> or node_modules/.bin/<runner> (D#102 F7
# remainder; ../ and absolute paths are not recognised). `git -C <dir> commit` stays
# unrecognised: a commit in another repo validates nothing here.
_NPMVAL='(-C|-w|--prefix|--workspace|--userconfig|--globalconfig|--cache|--registry|--tag|--otp|--loglevel|--scope|--include|--omit)'
_NPMOPT="([ \t]+${_NPMVAL}(=${_W}*|[ \t]+${_W}+)|[ \t]+(?!${_NPMVAL}([= \t]|\$))-${_W}+)*"
_VAL="(\"[^\"\n]*\"|'[^'\n]*'|${_W}*)"
VALIDATE_RE="(^|[;&|\n]+)[ \t(]*(time[ \t]+)?"
VALIDATE_RE+="(env([ \t]+(-u|--unset)[ \t]+${_W}+|[ \t]+(?!(-u|--unset)([ \t]|\$))-${_W}+)*[ \t]+)?(nice([ \t]+-n[ \t]+-?[0-9]+|[ \t]+-${_W}+)*[ \t]+)?"
VALIDATE_RE+="([A-Za-z_][A-Za-z0-9_]*=${_VAL}[ \t]+)*"
VALIDATE_RE+="(timeout([ \t]+-[ks][ \t]+${_W}+|[ \t]+-${_W}+)*[ \t]+[0-9.]+[smhd]?[ \t]+)?"
VALIDATE_RE+="(npx([ \t]+-${_W}+)*[ \t]+|(pnpm|yarn|npm)[ \t]+exec[ \t]+|bunx[ \t]+|python3?[ \t]+-m[ \t]+|(uv|poetry|pipenv)[ \t]+run[ \t]+)?"
VALIDATE_RE+="((\./)?node_modules/\.bin/)?"
VALIDATE_RE+="(node${_OPT}[ \t]+--test|pytest|unittest|mypy|npm${_NPMOPT}[ \t]+(test|t)([ \t\n;&|)<>]|\$)"
VALIDATE_RE+="|npm${_NPMOPT}[ \t]+run(-script)?${_OPT}[ \t]+${_SCRIPT}|(pnpm|yarn|bun)([ \t]+run)?${_OPT}[ \t]+${_SCRIPT}"
VALIDATE_RE+="|jest|vitest|go test|cargo[ \t]+(test|clippy|check|nextest|fmt[^;&|\n]*--check)"
VALIDATE_RE+="|make([ \t]+-${_W}+)*[ \t]+${_W}*(test|lint|check)|bash tests/|tsc |vue-tsc|eslint"
VALIDATE_RE+="|prettier[ \t]+(--check|-c)|biome[ \t]+(check|lint|ci)|ruff |clippy|shellcheck|git commit|git push)"

# Single jq pass over last 200 lines: find last user-input message,
# slice forward, classify tool_use entries.
# The boundary test is the shared `is_user_turn` (HOOK_USER_TURN_JQ in
# hook-common.sh), single-sourced with scripts/lib/transcript-user-turn.js and
# gated by tests/scripts/user-turn-parity.test.js (2026-07-27 audit, H2). The
# local spelling this replaces counted isMeta rows, <system-reminder> injections,
# and rows carrying BOTH a tool_result and trailing text as user input — each of
# which moves the boundary LATER and shrinks the slice this net inspects. The
# shared definition errs the other way, which is the safe side for an advisory
# checkpoint. The pre-v0.23.x defect the old comment recorded is still guarded:
# is_user_turn branches on content type before iterating, so a string never
# reaches an array operator (jq "Cannot iterate over string" errored the whole
# filter under 2>/dev/null and the hook exited 0 silently).
RESULT=$(tail -n 200 "$TRANSCRIPT" 2>/dev/null | jq -R -s --arg vre "$VALIDATE_RE" \
  --argjson roots "$ROOTS_JSON" --arg home "${HOME:-}" "$HOOK_USER_TURN_JQ"'
  # A path is in the project when it sits under a root. Relative or missing
  # paths count (they resolve against cwd; unknown errs toward the checkpoint).
  # ~/.claude/ and Claude Code'"'"'s /tmp/claude-<uid>/ scratch root are excluded
  # even under a root, unless that root itself lies inside the same zone — a
  # session run from $HOME must not count memory edits, one whose project lives
  # under ~/.claude must keep counting its own.
  # A root of "/" holds every absolute path (rtrimstr left it empty, so it held
  # none); `..` and `.` segments are resolved first, so <root>/../x is outside.
  def norm: if startswith("/") then "/" + (split("/") | map(select(. != "" and . != "."))
              | reduce .[] as $s ([]; if $s == ".." then .[:-1] else . + [$s] end) | join("/"))
            else . end;
  def under($d): if $d == "/" then startswith("/")
                 else ($d | rtrimstr("/")) as $d | ($d | length) > 0 and (. == $d or startswith($d + "/")) end;
  def zone: if ($home | length) > 0 and under($home + "/.claude") then $home + "/.claude"
            else (capture("^(?<z>(/private)?/tmp/claude-[0-9]+)(/|$)") | .z) // null end;
  def in_project: if type != "string" or (startswith("/") | not) then true
                  else norm as $p | ($p | zone) as $z
                    | any($roots[]; . as $r | ($p | under($r)) and ($z == null or ($r | under($z))))
                  end;
  # A match jq cannot finish is not a validation. `A="x"` fits both the quoted
  # and the bare value, so 17 of them before a non-check command pass
  # Oniguruma'"'"'s retry limit, and the uncaught error emptied the whole pass:
  # the open edits got no checkpoint.
  def is_validate: try test($vre) catch false;
  split("\n") |
  map(select(length > 0) | try fromjson catch null) |
  # Normalize row shapes before any path expression runs (0.99.0 pre-tag review
  # M4): a non-object line, a string `message`, or a non-object element in a
  # content array each made one operator below throw, and a jq error under
  # 2>/dev/null is an empty RESULT — the hook then exits 0 with no checkpoint.
  # String content is kept: a human prompt is recorded that way.
  map(select(type == "object")
      | .message |= (if type == "object" then . else {} end)
      | .message.content |= (if type == "array" then map(select(type == "object"))
                             elif type == "string" then . else null end)) |
  (map(is_user_turn)) as $mask |
  ($mask | to_entries | map(select(.value)) | (last // {key: -1}) | .key) as $lastUser |
  # The prompt'"'"'s time, for the stash test after this pass; null when unknown.
  (if $lastUser >= 0 then .[$lastUser].timestamp else null end) as $since |
  .[$lastUser + 1:] |
  # Files each Bash command modified, keyed by its tool_use id. Claude Code
  # records them on the RESULT row (`toolUseResult.bashEditDiff`, CC >=2.1.278),
  # and under Opus 5.5 most edits take this route (analysis 2026-09-26, B1), so
  # a checkpoint keyed on Edit/Write alone never fired for those sessions. The
  # join puts the mutation BEFORE the validate test of the same command below:
  # `python3 - <<PY … PY && npm test` edits and then verifies. `changedFiles`
  # is the complete list; `files[]` holds at most 5 diffs and can be empty
  # (0.99.0 pre-tag review M1), so both are read, once per path. Deduped in
  # first-seen order, not with `unique`, which sorts: the checkpoint lists the
  # last three, and sorted they were the alphabetically last (D#96 L1).
  (reduce (.[] | select(.toolUseResult | type == "object")
                | [(.message.content // [] | if type == "array" then . else [] end
                    | map(select(.type == "tool_result") | .tool_use_id) | first),
                   ([.toolUseResult.bashEditDiff | objects
                     | ((.changedFiles | arrays | .[] | strings),
                        (.files | arrays | .[] | objects | .filePath | strings))]
                    | reduce .[] as $f ([]; if index([$f]) then . else . + [$f] end))]
                | select((.[0] | type) == "string" and (.[1] | length) > 0))
          as $p ({}; .[$p[0]] = $p[1])) as $bed |
  # String content (a plain-text assistant row) holds no tool_use; coerce it to
  # [] so `. + $arr` below never adds a string to an array and kills the filter.
  map(select(.type == "assistant") | (.message.content // [] | if type == "array" then . else [] end)) |
  (reduce .[] as $arr ([]; . + $arr)) |
  map(select(.type == "tool_use")) as $tools |
  $tools |
  reduce .[] as $t (
    # `open` and `opened` cover only the changes made after the last validation:
    # a validate clears both. `mutations` stays the count since the user prompt.
    # `opened` is complete, one entry per change, so the files settled below
    # can be taken out of the count; `path` is the file, null when unknown.
    {mutations: 0, validates: 0, open: 0, opened: []};
    # A non-string id or a non-object input must not throw (review M4).
    ($t.id | if type == "string" then . else "" end) as $tid |
    ($t.input | if type == "object" then . else {} end) as $in |
    (($bed[$tid] // []) | map(select(in_project))) as $bf |
    (if $t.name == "Bash" and ($bf | length) > 0 then
      .mutations += ($bf | length)
      | .open += ($bf | length)
      | .validates = 0
      | .opened += ($bf | map({name: "Bash", target: ., path: .}))
    else . end) |
    if ($t.name == "Edit" or $t.name == "Write" or $t.name == "NotebookEdit")
       and (($in.file_path // $in.notebook_path) | in_project) then
      .mutations += 1
      | .open += 1
      # A validation that ran BEFORE this mutation did not validate it, so a
      # mutation resets the counter: `validates == 0` at the end now means "no
      # validation after the LAST mutation", which is what §11 session-exit
      # actually asks. Pre-fix any validate anywhere in the slice suppressed the
      # checkpoint, so `npm test` → `Edit` read as validated. Order-independence
      # was latent until the v0.62.0 boundary change widened the slice (an isMeta
      # `!command` caveat row stopped being a boundary, correctly), which turned
      # the latent flaw into a live suppression on a common shape.
      | .validates = 0
      | .opened += [{name: $t.name, target: ($in.file_path // $in.notebook_path // "?"),
                     path: ($in.file_path // $in.notebook_path | if type == "string" then . else null end)}]
    elif $t.name == "Bash" then
      ($in.command // "" | if type == "string" then . else "" end) as $cmd |
      # Anchor each validate verb to a command position — start of string or
      # right after a shell separator (; && || | newline). Pre-v0.23.11 this was
      # a bare substring test, so `echo "TODO: git commit later"` /
      # `grep "npm test" file` counted as a validation and suppressed the
      # mid-SPINE paused.md checkpoint. A stricter anchor errs toward WRITING
      # the checkpoint (the safe side for this advisory safety-net).
      # `bash -c` / `sh -lc` with a quoted body: the body is a command line of its
      # own, tested with the same anchored pattern (0.99.0 matched it only
      # because it had no anchor at all).
      if ($cmd | is_validate) or ([$cmd | scan("(?:^|[;&|\n])[ \t(]*(?:bash|sh|zsh)[ \t]+-l?c[ \t]+(?:\u0027([^\u0027]*)\u0027|\"([^\"]*)\")")]
            | map(.[] | select(. != null)) | any(is_validate)) then
        .validates += 1 | .open = 0 | .opened = []
      else . end
    else . end
  ) | .since = $since
  | .recent = (.opened | if length > 3 then .[length-3:] else . end)
  # The settle check below reads the list only up to 1,000 entries; past that
  # it is dropped here, so the rest of the hook passes a small object around.
  | if (.opened | length) > 1000 then del(.opened) else . end
' 2>/dev/null)

[[ -n "$RESULT" ]] || exit 0

MUTATIONS=$(printf '%s' "$RESULT" | jq -r '.mutations // 0' 2>/dev/null)
VALIDATES=$(printf '%s' "$RESULT" | jq -r '.validates // 0' 2>/dev/null)
OPEN=$(printf '%s' "$RESULT" | jq -r '.open // 0' 2>/dev/null)
RECENT=$(printf '%s' "$RESULT" | jq -c '.recent // []' 2>/dev/null) || RECENT='[]'
SETTLE_NOTE=""

# D#433: a change whose file git reports unchanged from the commit at HEAD by
# the end leaves nothing to validate: a branch switch (session af7b7d07
# committed on next-release, ran `git checkout main`, and was checkpointed for
# the 17 files the switch rewrote), a `git restore`, an edit undone. That
# content is a commit's, and `git commit` counts as a validation above. Asked
# only when something is open; any git failure or timeout drops nothing. A
# change is settled only when its file is not a symlink, resolves (`cd -P`) to
# a path under the top level, is tracked with the plain `H` tag of
# `ls-files -v`, and `status` does not list it. Everything else stays: a
# symlink (an edit through AGENTS.md -> CLAUDE.md changes the target), a file
# reached through a directory link out of the repo, an absent file (git cannot
# tell a file a switch removed from a deleted untracked or ignored file, or one
# in a submodule or under .git), anything untracked, ignored, assume-unchanged,
# skip-worktree or unmerged, anything status lists as changed, staged, deleted
# or renamed. The check is off while a rebase, merge, cherry-pick or revert is
# stopped (an autostash lives in the git dir, not refs/stash), and when a stash
# exists that is newer than the prompt, or a stash exists and the prompt has no
# time to compare: the stashed work is unvalidated though the tree matches HEAD. The first attempt (D#404,
# 8d88816) and the first build of this one dropped some of these; the 0.113.0
# and 0.113.1 pre-tag reviews found them.
#
# Paths go to git as separate arguments and git's answers reach jq on stdin
# (8d88816's --argjson failed past Linux's 128 KiB single-argument cap). Each
# git call is bounded at 0.5 s, and none starts once the hook has run for
# 2 s (SECONDS counts whole seconds), so the last one ends before 2.5 s of the
# 3 s SessionEnd budget. The fallback watchdog without coreutils kills the
# process it started, which for a direct git call is git itself; a git that is
# a wrapper script outlives it. Past 1,000 open changes nothing is asked and
# the jq pass above drops the list, so the hook costs what 0.113.0's did. The
# cap comes from measurement (2026-10-17): asking git about 12,530 paths took
# the hook from 2.3 s to 4.6 s, past the budget, and 2,000 from 0.19 s to
# 1.05 s under bash 3.2.
_git_settle() {
  (( SECONDS <= 1 )) || return 1
  platform_timeout 0.5 git --no-optional-locks "$@"
}
if [[ "${OPEN:-0}" -gt 0 && "$GIT_TOP" == /* ]] \
   && declare -f platform_timeout >/dev/null 2>&1 \
   && OPENED=$(printf '%s' "$RESULT" | jq -c '.opened | arrays' 2>/dev/null) && [[ -n "$OPENED" ]]; then
  _settle=0
  if _gd=$(_git_settle -C "$GIT_TOP" rev-parse --absolute-git-dir 2>/dev/null) && [[ "$_gd" == /* ]] \
     && [[ ! -e "$_gd/rebase-merge" && ! -e "$_gd/rebase-apply" && ! -e "$_gd/MERGE_HEAD" \
           && ! -e "$_gd/MERGE_AUTOSTASH" && ! -e "$_gd/CHERRY_PICK_HEAD" && ! -e "$_gd/REVERT_HEAD" ]] \
     && _st=$(_git_settle -C "$GIT_TOP" for-each-ref --format='%(committerdate:raw)' refs/stash 2>/dev/null); then
    _settle=1
    if [[ -n "$_st" ]]; then
      _since=$(printf '%s' "$RESULT" | jq -r '.since | strings | sub("\\.[0-9]+"; "") | fromdateiso8601 | floor' 2>/dev/null) || _since=""
      [[ "${_st%% *}" =~ ^[0-9]+$ && "$_since" =~ ^[0-9]+$ ]] && (( ${_st%% *} < _since )) || _settle=0
    fi
  fi
  _top=$(cd "$GIT_TOP" 2>/dev/null && pwd -P) || _settle=0
  if (( _settle )); then
    # One record per opened entry, in order: the file's physical path under
    # the top level when git may vouch for it, "" when it stays regardless.
    _recs=(); _ask=(); _here=$PWD
    while IFS= read -r -d '' _t; do
      _rec=""
      if [[ -n "$_t" ]]; then
        [[ "$_t" == /* ]] || _t="$CWD/$_t"
        _d=${_t%/*}; _b=${_t##*/}; [[ -n "$_d" ]] || _d=/
        if [[ -n "$_b" && "$_b" != . && "$_b" != .. ]] && builtin cd -P -- "$_d" 2>/dev/null \
           && [[ ! -L "$PWD/$_b" ]]; then
          if [[ "$PWD" == "$_top" ]]; then _rec=$_b
          elif [[ "$PWD" == "$_top"/* ]]; then _rec=${PWD#"$_top"/}/$_b
          fi
          [[ -n "$_rec" ]] && _ask+=("$_rec")
        fi
      fi
      _recs+=("$_rec")
    done < <(printf '%s' "$OPENED" | jq -j '.[] | (.path | strings // "") + "\u0000"' 2>/dev/null)
    builtin cd -- "$_here" 2>/dev/null || true
    if (( ${#_ask[@]} > 0 )) \
       && _lsf=$(_git_settle --literal-pathspecs -C "$_top" ls-files -v -z -- "${_ask[@]}" 2>/dev/null \
          | jq -R -s -c 'split("\u0000") | map(select(length > 1) | {key: .[2:], value: .[0:1]}) | from_entries' 2>/dev/null) \
       && _sts=$(_git_settle --literal-pathspecs -C "$_top" status --porcelain=v1 -z --untracked-files=no \
            -- "${_ask[@]}" 2>/dev/null \
          | jq -R -s -c 'split("\u0000") | map(select(length > 0))
              | reduce .[] as $f ({paths: {}, src: false};
                  if .src then .paths[$f] = true | .src = false
                  else .paths[$f[3:]] = true | .src = ($f[0:2] | test("[RC]")) end)
              | .paths' 2>/dev/null) \
       && _kept=$( { printf '%s\n' "$OPENED"
                     printf '%s\0' "${_recs[@]}" | jq -R -s -c 'split("\u0000")[:-1]'
                     printf '%s\n%s\n' "$_lsf" "$_sts"; } \
          | jq -s -c '.[0] as $o | .[1] as $r | .[2] as $tag | .[3] as $listed
              | if ($r | length) != ($o | length) then $o
                else [range(0; $o | length) as $i | $r[$i] as $x
                      | select(($x | length) == 0 or $listed[$x] or $tag[$x] != "H") | $o[$i]] end' 2>/dev/null) \
       && _n=$(printf '%s' "$_kept" | jq 'length' 2>/dev/null) && [[ "$_n" =~ ^[0-9]+$ ]]; then
      OPEN="$_n"
      RECENT=$(printf '%s' "$_kept" | jq -c 'if length > 3 then .[length-3:] else . end' 2>/dev/null) || RECENT='[]'
      SETTLE_NOTE=$'\nChanges to files that match the commit at HEAD again by the end are not counted.\n'
    fi
  fi
fi

# Trip condition: open > 0 AND validates == 0. A mutation zeroes `validates`
# and a validate zeroes `open`, so at the end whichever came last decides both;
# open can then only drop, by the settled files above. OPEN is what the user is
# told; MUTATIONS, the count since the prompt, is context.
# A session that changed only markdown trips too, on purpose: spec/CLAUDE.md,
# SKILL.md and commands/*.md are model-visible text (core §2 makes them L3), so
# skipping `*.md` would drop the edits this checkpoint matters most for
# (converge D11).
if [[ "${OPEN:-0}" -gt 0 && "${VALIDATES:-0}" -eq 0 ]]; then
  mkdir -p "$CWD/tasks" 2>/dev/null || exit 0
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) || TS="unknown"
  SLUG=$(printf 'session-end-%s' "${SESSION_ID:0:8}")
  PAUSED="$CWD/tasks/${SLUG}-paused.md"

  RECENT_LIST=$(printf '%s' "$RECENT" | jq -r 'map("- \(.name): \(.target)") | join("\n")' 2>/dev/null)

  # The write is checked: an unwritable or full tasks/ used to leave stderr
  # announcing a checkpoint, and the rule-hits row naming it, when none
  # existed (converge round 14). It goes to a temp file beside the target and
  # is renamed over it, so a write that fails part-way (full disk, quota)
  # removes only the temp file: `cat > "$PAUSED"` truncated the existing file
  # first and left half a new one. The path is fixed per session, so what is
  # already there is usually this session's earlier checkpoint, which a
  # successful write replaces. A rename would also replace a read-only copy
  # the user kept, and would move the file INTO a directory of that name, so
  # both count as unwritable. The temp name does not end in -paused.md, which
  # is what session-start's paused banner counts. mktemp creates mode 600; the
  # chmod gives the checkpoint the mode a newly created file gets under the umask.
  WROTE=0
  if [[ -d "$PAUSED" || ( -e "$PAUSED" && ! -w "$PAUSED" ) ]]; then
    :
  elif TMP_PAUSED=$(mktemp "$CWD/tasks/.${SLUG}.XXXXXX" 2>/dev/null); then
    { cat > "$TMP_PAUSED" <<EOF
# Paused — mid-SPINE session exit detected

Generated by claudemd \`session-end-check.sh\` at $TS.

Since the final user prompt the assistant made **$OPEN change(s) after the last validation**
($MUTATIONS in this turn; a change is one Edit / Write / NotebookEdit call, or one project
file a Bash command modified) and there is **no VALIDATE signal after the last mutation**
(test runner / lint / typecheck / git commit / git push).
$SETTLE_NOTE
A validation earlier in the session does not count here, and this checkpoint is
written even if you ran one: it could not have covered a change made after it.

Per spec §11 "Session-exit mid-SPINE" HARD: un-VALIDATE'd items MUST NOT be
reported as Done. Re-run the work's verify command before treating any of
these as complete.

## Unvalidated change(s)

(showing up to the last 3 of the $OPEN made after the last validation)

$RECENT_LIST

## Source

- session_id: $SESSION_ID
- transcript: $TRANSCRIPT
- ts: $TS

## Resume

Run the project's verify command (e.g. \`bash tests/run-all.sh\`,
\`pytest\`, \`cargo test\`, etc.), then either delete this file (verified
green) or convert it to a real \`tasks/<slug>-paused.md\` with the
specific verify command and remaining work.
EOF
    } 2>/dev/null \
      && chmod "$(printf '%o' $((0666 & ~0$(umask))))" "$TMP_PAUSED" 2>/dev/null \
      && mv -f "$TMP_PAUSED" "$PAUSED" 2>/dev/null && WROTE=1
    ((WROTE)) || rm -f "$TMP_PAUSED" 2>/dev/null
  fi

  if ((WROTE)); then
    printf '[claudemd] mid-SPINE session-exit: %d unvalidated change(s) after the last validation (%d in this turn); paused.md → %s\n' \
      "$OPEN" "$MUTATIONS" "$PAUSED" >&2
  else
    printf '[claudemd] mid-SPINE session-exit: %d unvalidated change(s) after the last validation (%d in this turn); could not write %s, so no checkpoint lists them\n' \
      "$OPEN" "$MUTATIONS" "$PAUSED" >&2
  fi

  hook_record session-end-check warn \
    "$(jq -cn --argjson m "$MUTATIONS" --argjson o "$OPEN" --arg p "$PAUSED" --argjson w "$WROTE" '{mutations:$m,open:$o,paused:(if $w == 1 then $p else null end)}' 2>/dev/null)" \
    '§11-session-exit' "$SESSION_ID"
fi

# v0.10.1: drop session-extended-read sentinel for this SID. Hook fail-open
# already tolerates missing/leaked sentinels — this is best-effort GC so
# `~/.claude/.claudemd-state/` doesn't accumulate one file per ended session.
if [[ -n "${SESSION_ID:-}" && "$SESSION_ID" != "unknown" ]]; then
  SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c '[:alnum:]-' '_')
  rm -f "$HOME/.claude/.claudemd-state/ext-read-${SAFE_SID}.ts" 2>/dev/null || true
fi

# v0.19.2 B1 — §13.2 batch-review cadence advisory.
#
# Mechanizes the operator-facing OPERATOR.md §13.2 line "every 20 L2+ tasks
# OR 30 days (whichever first) — merge overlapping `rule-candidates-*.md`
# entries, promote eligible candidates per §13.2 gates, prune stale entries."
# Pre-this, the cadence was operator-tracked-in-head; if maintainer skipped
# the manual /claudemd-sampling-audit run, the §13.2/§13.3 feedback loop
# went dark.
#
# L2+ heuristic: this session emitted ≥1 rule-hits row with event in
# {deny, warn, deny-repeat} (always-on signals) plus the opt-in
# {structure-advisory} when its Stop scan is enabled (TRANSCRIPT_STRUCTURE_SCAN=1).
# `mid-spine-advisory` retired with its hook in v0.57.0; the jq arm below still
# counts historical rows, and MID_SPINE_YIELD_SCAN no longer exists.
# In default-OFF posture only the first three fire — sufficient coverage
# (hook denies for §5-hard / §8 / §7 + unvalidated-mutation `warn` from
# this script + same-CI-run retry escalation `deny-repeat` from
# ship-baseline). When operators flip the opt-in scans on, sensitivity
# increases automatically without code change.
#
# Counter file: ~/.claude/.claudemd-state/l2-task-counter. Single-line text
# integer. Increment per L2+ session; at threshold → advisory stderr + reset
# to 0 + audit event. Threshold = 20 per §13.2.
#
# Kill-switch: covered by DISABLE_SESSION_END_CHECK_HOOK at top of file.
# To disable ONLY this sub-feature without disabling the mid-SPINE check:
# DISABLE_BATCH_CADENCE_ADVISORY=1 (sub-flag, env-controlled).
if [[ "${DISABLE_BATCH_CADENCE_ADVISORY:-0}" != "1" ]]; then
  LOG="$HOME/.claude/logs/claudemd.jsonl"
  COUNTER_DIR="$HOME/.claude/.claudemd-state"
  COUNTER_FILE="$COUNTER_DIR/l2-task-counter"
  mkdir -p "$COUNTER_DIR" 2>/dev/null || true
  if [[ -f "$LOG" && -n "${SESSION_ID:-}" && "$SESSION_ID" != "unknown" ]]; then
    # Single jq pass: parse each row, filter to this session_id + L2+ event
    # set, count. -R reads lines, try fromjson catch empty drops malformed.
    # v0.20.1 I2: `tail -n 10000` bound before jq to prevent linear scan cost
    # on oversized rule-hits logs (5MB warn threshold ≈ 50K rows; a single
    # session won't reasonably emit 10K rows, so the tail is a defensive
    # cap with zero behavior change on healthy logs).
    L2_HIT_COUNT=$(tail -n 10000 "$LOG" 2>/dev/null | jq -R -s --arg sid "$SESSION_ID" '
      split("\n")
      | map(select(length > 0) | try fromjson catch empty)
      | map(select(.session_id == $sid))
      | map(select(.event == "deny"
                   or .event == "structure-advisory"
                   or .event == "mid-spine-advisory"
                   or .event == "warn"
                   or .event == "deny-repeat"))
      | length
    ' 2>/dev/null) || L2_HIT_COUNT=0
    [[ "$L2_HIT_COUNT" =~ ^[0-9]+$ ]] || L2_HIT_COUNT=0
    if (( L2_HIT_COUNT > 0 )); then
      # Atomic REPLACE via tmp+mv (2026-08-16 audit CONC-2): the truncating
      # `printf > file` let a concurrent reader see an empty/partial file, and
      # the numeric guard below then coerced that torn read to CUR=0 —
      # discarding the entire accumulated count near the threshold. tmp+mv
      # removes torn reads; it does NOT serialize read-modify-write, so
      # concurrent Stops can still lose individual increments (advisory
      # cadence tolerates undercount-by-races; it does not tolerate resets).
      # Same pattern as session-summary.sh's SUMMARY_FILE write.
      _counter_write() {
        local _v="$1" _tmp="$COUNTER_FILE.tmp.$$"
        ( printf '%d' "$_v" ) > "$_tmp" 2>/dev/null || return 0
        mv -f "$_tmp" "$COUNTER_FILE" 2>/dev/null || rm -f "$_tmp" 2>/dev/null || true
      }
      CUR=0
      if [[ -r "$COUNTER_FILE" ]]; then
        CUR=$(cat "$COUNTER_FILE" 2>/dev/null || printf '0')
        [[ "$CUR" =~ ^[0-9]+$ ]] || CUR=0
      fi
      NEXT=$((CUR + 1))
      # Threshold: 20 L2+ sessions per OPERATOR.md §13.2 cadence. Test-overridable
      # via CLAUDEMD_BATCH_THRESHOLD (positive integer); other values silently
      # ignored, keeping the cadence stable for operators who env-typo.
      THRESHOLD=20
      if [[ "${CLAUDEMD_BATCH_THRESHOLD:-}" =~ ^[1-9][0-9]*$ ]]; then
        THRESHOLD="$CLAUDEMD_BATCH_THRESHOLD"
      fi
      if (( NEXT >= THRESHOLD )); then
        echo "[claudemd] §13.2 batch-review cadence: ${THRESHOLD} L2+ sessions since last reset — recommend \`/claudemd-sampling-audit\` to feed §13.2 promotion gates + \`/claudemd-rules\` to spot demote candidates." >&2
        echo "  Disable advisory: DISABLE_BATCH_CADENCE_ADVISORY=1" >&2
        _counter_write 0
        EXTRA=$(jq -cn --argjson n "$THRESHOLD" '{l2_sessions:$n}' 2>/dev/null) || EXTRA='null'
        hook_record session-end-check batch-cadence-advisory "$EXTRA" '§13.2-batch-review' "$SESSION_ID"
      else
        _counter_write "$NEXT"
      fi
    fi
  fi
fi

exit 0
