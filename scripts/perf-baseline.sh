#!/usr/bin/env bash
# perf-baseline.sh — measure hook overhead on a fixed set of bash commands.
#
# Replaces the "200-400 ms estimate" handed down across audits with measured
# numbers. Runs each test command N times with hooks ON vs hooks OFF
# (DISABLE_CLAUDEMD_HOOKS=1) and reports median delta. Output is plain TSV
# on stdout for piping into a CHANGELOG line; one JSON line per command on
# stderr for machine consumption.
#
# Usage:
#   bash scripts/perf-baseline.sh [--runs N] [--json]
#
# Caveats:
#   - "Hooks ON" here means "execute the hook script directly via stdin",
#     not "go through the CC harness". The harness adds its own overhead
#     (event JSON construction, timeout enforcement) that this script does
#     not measure. Treat the numbers as a lower bound on real hook cost.
#   - Wall-clock timing is sensitive to system load; run in a quiet shell.
#
# 2026-08-17 — the sandbox now carries a MEMORY.md, a transcript and a
# rule-hits log, and HOME points at it.
#
# Before that, the probes ran in a bare `mktemp -d` with the caller's real HOME.
# No memory index exists for a throwaway cwd, so memory-read-check.sh took its
# `[[ -f "$MEM_INDEX" ]] || exit 0` fail-open exit and this script reported
# 0.03s for a hook that cost 1.91s against a populated index — a 60x underread,
# and structural rather than unlucky: the fixture omitted the data the cost
# scales with. The hook that finally blew its hooks.json timeout in a live
# session (memory-prompt-hint.sh, UserPromptSubmit) was not probed here at all.
# An instrument that reports zero for the expensive path is worse than no
# instrument, because it is quoted as evidence.
#
# Still NOT covered here, stated rather than left to be discovered: the
# SessionStart / Stop / SessionEnd / PostToolUse chains. Their per-hook budget
# is asserted by tests/hooks/hook-budget.test.sh, which drives every
# data-scaling hook against a production-scale fixture and fails when one
# crosses half its declared timeout.

set -uo pipefail

RUNS=10
JSON_OUT=0
while (( $# > 0 )); do
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    --json) JSON_OUT=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/hooks"

# All probe commands execute inside a throwaway git repo. The git probes used
# to run in the CALLER's cwd — a high --runs invocation from the claudemd repo
# root left 48 stray `noop` commits on main (2026-07-17, pushed with the next
# release). §8.V3: probes never touch the live repo. Telemetry is disabled for
# the direct hook invocations — they are synthetic probes, not real sessions
# (feedback_manual_hook_probe_pollutes_telemetry).
export DISABLE_RULE_HITS_LOG=1
SANDBOX="$(mktemp -d)"
cleanup_sandbox() { [[ -n "${SANDBOX:-}" && -d "$SANDBOX" ]] && rm -rf "$SANDBOX"; }
trap cleanup_sandbox EXIT
git -C "$SANDBOX" init -q
git -C "$SANDBOX" config user.email perf-baseline@claudemd.local
git -C "$SANDBOX" config user.name perf-baseline
echo "perf-baseline fixture" > "$SANDBOX/README.md"
git -C "$SANDBOX" add README.md
git -C "$SANDBOX" commit -qm seed

# Sandbox HOME carrying the data the hooks' cost scales with (see Caveats).
# The memory index is sized at this maintainer's own order of magnitude rather
# than a toy 3-entry fixture — a 3-entry index measures the same "0.03s" the
# empty one did.
FIX_HOME="$SANDBOX/home"
PROBE_CWD="$SANDBOX"
ENCODED=$(printf '%s' "$PROBE_CWD" | tr -c 'a-zA-Z0-9-' '-')
MEM_DIR="$FIX_HOME/.claude/projects/$ENCODED/memory"
PROBE_SESSION="perf-baseline-session"
TRANSCRIPT="$FIX_HOME/.claude/projects/$ENCODED/$PROBE_SESSION.jsonl"
mkdir -p "$MEM_DIR" "$FIX_HOME/.claude/logs"
awk 'BEGIN {
  for (i = 1; i <= 80; i++)
    printf "- [Entry %d](feedback_perf_%d.md) `[perftag%d, perfalpha%d, perfbeta%d, perfgamma%d]` — perf-baseline fixture entry %d\n",
      i, i, i, i, i, i, i
}' > "$MEM_DIR/MEMORY.md"
i=1
while (( i <= 80 )); do
  : > "$MEM_DIR/feedback_perf_$i.md"
  i=$((i + 1))
