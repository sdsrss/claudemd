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
# Opt-in: REWORK_BREAKER=1 (default OFF). §EXT §13.3 is explicit that a
# behaviour-layer hook ships default-OFF for >=30d of FP signal collection
# before advancing to default-ON advisory and only then to deny, and this is a
# behaviour-layer hook — the roadmap's "advisory 起步" is about the VERDICT, not
# about the default, and where the two readings differ §3 takes the stricter.
# Same shape as transcript-vocab-scan / transcript-structure-scan.
#
# Kill-switches:
#   DISABLE_REWORK_BREAKER_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1      — global

set -uo pipefail

# Opt-in gate (default OFF). Checked BEFORE sourcing hook-common so the default
# path costs one string compare — this hook is on every Edit and every Write.
[[ "${REWORK_BREAKER:-0}" == "1" ]] || exit 0

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
#
# The firing decision is a CLAIM, not a comparison, because the append-then-read
# above is a read-modify-check race and Claude Code issues several Edit/Write
# calls in one assistant message, so these hooks run concurrently. Measured in
# pre-ship review over six trials of 16 concurrent edits: 1, 3, 3, 5, 2 and 3
# advisories where the answer is 2 — both duplicates on one multiple and a
# multiple crossed by two processes that neither of them observed.
#
# `(set -o noclobber; : > file)` is an O_CREAT|O_EXCL create: exactly one
# process can win each multiple, whatever order they interleave in. The loop
# claims every UNCLAIMED multiple at or below the observed count rather than
# only `COUNT % T == 0`, so a count that jumps the boundary (every process
# appends, then every process reads 16) still reports the 8 that was crossed.
# Fires once per invocation, for the highest multiple this process won.
CLAIMED=0
M=$REWORK_THRESHOLD
while (( M <= COUNT )); do
  RB_CLAIM="$RB_STATE_DIR/rework-${RB_SAFE_SID}.fired-${RB_KEY}-${M}"
  if (set -o noclobber; : > "$RB_CLAIM") 2>/dev/null; then
    CLAIMED=$M
  fi
  M=$((M + REWORK_THRESHOLD))
done
(( CLAIMED > 0 )) || exit 0

# CLAIMED, not COUNT, is what the message names. Under concurrency the count
# this process happened to read is whatever the other processes had appended by
# then; the multiple it won is exact, and "at least N" is true of both.
EXTRA=$(jq -cn --argjson n "$COUNT" --argjson c "$CLAIMED" --argjson t "$REWORK_THRESHOLD" --arg tool "$TOOL" \
  '{edits:$n, threshold_crossed:$c, threshold:$t, tool:$tool}' 2>/dev/null) || EXTRA='null'
hook_record rework-breaker rework-advisory "$EXTRA" '§1-root-cause' "$SESSION_ID" "$TOOL_USE_ID"

# The model reads additionalContext; PostToolUse delivery was verified on
# Claude Code 2.1.278 (roadmap §5, 0a). suppressOutput keeps the terminal quiet
# — this is a note to the agent, not a banner for the user, and the same line on
# every eighth edit of a long refactor would be the user's noise, not theirs.
CONTEXT="[claudemd] system-injected: this session has now edited ${FILE_PATH} at least ${CLAIMED} times (threshold ${REWORK_THRESHOLD}). Spec §1 Root cause over patch: if the last few edits were attempts rather than a planned change, stop editing — reproduce the failure, name the cause, then make one edit. Advisory only; disable with DISABLE_REWORK_BREAKER_HOOK=1."
jq -cn --arg ctx "$CONTEXT" '{
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}' 2>/dev/null

exit 0
