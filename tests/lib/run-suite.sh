# shellcheck shell=bash
# run-suite.sh — shared per-suite runner with a wall-clock guard (roadmap TEST-1).
#
# A hung test (a hook that reads stdin and never gets EOF, a blocking spawnSync,
# a deadlocked worker) otherwise hangs the whole run until the CI runner's
# job-level kill — minutes of stall with no diagnostic pointing at the culprit.
# `run_suite` caps each bash suite's wall-clock and prints which one blew it.
#
# Portability: `timeout` is GNU coreutils. macOS provides it via coreutils
# (gnubin on PATH in CI) or as `gtimeout`. When neither is present (a bare BSD
# box with no coreutils) we degrade to running without a cap — the runner must
# never BREAK for lack of a timeout binary, only lose the guard.
#
# Sourced by tests/run-all.sh and tests/hooks/timeout-guard.test.sh (which
# exercises run_suite directly against a deliberately-hanging suite).

CLAUDEMD_SUITE_TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  CLAUDEMD_SUITE_TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  CLAUDEMD_SUITE_TIMEOUT_BIN="gtimeout"
fi

# Names of the suites that failed, one per line, in the order they failed.
#
# run-all.sh's `FAIL` is a COUNTER and was the only record: a run printing
# "OVERALL: 1 suite(s) failed" named no file, and the node leg's 72 test files
# could contribute at most 1 to it. Two reds in the 0.77.0 and 0.78.0 release
# windows are permanently unattributable for that reason — by the time anyone
# looked, the scrollback was gone and nothing had been written down (Round-14
# audit REL-M3). Every bash suite goes through run_suite, so the accumulator
# belongs here rather than at each of the three call sites.
CLAUDEMD_FAILED_SUITES=""

# record_suite_failure <label>
#   Appends one line to CLAUDEMD_FAILED_SUITES. Exposed separately so run-all.sh
#   can register the legs that are NOT suites (the node leg, the static gates).
record_suite_failure() {
  CLAUDEMD_FAILED_SUITES="${CLAUDEMD_FAILED_SUITES}$1"$'\n'
}

# run_suite <suite-file> [timeout-seconds]
#   Runs `bash <suite-file>` under a wall-clock cap (default 120s). Returns the
#   suite's own exit code, or 124 on timeout after printing a TIMEOUT line.
#
#   When CLAUDEMD_SUITE_LOG_DIR is set, the suite's stdout AND stderr are teed
#   into "$CLAUDEMD_SUITE_LOG_DIR/<basename>.log" as well as passed through.
#   Both streams, because a suite's own diagnostic is as often on stderr as on
#   stdout, and the point of the capture is that neither survived the run.
run_suite() {
  local suite="$1" secs="${2:-120}" rc name log
  name=$(basename "$suite")
  log=""
  [[ -n "${CLAUDEMD_SUITE_LOG_DIR:-}" ]] && log="$CLAUDEMD_SUITE_LOG_DIR/$name.log"
  if [[ -n "$CLAUDEMD_SUITE_TIMEOUT_BIN" ]]; then
    if [[ -n "$log" ]]; then
      # PIPESTATUS[0], not $?: with a pipe, `$?` is TEE's status and every
      # failing suite would read as rc=0 — the gate would then report a green
      # run for a red suite, which is worse than the missing name it replaces.
      "$CLAUDEMD_SUITE_TIMEOUT_BIN" "$secs" bash "$suite" 2>&1 | tee "$log"
      rc=${PIPESTATUS[0]}
    else
      "$CLAUDEMD_SUITE_TIMEOUT_BIN" "$secs" bash "$suite"
      rc=$?
    fi
    if (( rc == 124 )); then
      echo "TIMEOUT: $name exceeded ${secs}s (killed)"
    fi
  else
    if [[ -n "$log" ]]; then
      bash "$suite" 2>&1 | tee "$log"
      rc=${PIPESTATUS[0]}
    else
      bash "$suite"
      rc=$?
    fi
  fi
  if (( rc != 0 )); then
    if (( rc == 124 )); then
      record_suite_failure "$name (rc=124 TIMEOUT after ${secs}s)"
    else
      record_suite_failure "$name (rc=$rc)"
    fi
  fi
  return "$rc"
}
