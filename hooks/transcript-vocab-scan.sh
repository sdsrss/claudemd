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
LAST_TEXT=$(tail -n 200 "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -R -r 'try fromjson catch empty
              | select(.type == "assistant")
              | (.message.content // [])
              | map(select(.type == "text") | .text)
              | join(" ")' 2>/dev/null \
  | awk 'NF' \
  | tail -n 1)
[[ -n "$LAST_TEXT" ]] || exit 0

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
hook_record transcript-vocab-scan advisory "{\"matched\":$HITS_JSON}" '§10-V'

printf '[claudemd] §10-V drift detected in agent text:\n' >&2
for i in "${!HITS[@]}"; do
  printf '  - %s  (%s)\n' "${HITS[$i]}" "${REASONS[$i]}" >&2
done
printf '  Spec: §10 Specificity (HARD). Cite absolute number or baseline ratio.\n' >&2
printf '  Disable: TRANSCRIPT_VOCAB_SCAN=0 or DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK=1.\n' >&2

exit 0
