#!/usr/bin/env bash
# memory-prompt-hint.sh — UserPromptSubmit hook (v0.11.0).
#
# Proactive twin of memory-read-check.sh. When the user's prompt matches any
# tag in MEMORY.md AND the matched memory file has NOT been Read this session,
# emit a brief additionalContext block listing the un-Read files.
#
# Rationale: §11 MEMORY.md read-the-file is HARD but observed cite-recall is
# ~8% (2/24 in last session). Prose HARD rule has plateaued; mechanical
# UserPromptSubmit nudge surfaces relevant memories before the agent acts,
# instead of waiting for the ship-time deny in memory-read-check.sh.
#
# Behavior:
#   1. Parse prompt, cwd, session_id from UserPromptSubmit event JSON.
#   2. Encode cwd → ~/.claude/projects/<encoded>/memory/MEMORY.md path.
#   3. Match prompt against tagged MEMORY.md entries (same word-boundary +
#      declension + meta-escape logic as memory-read-check.sh).
#   4. For each matched file, check session transcript for prior Read.
#   5. Non-human prompt sources (<agent-message>/<task-notification>/command
#      relays/system-reminders) never emit: log `suppress-source` with the
#      un-Read match list and stop here (v0.35.0 R1; row moved BEFORE the
#      dedupe in v0.36.0 so it fires even when every match was already
#      suggested to a human prompt — review finding #5).
#   6. Drop files already suggested this session (rule-hits log lookup,
#      event=suggest only — beats transcript flush lag; v0.35.0 R1).
#   7. If any un-Read matches remain, emit additionalContext
#      (suppressOutput=true so model sees it, UI stays quiet), capped at 5 to
#      bound prompt noise, and log `suggest` for cite-recall measurement.
#
# Fail-open on every branch: missing MEMORY.md / transcript / jq / empty
# prompt → silent exit 0.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# platform.sh provides platform_stat_mtime (BSD-vs-GNU stat portability used by
# v0.19.2 B3 priority ranking). Per feedback_hook_platform_lib_source.md, the
# `command -v platform_*` guard alone silently fall-throughs when the lib is
# not sourced — explicit source required.
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch MEMORY_HINT || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
PROMPT=$(printf '%s' "$EVENT" | jq -r '.prompt // ""' 2>/dev/null)
CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

[[ -n "$PROMPT" && -n "$CWD" && -n "$SESSION_ID" ]] || exit 0

# v0.35.0 R1 — non-human prompt-source detection. Teammate/agent messages,
# background-task notifications, and local-command relays fire UserPromptSubmit
# exactly like typed prompts, but their bodies QUOTE rule/memory vocabulary
# instead of expressing user intent — the 2026-07-11 spec-audit session
# measured 6/9 suggest events triggered by subagent deliverables quoting tag
# words (hint avalanche). Tag matching + telemetry still run below so the
# suppression stays measurable (§13.3 advisory-data discipline); only the
# additionalContext emission is suppressed. Telemetry then records event
# suppress-source instead of suggest.
SOURCE_FILTERED=0
_PROMPT_HEAD="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
case "$_PROMPT_HEAD" in
  '<agent-message'*|'<task-notification'*|'<local-command-caveat'*|'<command-name'*|'<local-command-stdout'*|'<system-reminder'*)
    SOURCE_FILTERED=1 ;;
esac

# Project-dir encoding: convert EVERY non-`[a-zA-Z0-9-]` char to `-` (CC
# convention; see memory-read-check.sh for the empirical derivation + why the
# narrower `tr '/._'` mis-located the dir for cwds with other special chars).
ENCODED=$(printf '%s' "$CWD" | tr -c 'a-zA-Z0-9-' '-')
MEM_DIR="$HOME/.claude/projects/${ENCODED}/memory"
MEM_INDEX="$MEM_DIR/MEMORY.md"
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"

