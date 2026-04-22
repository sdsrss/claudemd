#!/usr/bin/env bash
# session-start-check.sh — SessionStart hook.
# Auto-runs install.js when the plugin is present but the manifest is missing.
# Saves new users the manual `node .../scripts/install.js` bootstrap step.
# Fail-open on any hiccup — SessionStart must never delay the user's session.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch SESSION_START || exit 0

MANIFEST_NEW="$HOME/.claude/.claudemd-manifest.json"
MANIFEST_OLD="$HOME/.claude/.claudemd-state/installed.json"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Already installed (new or legacy location) — nothing to do. Legacy files
# get relocated the next time any claudemd script calls readManifest().
[[ -f "$MANIFEST_NEW" || -f "$MANIFEST_OLD" ]] && exit 0

# node required to run install.js — silent no-op if absent.
command -v node >/dev/null 2>&1 || exit 0

# Background self-install with a 10s ceiling. Detach so a hanging filesystem
# cannot delay session start. Stdout/stderr captured for post-hoc debug.
LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
LOG="$LOG_DIR/claudemd-bootstrap.log"

(
  {
    echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) SessionStart bootstrap → $PLUGIN_ROOT/scripts/install.js"
    timeout 10 node "$PLUGIN_ROOT/scripts/install.js" 2>&1 || echo "[claudemd] bootstrap exited non-zero or timed out"
  } >> "$LOG"
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

hook_record session-start bootstrap null
exit 0
