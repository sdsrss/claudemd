#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# hook-budget.test.sh — every DATA-SCALING hook must finish well inside the
# `timeout` it declares in hooks.json, measured against a PRODUCTION-SCALE
# fixture.
#
# Why this exists (2026-08-17). memory-prompt-hint.sh forked three processes per
# MEMORY.md tag. At 336 tags that is ~1.8s against a 3s budget, and under real
# session load it crossed the line: the UserPromptSubmit hint stopped appearing.
# The same loop is copied in memory-read-check.sh, whose timeout does not cost a
# hint — it costs the §11 deny. A hook killed at its timeout emits nothing, so a
# blocking gate fails OPEN and cannot even log that it did.
#
# Two instruments already existed and neither could see it:
#   - tests/hooks/timeout-guard.test.sh guards the TEST RUNNER's wall clock
#     (run_suite kill at 124). Nothing to do with hooks.json budgets.
#   - scripts/perf-baseline.sh measures hook cost inside a bare `mktemp -d`
#     sandbox. No MEMORY.md exists for that cwd, so memory-read-check exits at
#     its `[[ -f "$MEM_INDEX" ]]` fail-open line and the tool reported 0.03s for
#     the hook that really costs 1.91s — a 60x underread, structurally, because
#     the fixture omitted the data the cost scales with.
# Hence the two properties below that make this gate different in kind:
#   1. The subject set is DERIVED from source (any hook that reads MEMORY.md /
#      a transcript / the rule-hits log), not a hand-kept list. A new
#      data-scaling hook with no probe FAILS here rather than being silently
#      uncovered — same discipline as trigger-view-parity.test.sh.
#   2. Every probe must PROVE it reached data-dependent code (stdout, a
#      rule-hits row, or a state-dir write). A probe that measures an early
#      fail-open exit is the perf-baseline defect rebuilt, and it would pass
#      forever while measuring nothing.
#
# Budget ratio 0.5: the numbers here come from a quiet machine, and the hooks
# run on a box that is also running the model, MCP servers and the other hooks
# on the same event. Half the declared timeout is the margin that separates
# "fast" from "fast when nothing else is happening" — the live failure was a
# hook measured at 1.9s on an idle box and 3.5-3.9s under load.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
HOOKS_DIR="$REPO/hooks"
HOOKS_JSON="$HOOKS_DIR/hooks.json"

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

command -v jq >/dev/null 2>&1 || { echo "SKIP: jq not installed"; exit 0; }

# ---------------------------------------------------------------- fixture ----
# Production scale, deliberately ABOVE today's real numbers so the gate has
# something to say before the next growth step rather than after it:
#   MEMORY.md   150 entries x 5 tags = 750 tags   (this maintainer's: 76 / 336)
#   transcript  ~5 MB                             (observed largest: 3.5 MB)
#   rule-hits   ~3 MB                             (observed: 2.7 MB)
SANDBOX=$(mktemp -d -t claudemd-budget-XXXXXX) || { echo "FAIL: mktemp"; exit 1; }
SANDBOX=$(cd "$SANDBOX" && pwd -P) || { echo "FAIL: cannot resolve sandbox"; exit 1; }
trap 'rm -rf "$SANDBOX"' EXIT

FIX_HOME="$SANDBOX/home"
CWD="$SANDBOX/proj"
mkdir -p "$FIX_HOME/.claude/logs" "$CWD"
ENCODED=$(printf '%s' "$CWD" | tr -c 'a-zA-Z0-9-' '-')
PROJ_DIR="$FIX_HOME/.claude/projects/$ENCODED"
MEM_DIR="$PROJ_DIR/memory"
mkdir -p "$MEM_DIR"

SESSION_ID="budget-probe-session"
TRANSCRIPT="$PROJ_DIR/$SESSION_ID.jsonl"
RULE_LOG="$FIX_HOME/.claude/logs/claudemd.jsonl"

# MEMORY.md — `budgettag7` is the tag the probes match on; the other 749 exist
# to be scanned, which is the whole point.
awk 'BEGIN {
  for (i = 1; i <= 150; i++) {
    printf "- [Entry %d](feedback_entry_%d.md) `[budgettag%d, budgetalpha%d, budgetbeta%d, budgetgamma%d, budgetdelta%d]` — synthetic budget fixture entry %d\n",
      i, i, i, i, i, i, i, i
  }
}' > "$MEM_DIR/MEMORY.md"
# The hooks stat the matched files for mtime ranking; they must exist.
#
# They are also ≥400 bytes and carry NO `**Why:**` marker, on purpose: mem-audit
# touches its sentinel BEFORE scanning (deliberately — see its header), so a
# state-dir write proves nothing about whether it scanned. With empty files it
# found nothing, emitted nothing, and its probe passed on the sentinel alone —
# injecting `exit 0` right after the touch kept this gate green (pre-tag
# review). Files that produce a real finding make the stderr banner the reach
# proof.
BODY=$(awk 'BEGIN { s = ""; while (length(s) < 500) s = s "filler body text "; print s }')
awk 'BEGIN { for (i = 1; i <= 150; i++) printf "%d\n", i }' | while read -r i; do
  printf 'Synthetic budget fixture entry %s.\n%s\n' "$i" "$BODY" > "$MEM_DIR/feedback_entry_$i.md"
