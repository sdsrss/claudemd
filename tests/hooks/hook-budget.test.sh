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

# Filesystem fixture — the second scaling family (audit-2026-08-22 P1-2).
# residue-audit counts every depth-1 entry of ~/.claude/tmp; sandbox-disposal
# runs find -newer over it; version-sync walks $TMPDIR. 6,000 entries is above
# the largest real one observed (5,950) for the same reason the memory index is
# oversized here: a gate sized at today's numbers reports the problem after it
# lands. `xargs` rather than a shell loop — 6,000 forks would dominate the
# suite's own runtime.
CLAUDE_TMP="$FIX_HOME/.claude/tmp"
SYNC_TMP="$SANDBOX/synctmp"
mkdir -p "$CLAUDE_TMP" "$SYNC_TMP"
awk -v d="$CLAUDE_TMP" 'BEGIN { for (i = 1; i <= 5950; i++) printf "%s/probe-file-%d\n", d, i }' | xargs touch
# 50 mkdtemp-shaped DIRECTORIES: the shape sandbox-disposal actually reports on.
awk -v d="$CLAUDE_TMP" 'BEGIN { for (i = 1; i <= 50; i++) printf "%s/tmp.probe%d\n", d, i }' | xargs mkdir -p
awk -v d="$SYNC_TMP" 'BEGIN { for (i = 1; i <= 5950; i++) printf "%s/probe-file-%d\n", d, i }' | xargs touch

# Pre-seeded per-session state so the two Stop scanners take their FULL path
# instead of the silent first-run branch (which establishes a baseline and
# exits — cheap, and measuring it is the underread this gate exists to catch).
STATE_FIX="$FIX_HOME/.claude/.claudemd-state"
mkdir -p "$STATE_FIX"
# residue-audit: baseline 0 against ~6,000 entries → over threshold → it emits.
printf 'v2:0\n' > "$STATE_FIX/tmp-baseline-${SESSION_ID}.txt"
# sandbox-disposal: a session ref OLDER than the fixture dirs, so find -newer
# has something to report. Written last would make every dir older than it.
touch -t 200001010000 "$STATE_FIX/session-start-${SESSION_ID}.ref"
# version-sync: a manifest whose version is NEWER than this repo's package.json
# drives the stale-root branch — it logs and records a rule-hits row (the reach
# proof) without spawning a background install.
printf '{"version":"99.0.0"}\n' > "$FIX_HOME/.claude/.claudemd-manifest.json"

echo "-- fixture: $(grep -c '^- \[' "$MEM_DIR/MEMORY.md") MEMORY.md entries, transcript $(wc -c < "$TRANSCRIPT" | tr -d ' ') bytes, rule-hits $(wc -c < "$RULE_LOG" | tr -d ' ') bytes, ~/.claude/tmp $(find "$CLAUDE_TMP" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ') entries"

# ------------------------------------------------------------ subject set ----
# Derive, do not name: a hook whose runtime scales with data it does not
# control. Two families, and the second was missing until audit-2026-08-22 P1-2:
#   - CONTENT: the memory index, a transcript, the rule-hits log.
#   - FILESYSTEM: a scan of ~/.claude/tmp or of $TMPDIR, whose cost scales with
#     the entry count there. residue-audit, sandbox-disposal-check and
#     version-sync all walk one of those directories on every event and none of
#     them was in the derived set, so the gate's own subject list was narrower
#     than the thing it claims to cover.
# Network-blocking hooks are a DIFFERENT class — bounded by an explicit
# platform_timeout, not by data volume — and get the static gate further down;
# a timing probe for them would either hit the network or measure the offline
# early-exit, which is the perf-baseline defect this file exists to avoid.
DATA_RE='MEMORY\.md|TRANSCRIPT|claudemd\.jsonl|\.claude/tmp|platform_find_newer|\$\{TMPDIR'
SUBJECTS=()
while IFS= read -r _f; do
  [[ -n "$_f" ]] && SUBJECTS+=("$(basename "$_f" .sh)")
