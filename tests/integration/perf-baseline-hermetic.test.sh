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
# exists to catch.
#
# Filtering by HOOK NAME narrowed that race without closing it: those same six
# hooks fire constantly in the session running this suite, so any concurrent row
# from one of them landing between the two counts was still counted as probe
# pollution. This audit ran five agents in parallel against this repo, which is
# exactly that condition (2026-08-29 audit R10-12). The probe carries a
# synthetic session_id that nothing else can produce, so that is the filter —
# read out of the script rather than copied, so renaming it there fails HERE
# instead of silently reducing this to a count of zero.
PROBE_SESSION=$(sed -nE 's/^PROBE_SESSION="([^"]+)".*/\1/p' "$ROOT/scripts/perf-baseline.sh" | head -n1)
if [[ -z "$PROBE_SESSION" ]]; then
  echo "FAIL: 0 could not read PROBE_SESSION out of scripts/perf-baseline.sh — the filter anchor moved"
  FAIL=$((FAIL+1))
  PROBE_SESSION='::unresolvable::'
fi
count_probe_rows() {
  local log="${1:-$LOG}" n
  [[ -f "$log" ]] || { echo 0; return; }
  # `grep -c` prints 0 AND exits 1 on no matches, so the old `|| echo 0` tail
  # emitted "0\n0" — two lines into an arithmetic comparison. It never showed
  # because the previous hook-name filter always matched something in the live
  # log. Capture into a variable and let the non-zero status set the default.
  n=$(grep -cF "\"session_id\":\"$PROBE_SESSION\"" "$log" 2>/dev/null) || n=0
  echo "${n:-0}"
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

# Case 5 (0.68.3): a failed self-check must reach the EXIT CODE, not only
# stderr. Case 4 asserts the happy path; without this, the unhappy path printed
# a warning and exited 0, so a scripted caller collected the numbers alongside a
# success code — an instrument that knows it is blind and reports fine. Forced
# through the real kill switch rather than a doctored fixture: with hooks off,
# the must-deny probe cannot deny, which is exactly the condition the
# self-check exists to detect.
PB5_ERR="$SCRATCH/perf-baseline-selfcheck-fail.stderr"
set +e
(cd "$CALLER" && DISABLE_CLAUDEMD_HOOKS=1 bash "$ROOT/scripts/perf-baseline.sh" --runs 1 \
   >/dev/null 2>"$PB5_ERR")
PB5_STATUS=$?
set -e
if (( PB5_STATUS != 0 )) && grep -q "probe self-check did not reach" "$PB5_ERR"; then
  echo "PASS: 5 a failed self-check exits non-zero (status $PB5_STATUS), not just a warning"
else
  echo "FAIL: 5 self-check failure did not reach the exit code (status $PB5_STATUS) — a scripted caller would read the underread numbers as valid:"
  sed 's/^/      /' "$PB5_ERR" | tail -5
  FAIL=$((FAIL+1))
fi

# Case 6 (2026-08-29 audit R10-12): the filter Case 3 rests on must be immune to
# a CONCURRENT row from one of the same hooks. Driven against a fixture log
# rather than the live one — injecting into `$HOME/.claude/logs/claudemd.jsonl`
# to test a telemetry assertion would be the pollution this suite exists to
# catch (feedback_manual_hook_probe_pollutes_telemetry).
FIXLOG="$SCRATCH/concurrent.jsonl"
{
  printf '{"hook":"memory-read-check","event":"deny","session_id":"some-other-session"}\n'
  printf '{"hook":"pre-bash-safety","event":"deny","session_id":"another-live-session"}\n'
} > "$FIXLOG"
C6_BEFORE=$(count_probe_rows "$FIXLOG")
printf '{"hook":"memory-read-check","event":"deny","session_id":"yet-another-session"}\n' >> "$FIXLOG"
C6_AFTER=$(count_probe_rows "$FIXLOG")
printf '{"hook":"memory-read-check","event":"deny","session_id":"%s"}\n' "$PROBE_SESSION" >> "$FIXLOG"
C6_PROBE=$(count_probe_rows "$FIXLOG")
if [[ "$C6_BEFORE" == "0" && "$C6_AFTER" == "0" && "$C6_PROBE" == "1" ]]; then
  echo "PASS: 6 concurrent same-hook rows do not move the count; a probe row does ($C6_BEFORE/$C6_AFTER/$C6_PROBE)"
else
  echo "FAIL: 6 probe-row filter is not session-scoped (before=$C6_BEFORE concurrent=$C6_AFTER probe=$C6_PROBE; expected 0/0/1)"
  FAIL=$((FAIL+1))
fi

TOTAL=$(grep -cE '^  echo "PASS: [0-9]' "$0" 2>/dev/null || echo 6)
if (( FAIL > 0 )); then
  echo "Tests: $((TOTAL - FAIL))/$TOTAL passed"
  exit 1
fi
echo "Tests: $TOTAL/$TOTAL passed"
