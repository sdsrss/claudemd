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

# Case 7 (v0.23.11): corrupt/non-numeric baseline must fail open (exit 0), not
# crash under `set -u`. Pre-fix `$((CURRENT - garbage))` was an unbound-variable
# error → exit 1, and the bad baseline crashed EVERY subsequent Stop.
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
printf 'garbage-not-a-number' > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
bash "$HOOK" <<<'{}' >/dev/null 2>&1; EC=$?
[[ "$EC" == "0" ]] && echo "PASS: 7 corrupt baseline fails open (exit 0)" || { echo "FAIL: 7 (exit=$EC)"; FAIL=$((FAIL+1)); }
grep -qE '^[0-9]+$' "$HOME/.claude/.claudemd-state/tmp-baseline.txt" && echo "PASS: 7b baseline self-healed to numeric" || { echo "FAIL: 7b baseline still corrupt"; FAIL=$((FAIL+1)); }

# Case 8 (v0.23.11): non-numeric SPEC_RESIDUE_THRESHOLD must fail open, not crash.
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
echo 0 > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
SPEC_RESIDUE_THRESHOLD=notanumber bash "$HOOK" <<<'{}' >/dev/null 2>&1; EC=$?
[[ "$EC" == "0" ]] && echo "PASS: 8 non-numeric threshold fails open (exit 0)" || { echo "FAIL: 8 (exit=$EC)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((8 - FAIL))/8 passed"; exit 1
fi
echo "Tests: 8/8 passed"
