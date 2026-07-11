#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# env-hygiene.test.sh — regression for QA ISSUE-001: user-tunable claudemd env
# vars leaking from the invoking shell (e.g. DISABLE_RULE_HITS_LOG=1 exported
# for manual hook probing per the telemetry-hygiene practice, or the
# maintainer's own TRANSCRIPT_STRUCTURE_SCAN=1 opt-in) broke 15 suites whose
# assertions depend on rule-hits logging being ON. tests/lib/env-hygiene.sh
# must scrub these at run-all entry so `npm test` is deterministic in any
# user shell.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$HERE/../lib/env-hygiene.sh"
RUN_ALL="$HERE/../run-all.sh"
FAIL=0

# Case 1: lib exists and scrubs every family a hook/script reads.
if [[ ! -f "$LIB" ]]; then
  echo "FAIL: 1 tests/lib/env-hygiene.sh missing"
  FAIL=$((FAIL + 1))
else
  OUT=$(
    DISABLE_RULE_HITS_LOG=1 \
    DISABLE_CLAUDEMD_HOOKS=1 \
    DISABLE_BANNED_VOCAB_HOOK=1 \
    TRANSCRIPT_VOCAB_SCAN=1 \
    TRANSCRIPT_STRUCTURE_SCAN=1 \
    MID_SPINE_YIELD_SCAN=1 \
    BANNED_VOCAB_PROSE_SCAN=0 \
    BASH_READONLY_FAST_PATH=0 \
    BASH_SAFETY_INDIRECT_CALL=0 \
    SPEC_RESIDUE_THRESHOLD=1 \
    CLAUDEMD_PATH2_DRY_RUN=1 \
    CLAUDEMD_UPDATE_CHOICE=apply-all \
    bash -c '
      source "$1" && claudemd_reset_test_env
      leaked=""
      for v in DISABLE_RULE_HITS_LOG DISABLE_CLAUDEMD_HOOKS DISABLE_BANNED_VOCAB_HOOK \
               TRANSCRIPT_VOCAB_SCAN TRANSCRIPT_STRUCTURE_SCAN MID_SPINE_YIELD_SCAN \
               BANNED_VOCAB_PROSE_SCAN BASH_READONLY_FAST_PATH BASH_SAFETY_INDIRECT_CALL \
               SPEC_RESIDUE_THRESHOLD CLAUDEMD_PATH2_DRY_RUN CLAUDEMD_UPDATE_CHOICE; do
        [[ -n "${!v:-}" ]] && leaked="$leaked $v"
      done
      echo "leaked:${leaked}"
    ' _ "$LIB"
  )
  if [[ "$OUT" == "leaked:" ]]; then
    echo "PASS: 1 all polluted vars scrubbed"
  else
    echo "FAIL: 1 ($OUT)"
    FAIL=$((FAIL + 1))
  fi
fi

# Case 2: scrub must NOT touch harness/infra vars the suites rely on.
OUT=$(
  CLAUDE_PLUGIN_ROOT=/some/root bash -c '
    source "$1" && claudemd_reset_test_env
    echo "root:${CLAUDE_PLUGIN_ROOT:-}"
  ' _ "$LIB" 2>/dev/null
)
if [[ "$OUT" == "root:/some/root" ]]; then
  echo "PASS: 2 CLAUDE_PLUGIN_ROOT preserved"
else
  echo "FAIL: 2 (got: $OUT)"
  FAIL=$((FAIL + 1))
fi

# Case 3: run-all.sh wires the scrub before any suite runs.
if grep -q 'env-hygiene.sh' "$RUN_ALL" && grep -q 'claudemd_reset_test_env' "$RUN_ALL"; then
  echo "PASS: 3 run-all.sh sources env-hygiene"
else
  echo "FAIL: 3 run-all.sh does not wire env-hygiene"
  FAIL=$((FAIL + 1))
fi

# Case 4: EVERY bash suite self-scrubs — a direct `bash tests/hooks/x.test.sh`
# run must behave like a run-all.sh run (tech-debt follow-up to Case 3, which
# only guards the run-all entry point).
MISSING=""
for suite in "$HERE"/*.test.sh "$HERE"/../integration/*.test.sh; do
  grep -q 'claudemd_reset_test_env' "$suite" || MISSING="$MISSING $(basename "$suite")"
done
if [[ -z "$MISSING" ]]; then
  echo "PASS: 4 all bash suites source env-hygiene"
else
  echo "FAIL: 4 suites missing scrub:$MISSING"
  FAIL=$((FAIL + 1))
fi

# Case 5: behavioral spot check — a rule-hits-asserting suite run DIRECTLY
# under the polluting env must pass (the exact ISSUE-001 shape that broke 15
# suites via run-all, now hit via direct invocation).
if DISABLE_RULE_HITS_LOG=1 TRANSCRIPT_STRUCTURE_SCAN=1 bash "$HERE/rule-hits.test.sh" >/dev/null 2>&1; then
  echo "PASS: 5 rule-hits suite passes under polluted direct invocation"
else
  echo "FAIL: 5 rule-hits suite fails under polluted direct invocation"
  FAIL=$((FAIL + 1))
fi

if (( FAIL > 0 )); then
  echo "env-hygiene: $FAIL case(s) failed"
  exit 1
fi
echo "env-hygiene: PASS"
