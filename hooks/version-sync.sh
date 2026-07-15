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
# platform.sh for platform_timeout (BSD/macOS without coreutils has no `timeout`).
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch USER_PROMPT_SUBMIT || exit 0

# Session-scope sentinel. CC exposes CLAUDE_SESSION_ID when available; fall
# back to PPID (the CC process), which is stable within a single session.
SCOPE="${CLAUDE_SESSION_ID:-$PPID}"
TMP_BASE="${TMPDIR:-/tmp}"
SENTINEL="$TMP_BASE/claudemd-sync-$SCOPE"
[[ -f "$SENTINEL" ]] && exit 0

# Self-cleanup: GC stale claudemd-sync-* sentinels older than 24h. Runs only
# on first prompt of a session (the early-exit above already filtered out
# subsequent prompts), so cost is bounded to once per CC session. -maxdepth 1
# + -mmin (GNU+BSD compatible) + fail-silent — no §8 deep-traversal risk.
find "$TMP_BASE" -maxdepth 1 -name 'claudemd-sync-*' -mmin +1440 -delete 2>/dev/null || true

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

# v0.36.0 — direction gate (same defect family as session-start-check.sh;
# reproduced 2026-07-11, tasks/manifest-pluginroot-stale-cache.md). An
# INSTALLED_VER newer than this hook's own PLUGIN_VER means the hook is firing
# from a stale versioned cache dir; spawning the stale root's install.js would
# downgrade ~/.claude spec + manifest. Skip the spawn — stdout stays 0 bytes
# (this hook's contract); the SessionStart banner + bootstrap log carry the
# user-facing fix, and install.js refuses downgrades on its own (depth).
if [[ "$PLUGIN_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$INSTALLED_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEWER=$(printf '%s\n%s\n' "$PLUGIN_VER" "$INSTALLED_VER" | sort -V | tail -1)
  if [[ "$NEWER" == "$INSTALLED_VER" ]]; then
    LOG_DIR="$HOME/.claude/logs"
    mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
    echo "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) stale plugin root (piggy-back): hook v$PLUGIN_VER < installed v$INSTALLED_VER — sync skipped (would downgrade)" >> "$LOG_DIR/claudemd-bootstrap.log" 2>/dev/null || true
    STALE_EXTRA=$(jq -cn --arg h "$PLUGIN_VER" --arg i "$INSTALLED_VER" '{hook_version:$h, installed_version:$i}' 2>/dev/null) || STALE_EXTRA='null'
    hook_record user-prompt-submit stale-root "$STALE_EXTRA" '' "${CLAUDE_SESSION_ID:-}"
    exit 0
  fi
fi

# Mismatch. node required to run install.js — silent no-op if absent.
command -v node >/dev/null 2>&1 || exit 0

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
LOG="$LOG_DIR/claudemd-bootstrap.log"

# Same backgrounding pattern as session-start-check.sh: 10s ceiling, detached,
# all output to log. UserPromptSubmit MUST return promptly — the user is
# waiting on the next assistant turn.
# Shared spawn (hook-common.sh): same detached 10s-ceiling pattern as the
# SessionStart bootstrap; failure writes the bootstrap-failed sentinel so the
# next SessionStart banners it (stdout here stays 0 bytes — hook contract).
hook_spawn_install "$PLUGIN_ROOT" "$LOG" \
  "[claudemd] $(date -u +%Y-%m-%dT%H:%M:%SZ) UserPromptSubmit piggy-back: manifest $INSTALLED_VER → plugin $PLUGIN_VER" \
  "$INSTALLED_VER" "$PLUGIN_VER"

hook_record user-prompt-submit version-sync null '' "${CLAUDE_SESSION_ID:-}"
exit 0