done
awk -v n=1500 'BEGIN {
  pad = ""
  for (i = 0; i < 700; i++) pad = pad "x"
  for (i = 1; i <= n; i++) {
    printf "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"perf fixture turn %d %s\"}}\n", i, pad
    printf "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"reply %d %s\"}]}}\n", i, pad
  }
}' > "$TRANSCRIPT"
export HOME="$FIX_HOME"

cd "$SANDBOX" || exit 1

# Construct a synthetic Bash event envelope and pipe it to each PreToolUse
# Bash hook in declaration order. Mirrors hooks/hooks.json L20-26.
# cwd/session_id are populated so the memory + transcript hooks resolve the
# sandbox fixture instead of exiting at their `-f` guards.
run_pretoolse_bash() {
  local cmd="$1"
  local event
  event=$(jq -cn --arg cmd "$cmd" --arg c "$PROBE_CWD" --arg s "$PROBE_SESSION" \
    '{tool_name:"Bash", cwd:$c, session_id:$s, tool_use_id:"perf-probe",
      tool_input:{command:$cmd}}')
  for hook in pre-bash-safety-check banned-vocab-check ship-baseline-check memory-read-check; do
    printf '%s' "$event" | bash "$HOOKS_DIR/$hook.sh" >/dev/null 2>&1
  done
}

# The UserPromptSubmit chain — the one that actually crossed its timeout in a
# live session, and the one this script never probed.
run_user_prompt_submit() {
  local prompt="$1"
  local event
  event=$(jq -cn --arg p "$prompt" --arg c "$PROBE_CWD" --arg s "$PROBE_SESSION" \
    '{hook_event_name:"UserPromptSubmit", prompt:$p, cwd:$c, session_id:$s}')
  for hook in version-sync memory-prompt-hint; do
    printf '%s' "$event" | bash "$HOOKS_DIR/$hook.sh" >/dev/null 2>&1
  done
}

# Median of N runs, in milliseconds (integer).
#
# bash's `time` builtin rather than `date +%s%N`: %N is a GNU extension that BSD
# date does not implement, so on macOS the old form substituted a literal `N`
# and every subtraction was arithmetic on garbage — the script printed numbers
# that were not measurements. TIMEFORMAT='%R' is a bash feature and behaves the
# same on both legs.
time_runs() {
  local label="$1" cmd="$2"
  local times=()
  local i secs
  local TIMEFORMAT='%R'
  for (( i = 0; i < RUNS; i++ )); do
    secs=$( { time eval "$cmd" >/dev/null 2>&1; } 2>&1 )
    [[ "$secs" =~ ^[0-9]+\.[0-9]+$ ]] || secs=0
    times+=("$(awk -v s="$secs" 'BEGIN { printf "%d", s * 1000 }')")
  done
  printf '%s\n' "${times[@]}" | sort -n | awk -v n="$RUNS" 'NR==int(n/2)+1 {print; exit}'
}

# Test commands — representative shapes the 4 PreToolUse:Bash hooks see.
declare -a CMDS=(
  "ls /tmp >/dev/null"
  "git log --oneline -1"
  "git status"
  "git commit --allow-empty -m 'noop'"           # exercises banned-vocab
  "echo hello world"
  "cat README.md | head -1"
)
declare -a LABELS=(
  "ls"
  "git_log"
  "git_status"
  "git_commit_noop"
  "echo"
  "cat_head"
)

