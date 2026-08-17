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
# Capture file lives OUTSIDE the caller repo: case 2 asserts that repo's
# worktree stays clean, and an artifact dropped inside it fails that assertion
# — which is the same class of finding, just self-inflicted.
SCRATCH="$(mktemp -d)"
cleanup() {
  [[ -n "${CALLER:-}" && -d "$CALLER" ]] && rm -rf "$CALLER"
  [[ -n "${SCRATCH:-}" && -d "$SCRATCH" ]] && rm -rf "$SCRATCH"
}
trap cleanup EXIT

git -C "$CALLER" init -q
git -C "$CALLER" config user.email test@claudemd.local
git -C "$CALLER" config user.name perf-hermetic-test
echo "caller fixture" > "$CALLER/README.md"
git -C "$CALLER" add README.md
git -C "$CALLER" commit -qm seed
BEFORE=$(git -C "$CALLER" rev-list --count HEAD)

LOG="$HOME/.claude/logs/claudemd.jsonl"
# Count only rows the SCRIPT could have written, not every row in the live log.
# A total-row count is racy against the session running the suite: this repo is
# developed from inside Claude Code, whose own hooks append to the same file, so
# the count grows for reasons that have nothing to do with perf-baseline. It
# went red exactly that way during the 0.68.2 pre-tag review (10828 -> 10829,
# written by the reviewer's own hooks) and passed on a standalone re-run —
# indistinguishable, from the assertion's side, from the probe pollution it
# exists to catch. The hooks perf-baseline drives are the four PreToolUse:Bash
# ones plus the two UserPromptSubmit ones; those names are the filter.
PROBED_HOOKS='pre-bash-safety-check|banned-vocab-check|ship-baseline-check|memory-read-check|version-sync|memory-prompt-hint'
count_probe_rows() {
  [[ -f "$LOG" ]] || { echo 0; return; }
  grep -cE "\"hook\":\"($PROBED_HOOKS)\"" "$LOG" 2>/dev/null || echo 0
}
LOG_BEFORE=$(count_probe_rows)

PB_ERR="$SCRATCH/perf-baseline.stderr"
(cd "$CALLER" && bash "$ROOT/scripts/perf-baseline.sh" --runs 1 >/dev/null 2>"$PB_ERR")

AFTER=$(git -C "$CALLER" rev-list --count HEAD)
DIRTY=$(git -C "$CALLER" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
LOG_AFTER=$(count_probe_rows)

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
  echo "PASS: 3 no live-telemetry rows written by the probed hooks ($LOG_BEFORE -> $LOG_AFTER)"
else
  echo "FAIL: 3 telemetry rows grew $LOG_BEFORE -> $LOG_AFTER (probe pollution)"
  FAIL=$((FAIL+1))
fi

# Case 4 (2026-08-17): the script's own probe self-check must pass. For two
# months it measured hook cost in a sandbox with no MEMORY.md, so
# memory-read-check took its fail-open exit and the tool reported 0.03s for a
# hook that costs 1.91s against a populated index. The script now drives a
# must-deny command before timing and warns on stderr when that probe does not
# reach the scan; a silent stderr is the assertion that the numbers mean
# something. Anything else on stderr is also a finding — this script is a
# measurement instrument, and noise on its error channel is how the last
# underread stayed invisible.
if [[ ! -s "$PB_ERR" ]]; then
  echo "PASS: 4 probe self-check clean (fixture reaches the data-dependent path)"
else
  echo "FAIL: 4 perf-baseline wrote to stderr — probes may not reach the hooks they time:"
  sed 's/^/      /' "$PB_ERR"
  FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((4 - FAIL))/4 passed"
  exit 1
fi
echo "Tests: 4/4 passed"
