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
  (( rc == 0 )) || record_suite_rc "$name" "$rc" "$secs"
  return "$rc"
}

# record_suite_rc <name> <rc> <timeout-seconds>
#   The failure line run_suite records, shared with the callers that collect a
#   suite's exit code from run_suites_bg's .rc file.
record_suite_rc() {
  if (( $2 == 124 )); then
    record_suite_failure "$1 (rc=124 TIMEOUT after ${3}s)"
  else
    record_suite_failure "$1 (rc=$2)"
  fi
}

# suite_runs_alone <basename> — true for the suites that must not share the
# machine with other suites, so run-all.sh and bash32-runtime.sh run them one at
# a time before the parallel batch:
#   hook-budget.test.sh      compares hook wall time to a ratio measured on a
#                            quiet machine.
#   sandbox-disposal.test.sh case 12b scans the real /tmp, and the hook lists 5
#                            entries; other suites' mktemp dirs pushed the probe
#                            off that list (1 of 6 parallel trial runs, under
#                            bash 3.2, 2026-11-10).
suite_runs_alone() {
  case "$1" in
    hook-budget.test.sh | sandbox-disposal.test.sh) return 0 ;;
  esac
  return 1
}

# suite_jobs — how many suites run_suites_bg runs at once: CLAUDEMD_TEST_JOBS
# when it is a positive integer, else the online CPU count, else 1.
suite_jobs() {
  local n="${CLAUDEMD_TEST_JOBS:-}"
  case "$n" in '' | *[!0-9]* | 0) n=$(getconf _NPROCESSORS_ONLN 2>/dev/null) ;; esac
  case "$n" in '' | *[!0-9]* | 0) n=1 ;; esac
  printf '%s\n' "$n"
}

# run_suites_bg <out-dir> <cap> <suite> [<cap> <suite>]...
#   Runs each suite through run_suite, $(suite_jobs) at a time, and waits for
#   all of them. Each writes its stdout+stderr (and run_suite's TIMEOUT line) to
#   <out-dir>/<basename>.log and its exit code to <out-dir>/<basename>.rc;
#   nothing is printed and nothing is recorded, because the runs are child
#   processes: the caller reads the .rc files in its own order. Suites start in
#   argument order, so pass the slowest first. Basenames must be unique.
#   The 40 hook suites took 266 s one at a time on a 12-core machine
#   (2026-11-10, docs/claudemd-optimization-review-2026-11-10.md §3).
run_suites_bg() {
  local out="$1" lib
  shift
  lib="${BASH_SOURCE[0]}"
  # -0 and -P are in both GNU and BSD xargs. The child is `bash` from PATH, so
  # under tests/lib/bash32-runtime.sh's shim the runner itself is bash 3.2 too.
  # It exits 0 whatever the suite did, so xargs never stops early.
  printf '%s\0' "$@" | xargs -0 -n 2 -P "$(suite_jobs)" bash -c '
    . "$1"
    CLAUDEMD_SUITE_LOG_DIR=""
    name=$(basename "$4")
    run_suite "$4" "$3" >"$2/$name.log" 2>&1
    echo "$?" >"$2/$name.rc"
  ' _ "$lib" "$out"
}
