#!/usr/bin/env bash
# sandbox-disposal-check.sh — Stop hook. Advisory by default.
# Warns about tmp.XXXXXX-style mkdtemp directories that appeared or changed
# since this session's previous Stop (mtime, not ownership — a concurrent
# session's sandbox can show up too), in the places spec §8.V4 names for
# test/probe residue: /tmp (and
# ~/.claude/tmp), /var/tmp, and ~/.claude/projects/ (the transcript dir a
# headless `claude -p` probe leaves behind when it runs from a temp cwd).
#
# macOS: /tmp is a symlink and platform_find_newer (find -P) does not descend
# it, so the /tmp arm finds nothing there; $TMPDIR is not scanned. Pre-existing
# and open, recorded rather than fixed in 0.97.0.
#
# Timing: by default a directory is reported only if it is still there at the
# session's NEXT Stop (v0.98.0); SANDBOX_DISPOSAL_IMMEDIATE=1 reports it at the
# Stop that first sees it, as before. See the pending-list block below.
#
# Opt-in: SANDBOX_DISPOSAL_BLOCK=1 returns {"decision":"block"} instead, so the
# turn continues and the session removes what it created — the reason says
# some entries may belong to another session. The window is NOT
# advanced on a block, and the Stop that follows (`stop_hook_active`) only
# warns — at most one block per turn. Default OFF (§EXT §13.3).
# Kill-switches:
#   DISABLE_SANDBOX_DISPOSAL_HOOK=1 — this hook
#   DISABLE_CLAUDEMD_HOOKS=1        — global

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
TRANSCRIPT_PATH=""
STOP_HOOK_ACTIVE=""
if hook_require_jq; then
  EVENT=$(hook_read_event) || EVENT=""
  if [[ -n "$EVENT" ]]; then
    SESSION_ID=$(hook_jq_field sandbox-disposal "$EVENT" '.session_id // ""') || SESSION_ID=""
    TRANSCRIPT_PATH=$(hook_jq_field sandbox-disposal "$EVENT" '.transcript_path // ""') || TRANSCRIPT_PATH=""
    STOP_HOOK_ACTIVE=$(hook_jq_field sandbox-disposal "$EVENT" '.stop_hook_active // false') || STOP_HOOK_ACTIVE=""
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
#         both          (~/.claude/tmp, /var/tmp — both ^tmp\. and ^claudemd-).
#                       /var/tmp is not mktemp's default root, so a fresh
#                       tmp.* there was placed deliberately (`mktemp -p`);
#                       /tmp's tmp.* churn from vim/pip/cargo is why /tmp
#                       stays claudemd_only.
#         probe_session (~/.claude/projects — a project dir whose encoded
#                       cwd is a temp dir: -tmp-, -var-tmp-, and macOS
#                       -private-tmp- / -private-var-folders- / -var-folders-.
#                       The dir holding this session's own transcript_path
#                       is excluded: a session run from a temp cwd writes
#                       subagent transcripts there, which moves its mtime.)
# Depth 1 for every scan (platform_find_newer), plus one level into an explicit
# probe_session candidate: §8 forbids descending ~/.claude/ any further.
# Override via CLAUDEMD_SCAN_SPECS_OVERRIDE for tests; production default below.
DEFAULT_SCAN_SPECS=$(printf '/tmp|claudemd_only\x1e%s|both\x1e/var/tmp|both\x1e%s|probe_session' \
  "$HOME/.claude/tmp" "$HOME/.claude/projects")
OWN_PROJECT_DIR=""
[[ -n "$TRANSCRIPT_PATH" ]] && OWN_PROJECT_DIR=$(dirname "$TRANSCRIPT_PATH")
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
      probe_session)
        [[ "$base" =~ ^-(private-)?(tmp|var-tmp|var-folders)- ]] || continue
        [[ "$path" != "$OWN_PROJECT_DIR" ]] || continue
        # Every direct entry modified since the ref (none at or before it). A
        # dir that still holds an untouched older file existed before the
        # window and only moved because some session added to it (0.97.0
        # pre-tag review H1). Any entry type counts: an old memory/ subdir is
        # what usually marks a real pre-existing project dir. mtime, not
        # ownership — the warn and block text say entries may belong to
        # another session. One level into an explicit path (§8 depth cap).
        [[ -z "$(find "$path" -mindepth 1 -maxdepth 1 ! -newer "$SESSION_REF" 2>/dev/null | head -n 1)" ]] || continue ;;
      *)             continue ;;
    esac
    FOUND+="$path"$'\n'
  done < <(platform_find_newer "$loc" "$SESSION_REF" 2>/dev/null | head -n 50)
