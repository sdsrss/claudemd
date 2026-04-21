#!/usr/bin/env bash
# End-to-end: install → simulate hook invocation → inspect rule-hits → uninstall.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

TMP_HOME=$(mktemp -d)
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

# Phase 3: settings.json has 5 hook entries
JQ_QUERY='(.hooks.PreToolUse[] | select(.matcher=="Bash") | .hooks | length) as $pre
  | (.hooks.Stop[] | select(.matcher=="*") | .hooks | length) as $stop
  | $pre == 3 and $stop == 2'
jq -e "$JQ_QUERY" "$HOME/.claude/settings.json" >/dev/null \
  || { echo "FAIL: settings.json hook count"; exit 1; }

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

# Phase 7: settings.json clean of our entries
REMAIN=$(jq '[.hooks.PreToolUse // [] | .[] | .hooks[] | select(.command | contains("claudemd"))] | length' "$HOME/.claude/settings.json" 2>/dev/null || echo 0)
[[ "$REMAIN" == "0" ]] || { echo "FAIL: claudemd entries remain"; exit 1; }

echo "full-lifecycle: PASS"
