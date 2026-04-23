#!/usr/bin/env bash
# version-sync.sh — UserPromptSubmit hook (v0.3.1).
# Piggy-back version-mismatch detection. Complements session-start-check.sh
# by covering the `/plugin marketplace update + install + /reload-plugins`
# path, where CC swaps the active plugin cache pointer mid-session but the
# ~/.claude/CLAUDE*.md files stay at the old version until next SessionStart.
# After this hook lands, the user's first UserPromptSubmit post-reload
# triggers install.js in the background — on-disk spec syncs immediately,
# no /exit required.
#
# Stdout: always 0 bytes. Never injects into the prompt context.
# Runs at most once per session (sentinel file keyed off CLAUDE_SESSION_ID
# or CC's parent PID). Fail-open on every branch.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch USER_PROMPT_SUBMIT || exit 0

# Session-scope sentinel. CC exposes CLAUDE_SESSION_ID when available; fall
# back to PPID (the CC process), which is stable within a single session.
SCOPE="${CLAUDE_SESSION_ID:-$PPID}"
TMP_BASE="${TMPDIR:-/tmp}"
SENTINEL="$TMP_BASE/claudemd-sync-$SCOPE"
[[ -f "$SENTINEL" ]] && exit 0

MANIFEST_NEW="$HOME/.claude/.claudemd-manifest.json"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# No manifest yet → defer to SessionStart bootstrap (fresh-install path has
# nothing to sync *to*). Sentinel write still happens so we don't re-check.
if [[ ! -f "$MANIFEST_NEW" ]]; then
  touch "$SENTINEL" 2>/dev/null || true
  exit 0
fi

# jq / readable package.json required for the version comparison. Anything
# missing → fail-open. Sentinel still written to avoid retry-every-prompt.
if ! command -v jq >/dev/null 2>&1 || [[ ! -r "$PLUGIN_ROOT/package.json" ]]; then
  touch "$SENTINEL" 2>/dev/null || true
  exit 0
fi

PLUGIN_VER="$(jq -r '.version // empty' "$PLUGIN_ROOT/package.json" 2>/dev/null || true)"
INSTALLED_VER="$(jq -r '.version // empty' "$MANIFEST_NEW" 2>/dev/null || true)"

# Sentinel written regardless of outcome — a successful check should not
# re-trigger next prompt. Version mismatch below still spawns the install,
# and the sentinel is session-scoped so a fresh session retries cleanly.
touch "$SENTINEL" 2>/dev/null || true

# Either side unknown (legacy manifest pre-0.1.9, dev-mode non-semver root)
# → defer. Match → nothing to do.
if [[ -z "$PLUGIN_VER" || -z "$INSTALLED_VER" || "$INSTALLED_VER" == "$PLUGIN_VER" ]]; then
  exit 0
fi

# Mismatch. node required to run install.js — silent no-op if absent.
command -v node >/dev/null 2>&1 || exit 0

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
LOG="$LOG_DIR/claudemd-bootstrap.log"

# Same backgrounding pattern as session-start-check.sh: 10s ceiling, detached,
# all output to log. UserPromptSubmit MUST return promptly — the user is
# waiting on the next assistant turn.
(
  {
    echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) UserPromptSubmit piggy-back: manifest $INSTALLED_VER → plugin $PLUGIN_VER"
    timeout 10 node "$PLUGIN_ROOT/scripts/install.js" 2>&1 || echo "[claudemd] piggy-back install exited non-zero or timed out"
  } >> "$LOG"
) </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

hook_record user-prompt-submit version-sync null
exit 0
