#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/residue-audit.sh"
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$HOME/.claude/logs"

FAIL=0
PASS=0
# Runtime counter, not a hand-maintained literal: the old `8` drifted the moment
# a case was added (2026-07-28). Every assertion emits exactly one PASS or FAIL.
ok() { echo "PASS: $1"; PASS=$((PASS+1)); }

# Case 1: first call with no baseline → exit 0 silent, creates baseline
# (v0.1.9: first-run establishes baseline without emitting a warning even if
# ~/.claude/tmp already has entries — mirrors sandbox-disposal-check.sh.)
bash "$HOOK" <<<'{}' 2>/dev/null
BASE=$(cat "$HOME/.claude/.claudemd-state/tmp-baseline.txt" 2>/dev/null)
[[ -n "$BASE" ]] && ok "1 baseline created" || { echo "FAIL: 1"; FAIL=$((FAIL+1)); }

# Case 2: growth below threshold → no warning
for i in $(seq 1 5); do mkdir -p "$HOME/.claude/tmp/d$i"; done
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
[[ -z "$STDERR" ]] && ok "2 below-threshold silent" || { echo "FAIL: 2 (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 3: growth above threshold → stderr warning + jsonl row
for i in $(seq 1 30); do mkdir -p "$HOME/.claude/tmp/big$i"; done
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "residue audit" && ok "3 above-threshold warn" || { echo "FAIL: 3"; FAIL=$((FAIL+1)); }

# Case 4: SPEC_RESIDUE_THRESHOLD=5 override triggers. Per v0.1.9, first
# invocation with no baseline is always silent — so we seed a baseline of 0
# before exercising the override, otherwise the first call returns silently
# and test 4 sees empty stderr.
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
echo "v2:0" > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(SPEC_RESIDUE_THRESHOLD=5 bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "threshold: 5" && ok "4 custom threshold" || { echo "FAIL: 4 (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 5: kill-switch
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(DISABLE_RESIDUE_AUDIT_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && ok "5 kill-switch" || { echo "FAIL: 5"; FAIL=$((FAIL+1)); }

# Case 6: tmp dir missing → exit 0 silent
rm -rf "$HOME/.claude/tmp"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && ok "6 missing tmp dir silent" || { echo "FAIL: 6"; FAIL=$((FAIL+1)); }

# Case 7 (v0.23.11): corrupt/non-numeric baseline must fail open (exit 0), not
# crash under `set -u`. Pre-fix `$((CURRENT - garbage))` was an unbound-variable
# error → exit 1, and the bad baseline crashed EVERY subsequent Stop.
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
printf 'garbage-not-a-number' > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
bash "$HOOK" <<<'{}' >/dev/null 2>&1; EC=$?
[[ "$EC" == "0" ]] && ok "7 corrupt baseline fails open (exit 0)" || { echo "FAIL: 7 (exit=$EC)"; FAIL=$((FAIL+1)); }
grep -qE '^v2:[0-9]+$' "$HOME/.claude/.claudemd-state/tmp-baseline.txt" && ok "7b baseline self-healed to numeric" || { echo "FAIL: 7b baseline still corrupt"; FAIL=$((FAIL+1)); }

# Case 9 (v0.65.0, 2026-07-28 audit H3): CURRENT now counts every depth-1 entry,
# files included — `-type d` made a leaked scratch FILE invisible. A v1 baseline
# is a bare integer counting directories only, so comparing across the format
# change would emit a one-time advisory whose delta is just the file count: a
# false alarm indistinguishable from real growth. v1 must re-baseline silently.
rm -rf "$HOME/.claude/tmp"; mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
for i in $(seq 1 40); do : > "$HOME/.claude/tmp/leaked-$i.txt"; done
printf '1' > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"   # v1 shape
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null); EC=$?
[[ "$EC" == "0" && -z "$STDERR" ]] && ok "9 v1 baseline re-baselines silently" || { echo "FAIL: 9 v1 migration emitted (exit=$EC, got: $STDERR)"; FAIL=$((FAIL+1)); }
grep -qE '^v2:[0-9]+$' "$HOME/.claude/.claudemd-state/tmp-baseline.txt" && ok "9b migrated to v2 format" || { echo "FAIL: 9b not migrated ($(cat "$HOME/.claude/.claudemd-state/tmp-baseline.txt"))"; FAIL=$((FAIL+1)); }

# Case 10: loose FILES now register as growth. Pre-fix this delta was always 0.
printf 'v2:0' > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
echo "$STDERR" | grep -q "residue audit" && ok "10 loose files count toward growth" || { echo "FAIL: 10 files invisible (got: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 8 (v0.23.11): non-numeric SPEC_RESIDUE_THRESHOLD must fail open, not crash.
rm -f "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
echo "v2:0" > "$HOME/.claude/.claudemd-state/tmp-baseline.txt"
SPEC_RESIDUE_THRESHOLD=notanumber bash "$HOOK" <<<'{}' >/dev/null 2>&1; EC=$?
[[ "$EC" == "0" ]] && ok "8 non-numeric threshold fails open (exit 0)" || { echo "FAIL: 8 (exit=$EC)"; FAIL=$((FAIL+1)); }

# Cases 11-12 (2026-08-16 audit CONC-3): the baseline must be per-session. One
# global file rewritten by every Stop made the metric "growth since the last
# Stop of ANY session" — under concurrency each session resets the others'
# windows, the threshold becomes unreachable, and a bystander session eats the
# warn for growth it didn't cause. Sessions without a session_id keep the
# legacy global file (blind spot kept, not widened).
rm -f "$HOME/.claude/.claudemd-state"/tmp-baseline*.txt
find "$HOME/.claude/tmp" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null
bash "$HOOK" <<<'{"session_id":"rsA"}' >/dev/null 2>&1
touch "$HOME/.claude/tmp/g1" "$HOME/.claude/tmp/g2" "$HOME/.claude/tmp/g3"
# Case 11: B's FIRST Stop lands mid-window — must not claim A's growth.
STDERR=$(SPEC_RESIDUE_THRESHOLD=2 bash "$HOOK" <<<'{"session_id":"rsB"}' 2>&1 >/dev/null)
if [[ -z "$STDERR" ]]; then
  ok "11 bystander session does not claim another session's tmp growth"
else
  echo "FAIL: 11 (stderr: $STDERR)"; FAIL=$((FAIL+1))
fi
# Case 12: A's own next Stop must still see the full delta — B's Stop must not
# have reset A's baseline.
STDERR=$(SPEC_RESIDUE_THRESHOLD=2 bash "$HOOK" <<<'{"session_id":"rsA"}' 2>&1 >/dev/null)
if echo "$STDERR" | grep -q "grew by 3"; then
  ok "12 owning session still sees its full window delta"
else
  echo "FAIL: 12 owner window reset by another session (stderr: $STDERR)"; FAIL=$((FAIL+1))
fi

# Case 13: ~/.claude/tmp absent at a session's first Stop. The hook exited before
# writing a baseline, so the next Stop took everything the new dir held as its
# baseline and the growth never alarmed. An absent dir counts 0.
rm -rf "$HOME/.claude/tmp"; rm -f "$HOME/.claude/.claudemd-state"/tmp-baseline*.txt
bash "$HOOK" <<<'{"session_id":"rsC"}' >/dev/null 2>&1
mkdir -p "$HOME/.claude/tmp"; for i in $(seq 1 25); do : > "$HOME/.claude/tmp/n$i"; done
STDERR=$(bash "$HOOK" <<<'{"session_id":"rsC"}' 2>&1 >/dev/null)
if echo "$STDERR" | grep -q "grew by 25 entries (current: 25, baseline: 0,"; then
  ok "13 a dir absent at the first Stop gets a zero baseline, so its growth alarms"
else
  echo "FAIL: 13 growth of a dir absent at the first Stop went unflagged (stderr: $STDERR)"; FAIL=$((FAIL+1))
fi

# Case 14: the remedy names the new entries. The old `find … -mtime +7` matched
# none of them: what the audit flags appeared since this session's last Stop.
# Four entries dated 2000, three new: the printed command, run as printed, lists
# exactly the three new ones.
rm -rf "$HOME/.claude/tmp"; mkdir -p "$HOME/.claude/tmp"
for i in 1 2 3 4; do : > "$HOME/.claude/tmp/old$i"; touch -t 200001010000 "$HOME/.claude/tmp/old$i"; done
printf 'v2:4' > "$HOME/.claude/.claudemd-state/tmp-baseline-rsD.txt"
for i in 1 2 3; do : > "$HOME/.claude/tmp/new$i"; done
STDERR=$(SPEC_RESIDUE_THRESHOLD=2 bash "$HOOK" <<<'{"session_id":"rsD"}' 2>&1 >/dev/null)
LINE14=$(echo "$STDERR" | sed -n 2p)
# Run only once it equals the pinned line: never execute whatever the hook printed.
LISTED14=""
[[ "$LINE14" == '[claudemd] The 3 newest entries: ls -At ~/.claude/tmp | head -n 3' ]] \
  && LISTED14=$(bash -c "${LINE14#*: }" 2>/dev/null | sort | tr '\n' ' ')
if [[ "$LISTED14" == "new1 new2 new3 " ]]; then
  ok "14 the remedy lists the new entries, not ones older than 7 days"
else
  echo "FAIL: 14 remedy wrong (line: $LINE14 | lists: $LISTED14)"; FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $PASS/$((PASS + FAIL)) passed"; exit 1
fi
echo "Tests: $PASS/$((PASS + FAIL)) passed"
