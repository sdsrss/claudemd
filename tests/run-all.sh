#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

# Env hygiene (QA ISSUE-001): scrub user-tunable claudemd knobs inherited from
# the invoking shell — 15 suites assert on rule-hits logging / opt-in defaults
# and go red under e.g. DISABLE_RULE_HITS_LOG=1. Suites that need a knob set
# it explicitly per-case.
# shellcheck source=lib/env-hygiene.sh
source "$HERE/lib/env-hygiene.sh" && claudemd_reset_test_env
# Per-suite wall-clock guard (TEST-1): bound each bash suite so one hung test
# can't stall the whole run to the CI job-level kill. node --test gets its own
# per-test timeout below.
# shellcheck source=lib/run-suite.sh
source "$HERE/lib/run-suite.sh"

echo "== Shell hook tests =="
for t in "$HERE"/hooks/*.test.sh; do
  [[ -f "$t" ]] || continue
  echo "-- $(basename "$t")"
  run_suite "$t" || FAIL=$((FAIL + 1))
done

echo "== Node.js script tests =="
# --test-timeout caps EACH test (ms); a single deadlocked test fails instead of
# hanging the run (Node ≥20 default is Infinity).
#
# 180s, not 60s (2026-07-15). The cap must be a multiple of the SLOWEST platform's
# real duration, not the fastest. doctor.test.js is spawn-bound (~15s on Linux CI,
# user≈sys≈8s), and macOS runners are roughly 4x slower at process creation — so it
# lands near 60s there and the old cap had ~zero margin. It went red on the v0.47.2
# and v0.47.3 releases (green on re-run: pure runner-speed luck), then twice in a row
# on v0.47.4 once +5 tests added ~0.5s of local load. Every one of those reported
# `# fail 0` with `failureType: 'testTimeoutFailure'` at `location: …:1:1` — the FILE
# blew the cap, no assertion failed. A real deadlock hangs FOREVER, so 180s catches it
# exactly as well as 60s; the only cost is 2 extra minutes to report a hang that
# already means someone is debugging. This keeps the TEST-1 guard while giving macOS
# the same ~4x margin Linux had. Fixing the cause (cutting doctor.test.js's spawn
# count) stays open — see the deferred item.
if ! node --test --test-timeout=180000 "$HERE"/scripts/*.test.js; then
  FAIL=$((FAIL + 1))
fi

echo "== Integration tests =="
for t in "$HERE"/integration/*.test.sh; do
  [[ -f "$t" ]] || continue
  echo "-- $(basename "$t")"
  run_suite "$t" 300 || FAIL=$((FAIL + 1))
done

if (( FAIL > 0 )); then
  echo "OVERALL: $FAIL suite(s) failed"
  exit 1
fi
echo "OVERALL: all suites passed"
