#!/usr/bin/env bash
# residue-audit.sh — Stop hook. Advisory only: never emits deny JSON (Stop cannot block).

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch RESIDUE_AUDIT || exit 0

# v0.9.34: best-effort session_id from Stop stdin for audit attribution.
# jq failure loses attribution, not the residue count — record + continue
# (2026-08-16 audit F4: inline guard was invisible to the consumer gate).
SESSION_ID=""
if hook_require_jq; then
  EVENT=$(hook_read_event) || EVENT=""
  if [[ -n "$EVENT" ]]; then
    SESSION_ID=$(hook_jq_field residue-audit "$EVENT" '.session_id // ""') || SESSION_ID=""
  fi
else
  hook_record_failopen residue-audit jq-missing
fi

STATE_DIR="$HOME/.claude/.claudemd-state"
# Per-session baseline (2026-08-16 audit CONC-3): one global baseline was
# rewritten by EVERY session's Stop, so the metric silently became "growth
# since the last Stop of ANY session" — more concurrency, more frequent
# resets, threshold never reachable. Per-session file = growth during this
# session's own window. No session_id → legacy global name (pre-fix blind
# spot, kept not widened). Orphans reaped by scripts/clean-residue.js.
SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
if [[ -n "$SAFE_SID" ]]; then
  BASELINE_FILE="$STATE_DIR/tmp-baseline-${SAFE_SID}.txt"
else
  BASELINE_FILE="$STATE_DIR/tmp-baseline.txt"
fi
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

TMP_DIR="$HOME/.claude/tmp"
[[ -d "$TMP_DIR" ]] || exit 0

# Counts every depth-1 entry, files included. `-type d` alone made loose files
# invisible (2026-07-28 audit H3) — a hook or script that leaks scratch FILES
# into ~/.claude/tmp produced zero growth signal, and spec §7's evidence table
# specifies a path-scoped residue count, not a directory count. `-mindepth 1`
# stops TMP_DIR itself being counted, which the old form silently included.
CURRENT=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')

# First-run: establish baseline silently. A user with a pre-existing
# ~/.claude/tmp/ (e.g. from other plugins or prior sessions) would otherwise
# eat an immediate false alarm with BASELINE=0 on initial Stop. Mirrors
# sandbox-disposal-check.sh, which also exits silently on first call.
if [[ ! -f "$BASELINE_FILE" ]]; then
  echo "v2:$CURRENT" > "$BASELINE_FILE"
  exit 0
fi

BASELINE_RAW=$(cat "$BASELINE_FILE" 2>/dev/null || echo "")
# Format tag (v0.65.0): a v1 baseline is a bare integer counting DIRECTORIES
# (plus TMP_DIR itself). That number is not comparable with the v2 count above,
# so comparing across the change would emit a one-time advisory whose delta is
# just the file count — a false alarm indistinguishable from real growth.
# Re-baseline silently instead, the same posture as first-run.
if [[ "$BASELINE_RAW" =~ ^v2:([0-9]+)$ ]]; then
  BASELINE="${BASH_REMATCH[1]}"
else
  echo "v2:$CURRENT" > "$BASELINE_FILE"
  exit 0
fi
# Defence in depth. The `v2:([0-9]+)` capture above already guarantees a numeric
# BASELINE, so this cannot currently fire — it stays because the original crash
# it prevents is severe and silent: under `set -u`, `$((CURRENT - garbage))`
# treats a non-numeric value as an unbound varname and exits 1 (NOT fail-open),
# and a corrupt baseline then crashed EVERY subsequent Stop. Self-healing to
# CURRENT yields DELTA=0 and no false alarm. Corrupt/legacy baselines are now
# handled one branch up, by re-baselining. A bad threshold still falls to 20.
[[ "$BASELINE" =~ ^[0-9]+$ ]] || BASELINE=$CURRENT
DELTA=$((CURRENT - BASELINE))
THRESHOLD="${SPEC_RESIDUE_THRESHOLD:-20}"
[[ "$THRESHOLD" =~ ^[0-9]+$ ]] || THRESHOLD=20

if (( DELTA > THRESHOLD )); then
  echo "[claudemd] §7 residue audit: ~/.claude/tmp grew by $DELTA entries (current: $CURRENT, baseline: $BASELINE, threshold: $THRESHOLD)." >&2
  # Remediation must cover what CURRENT counts. `-type d` here would remove none
  # of the loose files this hook now counts — the exact case v0.65.0 added — and
  # it also matched ~/.claude/tmp itself. `-mindepth 1` fixes both.
  echo "[claudemd] Consider: find ~/.claude/tmp -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} +" >&2
  hook_record residue-audit warn "{\"delta\":$DELTA,\"current\":$CURRENT,\"baseline\":$BASELINE}" '§7-user-global-state' "$SESSION_ID"
fi

echo "v2:$CURRENT" > "$BASELINE_FILE"
exit 0
