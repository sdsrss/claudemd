#!/usr/bin/env bash
# residue-audit.sh — Stop hook. Advisory only: never emits deny JSON (Stop cannot block).

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch RESIDUE_AUDIT || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
BASELINE_FILE="$STATE_DIR/tmp-baseline.txt"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

TMP_DIR="$HOME/.claude/tmp"
[[ -d "$TMP_DIR" ]] || exit 0

CURRENT=$(find "$TMP_DIR" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
BASELINE=0
[[ -f "$BASELINE_FILE" ]] && BASELINE=$(cat "$BASELINE_FILE" 2>/dev/null || echo 0)

DELTA=$((CURRENT - BASELINE))
THRESHOLD="${SPEC_RESIDUE_THRESHOLD:-20}"

if (( DELTA > THRESHOLD )); then
  echo "[claudemd] §7 residue audit: ~/.claude/tmp grew by $DELTA entries (current: $CURRENT, baseline: $BASELINE, threshold: $THRESHOLD)." >&2
  echo "[claudemd] Consider: find ~/.claude/tmp -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +" >&2
  hook_record residue-audit warn "{\"delta\":$DELTA,\"current\":$CURRENT,\"baseline\":$BASELINE}"
fi

echo "$CURRENT" > "$BASELINE_FILE"
exit 0
