#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# timeout-guard.test.sh (roadmap TEST-1) — lock the per-suite wall-clock guard.
# Exercises tests/lib/run-suite.sh's run_suite directly: a deliberately-hanging
# suite must be killed with exit 124 within its cap, and a normal suite must
# pass through untouched. Without this guard one hung test stalls the whole run
# to the CI job-level kill with no diagnostic.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/run-suite.sh
source "$HERE/../lib/run-suite.sh"

PASS=0; FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
ng() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP"' EXIT

# A suite that hangs forever (reads stdin with no EOF is the real-world shape;
# `sleep 30` is the deterministic stand-in).
HANG="$TMP/hang.test.sh"
printf '#!/usr/bin/env bash\nsleep 30\n' > "$HANG"
# A suite that exits 0 immediately.
OKAY="$TMP/ok.test.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$OKAY"
# A suite that fails (exit 1) — the guard must pass the real exit code through.
BAD="$TMP/bad.test.sh"
printf '#!/usr/bin/env bash\nexit 1\n' > "$BAD"

if [[ -z "$CLAUDEMD_SUITE_TIMEOUT_BIN" ]]; then
  # No timeout/gtimeout on this box — the guard degrades to no-cap by design, so
  # the hang case is un-runnable here (it would hang this test). Skip it loudly
  # rather than hang; CI (coreutils on both legs) always has the binary.
  echo "SKIP: no timeout/gtimeout binary — hang case not exercisable on this host"
else
  # Hang → killed with 124, bounded to ~1s (not the 30s sleep).
  START=$(date +%s)
  run_suite "$HANG" 1 >/dev/null 2>&1; rc=$?
  ELAPSED=$(( $(date +%s) - START ))
  if (( rc == 124 )); then ok "hanging suite killed with exit 124"
  else ng "hanging suite rc=$rc (expected 124)"; fi
  if (( ELAPSED <= 5 )); then ok "hang bounded to ${ELAPSED}s (cap enforced, not waited out)"
  else ng "hang took ${ELAPSED}s — cap not enforced"; fi
fi

# Normal suite passes through with its own exit code (guard is transparent).
run_suite "$OKAY" 10 >/dev/null 2>&1; rc=$?
if (( rc == 0 )); then ok "passing suite returns 0 through the guard"
else ng "passing suite rc=$rc (expected 0)"; fi

run_suite "$BAD" 10 >/dev/null 2>&1; rc=$?
if (( rc == 1 )); then ok "failing suite's exit 1 passes through (not masked)"
else ng "failing suite rc=$rc (expected 1)"; fi

# --- the runner must NAME what failed, and keep its output --------------------
# `FAIL` in run-all.sh was a COUNTER and nothing else: a run that printed
# "OVERALL: 1 suite(s) failed" identified no suite, and the node leg's 72 files
# contributed at most 1 to it. Two unreproducible reds in the 0.77.0 and 0.78.0
# release windows are unattributable for exactly this reason — no name, no
# stdout on disk (Round-14 audit REL-M3). run_suite is the only place every bash
# suite passes through, so the accumulator and the capture live here.
NOISY="$TMP/noisy.test.sh"
printf '#!/usr/bin/env bash\necho "marker-stdout"\necho "marker-stderr" >&2\nexit 3\n' > "$NOISY"

LOGDIR="$TMP/suite-logs"
mkdir -p "$LOGDIR"
# shellcheck disable=SC2034  # read by run_suite in tests/lib/run-suite.sh
CLAUDEMD_SUITE_LOG_DIR="$LOGDIR"
CLAUDEMD_FAILED_SUITES=""

run_suite "$NOISY" 10 >/dev/null 2>&1; rc=$?
if (( rc == 3 )); then ok "captured suite's exit 3 passes through the tee"
else ng "captured suite rc=$rc (expected 3)"; fi

case "$CLAUDEMD_FAILED_SUITES" in
  *noisy.test.sh*) ok "failing suite recorded by NAME, not just counted" ;;
  *) ng "failing suite absent from CLAUDEMD_FAILED_SUITES (got: '$CLAUDEMD_FAILED_SUITES')" ;;
esac

run_suite "$OKAY" 10 >/dev/null 2>&1
case "$CLAUDEMD_FAILED_SUITES" in
  *ok.test.sh*) ng "passing suite recorded as a failure" ;;
  *) ok "passing suite is not recorded as a failure" ;;
esac

# Both streams, because a suite's diagnostic is as likely to be on stderr as on
# stdout and the reason this exists is that neither survived the run.
if grep -q marker-stdout "$LOGDIR/noisy.test.sh.log" 2>/dev/null \
  && grep -q marker-stderr "$LOGDIR/noisy.test.sh.log" 2>/dev/null; then
  ok "failing suite's stdout AND stderr land in the log dir"
else
  ng "suite output not captured to $LOGDIR/noisy.test.sh.log"
fi

# A TIMEOUT is a failure with a name too — the shape both unattributable reds
# took (300s cap hit, counter incremented, nothing said which file).
if [[ -n "$CLAUDEMD_SUITE_TIMEOUT_BIN" ]]; then
  CLAUDEMD_FAILED_SUITES=""
  run_suite "$HANG" 1 >/dev/null 2>&1
  case "$CLAUDEMD_FAILED_SUITES" in
    *hang.test.sh*TIMEOUT*) ok "timed-out suite recorded by name and marked TIMEOUT" ;;
    *) ng "timed-out suite not recorded as a named TIMEOUT (got: '$CLAUDEMD_FAILED_SUITES')" ;;
  esac
fi
unset CLAUDEMD_SUITE_LOG_DIR

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
