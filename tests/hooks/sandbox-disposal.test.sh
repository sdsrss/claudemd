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
# We cannot assert stderr is empty because the hook also scans /tmp, which on
# CI runners routinely contains fresh tmp.*/claudemd-* directories unrelated
# to this test. Instead: set ref to NOW, then sleep+mkdir our nested path,
# and assert the hook's stderr does NOT mention that specific nested path.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp/legit-container" "$HOME/.claude/.claudemd-state"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
mkdir -p "$HOME/.claude/tmp/legit-container/tmp.nested_m2_marker_xyz"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.nested_m2_marker_xyz"; then
  echo "FAIL: 5 nested tmp.X walked — recursive traversal bug still present (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 5 nested tmp.X ignored (maxdepth 1 respected)"
fi

# Case 6 (v0.1.9 P3a): warn bullet list has no trailing blank " - " entry
# even when FOUND accumulator ends with \n.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
touch -d '1 second ago' "$HOME/.claude/.claudemd-state/session-start.ref" 2>/dev/null \
  || { touch "$HOME/.claude/.claudemd-state/session-start.ref"; sleep 1; }
mkdir -p "$HOME/.claude/tmp/tmp.p3a_bullet_test"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -E '^\s*-\s*$'; then
  echo "FAIL: 6 trailing blank bullet present — sed '/^$/d' regression (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 6 no trailing blank bullet in warn list"
fi

# Cases 7+8 (v0.5.0 §1.B refactor): test the system-tmp filter logic via the
# CLAUDEMD_SCAN_SPECS_OVERRIDE env knob. Pre-v0.5.0 these cases wrote into the
# real /tmp and read the hook's reaction — failed reproducibly on GitHub
# Actions macos-15-arm64 with empty stderr (FOUND list empty in hook) and
# mtime/symlink defenses didn't change the outcome (v0.4.1 / v0.4.2). v0.5.0
# decouples the hook from real /tmp via the override; tests now run identically
# on Linux + macOS without depending on hosted-runner /tmp behavior.
SYSTEM_FIXTURE="$TMP_HOME/system-tmp"
HOME_FIXTURE="$HOME/.claude/tmp"
RS=$'\x1e'

# Case 7: claudemd_only filter rejects ^tmp\. dirs (system /tmp churn from
# vim/pip/cargo/mktemp must NOT be attributed to the agent session).
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
mkdir "$SYSTEM_FIXTURE/tmp.system_marker"
SCAN_OVERRIDE="${SYSTEM_FIXTURE}|claudemd_only${RS}${HOME_FIXTURE}|both"
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$SCAN_OVERRIDE" bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.system_marker"; then
  echo "FAIL: 7 system /tmp/tmp.* attributed to session (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 7 system /tmp/tmp.* not attributed (claudemd_only filter)"
fi

# Case 8: claudemd_only filter accepts ^claudemd- dirs (claudemd-aware code
# that explicitly labels its mkdtemp IS attributable).
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
mkdir "$SYSTEM_FIXTURE/claudemd-test-labeled"
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$SCAN_OVERRIDE" bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -q "claudemd-test-labeled"; then
  echo "PASS: 8 /tmp/claudemd-* still flagged"
else
  echo "FAIL: 8 /tmp/claudemd-* not flagged (stderr: $STDERR)"
  FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((8 - FAIL))/8 passed"; exit 1
fi
echo "Tests: 8/8 passed"
