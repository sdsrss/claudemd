#!/usr/bin/env bash
# rework-breaker.sh — PostToolUse hook (G2, advisory only).
#
# What it measures and why. The 2026-09-21 transcript measurement
# (docs/spec-optimization-roadmap-2026-09-21.md §3.2b) counted, per session, how
# many Edit/Write calls landed on the session's hottest file: 58.7% of sessions
# with any edit reached 8 or more, the modal bucket was 8-14, and one session
# reached 58 on a single file. That shape is a loop: make an edit, run the
# suite, see red, edit again — hill-climbing rather than diagnosis. §1 "Root
# cause over patch" already forbids it and is pure prose, so nothing observes
# the loop while it is running.
#
# This hook observes it. At every multiple of the threshold it injects one line
# naming the count, which is the only fact the agent does not otherwise have:
# an agent mid-loop knows it edited the file again, not that this was the
# sixteenth time.
#
# Advisory by construction, not by choice: PostToolUse cannot deny, and the FP
# case is real — a large legitimate refactor touches one file many times and
# looks identical from here. G2's pre-registration says so: if the FP rate is
# high, change the PRESENTATION, not the threshold. The threshold was fixed at 8
# before the data was collected and must not be tuned to it.
#
# Kill-switches:
#   DISABLE_REWORK_BREAKER_HOOK=1 — disable this hook
#   DISABLE_CLAUDEMD_HOOKS=1      — global

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch REWORK_BREAKER || exit 0
hook_require_jq || { hook_record_failopen rework-breaker jq-missing; exit 0; }

# Pre-registered (G2). Not read from the environment: a threshold a session can
# move is a threshold the 30d FP measurement cannot interpret.
REWORK_THRESHOLD=8

EVENT=$(hook_read_event) || exit 0
TOOL=$(hook_jq_field rework-breaker "$EVENT" '.tool_name // ""') || exit 0
case "$TOOL" in
  Edit | Write) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(printf '%s' "$EVENT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
[[ -n "$FILE_PATH" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)
# No session_id, no per-session tally. Counting into a shared file instead would
# pool every concurrent window's edits into one number and fire on sessions that
# edited nothing twice.
[[ -n "$SESSION_ID" ]] || exit 0

RB_STATE_DIR="$HOME/.claude/.claudemd-state"
RB_SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
RB_LEDGER="$RB_STATE_DIR/rework-${RB_SAFE_SID}.counts"

# Append-only, one short line per edit, keyed by a checksum of the path rather
# than the path itself: paths contain spaces, newlines and non-ASCII, and a
# fixed-width key keeps the line format greppable with an anchored match. A
# checksum collision over-counts two files as one — the cost is one advisory
# line that names a real count for the wrong file, which is why the message
# quotes the path from the EVENT and never from this ledger.
RB_KEY=$(printf '%s' "$FILE_PATH" | cksum 2>/dev/null | awk '{print $1"-"$2}')
[[ -n "$RB_KEY" ]] || { hook_record_failopen rework-breaker prereq-missing; exit 0; }

mkdir -p "$RB_STATE_DIR" 2>/dev/null || { hook_record_failopen rework-breaker prereq-missing; exit 0; }
printf '%s\n' "$RB_KEY" >> "$RB_LEDGER" 2>/dev/null || {
  hook_record_failopen rework-breaker prereq-missing
  exit 0
}

COUNT=$(grep -c -x -F "$RB_KEY" "$RB_LEDGER" 2>/dev/null || true)
# `grep -c` prints 0 and exits 1 when nothing matches; an unreadable ledger
# prints nothing. Either way a non-numeric COUNT means "no tally", not "zero
# edits" — treat it as nothing to say rather than firing on a garbage number.
[[ "$COUNT" =~ ^[0-9]+$ ]] || exit 0
(( COUNT > 0 )) || exit 0

# Fire at the threshold and at each multiple of it. Once-per-session-per-file
# would leave a 58-edit session with a single line at edit 8; every edit past
# the threshold would be noise that says nothing new. The multiple carries the
# escalation in the number itself.
(( COUNT % REWORK_THRESHOLD == 0 )) || exit 0

EXTRA=$(jq -cn --argjson n "$COUNT" --argjson t "$REWORK_THRESHOLD" --arg tool "$TOOL" \
  '{edits:$n, threshold:$t, tool:$tool}' 2>/dev/null) || EXTRA='null'
hook_record rework-breaker rework-advisory "$EXTRA" '§1-root-cause' "$SESSION_ID" "$TOOL_USE_ID"

# The model reads additionalContext; PostToolUse delivery was verified on
# Claude Code 2.1.278 (roadmap §5, 0a). suppressOutput keeps the terminal quiet
# — this is a note to the agent, not a banner for the user, and the same line on
# every eighth edit of a long refactor would be the user's noise, not theirs.
CONTEXT="[claudemd] system-injected: this session has now edited ${FILE_PATH} ${COUNT} times (threshold ${REWORK_THRESHOLD}). Spec §1 Root cause over patch: if the last few edits were attempts rather than a planned change, stop editing — reproduce the failure, name the cause, then make one edit. Advisory only; disable with DISABLE_REWORK_BREAKER_HOOK=1."
jq -cn --arg ctx "$CONTEXT" '{
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}' 2>/dev/null

exit 0