done

# Transcript — realistic row mix (user turns, assistant text, tool_use, results)
# so the transcript-reading hooks find something to parse rather than bailing.
#
# The FINAL assistant turn carries both a §10-V banned-vocab claim and an
# out-of-order four-section report on purpose: transcript-vocab-scan and
# transcript-structure-scan are detectors, and a fixture they find nothing in
# exits before the emit path. That exit is cheap and would understate their
# cost — the same "measure the fail-open branch" error this gate exists to
# catch. Driving them to a hit measures the whole hook.
awk -v n=3000 'BEGIN {
  pad = ""
  for (i = 0; i < 700; i++) pad = pad "x"
  for (i = 1; i <= n; i++) {
    printf "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"budget fixture turn %d %s\"}}\n", i, pad
    printf "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Reply %d %s\"}]}}\n", i, pad
    printf "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"tu_%d\",\"name\":\"Edit\",\"input\":{\"file_path\":\"/proj/src/mod_%d.js\"}}]}}\n", i, i
  }
  printf "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Done: rewrote the parser, it is significantly faster and robust.\\nFailed: none.\\nNot done: none.\\nUncertain: none.\"}]}}\n"
}' > "$TRANSCRIPT"

# Rule-hits log — same shape rule_hits_append writes.
awk -v n=12000 -v sid="$SESSION_ID" 'BEGIN {
  for (i = 1; i <= n; i++) {
    printf "{\"ts\":\"2026-08-17T10:00:00Z\",\"hook\":\"pre-bash-safety-check\",\"event\":\"advisory\",\"spec_section\":\"§8\",\"session_id\":\"%s\",\"extra\":{\"seq\":%d}}\n", sid, i
  }
}' > "$RULE_LOG"

echo "-- fixture: $(grep -c '^- \[' "$MEM_DIR/MEMORY.md") MEMORY.md entries, transcript $(wc -c < "$TRANSCRIPT" | tr -d ' ') bytes, rule-hits $(wc -c < "$RULE_LOG" | tr -d ' ') bytes"

# ------------------------------------------------------------ subject set ----
# Derive, do not name: a hook whose runtime scales with user data is one that
# reads the memory index, a transcript, or the rule-hits log.
DATA_RE='MEMORY\.md|TRANSCRIPT|claudemd\.jsonl'
SUBJECTS=()
while IFS= read -r _f; do
  [[ -n "$_f" ]] && SUBJECTS+=("$(basename "$_f" .sh)")
