#!/usr/bin/env bash
# platform.sh — cross-platform abstractions for stat/find in hooks.

# platform_stat_mtime FILE — echo mtime as epoch seconds.
platform_stat_mtime() {
  local f="${1:-}"  # `${1:-}` not `$1`: defensive against a no-arg call under `set -u`
  [[ -n "$f" ]] || return 1
  if stat --format=%Y "$f" >/dev/null 2>&1; then
    stat --format=%Y "$f"
  else
    stat -f %m "$f" 2>/dev/null
  fi
}

# platform_find_newer DIR REFERENCE_FILE — list immediate children (depth ≤ 1)
# newer than REFERENCE_FILE. Depth cap matters in two ways:
#   1. The spec this plugin ships forbids recursive traversal of ~/.claude/
#      (CLAUDE.md §8) — hook behavior must comply with its own rule.
#   2. Callers only care about fresh top-level mkdtemp dirs; descending into
#      them can be expensive when tmp/ accumulates.
platform_find_newer() {
  local dir="${1:-}" ref="${2:-}"  # `${N:-}` not `$N`: defensive under `set -u`
  [[ -n "$dir" && -n "$ref" ]] || return 1
  find "$dir" -maxdepth 1 -newer "$ref" 2>/dev/null | grep -v "^${dir}$" || true
}

# platform_timeout SECONDS CMD [ARGS...] — run CMD with a wall-clock ceiling.
# `timeout` is GNU coreutils; stock macOS has NEITHER `timeout` nor `gtimeout`
# unless coreutils is brew-installed. Pre-v0.23.11 the hooks called `timeout`
# directly, so on a stock Mac every call was `timeout: command not found` →
# the wrapped step (upstream version check, ship-baseline CI gate, bootstrap
# install) silently never ran — the §7 ship gate in particular degraded to a
# no-op. Prefer timeout → gtimeout → a portable bash watchdog so the ceiling
# (and the feature) survives without coreutils. Returns the command's exit
# status (124 on watchdog timeout, matching GNU `timeout`).
platform_timeout() {
  local secs="${1:-}"; shift || true
  [[ -n "$secs" && "$#" -gt 0 ]] || return 1
  # CLAUDEMD_NO_TIMEOUT_BIN=1 forces the watchdog path — a test seam to exercise
  # the stock-macOS (no coreutils) fallback while real `sleep` stays available.
  if [[ "${CLAUDEMD_NO_TIMEOUT_BIN:-0}" != "1" ]]; then
    if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; return $?; fi
    if command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"; return $?; fi
  fi
  # Pure-bash watchdog (bash 3.2-safe): run CMD in background, kill it if a
  # sleeper outlives it. Whichever finishes first, the other is reaped.
  "$@" &
  local cmd_pid=$!
  # The watchdog's own stdout/stderr go to /dev/null, and that redirect is the
  # whole point rather than tidiness (round-16 audit 6.8). `$( )` returns only
  # when EVERY write end of its pipe closes. Without this the subshell inherited
  # fd 1, so after the wrapped command finished the orphan `sleep` held the pipe
  # open and the substitution blocked for the FULL ceiling — the bound became a
  # floor. Not intermittent where it matters: with an external binary (which is
  # what all three reachable call sites wrap — git ls-remote, gh run list) it
  # measured 30/30 blocked, minimum 2008ms against a 2s ceiling; with the
  # redirect, 0/30 at 8–20ms. The wrapped command keeps the caller's fds, so its
  # own output and stderr are untouched; `disown` was tried and changes nothing,
  # because the orphan holds the fd whether or not the shell tracks it.
  # The redirect covers fds 1 and 2 only, so the sleep is also killed with the
  # watchdog (D#434): it held every other fd the caller had open, and a reader
  # of an inherited fd 3 waited out the full ceiling. `wait` on a background
  # sleep returns as soon as the trapped TERM arrives; a foreground sleep would
  # defer the trap until it ended. The trap names the sleep by `jobs -p`, not by
  # a variable: a TERM between the fork and `$!` found the variable empty and
  # left the sleep running (52 of 300 calls under bash 5.3, 10 under 3.2).
  ( trap 'kill -TERM $(jobs -p) 2>/dev/null; exit 0' TERM
    sleep "$secs" 2>/dev/null &
    wait "$!" 2>/dev/null && kill -TERM "$cmd_pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  local watch_pid=$!
  local rc=0
  # PRESERVE the real exit code. `wait` returns the command's own status when it
  # finishes naturally, or 128+SIGTERM (=143) when the watchdog killed it. Only
  # the latter is a timeout → map to 124 (GNU `timeout` convention). Pre-fix this
  # was `|| rc=124`, which collapsed EVERY non-zero exit to 124 — a command that
  # exited 7 looked like a timeout, contradicting this function's contract.
  wait "$cmd_pid" 2>/dev/null; rc=$?
  [[ "$rc" -eq 143 ]] && rc=124
  # Disown the watchdog instead of waiting for it (D#444). A TERM that lands
  # after the trap is set but before `wait` can be interrupted is held by bash
  # 3.2 until the sleep ends, so waiting for the watchdog took the full ceiling
  # (17 of 500 calls of /bin/true under 3.2.57; none under 5.3). Not waiting
  # alone printed "Terminated" (1 of 1000 calls under 3.2): bash 3.2 reports a
  # job that a signal killed (a TERM before the trap is set) and nobody waited
  # for. A disowned job is never reported, so the disown comes first. In the
  # held-TERM case the watchdog and its sleep still run to the ceiling in the
  # background, with the caller's fds above 2 open.
  disown "$watch_pid" 2>/dev/null || true
  kill -TERM "$watch_pid" 2>/dev/null
  return "$rc"
}