done < <(grep -lE "$DATA_RE" "$HOOKS_DIR"/*.sh 2>/dev/null | sort)

if (( ${#SUBJECTS[@]} >= 11 )); then
  pass "subject-set floor (${#SUBJECTS[@]} data-scaling hooks derived from source)"
else
  fail "subject-set floor (expected >= 11 data-scaling hooks, found ${#SUBJECTS[@]}) — glob or grep broke"
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
    residue-audit)
      # Cost is the depth-1 walk of ~/.claude/tmp; the seeded v2:0 baseline
      # puts it over threshold so it reaches the emit path too.
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"Stop", session_id:$s, cwd:$c}' ;;
    sandbox-disposal-check)
      # The override points the scan at the same 6,000-entry fixture instead of
      # the host's real /tmp — hermetic, and it is the production scan shape.
      PROBE_ENV=("CLAUDEMD_SCAN_SPECS_OVERRIDE=$CLAUDE_TMP|both")
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"Stop", session_id:$s, cwd:$c}' ;;
    version-sync)
      # TMPDIR is the scaling input (the sentinel GC walks it on first prompt).
      PROBE_ENV=("TMPDIR=$SYNC_TMP" "CLAUDE_SESSION_ID=$SESSION_ID")
      jq -cn --arg s "$SESSION_ID" --arg c "$CWD" \
        '{hook_event_name:"UserPromptSubmit", session_id:$s, cwd:$c,
          prompt:"budget probe prompt"}' ;;
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
RC_FILE="$SANDBOX/probe.rc"
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
  rm -f "$RC_FILE"
  SECS=$( { time { env HOME="$FIX_HOME" ${PROBE_ENV[@]+"${PROBE_ENV[@]}"} \
                     bash "$HOOK_SH" < "$EVT_FILE" > "$OUT_FILE" 2> "$ERR_FILE"
                   printf '%s' "$?" > "$RC_FILE"; }; } 2>&1 )
  [[ "$SECS" =~ ^[0-9]+\.[0-9]+$ ]] || SECS=""
  STATUS=$(cat "$RC_FILE" 2>/dev/null || echo "")

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
  # Every shipped hook is fail-open by contract and exits 0 on every branch
  # (hook_deny included). A non-zero exit is a crashed probe, and its timing is
  # the crash, not the work.
  if [[ "$STATUS" != "0" ]]; then
    fail "$hook probe exited ${STATUS:-<unknown>} — hooks exit 0 on every branch, so this is a crash: $(head -c 200 "$ERR_FILE" 2>/dev/null)"
    continue
  fi

  REACHED=0
  (( OUT_SIZE > 0 )) && REACHED=1
  # stderr is a PAIRED signal, not a bare one (audit-2026-08-22 P1-2). Advisory
  # hooks report there, but so does a shell that dies on an unbound variable —
  # and `(( ERR_SIZE > 0 )) && REACHED=1` alone accepted the second as proof of
  # the first, weakening the reach assertion for all eight subjects at once. The
  # exit-0 requirement above is the pairing.
  (( ERR_SIZE > 0 )) && REACHED=1
  [[ "$LOG_AFTER" != "$LOG_BEFORE" ]] && REACHED=1
  if [[ "$hook" != "mem-audit" && "$STATE_AFTER" != "$STATE_BEFORE" ]]; then REACHED=1; fi
  # What this proves, stated exactly (0.68.3 pre-tag review MEDIUM-2): the
  # probe ran to completion and did observable work. It does NOT prove the work
  # was the data-scaling walk that put the hook in DATA_RE's set — REACHED is an
  # OR over evidence from ANY downstream branch. Two mutations confirmed the
  # gap: deleting version-sync's $TMPDIR sentinel sweep and residue-audit's
  # ~/.claude/tmp walk both left this green, because a rule-hits row still
  # arrived from another branch. sandbox-disposal-check's walk IS discriminated
  # (removing platform_find_newer fails here), and a crude `exit 0` at the top
  # of any of the three is caught.
  #
  # The claim is worded to that limit rather than widened past it. Closing the
  # gap needs a differential probe (empty vs populated fixture, per hook) —
  # tasks/hook-budget-reach-discrimination.md.
  if (( REACHED == 1 )); then
    pass "$hook probe ran to completion and did observable work (stdout ${OUT_SIZE}B, stderr ${ERR_SIZE}B, log Δ$((LOG_AFTER - LOG_BEFORE))B, state Δ$((STATE_AFTER - STATE_BEFORE)))"
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

# -------------------------------------------------- network-bounded hooks ----
# The other way a hook can outrun its budget: it blocks on the NETWORK. That
# cost does not scale with user data, so it has no place in the probe loop
# above — a timing probe would either hit the network (non-hermetic, and flaky
# by the second) or measure the offline early-exit, which is exactly the
# "measure the fail-open branch" error this file was written to stop.
#
# Its budget property is static and checkable without leaving the box: the call
# must be wrapped in `platform_timeout N`, and N must be strictly under the
# hooks.json timeout — otherwise the harness kills the hook before the wrapper
# can return, and a killed hook emits nothing. session-start-check.sh
# (5s budget, 3s ls-remote) is the hook the 713-banner incident's own
# instrumentation lives on, and it had NO budget coverage from either
# instrument before audit-2026-08-22 P1-2.
NET_HOOKS=()
while IFS= read -r _f; do
  [[ -n "$_f" ]] && NET_HOOKS+=("$(basename "$_f" .sh)")
done < <(grep -lE 'platform_timeout [0-9]+' "$HOOKS_DIR"/*.sh 2>/dev/null | sort)

if (( ${#NET_HOOKS[@]} >= 2 )); then
  pass "network-bounded set floor (${#NET_HOOKS[@]} hooks wrap a blocking call in platform_timeout)"
else
  fail "network-bounded set floor (expected >= 2, found ${#NET_HOOKS[@]}) — grep broke, or a bounded call lost its wrapper"
fi

for hook in ${NET_HOOKS[@]+"${NET_HOOKS[@]}"}; do
  BUDGET=$(budget_of "$hook")
  if [[ -z "$BUDGET" ]]; then
    fail "$hook has no timeout declared in hooks.json (or is not registered)"
    continue
  fi
  WORST=$(grep -oE 'platform_timeout [0-9]+' "$HOOKS_DIR/$hook.sh" | awk '{ if ($2 > m) m = $2 } END { print m + 0 }')
  if (( WORST > 0 && WORST < BUDGET )); then
    pass "$hook bounds its blocking call at ${WORST}s, inside its ${BUDGET}s hooks.json timeout"
  else
    fail "$hook wraps a blocking call at ${WORST}s against a ${BUDGET}s hooks.json timeout — the harness kills it first, and a killed hook emits nothing"
  fi
done

# Nothing may reach the network UNWRAPPED.
#
# Two passes, because the plugin calls its remote commands through a test seam:
# the literal `git ls-remote` text lives on the DEFINITION line, and the actual
# invocation one line down is spelled `"${ls_remote_args[@]}"`. A scan for the
# command NAME therefore never sees the call it exists to bound — this gate
# shipped in 0.68.2's successor counting 2 wrapped sites, both in
# ship-baseline-check, while session-start-check's remote call was invisible to
# it. The 0.68.3 pre-tag review confirmed it with two mutations that stayed
# green: an unwrapped call in the tree's own `"${ls_remote_args[@]}"` spelling,
# and an unwrapped literal on a line carrying any `:-` (the old blanket
# exclusion dropped the whole line). This is the 2026-08-16 root cause — a gate
# narrower than its subject — recurring inside the fix for that class, so the
# repair derives the invocation spelling FROM THE SOURCE instead of restating
# it (feedback_extraction_needs_consumer_gate).
REMOTE_RE='git ls-remote|gh run list'
REMOTE_WRAPPED=0
UNWRAPPED=""
SEAM_VARS=""

# Pass 1 — lines carrying the literal command name.
while IFS= read -r _line; do
  [[ -n "$_line" ]] || continue
  # grep -n over a glob yields `path:lineno:content`; strip both prefixes.
  _content="${_line#*:}"; _content="${_content#*:}"
  # Comments: every one of these hooks names its remote command in prose, and a
  # detector that fires on the documentation of its subject fires on the fix
  # (feedback_self_referential_marker_regex).
  case "$_content" in *[!\ ]*) ;; *) continue ;; esac
  _trimmed="${_content#"${_content%%[![:space:]]*}"}"
  case "$_trimmed" in \#*) continue ;; esac
  # A test seam that DEFINES the command is not a call. Recognised by its
  # assignment SHAPE — not by "the line contains :-", which also excused any
  # real call whose arguments happened to carry a default expansion — and the
  # variable it feeds is captured so pass 2 can bound the invocation.
  #
  # A variable holding the command must be told apart from one holding its
  # OUTPUT: `RUN_JSON=$(platform_timeout 2 gh run list …)` is a call whose
  # result is data, and every later `"$RUN_JSON"` is a jq pipe, not a network
  # call. Blanking command substitutions decides it — if the remote name
  # survives that, it is the command itself; if it vanishes, the line WAS the
  # call and falls through to the wrapped/unwrapped test below.
  _outer=$(printf '%s' "$_trimmed" | sed 's/\$([^()]*)/\$()/g')
  if ! printf '%s' "$_outer" | grep -qE "$REMOTE_RE"; then
    if printf '%s' "$_content" | grep -q 'platform_timeout'; then
      REMOTE_WRAPPED=$((REMOTE_WRAPPED + 1))
    else
      UNWRAPPED+="$_line"$'\n'
    fi
    continue
  fi
  # Flags are tolerated on both shapes: `read -r -a v`, `local -a v=`,
  # `declare -ag v=`. Without that, a correctly-wrapped `local -a` seam had its
  # DEFINITION line classified as an unwrapped call — a false RED pointing at
  # the wrong line (0.68.3 delta review MEDIUM-2).
  _seam=$(printf '%s\n' "$_trimmed" | awk '
    /^read[ \t]+-/ {
      for (i = 2; i <= NF; i++) if ($i !~ /^-/) { print $i; exit }
      exit
    }
    /^(local|declare|readonly)([ \t]+-[a-zA-Z]+)*[ \t]+[A-Za-z_][A-Za-z0-9_]*=/ {
      s = $0
      sub(/^(local|declare|readonly)([ \t]+-[a-zA-Z]+)*[ \t]+/, "", s)
      sub(/=.*/, "", s)
      print s; exit
    }
    /^[A-Za-z_][A-Za-z0-9_]*=/ {
      s = $0; sub(/=.*/, "", s); print s; exit
    }
  ')
  if [[ -n "$_seam" ]]; then
    SEAM_VARS+="$_seam"$'\n'
    continue
  fi
  if printf '%s' "$_content" | grep -q 'platform_timeout'; then
    REMOTE_WRAPPED=$((REMOTE_WRAPPED + 1))
  else
    UNWRAPPED+="$_line"$'\n'
  fi
