#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# End-to-end: install → simulate hook invocation → inspect rule-hits → uninstall.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../lib/hook-names.sh
source "$HERE/../lib/hook-names.sh"
# Registry-derived alternation for the two eviction assertions below. Phase 7's
# hand-written copy named 10 of the 15 hooks while asserting that NO claudemd
# entry remained (audit-2026-08-22 条目 8).
HOOK_ALT=$(claudemd_hook_alternation "$REPO") || { echo "FAIL: cannot derive hook names from the registry"; exit 1; }

TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX")
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude"

# Phase 1: install
OUT=$(CLAUDE_PLUGIN_ROOT="$REPO" node "$REPO/scripts/install.js") || { echo "FAIL: install"; exit 1; }
echo "$OUT" | jq -e '.spec == "fresh"' >/dev/null \
  || { echo "FAIL: expected fresh install"; exit 1; }

# Phase 2: spec files in place
# NOTE: spec/ directory is created in M6 (Task 32-34); until then this phase may be skipped.
# For M2, we check that at least ~/.claude/ exists post-install.
[[ -d "$HOME/.claude" ]] || { echo "FAIL: ~/.claude missing"; exit 1; }

# Phase 3: settings.json has NO claudemd hook entries (v0.1.5 moves them to
# the plugin's hooks/hooks.json where ${CLAUDE_PLUGIN_ROOT} actually expands).
# Manifest carries the canonical 5-entry list instead.
if [[ -f "$HOME/.claude/settings.json" ]]; then
  RESIDUE=$(jq --arg alt "$HOOK_ALT" '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("/hooks/(" + $alt + ")\\.sh"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
  [[ "$RESIDUE" == "0" ]] || { echo "FAIL: settings.json carries claudemd hooks (v0.1.5 expects 0)"; exit 1; }
fi
MCOUNT=$(jq '.entries | length' "$HOME/.claude/.claudemd-manifest.json") || { echo "FAIL: manifest unreadable"; exit 1; }
HOOK_COUNT=$(claudemd_hook_basenames "$REPO" | grep -c .) || { echo "FAIL: cannot count registry hooks"; exit 1; }
[[ "$MCOUNT" == "$HOOK_COUNT" ]] || { echo "FAIL: manifest entry count ($MCOUNT != $HOOK_COUNT registry hooks)"; exit 1; }

# Phase 4: simulate banned-vocab hook firing
EVENT='{"session_id":"integ","tool_name":"Bash","tool_input":{"command":"git commit -m '\''significantly improved'\''"},"cwd":"/tmp"}'
DENY=$(echo "$EVENT" | bash "$REPO/hooks/banned-vocab-check.sh" 2>&1 | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DENY" == "deny" ]] || { echo "FAIL: banned-vocab did not deny (got '$DENY')"; exit 1; }

# Phase 5: rule-hits has at least one row
[[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || { echo "FAIL: no jsonl"; exit 1; }
LINES=$(wc -l < "$HOME/.claude/logs/claudemd.jsonl")
(( LINES >= 1 )) || { echo "FAIL: expected rule-hits row"; exit 1; }

# Phase 6: uninstall keep
OUT=$(node "$REPO/scripts/uninstall.js") || { echo "FAIL: uninstall"; exit 1; }
echo "$OUT" | jq -e '.specAction == "keep"' >/dev/null \
  || { echo "FAIL: uninstall outcome"; exit 1; }

# Phase 7: settings.json clean of our entries. Match by known hook basename
# (works for both absolute-path and ${CLAUDE_PLUGIN_ROOT}-form commands).
REMAIN=$(jq --arg alt "$HOOK_ALT" '[.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | test("/hooks/(" + $alt + ")\\.sh"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
[[ "$REMAIN" == "0" ]] || { echo "FAIL: claudemd entries remain"; exit 1; }

echo "full-lifecycle: PASS"
