#!/usr/bin/env bash
# transcript-vocab-scan.sh — PostToolUse hook (v0.8.3 R-N8, advisory only).
#
# Reverses banned-vocab-check.sh: instead of scanning git commit messages
# (commit-time enforcement), scan the most recent assistant text in the
# transcript and warn on §10-V banned vocabulary in chat prose. Banned-vocab
# in commit messages was already gated; chat prose was the gap — agent could
# say "significantly faster" all session and only the commit got blocked.
#
# Advisory-only: writes to stderr + rule-hits log; cannot block tool output
# (PostToolUse fires after the assistant text has been sent). The signal
# steers next-turn behavior via the user seeing the warn + the rule-hits
# audit trail.
#
# Opt-in: TRANSCRIPT_VOCAB_SCAN=1 (default OFF). Per v0.6.0 precedent
# (BASH_SAFETY_INDIRECT_CALL), behavior-layer hooks ship with a 30-day FP
# signal-collection period before becoming default-on. Transcript jsonl
# parsing is fragile (CC-internal format), and "agent prose hits chat-prose
# banned-vocab" is a different FP profile from "commit message hits".
#
# Skips ratio-class patterns (`@ratio` reason prefix in banned-vocab.patterns)
# — those are commit-context-only; chat prose makes ratio claims with
# different baseline conventions and would FP heavily on legitimate
# narrative text.
#
# Kill-switches:
#   DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1             — global

set -uo pipefail

# Opt-in gate (default OFF). Check BEFORE sourcing hook-common to keep the
# default-OFF path as cheap as possible (no jq probe, no event read).
[[ "${TRANSCRIPT_VOCAB_SCAN:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch TRANSCRIPT_VOCAB_SCAN || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TRANSCRIPT_PATH=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
[[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)

PATTERNS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/banned-vocab.patterns"
[[ -r "$PATTERNS_FILE" ]] || exit 0

# Extract the LAST assistant text-content block from the transcript jsonl.
# Bound the read to the tail (last 200 lines) — assistant turns are short
# enough that the most-recent one fits comfortably; full-file scan on a
# multi-hour session would slow PostToolUse for no signal gain.
#
# Per-line jsonl parsing: `jq -R` reads each input line as a raw string,
# then `try fromjson catch empty` parses each as JSON and drops corrupt
# rows (CC sometimes appends partial lines mid-write). Without `-R`, jq
# tries to parse the whole stdin as a single JSON value and silently drops
# everything for jsonl input.
#
# `join(" ")` (not "\n") so each assistant turn maps to exactly one output
# line — `tail -n 1` then reliably picks the latest turn's text. With "\n",
# a single turn's multi-line text would be split across output lines and
# tail would grab only the final paragraph of the last turn.
#
# Per-text-block `gsub("[\\r\\n]+"; " ")`: collapse newlines INSIDE each
# .text block before the outer join. Pre-fix, an assistant turn like
# `"I significantly improved X.\n\nNext step is Y."` extracted as multi-line
# text, then `tail -n 1` picked only "Next step is Y." — the §10-V hit
# in the first paragraph was silently dropped. Normalizing internal
# newlines first turns the whole turn into one scan-friendly line.
LAST_TEXT=$(tail -n 200 "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -R -r 'try fromjson catch empty
              | select(.type == "assistant")
              | (.message.content // [])
              | map(select(.type == "text") | .text | gsub("[\\r\\n]+"; " "))
              | join(" ")' 2>/dev/null \
  | awk 'NF' \
  | tail -n 1)
[[ -n "$LAST_TEXT" ]] || exit 0

# Identifier/path mentions are not value claims (mirrors banned-vocab-check.sh's
# v0.23.19 Path 2 + lib/lint.js stripIdentifiers). `\b` treats '-', '/', '.' as
# word boundaries, so a filename/branch/backtick span quoting a high-fire word
# (`comprehensive-parser.js`, `docs/comprehensive-audit`, `\`robust\``) fires
# `\bcomprehensive\b` and inflates the advisory count in rule-hits telemetry.
# Strip, in order: fenced code blocks → inline backtick spans → slashed-path
# runs → bare `name.ext` files (lowercase extension only, so decimals/versions
# like "3.5x"/"v6.14" survive and a bare-word claim still matches).
LAST_TEXT=$(printf '%s\n' "$LAST_TEXT" \
  | awk '/^[[:space:]]*```/{f=!f; next} !f' \
  | sed -E 's/`[^`]*`/ /g; s|[A-Za-z0-9._@~-]*/[A-Za-z0-9._/@~-]*| |g; s/[A-Za-z0-9_-]+\.[a-z][a-z0-9]*/ /g')
[[ -n "${LAST_TEXT//[[:space:]]/}" ]] || exit 0

# Per-session dedup. This is PostToolUse, but the agent's prose precedes a whole
# CHAIN of tool calls — without dedup the SAME last-text turn re-fires the
# advisory row + stderr banner on every tool call in the chain (an agent that
# writes a plan then runs 6 tools would emit the identical §10-V banner 6×).
# Skip when the scanned text is byte-identical to the last text processed this
# session. Fail TOWARD firing on any sentinel I/O error — never silently
# suppress a real advisory. cksum is POSIX-portable (GNU + BSD).
if [[ -n "$SESSION_ID" ]]; then
  VS_STATE_DIR="$HOME/.claude/.claudemd-state"
  VS_SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
  VS_SENTINEL="$VS_STATE_DIR/vocab-scan-${VS_SAFE_SID}.last"
  VS_HASH=$(printf '%s' "$LAST_TEXT" | cksum 2>/dev/null | awk '{print $1"-"$2}')
  if [[ -n "$VS_HASH" && -f "$VS_SENTINEL" && "$(cat "$VS_SENTINEL" 2>/dev/null)" == "$VS_HASH" ]]; then
    exit 0
  fi
  if [[ -n "$VS_HASH" ]]; then
    mkdir -p "$VS_STATE_DIR" 2>/dev/null && printf '%s' "$VS_HASH" > "$VS_SENTINEL" 2>/dev/null || true
  fi
fi

# Scan against banned-vocab.patterns. Skip @ratio-tagged patterns — those
# are commit-baseline-context; chat prose uses ratios in narrative form and
# the @ratio detectors produce too many FPs on text like "70% faster"
# inside a longer baseline-anchored paragraph.
declare -a HITS=()
declare -a REASONS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  local_regex="${line%|*}"
  local_reason="${line##*|}"
  [[ "$local_reason" == "@ratio "* ]] && continue
  if echo "$LAST_TEXT" | grep -qiE "$local_regex"; then
    match=$(echo "$LAST_TEXT" | grep -oiE "$local_regex" | head -n1)
    HITS+=("$match")
    REASONS+=("$local_reason")
  fi
done < "$PATTERNS_FILE"

(( ${#HITS[@]} == 0 )) && exit 0

# Record + advise. PostToolUse cannot deny; advisory only.
HITS_JSON=$(printf '%s\n' "${HITS[@]}" | jq -R . | jq -s .)
hook_record transcript-vocab-scan advisory "{\"matched\":$HITS_JSON}" '§10-V' "$SESSION_ID" "$TOOL_USE_ID"

printf '[claudemd] §10-V drift detected in agent text:\n' >&2
for i in "${!HITS[@]}"; do
  printf '  - %s  (%s)\n' "${HITS[$i]}" "${REASONS[$i]}" >&2
done
printf '  Spec: §10 Specificity (HARD). Cite absolute number or baseline ratio.\n' >&2
printf '  Disable: TRANSCRIPT_VOCAB_SCAN=0 or DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK=1.\n' >&2

exit 0
