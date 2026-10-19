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
# The orphan `sleep` this case left alone (it held only /dev/null on fds 1-2)
# is killed with the watchdog since D#434; case 14 covers the fds it kept.
SECONDS=0
OUT=$(CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 5 /bin/echo pipe" 2>/dev/null)
ELAPSED=$SECONDS
if [[ "$OUT" == "pipe" ]] && (( ELAPSED < 4 )); then
  echo "PASS: 13 watchdog does not hold the command-substitution pipe open (${ELAPSED}s of a 5s ceiling)"
else
  echo "FAIL: 13 command substitution blocked ${ELAPSED}s of a 5s ceiling (out '$OUT')"; FAIL=$((FAIL+1))
fi

# Case 14 (D#434): the watchdog's sleep must not outlive the call. Case 13's
# redirect covers fds 1 and 2 only; the orphan `sleep` still held every other
# fd the caller had open. session-start.test.sh waits on fd 3 for the hook's
# detached install (`3>&1`), and on a PATH without timeout/gtimeout each such
# wait lasted the install's full 4 s or 10 s ceiling: suite 58 s against 16 s
# (2026-10-17). Same measurement as case 13, with the pipe on fd 3.
SECONDS=0
OUT=$(CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "set -uo pipefail; source $LIB; platform_timeout 5 /bin/echo fd3 >&2" 2>/dev/null 3>&1)
ELAPSED=$SECONDS
if (( ELAPSED < 4 )); then
  echo "PASS: 14 watchdog sleep does not hold an inherited fd 3 open (${ELAPSED}s of a 5s ceiling)"
else
  echo "FAIL: 14 a reader of fd 3 blocked ${ELAPSED}s of a 5s ceiling"; FAIL=$((FAIL+1))
fi

# Case 15 (D#444): the call returns when the command does, under bash 3.2 too.
# The caller used to `wait` for the watchdog after killing it. A TERM that
# reached the watchdog after its trap was set but before its `wait` could be
# interrupted was held by bash 3.2 until the sleep ended, so a command that
# exits within a millisecond returned after the full ceiling: 17 of 500
# `/bin/true` calls under 3.2.57, 0 of 500 under 5.3 (2026-10-19). Commands
# that outlast the watchdog's startup never hit it (real git: 0 of 300).
# Under the old code 300 calls all pass with odds of about (1-0.03)^300, 1e-4.
# `time` reports sub-second elapsed with BSD and GNU tools alike, and the loop
# stops at the first call that takes a second, so a failure costs one ceiling.
# A first line that is not a number (a job-status message) also fails.
CLAUDEMD_NO_TIMEOUT_BIN=1 bash -c "source $LIB; TIMEFORMAT=%R
  for ((i = 1; i <= 300; i++)); do
    { time platform_timeout 2 /bin/true; } 2>'$TMP/t15'
    read -r t < '$TMP/t15'
    case \$t in [0-9]*.*) ;; *) echo \"call \$i wrote '\$t'\"; exit 1 ;; esac
    [[ \${t%%.*} -ge 1 ]] && { echo \"call \$i took \${t}s of a 2s ceiling\"; exit 1; }
  done; echo done" > "$TMP/o15" 2>&1
OUT=$(cat "$TMP/o15")
if [[ "$OUT" == "done" ]]; then
  echo "PASS: 15 watchdog returns with the command (300 calls of /bin/true, none reached 1s)"
else
  echo "FAIL: 15 $OUT"; FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((15 - FAIL))/15 passed"; exit 1
fi
echo "Tests: 15/15 passed"
