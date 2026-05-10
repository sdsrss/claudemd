#!/usr/bin/env bash
# session-extended-read.sh — PreToolUse:Read hook (v0.10.1).
#
# Records when a session reads the canonical user-global extended spec
# `~/.claude/CLAUDE-extended.md`. Provides the per-session denominator
# signal for §13.1 demote analysis on extended-scope rules — a "0 hits"
# count for an extended rule is only meaningful against the count of
# sessions that actually loaded extended (per spec §2.2 EXT LOADING).
#
# Per-session dedup via `~/.claude/.claudemd-state/ext-read-<sid>.ts`
# sentinel: the row reflects "extended was loaded once this session"
# (binary), not Read frequency. Without dedup, an agent doing N Reads
# of the same file would inflate the denominator into a frequency
# metric, which §13.1 does not evaluate.
#
# Project source paths (e.g. `claudemd/spec/CLAUDE-extended.md` that
# maintainers Read while editing) are deliberately NOT counted — they
# are spec-edit traffic, not §2.2 EXT-load events.
#
# Kill-switch: DISABLE_SESSION_EXTENDED_READ_HOOK=1
# Fail-open on any hiccup — PreToolUse hooks can deny but this one never does.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch SESSION_EXTENDED_READ || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Read" ]] || exit 0

FILE_PATH=$(printf '%s' "$EVENT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
[[ "$FILE_PATH" == "$HOME/.claude/CLAUDE-extended.md" ]] || exit 0

SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)
[[ -n "$SESSION_ID" ]] || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
# UUID-shaped session_ids are filesystem-safe, but defensively normalize
# any non-[alnum-] char so a future session_id format change can't open
# a path-traversal vector (`../`, etc.) through the sentinel filename.
SAFE_SID=$(printf '%s' "$SESSION_ID" | tr -c '[:alnum:]-' '_')
SENTINEL="$STATE_DIR/ext-read-${SAFE_SID}.ts"
[[ -f "$SENTINEL" ]] && exit 0
date +%s > "$SENTINEL" 2>/dev/null || true

hook_record session-extended-read read 'null' '§13.1-extended-read' "$SESSION_ID" "$TOOL_USE_ID"
exit 0
