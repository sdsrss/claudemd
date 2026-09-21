#!/usr/bin/env bash
# smoke.sh — `npm run smoke`. The shortest run that answers "does the plugin
# still work end to end", as distinct from "do the units still pass".
#
# G1a of docs/spec-optimization-roadmap-2026-09-21.md: the 2026-09-21 transcript
# measurement found that the core spec has no concept of "did the feature
# actually run" — `smoke|e2e|end-to-end|integration` appears once in
# ~/.claude/CLAUDE.md, in §8.V3, where it means "sandbox destructive paths
# first" and not "verify the thing works". The cheapest available evidence for a
# completion claim therefore tends to be `tests N/N passed`, which is exactly
# the shape that over-fits a suite. This entry point exists so a claim about
# this repo can cite something else.
#
# Deliberately NOT a second copy of `npm test`: two of the four integration
# suites, chosen because they drive the plugin the way a person does — a fresh
# install through to a working session (user-journey) and install → upgrade →
# uninstall (full-lifecycle). Adding the rest would make this as slow as the
# full run and remove the reason to have it.
#
# Reports how many suites it RAN, and fails when that is not the whole list: a
# glob that matched nothing and a clean pass print the same "0 failed"
# otherwise, which is the instrument-reach rule this repo applies to its hooks.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# One name per line. tests/scripts/smoke-entry.test.js joins this list against
# the files on disk, so a suite renamed out from under it is a red build rather
# than a silently shorter smoke.
SMOKE_SUITES="user-journey
full-lifecycle"

# Same hygiene as run-all.sh: an inherited DISABLE_*/CLAUDEMD_* knob flips these
# suites red with no hint of why.
# shellcheck source=lib/env-hygiene.sh
source "$HERE/lib/env-hygiene.sh" && claudemd_reset_test_env
# shellcheck source=lib/run-suite.sh
source "$HERE/lib/run-suite.sh"

EXPECTED=0
RAN=0
FAILED=0
while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  EXPECTED=$((EXPECTED + 1))
  suite="$HERE/integration/$name.test.sh"
  if [[ ! -f "$suite" ]]; then
    echo "FAIL: smoke suite not found: tests/integration/$name.test.sh"
    FAILED=$((FAILED + 1))
    continue
  fi
  echo "-- $name.test.sh"
  RAN=$((RAN + 1))
  run_suite "$suite" 300 || FAILED=$((FAILED + 1))
done <<EOF
$SMOKE_SUITES
EOF

echo
if [[ "$RAN" -ne "$EXPECTED" ]]; then
  echo "SMOKE: FAILED — ran $RAN of $EXPECTED suite(s); a named suite is missing from tests/integration/"
  exit 1
fi
if [[ "$FAILED" -ne 0 ]]; then
  echo "SMOKE: FAILED — $FAILED of $RAN suite(s) failed"
  printf '%s' "$CLAUDEMD_FAILED_SUITES" | sed 's/^/      /'
  exit 1
fi
echo "SMOKE: $RAN/$EXPECTED suite(s) passed"
exit 0