done < <(printf '%s\x1e' "$SCAN_SPECS")

# Timing (v0.98.0). The default is DEFERRED: a candidate is remembered at the
# Stop that first sees it and reported only if it still exists at this
# session's NEXT Stop. The first-sight report named directories that were still
# in use — 149 of 149 paths reported since the 2026-09-25 boot were gone
# afterwards, 127 of them this repo's own test-suite dirs, alive at Stop only
# because a background run had not finished (docs/claude-session-analysis-
# 2026-09-26.md B7). Cost: residue left in a session's LAST turn is never
# reported, because there is no next Stop. SANDBOX_DISPOSAL_IMMEDIATE=1
# restores first-sight reporting. The pending list is per session, like the
# window ref, and clean-residue reaps orphans of it (sandbox-pending kind).
if [[ -n "$SAFE_SID" ]]; then
  PENDING_FILE="$STATE_DIR/sandbox-pending-${SAFE_SID}.list"
else
  PENDING_FILE="$STATE_DIR/sandbox-pending.list"
fi
if [[ "${SANDBOX_DISPOSAL_IMMEDIATE:-0}" == "1" ]]; then
  MODE=immediate
  NEXT_PENDING=""
else
  MODE=deferred
  CONFIRMED=""
  if [[ -f "$PENDING_FILE" ]]; then
    while IFS= read -r p; do
      [[ -n "$p" && -d "$p" ]] && CONFIRMED+="$p"$'\n'
    done < "$PENDING_FILE"
  fi
  NEXT_PENDING=""
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    case $'\n'"$CONFIRMED" in *$'\n'"$p"$'\n'*) continue ;; esac
    NEXT_PENDING+="$p"$'\n'
  done <<< "$FOUND"
  FOUND="$CONFIRMED"
fi
# Written before the verdict; a block below rewrites it to hold the reported
# dirs instead, so the Stop that follows the block re-checks them.
if [[ -n "$NEXT_PENDING" ]]; then
  printf '%s' "$NEXT_PENDING" > "$PENDING_FILE" 2>/dev/null
else
  rm -f "$PENDING_FILE" 2>/dev/null
fi
if [[ "$MODE" == deferred ]]; then
  WHEN="were created or changed during an earlier turn of this session and are still present"
else
  WHEN="appeared or changed since this session's previous stop"
fi

if [[ -n "$FOUND" ]]; then
  COUNT=$(echo "$FOUND" | grep -c .)
  LIST=$(printf '%s' "$FOUND" | sed -e '/^$/d' -e 's/^/  - /' | head -n 5)
  # Block only on opt-in, only with jq (the verdict is built by jq), and never
  # on the Stop that a block itself caused. The window stays open on a block
  # so that Stop re-scans: a dir still there is reported, not forgotten.
  if [[ "${SANDBOX_DISPOSAL_BLOCK:-0}" == "1" && "$STOP_HOOK_ACTIVE" != "true" ]] \
     && command -v jq >/dev/null 2>&1; then
    REASON=$(printf '[claudemd] §8.V4 sandbox disposal: %s temp directories %s (up to 5 listed). Some may belong to another session or process — remove only the ones this task created (guard the path: rm -rf "${D:?}"), keep any the user asked to keep, then finish.\n%s' "$COUNT" "$WHEN" "$LIST")
    if jq -nc --arg r "$REASON" '{decision:"block", reason:$r}' 2>/dev/null; then
      # Only the CONFIRMED dirs stay pending: the window is not advanced on a
      # block, so this Stop's first-sight candidates are re-found by the next
      # scan and must not be promoted to confirmed within the same turn.
      [[ "$MODE" == deferred ]] && printf '%s' "$FOUND" > "$PENDING_FILE" 2>/dev/null
      hook_record sandbox-disposal block "{\"count\":$COUNT,\"mode\":\"$MODE\"}" '§8.V4' "$SESSION_ID"
      exit 0
    fi
  fi
  echo "[claudemd] §8.V4 sandbox disposal: $COUNT temp directories $WHEN (up to 5 listed; some may belong to another session)." >&2
  printf '%s\n' "$LIST" >&2
  hook_record sandbox-disposal warn "{\"count\":$COUNT,\"mode\":\"$MODE\"}" '§8.V4' "$SESSION_ID"
fi

touch "$SESSION_REF"
exit 0
