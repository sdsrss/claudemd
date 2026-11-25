#!/usr/bin/env bash
# memory-index-lines.sh — PostToolUse(Edit|Write|Bash) hook, ADVISORY.
#
# Tells the agent, right after it writes to an auto-memory index
# (~/.claude/projects/<p>/memory/MEMORY.md), which of the index lines it just
# wrote are over 150 characters, so it shortens them in the same turn.
#
# Why (tasks/specs/memory-index-write-check-2026-11-25.md): core §11 and Claude
# Code's own memory instructions both say an index entry is one line under
# ~150 characters, and Claude Code loads MEMORY.md only up to 200 lines and
# 25,000 bytes. On 2026-11-25, 220 of 368 index lines across ten projects were
# over 150, one index stood at 86% of the byte cap, and 39 of the 52 lines
# written since 10-01 were over. The only check was /claudemd-doctor's advisory
# row, which runs when someone asks for it. Truncating to 150 keeps 344 of 363
# memory-prompt-hint matches, so the limit itself stays.
#
# What counts as "just wrote":
#   Edit  — lines of new_string that are not lines of old_string
#   Write — lines of content that are not lines of tool_response.originalFile
#   Bash  — lines of the index that occur verbatim in the command: echo, printf,
#           a heredoc or `L='…'; echo "$L" >>` all carry the whole line. The
#           index read is the project's own (same root as memory-prompt-hint.sh)
#           plus every ~/.claude/projects/<p>/memory the command names.
# Known gap: `sed -i` or a script that rewrites part of a line carries no whole
# line, so it is not seen (23 of 57 traced long lines were last touched that
# way; most were first appended whole, which is seen). Lines already in the
# file are never flagged — the backlog is each project's to shorten, and
# /claudemd-doctor lists it.
#
# Cost: every Edit/Write/Bash call pays a bash start, one read of stdin and one
# glob test on the raw event, which come BEFORE the libraries are sourced
# (sourcing hook-common.sh is most of a hook's fixed cost: 5.8 ms a call with it
# first, against 1.3 ms for a bare bash, measured 2026-11-25). jq runs only when
# the event text names MEMORY.md.
#
# Output: one JSON object with hookSpecificOutput.additionalContext, only when
# a long line was written. Never blocks; every failure exits 0 silently.
#
# Kill-switches:
#   DISABLE_MEMORY_INDEX_LINES_HOOK=1 — this hook
#   DISABLE_CLAUDEMD_HOOKS=1          — global

set -uo pipefail

# Fast path: nothing in the event names an index, so nothing was written to one.
# The read is hook_read_event's, inlined so this exit needs no library.
EVENT=""
IFS= read -r -d '' EVENT 2>/dev/null
[[ "$EVENT" == *MEMORY.md* ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MEMORY_INDEX_LINES || exit 0
[[ -n "$HOME" ]] || exit 0
hook_require_jq || { hook_record_failopen memory-index-lines jq-missing; exit 0; }

MAX=150
TOOL=$(hook_jq_field memory-index-lines "$EVENT" '.tool_name // ""') || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

# JSON arrays of {file, len, title}, one per index read; merged at the end.
FOUND=()

# long_lines FILE — reads newline-separated candidate lines on stdin and prints
# the index entries among them longer than MAX code points (jq counts code
# points, as doctor's [...line].length does; bash ${#…} would follow the locale).
long_lines() {
  jq -R -s -c --arg f "$1" --argjson max "$MAX" '
    split("\n") | map(select(startswith("- [") and length > $max))
    | map({file: $f, len: length,
           title: (ltrimstr("- [") | split("](")[0])})' 2>/dev/null
}

# is_index PATH — an auto-memory index: $HOME/.claude/projects/<one segment>/memory/MEMORY.md
is_index() {
  local rest
  case "$1" in
    "$HOME"/.claude/projects/*/memory/MEMORY.md) ;;
    *) return 1 ;;
  esac
  rest="${1#"$HOME"/.claude/projects/}"
  rest="${rest%/memory/MEMORY.md}"
  [[ -n "$rest" && "$rest" != */* ]]
}

