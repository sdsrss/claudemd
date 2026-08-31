#!/usr/bin/env bash
# sandbox-disposal-check.sh — Stop hook. Advisory only.
# Warns if tmp.XXXXXX-style mkdtemp directories were created this session.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch SANDBOX_DISPOSAL || exit 0
# The only hook that used to `source platform.sh || exit 0` outright: no
# `2>/dev/null`, no fail-open row, and ABOVE the kill switch, so a missing lib
# killed it with a stderr spray and left nothing on the record (2026-08-29 audit
# R10-06c). Advisory hook, so the impact is a lost warning rather than a lost
# deny — but "the scan silently stopped running" is exactly what OBS-1 exists to
# make visible. Symbol-asserted for the reason memory-read-check.sh:27-35 gives:
# a file truncated mid-definition sources cleanly and defines nothing.
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true
if ! declare -f platform_find_newer >/dev/null 2>&1; then
  hook_record_failopen sandbox-disposal prereq-missing
  exit 0
fi

# v0.9.34: best-effort session_id from Stop stdin for audit attribution.
# Stop event has no tool_use_id (not a tool call). Advisory only — a jq
# failure loses attribution, not the scan, so both failure arms record a
# fail-open row and CONTINUE rather than exit (2026-08-16 audit F4: the
# inline `command -v jq` guard was invisible to jq-guard-consumers.test.js).
SESSION_ID=""
if hook_require_jq; then
  EVENT=$(hook_read_event) || EVENT=""
  if [[ -n "$EVENT" ]]; then
    SESSION_ID=$(hook_jq_field sandbox-disposal "$EVENT" '.session_id // ""') || SESSION_ID=""
  fi
else
  hook_record_failopen sandbox-disposal jq-missing
fi

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

# Per-session window (2026-08-16 audit F5/CONC-1): the ref was one GLOBAL file
# advanced by every session's Stop, so under concurrency session B claimed
# session A's fresh sandboxes (misattributed warn) and then disarmed A's own
# next scan (A's artifact no longer "newer than ref"). One ref per session_id
# fixes both arms; a session WITHOUT a session_id (jq missing/broken, bare
# event) falls back to the legacy global name — the pre-fix blind spot, kept
# rather than silently widened. Orphaned per-session refs are reaped by
# scripts/clean-residue.js (session-ref pattern).
SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9_-' '_')
if [[ -n "$SAFE_SID" ]]; then
  SESSION_REF="$STATE_DIR/session-start-${SAFE_SID}.ref"
else
  SESSION_REF="$STATE_DIR/session-start.ref"
fi

if [[ ! -f "$SESSION_REF" ]]; then
  # First Stop of THIS session: establish the window silently. Scanning here
  # against any other baseline is exactly the misattribution being fixed.
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
    # §8.V4 scope is mkdtemp directories. v0.16.0: skip plain files so the
    # hook stops false-positive-flagging version-sync.sh's per-session
    # `claudemd-sync-<sid>` sentinel files (touch, not mkdtemp) — two of
    # this plugin's own hooks were stepping on each other (95% of 30d warns).
    [[ -d "$path" ]] || continue
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
  hook_record sandbox-disposal warn "{\"count\":$COUNT}" '§8.V4' "$SESSION_ID"
fi

touch "$SESSION_REF"
exit 0
