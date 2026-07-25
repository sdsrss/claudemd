#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# perf-baseline-hermetic.test.sh — regression gate for the 2026-07-17 incident:
# scripts/perf-baseline.sh ran its git probes in the caller's cwd and left 48
# stray `noop` commits on the real repo (git log --grep=noop v0.51.0..v0.51.1,
# all stamped 15:14:04-05). Asserts the script leaves a caller git repo
# untouched: no new commits, no dirty worktree, and no live-telemetry rows
# (the script must set DISABLE_RULE_HITS_LOG for its synthetic hook probes —
# feedback_manual_hook_probe_pollutes_telemetry).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
FAIL=0

CALLER="$(mktemp -d)"
cleanup() { [[ -n "${CALLER:-}" && -d "$CALLER" ]] && rm -rf "$CALLER"; }
trap cleanup EXIT

git -C "$CALLER" init -q
git -C "$CALLER" config user.email test@claudemd.local
git -C "$CALLER" config user.name perf-hermetic-test
echo "caller fixture" > "$CALLER/README.md"
git -C "$CALLER" add README.md
git -C "$CALLER" commit -qm seed
BEFORE=$(git -C "$CALLER" rev-list --count HEAD)

LOG="$HOME/.claude/logs/claudemd.jsonl"
LOG_BEFORE=0
[[ -f "$LOG" ]] && LOG_BEFORE=$(wc -l < "$LOG" | tr -d ' ')

(cd "$CALLER" && bash "$ROOT/scripts/perf-baseline.sh" --runs 1 >/dev/null 2>&1)

AFTER=$(git -C "$CALLER" rev-list --count HEAD)
DIRTY=$(git -C "$CALLER" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
LOG_AFTER=0
[[ -f "$LOG" ]] && LOG_AFTER=$(wc -l < "$LOG" | tr -d ' ')

if [[ "$AFTER" == "$BEFORE" ]]; then
  echo "PASS: 1 no commits leaked into caller repo ($BEFORE -> $AFTER)"
else
  echo "FAIL: 1 caller repo commit count $BEFORE -> $AFTER (probe leaked)"
  FAIL=$((FAIL+1))
fi

if [[ "$DIRTY" == "0" ]]; then
  echo "PASS: 2 caller worktree stays clean"
else
  echo "FAIL: 2 caller worktree dirty ($DIRTY entries)"
  FAIL=$((FAIL+1))
fi

if [[ "$LOG_AFTER" -le "$LOG_BEFORE" ]]; then
  echo "PASS: 3 no live-telemetry rows written ($LOG_BEFORE -> $LOG_AFTER)"
else
  echo "FAIL: 3 telemetry rows grew $LOG_BEFORE -> $LOG_AFTER (probe pollution)"
  FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((3 - FAIL))/3 passed"
  exit 1
fi
echo "Tests: 3/3 passed"