[[ -f "$MEM_INDEX" ]] || exit 0
# Transcript may not exist yet on session prompt #1 — still useful to suggest,
# just means "everything is un-Read" which is correct.

# Parse MEMORY.md → match → collect un-Read.
# Output rows: "file\ttag1,tag2,..." for matches.
MATCHES=()
MATCH_TAGS=()
while IFS= read -r line; do
  FILE=$(echo "$line" | sed -n 's/.*(\([^)]*\.md\)).*/\1/p')
  [[ -z "$FILE" ]] && continue

  # Backtick form first (precise), then plain.
  # Both forms ANCHOR on `.md)` so a backtick-wrapped `[token]` in the
  # description (e.g. `... — see also `[other]` inline`) does NOT get
  # mistaken for the tag block. Pre-fix the backtick variant was unanchored
  # and the greedy `.*` ate through to the LAST `\`[...]\`` on the line —
  # making the description's decorative backtick block the parsed tag and
  # the real tag invisible.
  TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*`\[\([^]]*\)\]`.*/\1/p')
  if [[ -z "$TAG_BLOCK" ]]; then
    TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*\[\([^]]*\)\][[:space:]]*[—-].*/\1/p')
  fi
  [[ -z "$TAG_BLOCK" ]] && continue

  IFS=',' read -ra TAGS <<<"$TAG_BLOCK"
  MATCHED_TAGS=""
  for t in "${TAGS[@]}"; do
    t=$(echo "$t" | tr -d ' ')
    [[ -z "$t" ]] && continue
    # Same word-boundary + declension regex as memory-read-check.sh:134.
    ESC_TAG=$(printf '%s' "$t" | sed 's|[][\\.*^$+?{}()|]|\\&|g')
    if echo "$PROMPT" | grep -qiE -- "(^|[^a-zA-Z0-9])${ESC_TAG}[a-zA-Z]{0,2}([^a-zA-Z0-9]|$)"; then
      if [[ -z "$MATCHED_TAGS" ]]; then
        MATCHED_TAGS="$t"
      else
        MATCHED_TAGS="$MATCHED_TAGS,$t"
      fi
    fi
  done

  if [[ -n "$MATCHED_TAGS" ]]; then
    MATCHES+=("$FILE")
    MATCH_TAGS+=("$MATCHED_TAGS")
  fi
done < "$MEM_INDEX"

