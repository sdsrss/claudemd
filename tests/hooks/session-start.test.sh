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

# Case 4: manifest already present → hook fast-exits, no bootstrap spawn.
# Truncate the bootstrap log so we can detect whether a new line is appended.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 4 manifest-present no-op (no spawn)"
else
  echo "FAIL: 4 hook spawned install despite manifest present (stderr=$STDERR size=$LOG_SIZE)"
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

if (( FAIL > 0 )); then
  echo "Tests: $((6 - FAIL))/6 passed"; exit 1
fi
echo "Tests: 6/6 passed"
