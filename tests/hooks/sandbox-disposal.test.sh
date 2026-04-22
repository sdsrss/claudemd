#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/sandbox-disposal-check.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/.claudemd-state" "$HOME/.claude/tmp" "$HOME/.claude/logs"

FAIL=0

# Case 1: first run (no session-start.ref) → creates ref + silent
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" && -f "$HOME/.claude/.claudemd-state/session-start.ref" ]] \
  && echo "PASS: 1 first run silent + ref created" \
  || { echo "FAIL: 1 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 2: no fresh tmp dirs since ref → silent
sleep 1
touch "$HOME/.claude/.claudemd-state/session-start.ref"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 2 no residue silent" || { echo "FAIL: 2 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 3: fresh tmp.XXXXXX created → warn
sleep 1
mkdir -p "$HOME/.claude/tmp/tmp.abc123"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
echo "$STDERR" | grep -q "sandbox disposal" && echo "PASS: 3 warn on mkdtemp residue" \
  || { echo "FAIL: 3 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 4: kill-switch
STDERR=$(DISABLE_SANDBOX_DISPOSAL_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 4 kill-switch" || { echo "FAIL: 4"; FAIL=$((FAIL+1)); }

# Case 5: nested tmp.XXXXXX is NOT walked (M2) — spec §8 forbids recursive
# ~/.claude/ traversal; hook must only scan immediate children of tmp/.
# Reset state for isolation.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp/legit-container" "$HOME/.claude/.claudemd-state"
touch -t 202001010000 "$HOME/.claude/.claudemd-state/session-start.ref"
# Fresh nested mkdtemp-style dir — deep under a legit container.
mkdir -p "$HOME/.claude/tmp/legit-container/tmp.nested_abc"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
# With maxdepth 1, only legit-container (basename doesn't match tmp.) is seen → silent.
# Without maxdepth (old bug), tmp.nested_abc would match → warn.
echo "$STDERR" | grep -q "sandbox disposal" \
  && { echo "FAIL: 5 nested tmp.X walked — recursive traversal bug still present (stderr: $STDERR)"; FAIL=$((FAIL+1)); } \
  || echo "PASS: 5 nested tmp.X ignored (maxdepth 1 respected)"

if (( FAIL > 0 )); then
  echo "Tests: $((5 - FAIL))/5 passed"; exit 1
fi
echo "Tests: 5/5 passed"