done < <(grep -lE "$DATA_RE" "$HOOKS_DIR"/*.sh 2>/dev/null | sort)

if (( ${#SUBJECTS[@]} >= 6 )); then
  pass "subject-set floor (${#SUBJECTS[@]} data-scaling hooks derived from source)"
else
  fail "subject-set floor (expected >= 6 data-scaling hooks, found ${#SUBJECTS[@]}) — glob or grep broke"
fi

# ------------------------------------------------------------- probe table ---
# bash 3.2 has no associative arrays (feedback_macos_shell_portability), so the
# table is a case statement. Each arm writes the event JSON for one hook and
# records any env the hook needs to reach its real work.
#
# Writes the event to $EVT_FILE rather than stdout, and sets PROBE_ENV in the
# CURRENT shell: `EVENT=$(probe_event …)` would run the arm in a command
# substitution, so the two opt-in hooks' `TRANSCRIPT_*_SCAN=1` assignments were
# made in a subshell and lost — both hooks then took their env-gate exit and the
# gate reported them as unreachable probes. The reach assertion caught it, which
# is the assertion doing its job on its own author.
PROBE_ENV=()
probe_event() {
  local hook="$1"
  PROBE_ENV=()
  { case "$hook" in
    memory-prompt-hint)
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"UserPromptSubmit", session_id:$s, cwd:$c,
          prompt:"what did we learn about budgettag7 here"}' ;;
    memory-read-check)
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"PreToolUse", tool_name:"Bash", session_id:$s, cwd:$c,
          tool_use_id:"tu_probe",
          tool_input:{command:"git push origin main budgettag7"}}' ;;
    banned-vocab-check)
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"PreToolUse", tool_name:"Bash", session_id:$s, cwd:$c,
          tool_use_id:"tu_probe",
          tool_input:{command:"git commit -m \"significantly faster parser\""}}' ;;
    mem-audit)
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"Stop", session_id:$s, cwd:$c}' ;;
    session-summary)
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"Stop", session_id:$s, cwd:$c}' ;;
    session-end-check)
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" --arg t "$TRANSCRIPT" \
        '{hook_event_name:"SessionEnd", session_id:$s, cwd:$c, transcript_path:$t}' ;;
    transcript-structure-scan)
      PROBE_ENV=("TRANSCRIPT_STRUCTURE_SCAN=1")
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" --arg t "$TRANSCRIPT" \
        '{hook_event_name:"Stop", session_id:$s, cwd:$c, transcript_path:$t}' ;;
    transcript-vocab-scan)
      PROBE_ENV=("TRANSCRIPT_VOCAB_SCAN=1")
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" --arg t "$TRANSCRIPT" \
        '{hook_event_name:"PostToolUse", session_id:$s, cwd:$c, transcript_path:$t,
          tool_use_id:"tu_probe"}' ;;
    *) return 1 ;;
  esac; } > "$EVT_FILE"
}

# hooks.json budget for a hook (empty when the hook is not registered).
budget_of() {
  jq -r --arg n "$1" '
    .hooks | to_entries[] | .value[] | .hooks[]
    | select(.command | test("hooks/" + $n + "\\.sh"))
    | .timeout // empty' "$HOOKS_JSON" 2>/dev/null | head -1
}

# ------------------------------------------------------------------ probes ---
RATIO_NUM=1
RATIO_DEN=2
EVT_FILE="$SANDBOX/event.json"
OUT_FILE="$SANDBOX/probe.out"
ERR_FILE="$SANDBOX/probe.err"
for hook in ${SUBJECTS[@]+"${SUBJECTS[@]}"}; do
  HOOK_SH="$HOOKS_DIR/$hook.sh"
  probe_event "$hook" || {
    fail "$hook is data-scaling but has NO budget probe — add one to the table above"
    continue
  }
  BUDGET=$(budget_of "$hook")
  if [[ -z "$BUDGET" ]]; then
    fail "$hook has no timeout declared in hooks.json (or is not registered)"
    continue
  fi

  LOG_BEFORE=$(wc -c < "$RULE_LOG" 2>/dev/null | tr -d ' ')
  STATE_BEFORE=$(ls -A "$FIX_HOME/.claude/.claudemd-state" 2>/dev/null | wc -l | tr -d ' ')

  # bash's `time` builtin, not /usr/bin/time: BSD time has no -f and macOS runs
  # this suite. TIMEFORMAT='%R' prints wall seconds to 3 decimals.
  TIMEFORMAT='%R'
  SECS=$( { time env HOME="$FIX_HOME" ${PROBE_ENV[@]+"${PROBE_ENV[@]}"} \
              bash "$HOOK_SH" < "$EVT_FILE" > "$OUT_FILE" 2> "$ERR_FILE"; } 2>&1 )
  [[ "$SECS" =~ ^[0-9]+\.[0-9]+$ ]] || SECS=""

  LOG_AFTER=$(wc -c < "$RULE_LOG" 2>/dev/null | tr -d ' ')
  STATE_AFTER=$(ls -A "$FIX_HOME/.claude/.claudemd-state" 2>/dev/null | wc -l | tr -d ' ')
  OUT_SIZE=$(wc -c < "$OUT_FILE" 2>/dev/null | tr -d ' ')
  # Advisory hooks report on STDERR (the PostToolUse/Stop banners), so stderr
  # counts as reach too — otherwise the gate would declare its own working
  # probes broken.
  ERR_SIZE=$(wc -c < "$ERR_FILE" 2>/dev/null | tr -d ' ')

  # Reach proof — see header. Without this the gate measures fail-open exits.
  #
  # mem-audit is excluded from the state-dir arm: it touches its sentinel
  # BEFORE the scan by design, so a state write is evidence that the hook
  # STARTED, not that it did any work. With that arm active, an `exit 0`
  # injected immediately after the touch left this gate green (pre-tag review)
  # — on the very hook this release claims went 0.93s -> 0.039s. It must show
  # output instead.
  REACHED=0
  (( OUT_SIZE > 0 )) && REACHED=1
  (( ERR_SIZE > 0 )) && REACHED=1
  [[ "$LOG_AFTER" != "$LOG_BEFORE" ]] && REACHED=1
  if [[ "$hook" != "mem-audit" && "$STATE_AFTER" != "$STATE_BEFORE" ]]; then REACHED=1; fi
  if (( REACHED == 1 )); then
    pass "$hook probe reaches data-dependent code (stdout ${OUT_SIZE}B, stderr ${ERR_SIZE}B, log Δ$((LOG_AFTER - LOG_BEFORE))B, state Δ$((STATE_AFTER - STATE_BEFORE)))"
  else
    fail "$hook probe produced no stdout, no rule-hits row and no state write — it exited early, so its timing means nothing (this is the perf-baseline defect)"
    continue
  fi

  if [[ -z "$SECS" ]]; then
    fail "$hook — could not measure elapsed time (TIMEFORMAT output unparsable)"
    continue
  fi
  if awk -v s="$SECS" -v b="$BUDGET" -v n="$RATIO_NUM" -v d="$RATIO_DEN" \
      'BEGIN { exit !(s < b * n / d) }'; then
    pass "$hook ${SECS}s < $((BUDGET))s x $RATIO_NUM/$RATIO_DEN budget"
  else
    fail "$hook took ${SECS}s against a ${BUDGET}s hooks.json timeout (limit: half the budget). A hook killed at its timeout emits nothing — a blocking gate fails OPEN silently."
  fi
done

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
