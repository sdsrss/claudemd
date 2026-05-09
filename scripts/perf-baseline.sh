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

# Construct a synthetic Bash event envelope and pipe it to each PreToolUse
# Bash hook in declaration order. Mirrors hooks/hooks.json L20-26.
run_pretoolse_bash() {
  local cmd="$1"
  local event
  event=$(jq -cn --arg cmd "$cmd" '{tool_name:"Bash",tool_input:{command:$cmd}}')
  for hook in pre-bash-safety-check banned-vocab-check ship-baseline-check memory-read-check; do
    printf '%s' "$event" | bash "$HOOKS_DIR/$hook.sh" >/dev/null 2>&1
  done
}

# Median of N runs, in milliseconds (integer).
time_runs() {
  local label="$1" cmd="$2"
  local times=()
  local i start_ns end_ns elapsed_ms
  for (( i = 0; i < RUNS; i++ )); do
    start_ns=$(date +%s%N)
    eval "$cmd" >/dev/null 2>&1
    end_ns=$(date +%s%N)
    elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
    times+=("$elapsed_ms")
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

echo
echo "Notes: hooks ON measures direct stdin invocation, NOT CC-harness round-trip."
echo "       Real CC overhead = above + per-event JSON construction + timeout enforcement."
echo "       Run on a quiet shell; wall-clock is load-sensitive."