done < <(grep -nE "$REMOTE_RE" "$HOOKS_DIR"/*.sh 2>/dev/null)

# Pass 2 — every EXPANSION of a seam variable pass 1 found IS the call.
#
# Matched by `$`-anchored variable reference rather than by an enumerated list
# of spellings. Enumerating `${v[@]}` and `"$v"` missed `${v[*]}` and a bare
# unquoted `$v`, and three mutations rode through those gaps (0.68.3 delta
# review MEDIUM-1). The `$` anchor also does the right thing on the definition
# line for free: `read -ra v <<< …` names `v` but never expands it, so it is not
# counted as a call — while a line that BOTH defines and calls (`read -ra v … &&
# "${v[@]}" …`) now IS, which the previous REMOTE_RE-based skip dropped.
SEAM_COUNT=0
SEAM_CALLS=0
SEAM_DRY=""
while IFS= read -r _var; do
  [[ -n "$_var" ]] || continue
  SEAM_COUNT=$((SEAM_COUNT + 1))
  _var_calls=0
  while IFS= read -r _line; do
    [[ -n "$_line" ]] || continue
    _content="${_line#*:}"; _content="${_content#*:}"
    _trimmed="${_content#"${_content%%[![:space:]]*}"}"
    case "$_trimmed" in \#*) continue ;; esac
    _var_calls=$((_var_calls + 1))
    SEAM_CALLS=$((SEAM_CALLS + 1))
    if printf '%s' "$_content" | grep -q 'platform_timeout'; then
      REMOTE_WRAPPED=$((REMOTE_WRAPPED + 1))
    else
      UNWRAPPED+="$_line"$'\n'
    fi
  done < <(grep -nE "\\\$\\{?${_var}([^a-zA-Z0-9_]|\$)" "$HOOKS_DIR"/*.sh 2>/dev/null)
  (( _var_calls == 0 )) && SEAM_DRY+="$_var "
done <<< "$SEAM_VARS"

# Vacuity floors. PER VARIABLE, not a global sum: with one shared counter, a
# seam variable resolving to zero call sites passed silently as long as some
# OTHER variable supplied one — which is how all three MEDIUM-1 mutations stayed
# green while an unwrapped call sat in the tree.
if (( SEAM_COUNT >= 1 )); then
  pass "remote-command seam derivation found $SEAM_COUNT seam variable(s), $SEAM_CALLS call site(s)"
else
  fail "no remote-command seam variable derived — pass 1's definition-shape match broke, so the invocation spelling is unchecked"
fi
if [[ -z "$SEAM_DRY" ]]; then
  pass "every derived seam variable resolves to at least one call site"
else
  fail "seam variable(s) with NO call site found — the expansion spelling changed and pass 2 is vacuous for: ${SEAM_DRY% }"
fi

if (( REMOTE_WRAPPED >= 2 )); then
  pass "remote-command scan classified $REMOTE_WRAPPED wrapped call site(s) (the exclusions above did not swallow everything)"
else
  fail "remote-command scan found only $REMOTE_WRAPPED wrapped site(s) — the pattern or the exclusions broke, so the check below proves nothing"
fi
if [[ -z "$UNWRAPPED" ]]; then
  pass "every remote command invocation is wrapped in platform_timeout"
else
  fail "unwrapped remote call(s) — unbounded against a hooks.json timeout:"
  printf '%s' "$UNWRAPPED" | sed 's/^/      /'
fi

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
