#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here; PASS branch is `echo` which does not fail
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
if echo "$STDERR" | grep -E '^[[:space:]]*-[[:space:]]*$'; then
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

# Case 9 (v0.16.0): plain files matching the prefix are NOT flagged. Regression
# guard for the cross-hook conflict where version-sync.sh's
# `~/.claude/tmp/claudemd-sync-<sid>` sentinel FILES were being flagged as
# sandbox dir leaks (95% of 30d warn volume in production telemetry).
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
touch "$HOME/.claude/tmp/claudemd-sync-fake-session-id"
touch "$HOME/.claude/tmp/tmp.fake-mktemp-file"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -qE 'claudemd-sync-fake-session-id|tmp\.fake-mktemp-file'; then
  echo "FAIL: 9 file matching prefix flagged (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 9 plain files with matching prefix NOT flagged"
fi

# Cases 10-11 (2026-08-16 audit F5/CONC-1): the time window must be
# per-session. With one global session-start.ref shared by every session,
# concurrent sessions both misattributed each other's sandboxes (B's Stop
# flagged A's dir under B's session_id) AND disarmed each other (B's Stop
# advanced the ref, so A's own artifact was never "newer than ref" at A's
# Stop). Sessions without a session_id keep the legacy global ref — same
# blind spot as before, named in the hook comment, not silently worse.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
ISO_SPECS="${HOME_FIXTURE}|both"
# A's first Stop: establishes A's window silently.
bash "$HOOK" <<<'{"session_id":"sessA"}' >/dev/null 2>&1
sleep 1
mkdir "$HOME/.claude/tmp/tmp.owned_by_A"
# Case 10: B's FIRST Stop lands between A's Stops — must not claim A's dir.
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO_SPECS" bash "$HOOK" <<<'{"session_id":"sessB"}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.owned_by_A"; then
  echo "FAIL: 10 session B attributed session A's sandbox (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 10 cross-session sandbox not misattributed"
fi
# Case 11: A's own next Stop must still see its artifact — B must not have
# disarmed A's window.
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO_SPECS" bash "$HOOK" <<<'{"session_id":"sessA"}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.owned_by_A"; then
  echo "PASS: 11 owning session still flags its own sandbox"
else
  echo "FAIL: 11 owning session's window was disarmed by another session's Stop (stderr: $STDERR)"
  FAIL=$((FAIL+1))
fi

TOTAL=11
if (( FAIL > 0 )); then
  echo "Tests: $((TOTAL - FAIL))/$TOTAL passed"; exit 1
fi
echo "Tests: $TOTAL/$TOTAL passed"
