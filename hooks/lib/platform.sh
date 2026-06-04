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
  ( sleep "$secs" 2>/dev/null; kill -TERM "$cmd_pid" 2>/dev/null ) &
  local watch_pid=$!
  local rc=0
  # PRESERVE the real exit code. `wait` returns the command's own status when it
  # finishes naturally, or 128+SIGTERM (=143) when the watchdog killed it. Only
  # the latter is a timeout → map to 124 (GNU `timeout` convention). Pre-fix this
  # was `|| rc=124`, which collapsed EVERY non-zero exit to 124 — a command that
  # exited 7 looked like a timeout, contradicting this function's contract.
  wait "$cmd_pid" 2>/dev/null; rc=$?
  [[ "$rc" -eq 143 ]] && rc=124
  kill -TERM "$watch_pid" 2>/dev/null
  wait "$watch_pid" 2>/dev/null || true
  return "$rc"
}
