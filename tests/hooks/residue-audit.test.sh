#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/residue-audit.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$HOME/.claude/logs"

FAIL=0

# Case 1: first call with no baseline → exit 0 silent, creates baseline
# (v0.1.9: first-run establishes baseline without emitting a warning even if
# ~/.claude/tmp already has entries — mirrors sandbox-disposal-check.sh.)
bash "$HOOK" <<<'{}' 2>/dev/null
BASE=$(cat "$HOME/.claude/.claudemd-state/tmp-baseline.txt" 2>/dev/null)
[[ -n "$BASE" ]] && echo "PASS: 1 baseline created" || { echo "FAIL: 1"; FAIL=$((FAIL+1)); }

# Case 2: growth below threshold → no warning
for i in $(seq 1 5); do mkdir -p "$HOME/.claude/tmp/d$i"; done
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
[[ -z "$STDERR" ]] && echo "PASS: 2 below-threshold silent" || { echo "FAIL: 2 (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 3: growth above threshold → stderr warning + jsonl row
for i in $(seq 1 30); do mkdir -p "$HOME/.claude/tmp/big$i"; done
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "residue audit" && echo "PASS: 3 above-threshold warn" || { echo "FAIL: 3"; FAIL=$((FAIL+1)); }

# Case 4: SPEC_RESIDUE_THRESHOLD=5 override triggers. Per v0.1.9, first
# invocation with no baseline is always silent — so we seed a baseline of 0
# before exercising the override, otherwise the first call returns silently
# and test 4 sees empty stderr.
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
echo 0 > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(SPEC_RESIDUE_THRESHOLD=5 bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "threshold: 5" && echo "PASS: 4 custom threshold" || { echo "FAIL: 4 (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 5: kill-switch
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(DISABLE_RESIDUE_AUDIT_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 5 kill-switch" || { echo "FAIL: 5"; FAIL=$((FAIL+1)); }

# Case 6: tmp dir missing → exit 0 silent
rm -rf "$HOME/.claude/tmp"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 6 missing tmp dir silent" || { echo "FAIL: 6"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((6 - FAIL))/6 passed"; exit 1
fi
echo "Tests: 6/6 passed"
