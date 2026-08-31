#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

# Trigger-view single source + CONSUMER ENUMERATION (2026-07-27 audit, H1/M1/M2).
#
# Why enumeration and not a list of names: v0.58.0 extracted hook_flatten_cmd /
# hook_strip_heredoc_bodies into hook-common.sh and rewired two of the three
# hooks whose trigger regex anchors on a shell separator. banned-vocab-check.sh
# was left on `tr '\n' ' '` while its comment still claimed parity with both
# siblings — a newline became a SPACE, so `git commit` on line 2+ sat at neither
# `^` nor `[;&|]` and the §10-V gate declined silently. A test that named the
# consumers would have been written against the same list that was already wrong.
# This one derives the consumer set from the source: any hook carrying the
# segment-anchor idiom must build its trigger input through hook_trigger_view.

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$HERE/../../hooks" && pwd)"
LIB="$HOOKS_DIR/lib/hook-common.sh"
FAIL=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

view() { printf '%s' "$1" | bash -c "source '$LIB'; hook_trigger_view"; }

assert_contains() {
  local name="$1" needle="$2" hay="$3"
  [[ "$hay" == *"$needle"* ]] && pass "$name" || fail "$name (expected to contain '$needle', got: $hay)"
}
assert_not_contains() {
  local name="$1" needle="$2" hay="$3"
  [[ "$hay" != *"$needle"* ]] && pass "$name" || fail "$name (expected NOT to contain '$needle', got: $hay)"
}

# ---------------------------------------------------------------- library view
# 1. A newline is a real command separator, not a space (the H1 defect).
assert_contains "1 newline becomes a ';' separator" ";git commit" \
  "$(view 'npm test
git commit -m "x"')"

# 2. Quoted bodies are emptied AFTER flattening, so a newline inside an -m
#    payload cannot synthesize a separator that fires the trigger on prose
#    (M1: memory-read-check flattened but never stripped quotes, and denied its
#    own probe commands during the audit).
QUOTED_VIEW="$(view 'git commit -m "fix parser
deploy notes are none"')"
assert_not_contains "2 quoted body content is dropped" "deploy" "$QUOTED_VIEW"
assert_contains "2b quoted-body drop keeps the real invocation" "git commit" "$QUOTED_VIEW"

# 3. Heredoc bodies are blanked BEFORE flattening (order is load-bearing: the
#    flatten manufactures the very separator the trigger anchors on).
assert_not_contains "3 heredoc body is not handed to the trigger" "git commit" \
  "$(view 'cat <<EOF
git commit -m "x"
EOF')"

# 4. A real line continuation still joins.
assert_contains "4 trailing backslash joins the continued line" "git push" \
  "$(view 'git \
push origin main')"

# 5. An ESCAPED backslash is a literal backslash, so the newline after it is a
#    REAL separator — bash runs both commands (M2). Pre-fix awk stripped one
#    backslash unconditionally and joined, hiding the push from both the §7 and
#    §11 gates.
assert_contains "5 escaped backslash does not swallow the next command" ";git push" \
  "$(printf 'echo a\\\\\ngit push origin main' | bash -c "source '$LIB'; hook_trigger_view")"

# ------------------------------------------------------------ consumer set
# Derive, do not name. The floor assertion is deliberate: an empty or shrunken
# consumer set must fail loudly rather than vacuously pass (same lesson as the
# run-all.sh empty-glob finding in the same audit).
ANCHOR='(^|[[:space:]]*[;&|]'
# `mapfile` is bash 4+; macOS ships /bin/bash 3.2 and this suite runs there
# (feedback_macos_shell_portability). v0.62.1 shipped the mapfile form and the
# macOS leg went red on `mapfile: command not found` → `CONSUMERS: unbound
# variable`. The CI construct-gate scanned hooks/ only, so tests/ was outside it.
CONSUMERS=()
while IFS= read -r _c; do
  [[ -n "$_c" ]] && CONSUMERS+=("$_c")
