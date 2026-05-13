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
#   5. If any un-Read matches → emit additionalContext (suppressOutput=true
#      so model sees it, UI stays quiet). Cap at 5 to bound prompt noise.
#   6. Log `suggest` event to rule-hits.jsonl for cite-recall measurement.
#
# Fail-open on every branch: missing MEMORY.md / transcript / jq / empty
# prompt → silent exit 0.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MEMORY_HINT || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
PROMPT=$(printf '%s' "$EVENT" | jq -r '.prompt // ""' 2>/dev/null)
CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

[[ -n "$PROMPT" && -n "$CWD" && -n "$SESSION_ID" ]] || exit 0

# Project-dir encoding: tr '/._' → '-' (matches CC convention, see
# memory-read-check.sh:84-86 for the empirical derivation).
ENCODED=$(printf '%s' "$CWD" | tr '/._' '-')
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

# Cap output at 5 to bound prompt-context inflation. Order = MEMORY.md order
# (curator authored prioritization). Telemetry records full match count.
MAX=5
COUNT=${#UNREAD_FILES[@]}
EMIT_COUNT=$(( COUNT < MAX ? COUNT : MAX ))

CONTEXT="[mem-hint] §11 — your prompt matches MEMORY.md tags. Consider Reading these before answering:"
for i in $(seq 0 $((EMIT_COUNT - 1))); do
  CONTEXT+=$'\n'"  - $MEM_DIR/${UNREAD_FILES[$i]} (tag: ${UNREAD_TAGS[$i]})"
done
if (( COUNT > MAX )); then
  CONTEXT+=$'\n'"  ... and $((COUNT - MAX)) more (capped). Per §11: index is a router, not a substitute."
fi

# Emit JSON with suppressOutput so model sees additionalContext but UI stays
# uncluttered (matches session-summary.sh / SessionStart additionalContext
# rendering pattern).
jq -cn --arg ctx "$CONTEXT" '{
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}' 2>/dev/null

# Telemetry: one row per emission. extra carries the matched file count
# (capped + un-capped) so cite-recall analysis can join against subsequent
# Read events in the same session_id.
FILES_JSON=$(printf '%s\n' "${UNREAD_FILES[@]}" | jq -R . | jq -s .)
EXTRA=$(jq -cn --argjson files "$FILES_JSON" --argjson n "$COUNT" \
  '{suggested:$files, match_count:$n}' 2>/dev/null) || EXTRA='null'
hook_record memory-prompt-hint suggest "$EXTRA" '§11-memory-hint' "$SESSION_ID"

exit 0
