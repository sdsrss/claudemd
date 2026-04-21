#!/usr/bin/env bash
# banned-vocab-check.sh — PreToolUse:Bash hook.
# Denies git-commit commands whose message matches patterns in banned-vocab.patterns.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch BANNED_VOCAB || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0

TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0

CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Filter: must be a git commit invocation
echo "$CMD" | grep -qE '(^|[[:space:];&|])git(\s+-c\s+\S+)*\s+commit(\s|$)' || exit 0

# Per-invocation escape hatch
if echo "$CMD" | grep -qF '[allow-banned-vocab]'; then
  hook_record banned-vocab bypass-escape-hatch null
  exit 0
fi

PATTERNS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/banned-vocab.patterns"
[[ -r "$PATTERNS_FILE" ]] || exit 0

# Collect hits
declare -a HITS=()
declare -a REASONS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  local_regex="${line%|*}"
  local_reason="${line##*|}"
  if echo "$CMD" | grep -qiE "$local_regex"; then
    match=$(echo "$CMD" | grep -oiE "$local_regex" | head -n1)
    HITS+=("$match")
    REASONS+=("$local_reason")
  fi
done < "$PATTERNS_FILE"

if (( ${#HITS[@]} == 0 )); then
  exit 0
fi

REASON_TEXT="§10-V Specificity: banned terms detected:"
for i in "${!HITS[@]}"; do
  REASON_TEXT+=$'\n'"  - ${HITS[$i]}  (${REASONS[$i]})"
done
REASON_TEXT+=$'\n\n'"Bypass options:
  (a) Rewrite with absolute numbers (preferred).
  (b) Per-commit escape: include [allow-banned-vocab] in the commit message.
  (c) Disable the hook: DISABLE_BANNED_VOCAB_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §10 Honesty rules — Specificity (HARD)."

HITS_JSON=$(printf '%s\n' "${HITS[@]}" | jq -R . | jq -s .)
hook_record banned-vocab deny "{\"matched\":$HITS_JSON}"

hook_deny banned-vocab "$REASON_TEXT"
