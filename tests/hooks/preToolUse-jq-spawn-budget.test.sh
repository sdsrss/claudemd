#!/usr/bin/env bash
# preToolUse-jq-spawn-budget.test.sh — how many jq processes the PreToolUse:Bash
# chain actually spawns, per command shape.
#
# 2026-08-29 audit R10-23. Its sibling preToolUse-fastpath-order.test.sh reads
# SOURCE ORDER: it can name the offending line, but it is a proxy for the thing
# anyone actually cares about, and proxies drift from their object. It had
# already been defeated once by a spelling it did not know (`jq -r … <<<`,
# v0.69.1 pre-tag review) and would have been defeated again by this release's
# own refactor, where the extraction became a function call with no `jq` at the
# call site.
#
# This gate measures the object directly: a jq shim first on PATH counts real
# invocations. It cannot be defeated by a spelling, because it does not read the
# source at all.
#
# Measured at the time of writing (per Bash tool call, whole 4-hook chain):
#
#   shape                          before R10-23   after
#   read-only (`git log`)               8            4
#   shell-meta, no trigger              16           5
#   `git commit -m …`                   16           6
#
# The "shell-meta, no trigger" shape is the one the fast-path cannot help and
# the one ordinary agent work is full of (`… | head`, `… >/dev/null`): 条目 12
# fixed the read-only column in the 2026-08-22 round and left this one, because
# every suite drove these hooks either with a read-only command or with a real
# trigger. Nothing exercised the middle.
#
# Network shapes (`git push`) are deliberately NOT probed: ship-baseline-check
# makes a `gh` call there, and a count that depends on the network is a flaky
# gate, not a budget.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")/../../hooks" && pwd)"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
FAIL=0
CASE=0

REAL_JQ=$(command -v jq 2>/dev/null)
if [[ -z "$REAL_JQ" ]]; then
  echo "SKIP: jq not installed — this gate counts jq spawns"
  [[ -n "${CI:-}" ]] && { echo "FAIL: jq must be installed in CI"; exit 1; }
  exit 0
fi

# Probes are synthetic, not sessions (feedback_manual_hook_probe_pollutes_telemetry).
export DISABLE_RULE_HITS_LOG=1

# The shim logs ONE line per invocation and nothing else. The first version
# logged "$*", and the merged filter this release introduced is a MULTI-LINE
# jq program — so a single spawn wrote three lines and the instrument reported
# the optimisation as a 50% regression. A counter whose unit depends on its
# subject's formatting is not a counter.
mkdir -p "$TMP/bin"
{
  echo '#!/usr/bin/env bash'
  echo 'printf "jq-call\n" >> "$JQ_LOG"'
  printf 'exec %s "$@"\n' "$REAL_JQ"
} > "$TMP/bin/jq"
chmod +x "$TMP/bin/jq"

SB="$TMP/sandbox"
mkdir -p "$SB/home/.claude/logs"
git -C "$SB" init -q 2>/dev/null || { echo "FAIL: cannot init probe repo"; exit 1; }
git -C "$SB" config user.email probe@claudemd.local
git -C "$SB" config user.name probe
echo probe > "$SB/README.md"
git -C "$SB" add README.md
git -C "$SB" commit -qm seed 2>/dev/null

