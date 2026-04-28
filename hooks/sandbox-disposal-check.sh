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

if [[ ! -f "$SESSION_REF" ]]; then
  touch "$SESSION_REF"
  exit 0
fi

# Scan-spec format: DIR|FILTER pairs separated by ASCII record separator (RS, \x1e).
# FILTER: claudemd_only (system /tmp — only ^claudemd- prefix attributable)
#         both          (~/.claude/tmp — both ^tmp\. and ^claudemd-).
# Override via CLAUDEMD_SCAN_SPECS_OVERRIDE for tests; production default below.
DEFAULT_SCAN_SPECS=$(printf '/tmp|claudemd_only\x1e%s|both' "$HOME/.claude/tmp")
SCAN_SPECS="${CLAUDEMD_SCAN_SPECS_OVERRIDE:-$DEFAULT_SCAN_SPECS}"

FOUND=""
while IFS= read -r -d $'\x1e' spec || [[ -n "$spec" ]]; do
  [[ -n "$spec" ]] || continue
  loc="${spec%|*}"
  filter="${spec##*|}"
  [[ -d "$loc" ]] || continue
  while IFS= read -r path; do
    base=$(basename "$path")
    case "$filter" in
      claudemd_only) [[ "$base" =~ ^claudemd- ]] || continue ;;
      both)          [[ "$base" =~ ^tmp\. ]] || [[ "$base" =~ ^claudemd- ]] || continue ;;
      *)             continue ;;
    esac
    FOUND+="$path"$'\n'
  done < <(platform_find_newer "$loc" "$SESSION_REF" 2>/dev/null | head -n 50)
done < <(printf '%s\x1e' "$SCAN_SPECS")

if [[ -n "$FOUND" ]]; then
  COUNT=$(echo "$FOUND" | grep -c .)
  echo "[claudemd] §8.V4 sandbox disposal: $COUNT fresh temp directories this session." >&2
  printf '%s' "$FOUND" | sed -e '/^$/d' -e 's/^/  - /' | head -n 5 >&2
  hook_record sandbox-disposal warn "{\"count\":$COUNT}"
fi

touch "$SESSION_REF"
exit 0
