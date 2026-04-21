#!/usr/bin/env bash
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/platform.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAIL=0

touch "$TMP/f1"
sleep 1
touch "$TMP/f2"

# Case 1: platform_stat_mtime returns epoch
MTIME=$(bash -c "source $LIB; platform_stat_mtime '$TMP/f1'")
[[ "$MTIME" =~ ^[0-9]+$ ]] && echo "PASS: 1 mtime numeric" || { echo "FAIL: 1 (got $MTIME)"; FAIL=$((FAIL+1)); }

# Case 2: f2 newer than f1 (mtime should be greater)
M1=$(bash -c "source $LIB; platform_stat_mtime '$TMP/f1'")
M2=$(bash -c "source $LIB; platform_stat_mtime '$TMP/f2'")
(( M2 > M1 )) && echo "PASS: 2 ordering" || { echo "FAIL: 2 (m1=$M1 m2=$M2)"; FAIL=$((FAIL+1)); }

# Case 3: platform_find_newer lists f2 but not f1
REF="$TMP/f1"
OUT=$(bash -c "source $LIB; platform_find_newer '$TMP' '$REF'")
echo "$OUT" | grep -q "f2" && echo "PASS: 3 find_newer lists f2" || { echo "FAIL: 3 (got: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((3 - FAIL))/3 passed"; exit 1
fi
echo "Tests: 3/3 passed"