done < <(grep -l -F "$ANCHOR" "$HOOKS_DIR"/*.sh 2>/dev/null | sort)

if (( ${#CONSUMERS[@]} >= 3 )); then
  pass "6 consumer set floor (${#CONSUMERS[@]} segment-anchored hooks found)"
else
  fail "6 consumer set floor (expected >= 3 segment-anchored hooks, found ${#CONSUMERS[@]})"
fi

for c in ${CONSUMERS[@]+"${CONSUMERS[@]}"}; do
  base=$(basename "$c")
  if grep -q 'hook_trigger_view' "$c"; then
    pass "7 $base builds its trigger input via hook_trigger_view"
  else
    fail "7 $base does NOT use hook_trigger_view (segment-anchored hook off the shared recipe)"
  fi
done

# No consumer may keep a private flatten spelling — the exact drift H1 found.
# Comment lines are excluded before matching: the fix commit documents the old
# spelling in prose, and a detector that matches its own subject's description
# fires on the very files it just fixed (feedback_self_referential_marker_regex).
for c in ${CONSUMERS[@]+"${CONSUMERS[@]}"}; do
  base=$(basename "$c")
  if grep -vE '^[[:space:]]*#' "$c" | grep -qE "tr '\\\\n' ' '"; then
    fail "8 $base still carries a private \`tr '\\n' ' '\` flatten"
  else
    pass "8 $base carries no private flatten spelling"
  fi
done

# ------------------------------------------------------------ live cross-gate
# The behavioral end of H1: the same multi-line shape must reach every
# segment-anchored gate, not just the two that were rewired.
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
FIX=$(mktemp); trap 'rm -rf "$TMP_HOME" "$FIX"' EXIT

printf '%s\n' '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"npm test\ngit commit -m \"significantly faster\""},"cwd":"/tmp"}' > "$FIX"
OUT=$(HOME="$TMP_HOME" DISABLE_RULE_HITS_LOG=1 bash "$HOOKS_DIR/banned-vocab-check.sh" < "$FIX" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] \
  && pass "9 multi-line git commit with banned vocab denies (§10-V gate sees line 2)" \
  || fail "9 multi-line git commit with banned vocab NOT denied (got: ${DEC:-<none>})"

# FP guard, unchanged from banned-vocab.test.sh case 23: the same text inside a
# heredoc body is data, not an invocation. A flatten-only fix would deny this.
printf '%s\n' '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"cat <<EOF\ngit commit -m \"significantly\"\nEOF"},"cwd":"/tmp"}' > "$FIX"
OUT=$(HOME="$TMP_HOME" DISABLE_RULE_HITS_LOG=1 bash "$HOOKS_DIR/banned-vocab-check.sh" < "$FIX" 2>&1)
[[ -z "$OUT" ]] \
  && pass "10 heredoc body with banned vocab still passes (FP guard held)" \
  || fail "10 heredoc body with banned vocab denied (FP regression): $OUT"

# ------------------------------------------- git global flags (R10-05)
# Second consumer set, same enumeration discipline: any hook whose trigger keys
# on a git SUBCOMMAND must splice in HOOK_GIT_GLOBAL_FLAGS. Pre-fix all three
# required `git` and the verb to be adjacent, so `git -C /repo push` — pushing a
# repo the shell is not cd'd into — cleared the §7 red-CI gate, the §11
# memory-read gate and the §10-V commit scan in one move, with no bypass row.
# The §8 side had already solved this (NPX_GLOBAL_FLAGS) and never shared it;
# not sharing is what this gate is here to stop repeating.
#
# The subject pattern deliberately matches the BROKEN spelling too (`git` …
# `[[:space:]]+push`), so reverting a hook to a private regex keeps it in the
# set and turns the requirement below red instead of quietly leaving the set.
GIT_SUBJECT='git[^;]*\[\[:space:\]\]\+(push|commit)'
#
# `grep -E … >/dev/null`, never `grep -qE`, on the downstream half of a pipe:
# under `set -o pipefail`, -q exits at the FIRST match and SIGPIPEs the upstream
# grep, so the pipeline's status depends on whether the upstream had already
# finished writing. This derivation returned 3 consumers standalone and 1 under
# run-all.sh from the same tree before the -q came out. Reading to EOF costs
# microseconds on a 400-line file and makes the result deterministic.
GIT_CONSUMERS=()
while IFS= read -r _c; do
  [[ -n "$_c" ]] && GIT_CONSUMERS+=("$_c")
done < <(for f in "$HOOKS_DIR"/*.sh; do
           grep -vE '^[[:space:]]*#' "$f" | grep -E "$GIT_SUBJECT" >/dev/null && echo "$f"
         done | sort)

if (( ${#GIT_CONSUMERS[@]} >= 3 )); then
  pass "11 git-trigger consumer set floor (${#GIT_CONSUMERS[@]} hooks key on a git subcommand)"
else
  fail "11 git-trigger consumer set floor (expected >= 3, found ${#GIT_CONSUMERS[@]})"
fi

for c in ${GIT_CONSUMERS[@]+"${GIT_CONSUMERS[@]}"}; do
  base=$(basename "$c")
  if grep -vE '^[[:space:]]*#' "$c" | grep -F 'HOOK_GIT_GLOBAL_FLAGS' >/dev/null; then
    pass "12 $base splices in HOOK_GIT_GLOBAL_FLAGS"
  else
    fail "12 $base keys on a git subcommand WITHOUT the shared global-flag group"
  fi
done

# The fragment itself: it must admit git's global options and must NOT admit a
# standalone bare word (or `git status push` would read as a push).
GFLAGS=$(bash -c "source '$LIB'; printf '%s' \"\$HOOK_GIT_GLOBAL_FLAGS\"")
# Feed the regex what PRODUCTION feeds it: hook_trigger_view output, not the raw
# string. The first version of this helper matched on the raw command, and
# hook_trigger_view appends `;` — so an argument-less `git push` matched here and
# NOT in the hook, and this case certified a shape the §7 gate never saw
# (0.70.0 pre-tag review, HIGH-1). A gate whose input shape differs from its
# subject's proves nothing about the subject; that is the class this whole round
# is about.
gmatch() {
  printf '%s' "$1" | bash -c "source '$LIB'; hook_trigger_view" \
    | grep -E "(^|[[:space:]]*[;&|]+[[:space:]]*)git${GFLAGS}[[:space:]]+push([[:space:]]|[;&|]|\$)" >/dev/null
}
for shape in 'git -C /repo push origin main' 'git --git-dir=/r/.git push' \
             'git -c user.name=x push' 'git --no-pager push' \
             'npm test && git -C /repo push' \
             'git push' 'git -C /repo push' 'git push --force'; do
  gmatch "$shape" && pass "13 matches: $shape" || fail "13 does NOT match: $shape"
done
for shape in 'git status push' 'echo git push-notes' 'git-push-helper run'; do
  gmatch "$shape" && fail "14 FP — matched: $shape" || pass "14 correctly ignores: $shape"
done

# Live cross-gate: the §10-V scan must see a `-C`-form commit.
printf '%s\n' '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git -C /repo commit -m \"significantly faster\""},"cwd":"/tmp"}' > "$FIX"
OUT=$(HOME="$TMP_HOME" DISABLE_RULE_HITS_LOG=1 bash "$HOOKS_DIR/banned-vocab-check.sh" < "$FIX" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] \
  && pass "15 git -C commit with banned vocab denies" \
  || fail "15 git -C commit with banned vocab NOT denied (got: ${DEC:-<none>})"

# FP guard for the same arm: a bare word after `git` is a different subcommand.
printf '%s\n' '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git log --oneline --grep=\"significantly faster\" -- ."},"cwd":"/tmp"}' > "$FIX"
OUT=$(HOME="$TMP_HOME" DISABLE_RULE_HITS_LOG=1 bash "$HOOKS_DIR/banned-vocab-check.sh" < "$FIX" 2>&1)
[[ -z "$OUT" ]] \
  && pass "16 git log with the same words still passes (FP guard)" \
  || fail "16 git log denied (FP regression): $OUT"

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