# Subject set from source, never a hand-written list: a fifth PreToolUse:Bash
# hook must land inside this budget rather than outside the gate.
SUBJECTS=$(grep -lE 'hook_is_readonly_bash' "$HOOKS_DIR"/*.sh 2>/dev/null | sort)
SUBJECT_COUNT=$(printf '%s\n' "$SUBJECTS" | grep -c . || true)
CASE=$((CASE + 1))
if (( SUBJECT_COUNT >= 4 )); then
  echo "PASS: $CASE subject-set floor ($SUBJECT_COUNT PreToolUse:Bash hooks derived from source)"
else
  echo "FAIL: $CASE subject-set floor (expected >= 4, found $SUBJECT_COUNT) — glob or grep broke"
  FAIL=$((FAIL + 1))
fi

# chain_spawns <hooks-dir> <command> [env-assignment…] — total jq spawns across
# the chain for one Bash tool call.
chain_spawns() {
  local dir="$1" cmd="$2"; shift 2
  local event hook total=0 n
  event=$("$REAL_JQ" -cn --arg c "$cmd" --arg d "$SB" \
    '{tool_name:"Bash", cwd:$d, session_id:"probe", tool_use_id:"probe",
      tool_input:{command:$c}}')
  for hook in "$dir"/*.sh; do
    grep -qE 'hook_is_readonly_bash' "$hook" || continue
    JQ_LOG="$TMP/jq.log"; : > "$JQ_LOG"
    env "$@" JQ_LOG="$JQ_LOG" PATH="$TMP/bin:$PATH" HOME="$SB/home" \
      bash "$hook" <<< "$event" >/dev/null 2>&1
    n=$(grep -c . "$JQ_LOG" 2>/dev/null || true)
    total=$((total + ${n:-0}))
  done
  printf '%s' "$total"
}

READONLY_CMD="git log --oneline -1"
META_CMD="ls /tmp >/dev/null"
COMMIT_CMD="git commit -m 'seed message'"

# ---------------------------------------------------------------- controls ---
# CONTROL 1 (feedback_probe_harness_controls_first): the shim must actually be
# the jq these hooks run. If PATH ordering fails, or the event never reaches a
# parse, every count below is 0 and every budget passes — the fail-open shape
# that made an earlier probe harness certify a gate that could not go red.
CASE=$((CASE + 1))
RO=$(chain_spawns "$HOOKS_DIR" "$READONLY_CMD")
if (( RO >= SUBJECT_COUNT )); then
  echo "PASS: $CASE instrument reaches every hook (read-only chain = $RO spawns, >= $SUBJECT_COUNT)"
else
  echo "FAIL: $CASE instrument premise — read-only chain counted $RO spawns for $SUBJECT_COUNT hooks."
  echo "      Each hook must parse the event at least once; a lower count means the shim"
  echo "      was bypassed and every budget below is vacuous."
  FAIL=$((FAIL + 1))
fi

# CONTROL 2: the counter must MOVE when the thing it measures changes. Disable
# the readonly fast-path and the same command has to cost more — if it does not,
# the number is not measuring the chain.
CASE=$((CASE + 1))
RO_NOFP=$(chain_spawns "$HOOKS_DIR" "$READONLY_CMD" BASH_READONLY_FAST_PATH=0)
if (( RO_NOFP > RO )); then
  echo "PASS: $CASE counter responds to the fast-path ($RO with, $RO_NOFP without)"
else
  echo "FAIL: $CASE control — disabling the fast-path did not raise the count ($RO vs $RO_NOFP);"
  echo "      the instrument is not sensitive to the path it claims to measure."
  FAIL=$((FAIL + 1))
fi

# CONTROL 3: a mutated copy that re-adds one telemetry extraction above the
# trigger must be caught by the budget. A copy of the whole tree, never a
# checkout (feedback_controls_in_a_copy_never_git_checkout).
CASE=$((CASE + 1))
MUT="$TMP/hooks-mut"
cp -a "$HOOKS_DIR" "$MUT"
awk '
  $0 ~ /^CMD="\$HOOK_CMD"$/ && !seen { print; print "hook_read_telemetry_ids \"$EVENT\""; seen = 1; next }
  { print }
' "$MUT/ship-baseline-check.sh" > "$MUT/ship-baseline-check.sh.new" \
  && mv "$MUT/ship-baseline-check.sh.new" "$MUT/ship-baseline-check.sh"
if ! grep -q 'hook_read_telemetry_ids "\$EVENT"' "$MUT/ship-baseline-check.sh"; then
  echo "FAIL: $CASE mutation did NOT apply — the awk anchor is stale, so this control proves nothing"
  FAIL=$((FAIL + 1))
else
  MUT_META=$(chain_spawns "$MUT" "$META_CMD")
  BASE_META=$(chain_spawns "$HOOKS_DIR" "$META_CMD")
  if (( MUT_META > BASE_META )); then
    echo "PASS: $CASE mutation control (re-added extraction: $BASE_META → $MUT_META spawns)"
  else
    echo "FAIL: $CASE mutation control — an extraction added above the trigger did not raise"
    echo "      the count ($BASE_META → $MUT_META). This gate cannot see the regression it exists for."
    FAIL=$((FAIL + 1))
  fi
fi

# ----------------------------------------------------------------- budgets ---
# Ceilings, not equalities: a fifth hook may legitimately raise a chain total by
# its own single first parse. What must not happen is a hook growing a SECOND
# spawn on a path that exits without using it. Raising a number here is a
# deliberate act — state which spawn was added and why it cannot wait until
# after the exit that would have skipped it.
check_budget() {
  local label="$1" cmd="$2" ceiling="$3" got
  got=$(chain_spawns "$HOOKS_DIR" "$cmd")
  CASE=$((CASE + 1))
  if (( got <= ceiling )); then
    echo "PASS: $CASE $label chain = $got jq spawn(s) (ceiling $ceiling)"
  else
    echo "FAIL: $CASE $label chain = $got jq spawn(s), over the ceiling of $ceiling."
    echo "      Command: $cmd"
    echo "      A jq spawn costs ~2 ms and this runs on every Bash tool call. Move the"
    echo "      extraction below the last exit that can be taken without it, or fold it"
    echo "      into hook_read_bash_fields / hook_read_telemetry_ids."
    FAIL=$((FAIL + 1))
  fi
}

# One first parse per hook.
check_budget "read-only" "$READONLY_CMD" "$SUBJECT_COUNT"
# One per hook, plus one: pre-bash-safety-check has no trigger exit — every
# non-read-only command is its subject — so its telemetry read cannot move
# further down. The other three exit at their trigger having spawned once.
check_budget "shell-meta, no trigger" "$META_CMD" $((SUBJECT_COUNT + 1))
# banned-vocab and pre-bash-safety both go past their trigger here.
check_budget "git commit" "$COMMIT_CMD" $((SUBJECT_COUNT + 2))

echo "Tests: $((CASE - FAIL))/$CASE passed"
[[ $FAIL -eq 0 ]] || exit 1
