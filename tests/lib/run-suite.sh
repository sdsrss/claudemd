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

# run_suite <suite-file> [timeout-seconds]
#   Runs `bash <suite-file>` under a wall-clock cap (default 120s). Returns the
#   suite's own exit code, or 124 on timeout after printing a TIMEOUT line.
run_suite() {
  local suite="$1" secs="${2:-120}" rc
  if [[ -n "$CLAUDEMD_SUITE_TIMEOUT_BIN" ]]; then
    "$CLAUDEMD_SUITE_TIMEOUT_BIN" "$secs" bash "$suite"
    rc=$?
    if (( rc == 124 )); then
      echo "TIMEOUT: $(basename "$suite") exceeded ${secs}s (killed)"
    fi
  else
    bash "$suite"
    rc=$?
  fi
  return "$rc"
}