(( ${#MATCHES[@]} == 0 )) && exit 0

# Filter to un-Read subset (mirrors memory-read-check.sh:146-151 logic).
UNREAD_FILES=()
UNREAD_TAGS=()
for i in "${!MATCHES[@]}"; do
  file="${MATCHES[$i]}"
  MEMFILE="$MEM_DIR/$file"
  if [[ -f "$TRANSCRIPT" ]] && grep -qF -- "$MEMFILE" "$TRANSCRIPT" 2>/dev/null; then
    continue
  fi
  UNREAD_FILES+=("$file")
  UNREAD_TAGS+=("${MATCH_TAGS[$i]}")
done

(( ${#UNREAD_FILES[@]} == 0 )) && exit 0

# v0.36.0 (review finding #5, 2026-07-11): source-filtered prompts log their
# suppress-source row HERE — after the un-Read filter, BEFORE the dedupe —
# then stop. Dedupe, priority sort, and the cap are emission machinery, and a
# filtered prompt never emits. Pre-fix the row was logged after dedupe, so a
# relay prompt whose matches had all been suggested to a HUMAN prompt earlier
# in the session exited at the empty-list check without logging, and exactly
# the avalanche rows this metric exists to count went missing. suggested =
# post-unRead match list in MEMORY.md authoring order (nothing is shown, so
# emission order is meaningless); match_count = its length. The dedupe reads
# event=suggest rows only, so these rows never mask a later human hint.
if (( SOURCE_FILTERED == 1 )); then
  FILES_JSON=$(printf '%s\n' "${UNREAD_FILES[@]}" | jq -R . | jq -s .)
  EXTRA=$(jq -cn --argjson files "$FILES_JSON" --argjson n "${#UNREAD_FILES[@]}" \
    '{suggested:$files, match_count:$n}' 2>/dev/null) || EXTRA='null'
  hook_record memory-prompt-hint suppress-source "$EXTRA" '§11-memory-hint' "$SESSION_ID"
  exit 0
fi

# v0.35.0 R1 — per-session per-file dedupe. The transcript check above already
# suppresses a re-suggest once a prior hint's additionalContext (which embeds
# the full memory path) is flushed to the transcript — but rapid-fire prompts
# beat the flush: the 2026-07-11 audit session logged the same file suggested
# twice 2s apart (same lag family as tasks/memory-read-check-transcript-lag.md).
# Our own rule-hits log is appended synchronously at emission time, so it is
# the lag-free record of "already SHOWN this session". Only event=suggest rows
# count — suppress-source rows were never shown to the model, so a later human
# prompt matching the same file must still surface it. Same reason the slice
# below keys on the EMITTED prefix only: `extra.suggested` logs the FULL match
# list while the hint emits at most MAX entries — a capped-out entry (#6 of 8)
# was never shown, so deduping on the full list would mask it for the rest of
# the session (pre-ship review finding, 2026-07-11; suggested is priority-
# ordered, so first min(MAX, len) = exactly what was emitted). Fail-open: log
# missing / unreadable / jq error → empty PRIOR_SUGGESTED → no dedupe.
MAX=5
RULE_LOG="$HOME/.claude/logs/claudemd.jsonl"
PRIOR_SUGGESTED=""
if [[ -r "$RULE_LOG" ]]; then
  PRIOR_SUGGESTED=$(grep -F -- "$SESSION_ID" "$RULE_LOG" 2>/dev/null \
    | jq -R -r --arg sid "$SESSION_ID" --argjson max "$MAX" \
        'try fromjson catch empty
         | select(.hook=="memory-prompt-hint" and .event=="suggest" and .session_id==$sid)
         | .extra.suggested[:$max] | .[]?' 2>/dev/null | sort -u)
fi
if [[ -n "$PRIOR_SUGGESTED" ]]; then
  DEDUP_FILES=()
  DEDUP_TAGS=()
  for i in "${!UNREAD_FILES[@]}"; do
    if grep -qxF -- "${UNREAD_FILES[$i]}" <<<"$PRIOR_SUGGESTED"; then
      continue
    fi
    DEDUP_FILES+=("${UNREAD_FILES[$i]}")
    DEDUP_TAGS+=("${UNREAD_TAGS[$i]}")
  done
  UNREAD_FILES=()
  UNREAD_TAGS=()
  if (( ${#DEDUP_FILES[@]} > 0 )); then
    UNREAD_FILES=("${DEDUP_FILES[@]}")
    UNREAD_TAGS=("${DEDUP_TAGS[@]}")
  fi
fi

(( ${#UNREAD_FILES[@]} == 0 )) && exit 0

# v0.19.2 B3 — priority ranking. Sort un-Read matches by:
#   (1) tag-match count desc — more matched tags = stronger signal
#   (2) mtime desc            — more recent edits = more likely still relevant
# Pre-this, output order = MEMORY.md authoring order, capped at 5; when COUNT > 5
# the top-MEMORY.md entries dominated regardless of how strongly they matched
# vs entries lower in the file. New order surfaces highest-signal first so the
# 5-item cap is spent on the entries most likely to change the agent's path.
#
# Sort key construction:
#   tag_count = count of commas in MATCHED_TAGS + 1 (single tag has 0 commas)
#   mtime     = platform_stat_mtime (Unix epoch); 0 fallback if unavailable
# Sort:  `sort -t<TAB> -k1,1nr -k2,2nr` — numeric desc on both columns.
# TAB delimiter chosen because tag lists are comma-separated and may contain
# any printable char; TAB is the only safe ASCII separator left.
SORT_ROWS=()
for i in "${!UNREAD_FILES[@]}"; do
  file="${UNREAD_FILES[$i]}"
  tags="${UNREAD_TAGS[$i]}"
  mfile="$MEM_DIR/$file"
  tag_count=$(printf '%s' "$tags" | awk -F, '{print NF}')
  # v0.20.1 M1: require positive integer (≥1). `awk NF` returns 0 on an
  # empty string — numeric but semantically wrong (every entry in
  # SORT_ROWS has ≥1 matched tag by upstream filter). Pre-this, the
  # `^[0-9]+$` guard accepted 0, falling unreachable today only because
  # of the upstream filter. The tighter regex defends against
  # filter-bypass regressions.
  [[ "$tag_count" =~ ^[1-9][0-9]*$ ]] || tag_count=1
  mtime=0
  if command -v platform_stat_mtime >/dev/null 2>&1; then
    mtime=$(platform_stat_mtime "$mfile" 2>/dev/null) || mtime=0
  fi
  [[ "$mtime" =~ ^[0-9]+$ ]] || mtime=0
  SORT_ROWS+=("${tag_count}"$'\t'"${mtime}"$'\t'"${file}"$'\t'"${tags}")
done

SORTED_FILES=()
SORTED_TAGS=()
while IFS=$'\t' read -r _tc _mt sfile stags; do
  [[ -z "$sfile" ]] && continue
  SORTED_FILES+=("$sfile")
  SORTED_TAGS+=("$stags")
done < <(printf '%s\n' "${SORT_ROWS[@]}" | sort -t$'\t' -k1,1nr -k2,2nr)

# Cap output at MAX (defined above the dedupe — the two must agree: dedupe
# keys on the emitted prefix) to bound prompt-context inflation. Order now =
# priority-ranked. Telemetry records the full match list + count, so audit can
# tell which matches got dropped by the cap.
COUNT=${#SORTED_FILES[@]}
EMIT_COUNT=$(( COUNT < MAX ? COUNT : MAX ))

CONTEXT="[claudemd] §11 memory-hint: your prompt matches MEMORY.md tags. Consider Reading these before answering:"
for i in $(seq 0 $((EMIT_COUNT - 1))); do
  CONTEXT+=$'\n'"  - $MEM_DIR/${SORTED_FILES[$i]} (tag: ${SORTED_TAGS[$i]})"
done
if (( COUNT > MAX )); then
  CONTEXT+=$'\n'"  ... and $((COUNT - MAX)) more (capped, priority-ranked). Per §11: index is a router, not a substitute."
fi

# Maintain back-compat: UNREAD_FILES / UNREAD_TAGS used by telemetry below.
UNREAD_FILES=("${SORTED_FILES[@]}")
UNREAD_TAGS=("${SORTED_TAGS[@]}")

# Emit JSON with suppressOutput so model sees additionalContext but UI stays
# uncluttered (matches session-summary.sh / SessionStart additionalContext
# rendering pattern). Only human-source prompts reach this point — the
# source-filtered path logged suppress-source and exited above the dedupe.
jq -cn --arg ctx "$CONTEXT" '{
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}' 2>/dev/null

# Telemetry: one row per emission. extra carries the matched file count
# (capped + un-capped) so cite-recall analysis can join against subsequent
# Read events in the same session_id. This and the suppress-source call above
# are literal call sites (not a $VAR event name) — tests/hooks/contract.test.sh
# part B greps `hook_record <hook> <event>` literally.
FILES_JSON=$(printf '%s\n' "${UNREAD_FILES[@]}" | jq -R . | jq -s .)
EXTRA=$(jq -cn --argjson files "$FILES_JSON" --argjson n "$COUNT" \
  '{suggested:$files, match_count:$n}' 2>/dev/null) || EXTRA='null'
hook_record memory-prompt-hint suggest "$EXTRA" '§11-memory-hint' "$SESSION_ID"

exit 0
