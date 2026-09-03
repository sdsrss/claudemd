# shellcheck shell=bash
# assert.sh — one assertion vocabulary for bash suites (audit R11-27).
#
# 14 of 28 hook suites each wrote their own `ok`/`pass`/`fail`, and they did not
# agree: `contract.test.sh`'s ok() increments a PASS counter, `hook-budget.test.sh`'s
# pass() increments nothing and only failures are counted. Both end with a
# "Tests: N/M passed" line, so the two Ns mean different things and the totals
# cannot be summed across files — which is exactly what a run-wide green/red
# verdict does.
#
# Adoption is deliberately NOT a big-bang migration (a 14-file sweep of working
# suites buys drift risk, not coverage): NEW suites must source this, existing
# ones migrate when they are already being edited. tests/scripts/assert-helper-
# consumers.test.js holds the shrinking legacy list and fails on a new private
# helper.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/../lib/assert.sh"
#   ok   "name"                     # a passing case
#   ng   "name (why)"               # a failing case
#   assert_eq          "name" "$expected" "$actual"
#   assert_contains     "name" "needle" "$haystack"
#   assert_not_contains "name" "needle" "$haystack"
#   assert_status       "name" 2 "$rc"
#   claudemd_assert_summary         # prints the tally, returns 1 if any failed
#
# Every helper counts. A pass that increments nothing is the drift above.

CLAUDEMD_ASSERT_PASS=0
CLAUDEMD_ASSERT_FAIL=0

ok() {
  echo "PASS: $1"
  CLAUDEMD_ASSERT_PASS=$((CLAUDEMD_ASSERT_PASS + 1))
}

ng() {
  echo "FAIL: $1"
  CLAUDEMD_ASSERT_FAIL=$((CLAUDEMD_ASSERT_FAIL + 1))
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    ok "$name"
  else
    ng "$name (expected '$expected', got '$actual')"
  fi
}

assert_contains() {
  local name="$1" needle="$2" hay="$3"
  if [[ "$hay" == *"$needle"* ]]; then
    ok "$name"
  else
    ng "$name (expected to contain '$needle', got: $hay)"
  fi
}

assert_not_contains() {
  local name="$1" needle="$2" hay="$3"
  if [[ "$hay" != *"$needle"* ]]; then
    ok "$name"
  else
    ng "$name (expected NOT to contain '$needle', got: $hay)"
  fi
}

assert_status() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    ok "$name"
  else
    ng "$name (expected exit $expected, got $actual)"
  fi
}

# A suite that asserted nothing must not report success: "0/0 passed" and "all
# green" are the same output otherwise, and a suite whose setup silently
# short-circuits produces exactly that (memory: a gate must report its
# cardinality). SKIP paths exit before reaching this line, deliberately.
claudemd_assert_summary() {
  local total=$((CLAUDEMD_ASSERT_PASS + CLAUDEMD_ASSERT_FAIL))
  if (( total == 0 )); then
    echo "FAIL: suite ran no assertions — nothing was verified"
    return 1
  fi
  echo "Tests: ${CLAUDEMD_ASSERT_PASS}/${total} passed"
  (( CLAUDEMD_ASSERT_FAIL == 0 ))
}
