#!/usr/bin/env bash
# tmp-sweep.sh — PostToolUse(Bash) hook. Reclaims the per-run directories
# vitest leaves in the temp root, and says so when the temp root is filling.
#
# Why a hook and not a rule: vitest 5.0.0 creates `join(os.tmpdir(), nanoid())`
# on its root object and never removes it (only the per-project tmpDir is
# rm'd, in close(), which a killed run never reaches) — one
# `<tmp>/<21-char id>/ssr/<sha1>` tree per run, 13-45 MB each. The agent that
# ran the suite cannot see the leak, and on a tmpfs /tmp (Ubuntu 26.04's
# default, capped at half of RAM) it is unreclaimable memory. Measured
# 2026-09-22: real ENOSPC on 2026-09-07 and 2026-09-08, and a manual clean of
# 627 dirs regrew by 39 in about five hours.
#
# What it deletes is decided by scripts/housekeeping.js, never here: only a
# directory carrying the exact vitest signature (name, owner, children,
# 40-hex file names, no symlinks) and idle past the floor. See its USAGE.
#
# Cost: every Bash call pays the hook preamble (sourcing two libs) plus a
# mkdir, two stats and a `date` — about 23 ms measured on 2026-09-22, against
# about 3 ms for a bare `bash -c 'exit 0'`. At most once per
# CLAUDEMD_TMP_SWEEP_INTERVAL_MIN (default 10) it spawns the sweep DETACHED and
# runs one `df`. The hook itself never waits on the sweep.
#
# Kill-switches:
#   DISABLE_TMP_SWEEP_HOOK=1 — this hook
#   DISABLE_CLAUDEMD_HOOKS=1 — global

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch TMP_SWEEP || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true
if ! declare -f platform_stat_mtime >/dev/null 2>&1; then
  hook_record_failopen tmp-sweep prereq-missing
  exit 0
fi

[[ -n "$HOME" ]] || exit 0
STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
STAMP="$STATE_DIR/tmp-sweep.stamp"
LOCK="$STATE_DIR/tmp-sweep.lock"

INTERVAL_MIN="${CLAUDEMD_TMP_SWEEP_INTERVAL_MIN:-10}"
[[ "$INTERVAL_MIN" =~ ^[0-9]+$ ]] || INTERVAL_MIN=10
NOW=$(date +%s)
# Check-then-touch of the stamp is two steps, so parallel Bash calls all read
# the same stale stamp and each spawn a sweep (0.93.0 pre-tag review L1: 5 of 6
# concurrent hooks did). `mkdir` is the atomic claim: one holder decides, the
# rest skip. A lock older than 60 s is a hook killed while holding it; it is
# cleared so the next call can claim, and this call skips.
if ! mkdir "$LOCK" 2>/dev/null; then
  held=$(platform_stat_mtime "$LOCK") || held=$NOW
  ((NOW - held > 60)) && rmdir "$LOCK" 2>/dev/null
  exit 0
fi
if [[ -f "$STAMP" ]]; then
  last=$(platform_stat_mtime "$STAMP") || last=0
  if ((NOW - last < INTERVAL_MIN * 60)); then
    rmdir "$LOCK" 2>/dev/null
    exit 0
  fi
fi
touch "$STAMP" 2>/dev/null
rmdir "$LOCK" 2>/dev/null

EVENT=$(hook_read_event) || EVENT=""
SESSION_ID=""
HAVE_JQ=0
if hook_require_jq; then
  HAVE_JQ=1
  if [[ -n "$EVENT" ]]; then
    SESSION_ID=$(hook_jq_field tmp-sweep "$EVENT" '.session_id // ""') || SESSION_ID=""
  fi
else
  # The sweep below does not need jq; only attribution and the advisory's
  # JSON envelope do, so this records and continues.
  hook_record_failopen tmp-sweep jq-missing
fi

if command -v node >/dev/null 2>&1; then
  SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/housekeeping.js"
  # Detached: stdin from /dev/null and both streams to the result file, so the
  # hook's own pipes close when it exits and Claude Code does not wait on them.
  nohup node "$SCRIPT" tmp --apply >"$STATE_DIR/tmp-sweep.last.json" 2>&1 </dev/null &
  disown 2>/dev/null || true
else
  hook_record_failopen tmp-sweep prereq-missing
fi

# Pressure advisory. Only the capacity column of POSIX `df -P`; a temp root
# on disk reaches the threshold far later than a tmpfs one, which is fine.
THRESHOLD="${CLAUDEMD_TMP_PRESSURE_PCT:-80}"
[[ "$THRESHOLD" =~ ^[0-9]+$ ]] || THRESHOLD=80
# Spelled without the brace-default TMPDIR expansion on purpose: hook-budget
# derives its data-scaling subjects by grepping for it, and this hook is not
# one — its synchronous path is one `df`, O(1) in the temp root's entry count;
# the scan that does scale runs in the detached child above, off the budget.
# printenv, not a bare expansion: TMPDIR is unset on stock Linux, and under
# `set -u` a bare read of it aborted the hook with exit 1 before the advisory
# (0.93.0 pre-tag review H1).
TMP_ROOT=$(printenv TMPDIR 2>/dev/null) || TMP_ROOT=""
[[ -n "$TMP_ROOT" ]] || TMP_ROOT=/tmp
PCT=$(df -P "$TMP_ROOT" 2>/dev/null | awk 'NR==2 { sub(/%/, "", $5); print $5 }')
if ((HAVE_JQ)) && [[ "$PCT" =~ ^[0-9]+$ ]] && ((PCT >= THRESHOLD)); then
  # GNU `stat -f -c %T` names the filesystem type. Not `df -T`: on macOS -T
  # takes a type LIST, so the path would be read as one. BSD stat rejects -c
  # and leaves this empty, which only drops the tmpfs sentence.
  FSTYPE=$(stat -f -c %T "$TMP_ROOT" 2>/dev/null)
  NOTE=""
  [[ "$FSTYPE" == "tmpfs" ]] && NOTE=" It is a tmpfs, so every byte there is RAM (or swap)."
  MSG="[claudemd] temp root $TMP_ROOT is ${PCT}% full.${NOTE} The vitest per-run dirs are swept automatically once idle 60 min; anything else there is not attributable, so list the largest entries (\`du -sh $TMP_ROOT/* | sort -rh | head\`) and delete what THIS session created. Disable: DISABLE_TMP_SWEEP_HOOK=1."
  hook_record tmp-sweep tmp-pressure-advisory "{\"pct\":$PCT,\"threshold\":$THRESHOLD}" '§8.V4' "$SESSION_ID"
  jq -cn --arg m "$MSG" '{suppressOutput: true, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}' 2>/dev/null
fi
exit 0
