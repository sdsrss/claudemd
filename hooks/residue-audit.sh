#!/usr/bin/env bash
# residue-audit.sh — Stop hook. Advisory only: never emits deny JSON (Stop cannot block).

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch RESIDUE_AUDIT || exit 0

# v0.9.34: best-effort session_id from Stop stdin for audit attribution.
SESSION_ID=""
if command -v jq >/dev/null 2>&1; then
  EVENT=$(cat 2>/dev/null || true)
  [[ -n "$EVENT" ]] && SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
fi

STATE_DIR="$HOME/.claude/.claudemd-state"
BASELINE_FILE="$STATE_DIR/tmp-baseline.txt"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

TMP_DIR="$HOME/.claude/tmp"
[[ -d "$TMP_DIR" ]] || exit 0

CURRENT=$(find "$TMP_DIR" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

# First-run: establish baseline silently. A user with a pre-existing
# ~/.claude/tmp/ (e.g. from other plugins or prior sessions) would otherwise
# eat an immediate false alarm with BASELINE=0 on initial Stop. Mirrors
# sandbox-disposal-check.sh, which also exits silently on first call.
if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "$CURRENT" > "$BASELINE_FILE"
  exit 0
fi

BASELINE=$(cat "$BASELINE_FILE" 2>/dev/null || echo 0)
# Numeric-guard before arithmetic — under `set -u`, `$((CURRENT - garbage))`
# treats a non-numeric value as an unbound varname and crashes the hook (exit 1,
# NOT fail-open), and a corrupt baseline would then crash EVERY subsequent Stop
# since the file is never re-validated. A corrupt baseline self-heals to CURRENT
# (DELTA=0, no false alarm) and is rewritten below; a bad threshold falls to 20.
[[ "$BASELINE" =~ ^[0-9]+$ ]] || BASELINE=$CURRENT
DELTA=$((CURRENT - BASELINE))
THRESHOLD="${SPEC_RESIDUE_THRESHOLD:-20}"
[[ "$THRESHOLD" =~ ^[0-9]+$ ]] || THRESHOLD=20

if (( DELTA > THRESHOLD )); then
  echo "[claudemd] §7 residue audit: ~/.claude/tmp grew by $DELTA entries (current: $CURRENT, baseline: $BASELINE, threshold: $THRESHOLD)." >&2
  echo "[claudemd] Consider: find ~/.claude/tmp -maxdepth 1 -type d -mtime +7 -exec rm -rf {} +" >&2
  hook_record residue-audit warn "{\"delta\":$DELTA,\"current\":$CURRENT,\"baseline\":$BASELINE}" '§7-user-global-state' "$SESSION_ID"
fi

echo "$CURRENT" > "$BASELINE_FILE"
exit 0
