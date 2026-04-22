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

# Filter: must be a git commit invocation. `\s` / `\S` aren't portable under
# BSD grep (macOS); use POSIX character classes so behavior matches Linux.
echo "$CMD" | grep -qE '(^|[[:space:];&|])git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)' || exit 0

# Per-invocation escape hatch
if echo "$CMD" | grep -qF '[allow-banned-vocab]'; then
  hook_record banned-vocab bypass-escape-hatch null
  exit 0
fi

PATTERNS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/banned-vocab.patterns"
[[ -r "$PATTERNS_FILE" ]] || exit 0

# Extract commit-message bodies (-m / --message) from CMD. §10-V is about the
# commit message, not the whole invocation — scanning `git -c core.editor=...
# commit -m "fix"` across all tokens used to flag unrelated config text.
# Supported forms: `-m "..."`, `-m '...'`, `--message="..."`, `--message='...'`,
# `--message "..."`, `--message '...'`. BSD-safe: uses octal \047 for single
# quote inside regex (some macOS seds/greps don't understand \x27).
SQ=$'\047'
MSG_REGEX="-m[[:space:]]+\"[^\"]*\"|-m[[:space:]]+${SQ}[^${SQ}]*${SQ}|--message=\"[^\"]*\"|--message=${SQ}[^${SQ}]*${SQ}|--message[[:space:]]+\"[^\"]*\"|--message[[:space:]]+${SQ}[^${SQ}]*${SQ}"
MSG_TEXT=""
while IFS= read -r match; do
  body=$(printf '%s' "$match" | sed -E "s/^(-m|--message([= ]))[\"${SQ}]?//; s/[\"${SQ}]\$//")
  [[ -n "$body" ]] && MSG_TEXT+="$body"$'\n'
done < <(printf '%s' "$CMD" | grep -oE -- "$MSG_REGEX" 2>/dev/null)

# Fallback — no -m/--message captured (editor commits, `-F file`, amend with
# no-edit, unusual quoting). Scan the whole CMD to preserve §10-V coverage.
[[ -z "$MSG_TEXT" ]] && MSG_TEXT="$CMD"

# Baseline-context exemption: if the commit message carries an explicit
# before-after anchor (number on both sides of →/->/=>) OR the literal word
# `baseline`, ratio-class patterns (tagged `@ratio` in their reason column)
# are suppressed. Non-ratio hedges/adjectives still deny regardless.
# Aligns with spec §10 "ratio with baseline" permission.
BASELINE_EXEMPT=0
if echo "$MSG_TEXT" | grep -qE '[0-9][^[:space:]]*[[:space:]]*(→|->|=>)[[:space:]]*[0-9]'; then
  BASELINE_EXEMPT=1
elif echo "$MSG_TEXT" | grep -qiE 'baseline'; then
  BASELINE_EXEMPT=1
fi

# Collect hits
declare -a HITS=()
declare -a REASONS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  local_regex="${line%|*}"
  local_reason="${line##*|}"
  is_ratio=0
  if [[ "$local_reason" == "@ratio "* ]]; then
    is_ratio=1
    local_reason="${local_reason#@ratio }"
  fi
  if echo "$MSG_TEXT" | grep -qiE "$local_regex"; then
    if (( is_ratio == 1 && BASELINE_EXEMPT == 1 )); then
      continue
    fi
    match=$(echo "$MSG_TEXT" | grep -oiE "$local_regex" | head -n1)
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
