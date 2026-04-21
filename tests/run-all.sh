#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

echo "== Shell hook tests =="
for t in "$HERE"/hooks/*.test.sh; do
  [[ -f "$t" ]] || continue
  echo "-- $(basename "$t")"
  bash "$t" || FAIL=$((FAIL + 1))
done

echo "== Node.js script tests =="
if ! node --test "$HERE"/scripts/*.test.js; then
  FAIL=$((FAIL + 1))
fi

echo "== Integration tests =="
for t in "$HERE"/integration/*.test.sh; do
  [[ -f "$t" ]] || continue
  echo "-- $(basename "$t")"
  bash "$t" || FAIL=$((FAIL + 1))
done

if (( FAIL > 0 )); then
  echo "OVERALL: $FAIL suite(s) failed"
  exit 1
fi
echo "OVERALL: all suites passed"
