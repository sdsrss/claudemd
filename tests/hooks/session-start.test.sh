#!/usr/bin/env bash
# session-start-check.sh tests — self-bootstrap behavior (v0.1.9 P1b).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/session-start-check.sh"
PLUGIN_ROOT="$HERE/../.."
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"

FAIL=0

# Case 1: no manifest at either location → hook spawns install.js in background.
# We don't wait for the background install here — the test only asserts the
# hook exits 0 and records a `bootstrap` event in the rule-hits log.
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 1 first-run silent stdout/stderr" \
  || { echo "FAIL: 1 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Wait for the background install to finish, then assert manifest appeared.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$HOME/.claude/.claudemd-manifest.json" ]] && break
  sleep 0.5
done
[[ -f "$HOME/.claude/.claudemd-manifest.json" ]] \
  && echo "PASS: 2 background install wrote manifest" \
  || { echo "FAIL: 2 manifest never appeared"; FAIL=$((FAIL+1)); }

# Bootstrap log exists (diagnostic trail).
[[ -f "$HOME/.claude/logs/claudemd-bootstrap.log" ]] \
  && echo "PASS: 3 bootstrap log created" \
  || { echo "FAIL: 3 bootstrap log missing"; FAIL=$((FAIL+1)); }

# Case 4: manifest version matches current plugin version → no bootstrap spawn.
# v0.2.5: hook now compares manifest.version against plugin package.json version.
# Case 2 above ran a real install, so the current manifest carries the same
# version as $PLUGIN_ROOT/package.json — match path exercised here.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 4 manifest version-match no-op (no spawn)"
else
  echo "FAIL: 4 hook spawned install despite version match (stderr=$STDERR size=$LOG_SIZE)"
  FAIL=$((FAIL+1))
fi

# Case 5: kill-switch suppresses bootstrap.
rm -f "$HOME/.claude/.claudemd-manifest.json"
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(DISABLE_SESSION_START_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
sleep 1
[[ ! -f "$HOME/.claude/.claudemd-manifest.json" && -z "$STDERR" ]] \
  && echo "PASS: 5 kill-switch suppresses bootstrap" \
  || { echo "FAIL: 5 kill-switch leaked (stderr=$STDERR)"; FAIL=$((FAIL+1)); }

# Case 6: legacy manifest present → hook treats as installed, no spawn.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
mkdir -p "$HOME/.claude/.claudemd-state"
echo '{"version":"0.1.8","entries":[]}' > "$HOME/.claude/.claudemd-state/installed.json"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 6 legacy manifest → no re-bootstrap"
else
  echo "FAIL: 6 hook re-bootstrapped despite legacy manifest (stderr=$STDERR size=$LOG_SIZE)"
  FAIL=$((FAIL+1))
fi

# Case 7 (v0.2.5): manifest present but .version < current plugin → auto-upgrade.
# Regression for the 0.2.2→0.2.4 stuck-upgrade scenario: under the old hook,
# manifest-exists was sufficient to short-circuit. Auto-sync must trigger.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
# Background install needs a moment to write bootstrap log + new manifest.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  NEW_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
  [[ -n "$NEW_VER" && "$NEW_VER" != "0.0.1" ]] && break
  sleep 0.5
done
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "")
POST_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" -gt "0" && "$POST_VER" == "$PLUGIN_VER" ]]; then
  echo "PASS: 7 version-mismatch triggers auto-upgrade (0.0.1 → $PLUGIN_VER)"
else
  echo "FAIL: 7 auto-upgrade not triggered (stderr=$STDERR log_size=$LOG_SIZE post_ver=$POST_VER plugin_ver=$PLUGIN_VER)"
  FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((7 - FAIL))/7 passed"; exit 1
fi
echo "Tests: 7/7 passed"
