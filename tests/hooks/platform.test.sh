#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/platform.sh"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP"' EXIT
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

# Case 4/5 (v0.23.11): helpers must not crash under `set -u` when called with no
# arg — `local f="$1"` was an unbound-variable abort; now `${1:-}` + guard → rc 1.
bash -c "set -uo pipefail; source $LIB; platform_stat_mtime" >/dev/null 2>&1
[[ $? -eq 1 ]] && echo "PASS: 4 stat_mtime no-arg returns 1 (no set -u crash)" || { echo "FAIL: 4 stat_mtime no-arg"; FAIL=$((FAIL+1)); }
bash -c "set -uo pipefail; source $LIB; platform_find_newer" >/dev/null 2>&1
[[ $? -eq 1 ]] && echo "PASS: 5 find_newer no-arg returns 1 (no set -u crash)" || { echo "FAIL: 5 find_newer no-arg"; FAIL=$((FAIL+1)); }

# Case 6/7/8/9 (v0.23.11): platform_timeout — survives without coreutils.
# 6: fast command returns its stdout + rc 0.
OUT=$(bash -c "set -uo pipefail; source $LIB; platform_timeout 3 echo hi")
[[ "$OUT" == "hi" ]] && echo "PASS: 6 platform_timeout passes through output" || { echo "FAIL: 6 (got '$OUT')"; FAIL=$((FAIL+1)); }
# 7: slow command hits ceiling → rc 124 (GNU-timeout convention).
bash -c "set -uo pipefail; source $LIB; platform_timeout 1 sleep 5" >/dev/null 2>&1
[[ $? -eq 124 ]] && echo "PASS: 7 platform_timeout enforces ceiling (rc 124)" || { echo "FAIL: 7 ceiling not enforced"; FAIL=$((FAIL+1)); }
# 8: WATCHDOG path (CLAUDEMD_NO_TIMEOUT_BIN=1 forces it; sleep still available,
# as on stock macOS where coreutils' timeout is absent but /bin/sleep exists) —
# fast command still passes through.
OUT=$(CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 3 echo wd")
[[ "$OUT" == "wd" ]] && echo "PASS: 8 watchdog fallback passes output without coreutils" || { echo "FAIL: 8 (got '$OUT')"; FAIL=$((FAIL+1)); }
# 9: watchdog enforces ceiling without coreutils.
CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 1 sleep 5" >/dev/null 2>&1
[[ $? -eq 124 ]] && echo "PASS: 9 watchdog enforces ceiling (rc 124) without coreutils" || { echo "FAIL: 9 watchdog ceiling"; FAIL=$((FAIL+1)); }
# 10: no-arg guard.
bash -c "set -uo pipefail; source $LIB; platform_timeout" >/dev/null 2>&1
[[ $? -eq 1 ]] && echo "PASS: 10 platform_timeout no-arg returns 1" || { echo "FAIL: 10 no-arg"; FAIL=$((FAIL+1)); }
# 11 (re-audit): watchdog PRESERVES the command's real exit code — a non-zero
# exit must NOT be collapsed to 124 (124 is reserved for an actual timeout kill).
CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 5 sh -c 'exit 7'" >/dev/null 2>&1
[[ $? -eq 7 ]] && echo "PASS: 11 watchdog preserves real exit code (7, not 124)" || { echo "FAIL: 11 exit code collapsed (got $?)"; FAIL=$((FAIL+1)); }
# 12: watchdog success returns 0.
CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 5 true" >/dev/null 2>&1
[[ $? -eq 0 ]] && echo "PASS: 12 watchdog success returns 0" || { echo "FAIL: 12 (got $?)"; FAIL=$((FAIL+1)); }

# Case 13 (round-16 audit 6.8): the watchdog must not hold the write end of a
# command-substitution pipe.
#
# `$( )` returns only when EVERY write end of its pipe closes. The watchdog
# subshell inherited fd 1, so once the wrapped command finished, the orphan
# `sleep` kept the pipe open and the substitution blocked until the full
# ceiling -- turning a bound into a floor. Of the five production call sites,
# the three the bug can REACH are the command substitutions, and all three wrap
# an EXTERNAL binary (session-start-check.sh:464 git ls-remote;
# ship-baseline-check.sh:185 and :187 gh run list). The other two --
# session-start-check.sh:722 and hook-common.sh:531, both `node install.js` --
# redirect into a log file, so nothing is waiting on a pipe and they were never
# affected. With an external binary this is not a race at all:
# measured 30/30 blocked with a MINIMUM of 2008ms against a 2s ceiling. The
# audit's own production medians land on the ceilings exactly -- 3212ms for
# SessionStart (ceiling 3) and 2213ms for ship-baseline (ceiling 2).
#
# The bound is the function's OWN ceiling rather than a machine-tuned number:
# pre-fix the elapsed time is >= SECS by construction, post-fix it is the
# runtime of /bin/echo (measured 2008ms -> 8ms). `SECONDS` is used instead of
# `date +%s%N` because BSD date has no %N and this suite runs on the macOS leg;
# one-second granularity is ample across a 5000ms-to-8ms gap.
#
# What this does NOT assert: that the orphan `sleep` is gone. It still lives
# out the ceiling holding /dev/null -- harmless to the caller, and killing it
# would need new control flow in a bash-3.2-safe function.
SECONDS=0
OUT=$(CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 5 /bin/echo pipe" 2>/dev/null)
ELAPSED=$SECONDS
if [[ "$OUT" == "pipe" ]] && (( ELAPSED < 4 )); then
  echo "PASS: 13 watchdog does not hold the command-substitution pipe open (${ELAPSED}s of a 5s ceiling)"
else
  echo "FAIL: 13 command substitution blocked ${ELAPSED}s of a 5s ceiling (out '$OUT')"; FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((13 - FAIL))/13 passed"; exit 1
fi
echo "Tests: 13/13 passed"
