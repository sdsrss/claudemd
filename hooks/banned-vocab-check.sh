#!/usr/bin/env bash
# banned-vocab-check.sh — PreToolUse:Bash hook.
# Denies git-commit commands whose message matches patterns in banned-vocab.patterns.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch BANNED_VOCAB || exit 0
if ! hook_require_jq; then
  hook_record_failopen banned-vocab jq-missing
  exit 0
fi

EVENT=$(hook_read_event)
if [[ -z "$EVENT" ]]; then
  hook_record_failopen banned-vocab bad-event
  exit 0
fi

TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0

CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)

# R-N5 readonly fast-path. **v0.20.0 default-ON** (§13.3 promotion from
# v0.8.3 opt-in default-OFF). When CMD is a definitely-read-only shape
# (ls / cat / git log / etc., no shell-meta), exit before the per-pattern
# scan loop. Free in this hook (filter on next line is also fast), but
# uniform across all 4 PreToolUse:Bash hooks for cumulative latency.
# Opt-out: BASH_READONLY_FAST_PATH=0.
if [[ "${BASH_READONLY_FAST_PATH:-1}" != "0" ]] && hook_is_readonly_bash "$CMD"; then
  exit 0
fi

# Filter: must be a git commit invocation. `\s` / `\S` aren't portable under
# BSD grep (macOS); use POSIX character classes so behavior matches Linux.
#
# Flatten CMD before regex match so heredoc bodies and other line-2+ content
# can't masquerade as line-start. Per-line `grep -qE` would otherwise see
# each heredoc body line's bare `git commit -m "..."` as `^`-anchored.
# Segment-anchor: require `^` (real start, post-flatten) OR a real shell
# separator (`[[:space:]]*[;&|]+[[:space:]]*`). The looser `[[:space:];&|]`
# allows ANY whitespace (including space after `#` in
# `ls # git commit -m "msg"`) — produced FPs on comments and heredoc bodies
# whose `git commit` substring was treated as a real invocation. Mirrors the
# memory-read-check.sh v0.9.28 segment-anchor fix and the v0.17.4
# ship-baseline-check.sh sibling.
CMD_FLAT=$(printf '%s' "$CMD" | tr '\n' ' ')
TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
echo "$CMD_FLAT" | grep -qE "$TRIGGER_RE" || exit 0

# Per-invocation escape hatch
if echo "$CMD" | grep -qF '[allow-banned-vocab]'; then
  hook_record banned-vocab bypass-escape-hatch null '§10-V' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi

PATTERNS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/banned-vocab.patterns"
if [[ ! -r "$PATTERNS_FILE" ]]; then
  hook_record_failopen banned-vocab patterns-missing
  exit 0
fi

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
# Trade-off: banned words in unrelated argv tokens (filenames, `-c
# user.email=...`, env vars) can cause false positives in this branch — the
# `[allow-banned-vocab]` escape hatch is the documented workaround.
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
hook_record banned-vocab deny "{\"matched\":$HITS_JSON}" '§10-V' "$SESSION_ID" "$TOOL_USE_ID"

hook_deny banned-vocab "$REASON_TEXT"
