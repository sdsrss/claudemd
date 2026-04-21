#!/usr/bin/env bash
# sandbox-disposal-check.sh — Stop hook. Advisory only.
# Warns if tmp.XXXXXX-style mkdtemp directories were created this session.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" || exit 0

hook_kill_switch SANDBOX_DISPOSAL || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
SESSION_REF="$STATE_DIR/session-start.ref"

# Establish session reference if not present
if [[ ! -f "$SESSION_REF" ]]; then
  touch "$SESSION_REF"
  exit 0
fi

# Scan locations for fresh tmp.XXXXXX-style dirs
FOUND=""
for loc in "/tmp" "$HOME/.claude/tmp"; do
  [[ -d "$loc" ]] || continue
  while IFS= read -r path; do
    base=$(basename "$path")
    if [[ "$base" =~ ^tmp\. ]] || [[ "$base" =~ claudemd- ]]; then
      FOUND+="$path"$'\n'
    fi
  done < <(platform_find_newer "$loc" "$SESSION_REF" 2>/dev/null | head -n 50)
done

if [[ -n "$FOUND" ]]; then
  COUNT=$(echo "$FOUND" | grep -c .)
  echo "[claudemd] §8.V4 sandbox disposal: $COUNT fresh temp directories this session." >&2
  echo "$FOUND" | head -n 5 | sed 's/^/  - /' >&2
  hook_record sandbox-disposal warn "{\"count\":$COUNT}"
fi

# Refresh session reference for next run
touch "$SESSION_REF"
exit 0