# Self-check BEFORE timing anything: drive memory-read-check with a command
# that must deny against the fixture. If it does not, the probes are not
# reaching the data-dependent path and every number below is an underread —
# which is precisely how this script reported 0.03s for a 1.91s hook for two
# months. A control that must produce a specific result, run before the
# measurement it validates (feedback_probe_harness_controls_first).
REACH_EVENT=$(jq -cn --arg c "$PROBE_CWD" --arg s "$PROBE_SESSION" \
  '{tool_name:"Bash", cwd:$c, session_id:$s, tool_use_id:"perf-reach",
    tool_input:{command:"git push origin main perftag7"}}')
REACH_OUT=$(printf '%s' "$REACH_EVENT" | bash "$HOOKS_DIR/memory-read-check.sh" 2>/dev/null)
if ! printf '%s' "$REACH_OUT" | grep -q '"permissionDecision": *"deny"'; then
  echo "WARNING: probe self-check failed — memory-read-check did not reach its" >&2
  echo "         MEMORY.md scan against the sandbox fixture, so the numbers below" >&2
  echo "         UNDERSTATE hook cost. Fix the fixture before quoting them." >&2
fi

# Header.
printf '%-20s\t%10s\t%10s\t%10s\n' "command" "off_ms" "on_ms" "delta_ms"
printf '%-20s\t%10s\t%10s\t%10s\n' "-------" "------" "-----" "--------"

for i in "${!CMDS[@]}"; do
  label="${LABELS[$i]}"
  cmd="${CMDS[$i]}"

  # OFF: kill-switch on hook chain — measure baseline command cost.
  off_ms=$(DISABLE_CLAUDEMD_HOOKS=1 time_runs "$label-off" "$cmd")

  # ON: invoke hook chain explicitly before the command. Approximates
  # "what CC would add" without the harness round-trip.
  on_cmd="run_pretoolse_bash '$cmd'; $cmd"
  on_ms=$(time_runs "$label-on" "$on_cmd")

  delta=$(( on_ms - off_ms ))
  printf '%-20s\t%10s\t%10s\t%10s\n' "$label" "$off_ms" "$on_ms" "$delta"

  if (( JSON_OUT )); then
    jq -cn --arg label "$label" --argjson off "$off_ms" --argjson on "$on_ms" --argjson delta "$delta" \
      '{label: $label, off_ms: $off, on_ms: $on, delta_ms: $delta}' >&2
  fi
done

# UserPromptSubmit chain. There is no "command" to run underneath, so OFF is
# the same chain with the kill switch set — the delta is the whole hook cost.
UPS_PROMPT="what did we learn about perftag7 and the release flow"
ups_off=$(DISABLE_CLAUDEMD_HOOKS=1 time_runs "user_prompt_submit-off" "run_user_prompt_submit '$UPS_PROMPT'")
ups_on=$(time_runs "user_prompt_submit-on" "run_user_prompt_submit '$UPS_PROMPT'")
printf '%-20s\t%10s\t%10s\t%10s\n' "user_prompt_submit" "$ups_off" "$ups_on" "$(( ups_on - ups_off ))"
if (( JSON_OUT )); then
  jq -cn --arg label "user_prompt_submit" --argjson off "$ups_off" --argjson on "$ups_on" \
     --argjson delta "$(( ups_on - ups_off ))" \
    '{label: $label, off_ms: $off, on_ms: $on, delta_ms: $delta}' >&2
fi

echo
echo "Notes: hooks ON measures direct stdin invocation, NOT CC-harness round-trip."
echo "       Real CC overhead = above + per-event JSON construction + timeout enforcement."
echo "       Run on a quiet shell; wall-clock is load-sensitive."
echo "       Fixture: $(grep -c '^- \[' "$MEM_DIR/MEMORY.md") MEMORY.md entries, $(wc -c < "$TRANSCRIPT" | tr -d ' ')-byte transcript."
echo "       Stop / SessionStart / SessionEnd / PostToolUse chains are not probed"
echo "       here — tests/hooks/hook-budget.test.sh asserts those against their"
echo "       hooks.json timeouts."
