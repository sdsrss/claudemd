#!/usr/bin/env bash
# ship-baseline-check.sh — PreToolUse:Bash hook.
# Denies `git push` if base-branch CI is RED, unless bypass present.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch SHIP_BASELINE || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# Filter: git push, not --help
echo "$CMD" | grep -qE '(^|[[:space:];&|])git[[:space:]]+push([[:space:]]|$)' || exit 0
echo "$CMD" | grep -qE '\-\-help|\-h\b' && exit 0

# Require gh CLI
command -v gh >/dev/null 2>&1 || exit 0

# Query latest run with 2s hard timeout
RUN_JSON=$(timeout 2 gh run list --limit 1 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
[[ -n "$RUN_JSON" ]] || exit 0

CONCLUSION=$(printf '%s' "$RUN_JSON" | jq -r '.[0].conclusion // ""' 2>/dev/null)
[[ "$CONCLUSION" == "failure" ]] || { hook_record ship-baseline pass null; exit 0; }

# known-red baseline bypass
HEAD_MSG=$(git log -1 --format=%B 2>/dev/null || true)
if printf '%s' "$HEAD_MSG" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red null
  exit 0
fi

RUN_URL=$(printf '%s' "$RUN_JSON" | jq -r '.[0].url // ""')
RUN_TITLE=$(printf '%s' "$RUN_JSON" | jq -r '.[0].displayTitle // ""')

REASON="§7 Ship-baseline: base-branch CI is RED — $RUN_TITLE
$RUN_URL

Options:
  (a) Fix failing workflow, then retry push.
  (b) Override: prepend commit body with: known-red baseline: <reason>
  (c) Bypass: DISABLE_SHIP_BASELINE_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §7 Ship-baseline check."

hook_record ship-baseline deny "{\"run_url\":\"$RUN_URL\"}"
hook_deny ship-baseline "$REASON"
