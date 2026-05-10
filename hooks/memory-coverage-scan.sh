#!/usr/bin/env bash
# memory-coverage-scan.sh — Stop hook (advisory only, opt-in default OFF).
#
# v0.13.0 — companion observation hook for §11 Auto-memory triggers. Counts
# lesson/decision tokens in this session's assistant text and compares against
# mem_save tool-call count from the transcript. Emits one coverage-advisory
# per session when total trigger tokens >= THRESHOLD AND mem_save count == 0.
#
# Rationale: §11-memory-hint covers "READ memory" (proactive pre-task). This
# hook covers the inverse — "should have SAVED memory" (post-task) — closing
# the read/write half of the MEMORY.md lifecycle.
#
# Detection patterns (case-insensitive, line-counted):
#   Lesson tokens:   lesson | gotcha | non-obvious | turns out | 踩坑 | 原因是
#                   | 原来如此 | 学到 | 不该 | 下次
#   Decision tokens: non-default | chose .* over | 因为.*所以 | 选 .* 不选 | 非默认
#
# Threshold: configurable via MEMORY_COVERAGE_THRESHOLD env (default 3).
#
# Per-session dedup via state sentinel — emits at most once per session_id.
# Without dedup, every Stop event in a session would re-emit.
#
# Opt-in: MEMORY_COVERAGE_SCAN=1 (default OFF). Same precedent as
# transcript-vocab-scan / transcript-structure-scan — behavior-layer hooks
# ship default-off for >=30 days FP signal collection before default-on flip.
#
# Kill-switches:
#   DISABLE_MEMORY_COVERAGE_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1       — global

set -uo pipefail

[[ "${MEMORY_COVERAGE_SCAN:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MEMORY_COVERAGE || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TRANSCRIPT_PATH=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
[[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
[[ -n "$SESSION_ID" ]] || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
SENTINEL="$STATE_DIR/mem-coverage-${SESSION_ID}.ts"
[[ -f "$SENTINEL" ]] && exit 0

# Extract all assistant text across the full session (coverage is session-
# aggregate, not turn-local).
ASSISTANT_TEXT=$(jq -R -r 'try fromjson catch empty
                          | select(.type == "assistant")
                          | (.message.content // [])
                          | map(select(.type == "text") | .text)
                          | join("\n")' "$TRANSCRIPT_PATH" 2>/dev/null)
[[ -n "$ASSISTANT_TEXT" ]] || exit 0

# Count token *occurrences* (not matching lines — `grep -c` would undercount
# multi-keyword lines). `grep -o` emits one line per match; BSD `wc -l`
# whitespace-pads, so strip with `tr -d ' '` per macOS portability memory.
count_matches() {
  local pat="$1" txt="$2"
  local n
  n=$(printf '%s' "$txt" | grep -oiE -- "$pat" 2>/dev/null | wc -l | tr -d ' ')
  echo "${n:-0}"
}

LESSON_COUNT=$(count_matches 'lesson|gotcha|non-obvious|turns out|踩坑|原因是|原来如此|学到|不该|下次' "$ASSISTANT_TEXT")
DECISION_COUNT=$(count_matches 'non-default|chose .* over|因为.*所以|选 .* 不选|非默认' "$ASSISTANT_TEXT")
LESSON_COUNT=${LESSON_COUNT:-0}
DECISION_COUNT=${DECISION_COUNT:-0}
TOTAL=$(( LESSON_COUNT + DECISION_COUNT ))

# Count mem_save tool_use entries (MCP shape `mcp__*__mem_save`) and Bash
# invocations of `claude-mem-lite save` / `mem save`.
MEM_SAVE_TU=$(jq -R -r 'try fromjson catch empty
                       | select(.type == "assistant")
                       | (.message.content // [])
                       | .[] | select(.type == "tool_use") | .name // empty' \
              "$TRANSCRIPT_PATH" 2>/dev/null \
              | grep -c 'mem_save' || true)
MEM_SAVE_BASH=$(jq -R -r 'try fromjson catch empty
                         | select(.type == "assistant")
                         | (.message.content // [])
                         | .[] | select(.type == "tool_use" and .name == "Bash") | .input.command // empty' \
                "$TRANSCRIPT_PATH" 2>/dev/null \
                | grep -cE 'claude-mem-lite[[:space:]]+(save|mem_save)' || true)
MEM_SAVE_TU=${MEM_SAVE_TU:-0}
MEM_SAVE_BASH=${MEM_SAVE_BASH:-0}
MEM_SAVES=$(( MEM_SAVE_TU + MEM_SAVE_BASH ))

THRESHOLD=${MEMORY_COVERAGE_THRESHOLD:-3}

if (( TOTAL >= THRESHOLD && MEM_SAVES == 0 )); then
  touch "$SENTINEL" 2>/dev/null
  echo "[claudemd] §11 memory-coverage: $TOTAL trigger tokens (lesson=$LESSON_COUNT, decision=$DECISION_COUNT) in assistant text, 0 mem_save calls — review whether any lesson/decision warrants memory persistence." >&2
  echo "  Disable: MEMORY_COVERAGE_SCAN=0 or DISABLE_MEMORY_COVERAGE_HOOK=1" >&2
  EXTRA=$(jq -cn --argjson l "$LESSON_COUNT" --argjson d "$DECISION_COUNT" \
                --argjson m "$MEM_SAVES" --argjson t "$THRESHOLD" \
    '{lesson:$l, decision:$d, mem_saves:$m, threshold:$t, total:($l + $d)}' \
    2>/dev/null) || EXTRA='null'
  hook_record memory-coverage-scan coverage-advisory "$EXTRA" '§11-mem-coverage' "$SESSION_ID"
fi

exit 0
