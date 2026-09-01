#!/usr/bin/env bash
# preToolUse-fastpath-order.test.sh — the readonly fast-path must be the FIRST
# exit, not the fourth.
#
# audit-2026-08-22 条目 12 (carried from the 2026-07-25 round as "P2 遗留原样"):
# three of the four PreToolUse:Bash hooks extracted session_id / tool_use_id /
# cwd ABOVE their `hook_is_readonly_bash` exit. Those fields are telemetry for
# the deny path; a read-only command exits two lines later and never uses them.
# So every `ls`, `cat`, `git log` in a session paid 7 jq spawns across the chain
# (3 + 2 + 2) to fill variables that were then discarded.
#
# Why it survived two audits: each hook's own suite drives it with a command
# that is NOT read-only — otherwise the assertion under test never runs — so
# the wasted work sat on the one path no suite exercises. memory-read-check.sh
# had the right order the whole time, which is what makes this a drift class
# rather than a design choice: four siblings, one of them correct, nothing
# joining them.
#
# This gate derives its subject set from source rather than naming the hooks,
# because a fifth PreToolUse:Bash hook added tomorrow would otherwise inherit
# the same shape unnoticed (feedback_gate_scope_must_cover_its_subject).

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "$0")/../../hooks" && pwd)"
TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT
FAIL=0

# Fields a hook legitimately needs BEFORE it can decide whether the command is
# read-only. Everything else must wait until after the exit.
# `hook_read_bash_fields` is the blessed first parse (hook-common.sh): it yields
# exactly those two fields in one spawn, so it belongs above the exit. Its
# sibling `hook_read_telemetry_ids` yields session/tool_use/cwd and belongs
# below — it is deliberately NOT in this allowlist.
ALLOWED_RE='\.tool_name|\.tool_input\.command|hook_read_bash_fields'
# ANY jq invocation, not one spelling of one. The first version of this gate
# matched `| jq ` and `hook_jq_field` only, and a here-string extraction —
#   SESSION_ID=$(jq -r '.session_id // ""' <<< "$EVENT")
# — walked straight past it, green (v0.69.1 pre-tag review, reproduced with a
# working mutation). That is the repo's own recurring class, a gate narrower
# than its subject, recurring INSIDE the fix for another instance of it. And the
# missed spelling is not exotic: `jq -r '.x' "$file"` is the dominant form in
# hooks/ (session-start-check, session-summary, session-end-check all use it).
#
# The helper names are in here for the same reason: since R10-23 the extraction
# a hook performs is usually a hook-common function, not a visible `jq`. A gate
# that only knows the `jq` spelling would go green on
#   hook_read_telemetry_ids "$EVENT"
# moved above the exit — one function call that spawns exactly the jq this gate
# exists to keep out. The regex has to name every spelling that reaches jq, and
# case 5 below mutates with this one to prove it does.
EXTRACT_RE='(^|[^a-zA-Z_/-])jq[[:space:]]|hook_jq_field|hook_read_bash_fields|hook_read_telemetry_ids'
# Presence probes are not extractions — they spawn nothing and gate everything
# below them, so they legitimately precede the fast-path.
NOT_EXTRACT_RE='hook_require_jq|command -v jq'
FASTPATH_RE='hook_is_readonly_bash'