case "$TOOL" in
  Edit|Write)
    FILE=$(printf '%s' "$EVENT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
    is_index "$FILE" || exit 0
    if [[ "$TOOL" == Edit ]]; then
      FILTER='((.tool_input.old_string // "") | split("\n") | map({(.): true}) | add // {}) as $old
              | (.tool_input.new_string // "") | split("\n") | map(select($old[.] | not)) | .[]'
    else
      FILTER='((.tool_response.originalFile // "") | split("\n") | map({(.): true}) | add // {}) as $old
              | (.tool_input.content // "") | split("\n") | map(select($old[.] | not)) | .[]'
    fi
    ROWS=$(printf '%s' "$EVENT" | jq -r "$FILTER" 2>/dev/null | long_lines "$FILE")
    [[ -n "$ROWS" ]] && FOUND+=("$ROWS")
    ;;
  Bash)
    CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
    [[ "$CMD" == *MEMORY.md* ]] || exit 0
    CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
    FILES=()
    PROJECT_START="${CLAUDE_PROJECT_DIR:-$CWD}"
    if [[ -n "$PROJECT_START" ]]; then
      MEM_ROOT=$(hook_memory_root "$PROJECT_START")
      FILES+=("$HOME/.claude/projects/$(hook_encode_project "$MEM_ROOT")/memory/MEMORY.md")
    fi
    # Every <p> in `…/.claude/projects/<p>/memory` the command names, whatever
    # spells the home part (~, $HOME, an absolute path). Only lines found
    # verbatim in the command are flagged, so reading a same-named index under
    # this $HOME when the command meant another home flags nothing.
    rest="$CMD"
    while [[ "$rest" == *"/.claude/projects/"* ]]; do
      rest="${rest#*/.claude/projects/}"
      seg="${rest%%/*}"
      [[ "$rest" == "$seg/memory"* && "$seg" =~ ^[A-Za-z0-9-]+$ ]] || continue
      FILES+=("$HOME/.claude/projects/$seg/memory/MEMORY.md")
    done
    SEEN=$'\n'
    for f in ${FILES[@]+"${FILES[@]}"}; do
      [[ "$SEEN" == *$'\n'"$f"$'\n'* ]] && continue
      SEEN+="$f"$'\n'
      [[ -f "$f" && -r "$f" ]] || continue
      ROWS=$(jq -R -s -r --arg c "$CMD" \
               'split("\n") | map(select(startswith("- [") and (. as $l | $c | contains($l)))) | .[]' \
               < "$f" 2>/dev/null | long_lines "$f")
      [[ -n "$ROWS" ]] && FOUND+=("$ROWS")
    done
    ;;
  *) exit 0 ;;
esac

(( ${#FOUND[@]} > 0 )) || exit 0
ALL=$(printf '%s\n' "${FOUND[@]}" | jq -s -c 'add | unique_by([.file, .title, .len]) | sort_by(-.len)' 2>/dev/null)
N=$(printf '%s' "$ALL" | jq -r 'length' 2>/dev/null)
[[ "$N" =~ ^[1-9][0-9]*$ ]] || exit 0

# One line per run. Paths are written with ~ so the model sees which index,
# without the home directory. At most five entries are named.
CTX=$(printf '%s' "$ALL" | jq -r --arg home "$HOME" --argjson max "$MAX" '
  length as $n
  | (map(.file) | unique | map(if startswith($home + "/") then "~" + .[($home | length):] else . end) | join(", ")) as $where
  | (.[:5] | map("\(.len): \"\(.title)\"") | join("; ")) as $named
  | "[claudemd] §11 memory index: \($n) \(if $n == 1 then "line you just wrote to \($where) is" else "lines you just wrote to \($where) are" end) over \($max) characters — \($named)\(if $n > 5 then "; +\($n - 5) more" else "" end). An index line is a title, tags and a one-line hook: move the rest into the memory file and shorten the line now. Lines that were already there are not flagged. The user can turn this off with DISABLE_MEMORY_INDEX_LINES_HOOK=1."' 2>/dev/null)
[[ -n "$CTX" ]] || exit 0

jq -cn --arg m "$CTX" \
  '{suppressOutput: true, hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}' 2>/dev/null

EXTRA=$(printf '%s' "$ALL" | jq -c --arg t "$TOOL" '{lines: length, max: (map(.len) | max), tool: $t}' 2>/dev/null) || EXTRA='null'
hook_record memory-index-lines index-line-advisory "$EXTRA" '§11-memory-index' "$SESSION_ID"

exit 0