# check_dir <hooks-dir> — prints one line per violation, returns 1 if any.
# Also returns 1 when a PREMISE fails (no fast-path line, or no allowed
# extraction above it), so a broken grep reads as red rather than as clean.
check_dir() {
  local dir="$1" f rel fp_line before violations=0 allowed_seen
  for f in "$dir"/*.sh; do
    [[ -f "$f" ]] || continue
    grep -q "$FASTPATH_RE" "$f" || continue          # not a fast-path hook
    rel=$(basename "$f")

    fp_line=$(grep -n "$FASTPATH_RE \"\$CMD\"" "$f" | head -1 | cut -d: -f1)
    if [[ -z "$fp_line" ]]; then
      echo "$rel: PREMISE — no \`$FASTPATH_RE \"\$CMD\"\` line found; this gate cannot see the exit it guards"
      violations=$((violations + 1))
      continue
    fi

    before=$(head -n "$fp_line" "$f" | grep -nE "$EXTRACT_RE")
    allowed_seen=0
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      local content="${line#*:}"
      # Strip a trailing comment and skip whole-line comments before matching,
      # so a comment MENTIONING .session_id is not a false RED and a trailing
      # `# … .tool_name …` cannot excuse a real extraction (pre-tag review N2).
      local code="${content%%#*}"
      [[ -n "${code//[[:space:]]/}" ]] || continue
      printf '%s' "$code" | grep -qE "$NOT_EXTRACT_RE" && continue
      printf '%s' "$code" | grep -qE "$EXTRACT_RE" || continue
      if printf '%s' "$code" | grep -qE "$ALLOWED_RE"; then
        allowed_seen=$((allowed_seen + 1))
      else
        echo "$rel:${line%%:*} (above the fast-path exit at :$fp_line) — $content"
        violations=$((violations + 1))
      fi
    done <<< "$before"

    # Premise: a hook that reaches the fast-path must have extracted the
    # command first. Zero allowed extractions means EXTRACT_RE stopped
    # matching this file's spelling and every violation below it went unseen.
    if (( allowed_seen == 0 )); then
      echo "$rel: PREMISE — no tool_name/command extraction matched above :$fp_line; EXTRACT_RE is stale"
      violations=$((violations + 1))
    fi
  done
  (( violations == 0 ))
}

# Subject-set floor. Four hooks call hook_is_readonly_bash today; a derivation
# that silently returns fewer means the glob or the grep broke, and an empty
# loop passes every assertion in it.
SUBJECTS=$(grep -lE "$FASTPATH_RE" "$HOOKS_DIR"/*.sh 2>/dev/null | wc -l | tr -d ' ')
if (( SUBJECTS >= 4 )); then
  echo "PASS: 1 subject-set floor ($SUBJECTS PreToolUse:Bash hooks derived from source)"
else
  echo "FAIL: 1 subject-set floor (expected >= 4, found $SUBJECTS) — glob or grep broke"
  FAIL=$((FAIL + 1))
fi

# CONTROL FIRST (feedback_probe_harness_controls_first): a harness that cannot
# go red proves nothing about the green below it. Run the check against a full
# copy of hooks/ with one extraction moved back above the exit — the exact
# regression this gate exists to catch. A copy, never a git checkout
# (feedback_controls_in_a_copy_never_git_checkout): the tree has uncommitted
# work and a checkout would take it with the mutation.
# Run one mutation shape end to end: inject the line above the exit, confirm it
# landed, then require check_dir to name it. TWO shapes, because the first
# version of this gate caught only the pipe form and the pre-tag review defeated
# it with the here-string form — the spelling that dominates hooks/.
CASE=2
control_shape() {
  local label="$1" inject="$2" dir="$TMP/hooks-$CASE"
  # The token that must show up in the mutated file AND in the gate's complaint.
  # Parameterised because the helper spelling (case 5) carries no `session_id`
  # substring — asserting on a hardcoded token would have reported "mutation did
  # not apply" for a mutation that applied fine, i.e. a control that cannot fail
  # for the reason it claims.
  local token="${3:-session_id}"
  rm -rf "$dir"
  cp -a "$HOOKS_DIR" "$dir" || { echo "FAIL: $CASE cannot copy hooks"; FAIL=$((FAIL + 1)); return; }
  local mut="$dir/banned-vocab-check.sh"
  awk -v ins="$inject" '
    $0 ~ /hook_is_readonly_bash "\$CMD"/ && !seen { print ins; seen = 1 }
    { print }
  ' "$mut" > "$mut.new" && mv "$mut.new" "$mut"

  if ! grep -B1 "$FASTPATH_RE \"\$CMD\"" "$mut" | grep -q "$token"; then
    echo "FAIL: $CASE [$label] mutation did NOT apply — awk anchor is stale, so the control proves nothing"
    FAIL=$((FAIL + 1)); CASE=$((CASE + 1)); return
  fi
  if check_dir "$dir" > "$dir.out" 2>&1; then
    echo "FAIL: $CASE [$label] control — the mutated copy PASSED; this gate cannot see this spelling"
    FAIL=$((FAIL + 1))
  elif grep -q "banned-vocab-check.sh.*$token" "$dir.out"; then
    echo "PASS: $CASE [$label] control fails on the mutation, naming the offending line"
  else
    echo "FAIL: $CASE [$label] control failed but did not name the mutated line (got: $(head -1 "$dir.out"))"
    FAIL=$((FAIL + 1))
  fi
  CASE=$((CASE + 1))
}

control_shape "pipe into jq" \
  'SESSION_ID=$(printf '"'"'%s'"'"' "$EVENT" | jq -r '"'"'.session_id // ""'"'"' 2>/dev/null)'
control_shape "here-string into jq" \
  'SESSION_ID=$(jq -r '"'"'.session_id // ""'"'"' <<< "$EVENT" 2>/dev/null)'
control_shape "jq reading a file argument" \
  'SESSION_ID=$(jq -r '"'"'.session_id // ""'"'"' "$SOME_FILE" 2>/dev/null)'
# The spelling that exists today: a hook-common helper that spawns jq without
# the string `jq` appearing at the call site (2026-08-29 audit R10-23).
control_shape "telemetry helper call" \
  'hook_read_telemetry_ids "$EVENT"' \
  'hook_read_telemetry_ids'

# The real assertion.
if check_dir "$HOOKS_DIR" > "$TMP/real.out" 2>&1; then
  echo "PASS: $CASE no jq extraction sits above the readonly fast-path exit"
else
  echo "FAIL: $CASE extraction(s) above the fast-path exit — a read-only Bash call pays for fields it discards:"
  sed 's/^/       /' "$TMP/real.out"
  echo "       Move them below the \`hook_is_readonly_bash\` exit (memory-read-check.sh is the reference shape)."
  FAIL=$((FAIL + 1))
fi

TOTAL=$CASE
echo "Tests: $((TOTAL - FAIL))/$TOTAL passed"
[[ $FAIL -eq 0 ]] || exit 1
