#!/usr/bin/env bash
# evidence-gate.sh — Stop hook (G1b, advisory only).
#
# Iron Law #2 says no completion claim without fresh evidence. It is one of the
# 16 HARD rules the manifest marks `self`: the agent is the only thing checking
# it. The 2026-07-24 labeling pass explains why nothing else does — six
# detectors that tried were closed at a precision upper bound of 0.17, and all
# six worked the same way, by reading the PROSE for evidence (looking for
# `Checked:`, for digits, for the word `passed`). Prose has unbounded shapes;
# precision collapsed.
#
# So this one does not read prose for evidence. It reads the TRANSCRIPT for the
# command output, which is a structural fact: either a Bash tool_result exists
# after the last code edit or it does not. The prose is used only to decide
# whether a claim was made at all.
#
# Verdict, three tiers (roadmap G1b):
#   T1  a smoke entry point ran (the G1a anchor's command shape)   -> silent
#   T2  a test / typecheck / build runner produced output          -> silent
#   T3  some other command ran, no runner output                   -> advisory
#   --  no non-error command output at all after the last edit     -> advisory
#
# False-positive control, in the order it matters:
#   - no completion claim in the last assistant message  -> never fires
#   - the claim carries `[PARTIAL`                       -> never fires
#   - no code-file Edit/Write in the window              -> never fires,
#     which is what keeps L0 / L1-copy / docs work out of it entirely
#
# Known limits, both in the under-reporting direction:
#   - the transcript is read from the tail (EVIDENCE_GATE_WINDOW lines). A last
#     code edit older than that window reads as "no code edit" and the hook
#     stays silent rather than guessing.
#   - `transcript_path` can lag the last few messages of the current turn
#     (official docs). The CLAIM comes from `last_assistant_message`, which does
#     not lag; the EVIDENCE is older than the claim by construction, so the lag
#     costs at most the most recent command. Registered as an FP source.
#
# Opt-in: EVIDENCE_GATE=1 (default OFF). §EXT §13.3: behaviour-layer hooks ship
# default-OFF for >=30d of FP signal collection before default-ON advisory, and
# only then is a `deny` form even on the table.
#
# Kill-switches:
#   DISABLE_EVIDENCE_GATE_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1     — global

set -uo pipefail

# Opt-in gate (default OFF), before any work.
[[ "${EVIDENCE_GATE:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch EVIDENCE_GATE || exit 0
hook_require_jq || { hook_record_failopen evidence-gate jq-missing; exit 0; }

EVENT=$(hook_read_event) || exit 0
LAST_MSG=$(hook_jq_field evidence-gate "$EVENT" '.last_assistant_message // ""') || exit 0
[[ -n "$LAST_MSG" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

# A `[PARTIAL` claim is the spec-sanctioned way to say the evidence does not
# cover everything. Checked first: it suppresses regardless of what else the
# message says, so an honest partial never earns a nag.
case "$LAST_MSG" in
  *'[PARTIAL'*) exit 0 ;;
esac

# Completion-claim shapes, the same normalisation scripts/sampling-audit.js uses
# after the Round-14 audit found the scanner saw `Done:` and `## Done` only:
# `Done:`, `## Done`, `**Done**`, `### Done`, `- **Done:**`. 中文 `完成:` too —
# the label is English by the §1 language contract, but the contract is a rule
# and this is a detector, which has to match what gets written.
DONE_RE='(^|\n)[[:space:]]*(#{1,4}[[:space:]]*)?(-[[:space:]]+)?(\*\*)?(Done|完成)(\*\*)?[[:space:]]*([:：]|\*\*[[:space:]]*$|$)'
printf '%s' "$LAST_MSG" | grep -Eq "$DONE_RE" || exit 0

TRANSCRIPT_PATH=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  hook_record_failopen evidence-gate transcript-missing
  exit 0
fi

# Tail bound. Large enough to hold a working stretch, small enough that a Stop
# hook on a multi-hour session stays inside its 5s budget.
EG_WINDOW="${EVIDENCE_GATE_WINDOW:-1200}"
[[ "$EG_WINDOW" =~ ^[0-9]+$ ]] || EG_WINDOW=1200

# One pass over the tail, emitting a tab-separated event stream:
#   E                        a code-file Edit/Write
#   U <tool_use_id> <cmd>    a Bash tool_use and its command text
#   R <tool_use_id> <0|1> <output>   a tool_result and whether it errored
# Nothing else is extracted; the point is to get out of jq with a few hundred
# short lines rather than to carry the transcript into awk.
#
# Rows are classified by the CONTENT ITEM's own type, never by the row's
# `.type`. A tool_result arrives on a row typed "user", but it is not a user
# TURN — `isUserTurn` excludes exactly those rows — so keying on `.type ==
# "user"` here would spell a concept this hook does not use and would put it in
# the consumer set of the shared user-turn definition
# (tests/scripts/user-turn-parity.test.js), which is a different question from
# the one being asked. tool_use items only appear on assistant rows and
# tool_result items only on user rows, so the item type is the whole signal.
STREAM=$(tail -n "$EG_WINDOW" "$TRANSCRIPT_PATH" 2>/dev/null | jq -R -r '
  try fromjson catch empty
  | ((.message.content // []) | if type == "array" then . else [] end)
  | map(
      if .type == "tool_use" then
        if (.name == "Edit" or .name == "Write") then
          (if ((.input.file_path // "") | test("\\.(m?[jt]sx?|rs|py|go|sh|rb|java|c|cpp|h)$"; "i"))
           then "E" else empty end)
        elif .name == "Bash" then
          "U\t" + (.id // "") + "\t"
          + ((.input.command // "") | gsub("[\\r\\n]+"; " ") | .[0:300])
        else empty end
      elif .type == "tool_result" then
        "R\t" + (.tool_use_id // "") + "\t"
        + (if .is_error == true then "1" else "0" end) + "\t"
        + ((.content // "")
           | if type == "array" then (map(.text // "") | join(" ")) else tostring end
           | gsub("[\\r\\n]+"; " ") | .[0:800])
      else empty end)
  | .[]' 2>/dev/null)
[[ -n "$STREAM" ]] || exit 0

# A smoke entry point, per the G1a anchor. Recognised from the COMMAND rather
# than the output: `npm run smoke` prints whatever the project's suites print,
# and there is no output shape common to every project's smoke entry.
T1_CMD_RE='(^|[;&|[:space:]])((npm|pnpm|yarn|bun)[[:space:]]+run[[:space:]]+smoke|make[[:space:]]+smoke|\.?/?scripts?/smoke)([[:space:]]|$)'
# Runner output. Anchored on a digit-plus-verdict, a label-colon, a tick/cross,
# or a runner name — plain prose containing the word "failed" does not match,
# which is the direction that matters: a loose pattern here buys silence, and
# silence is this hook saying "evidence exists".
T2_OUT_RE='[0-9]+[[:space:]]+(passed|failed|pass|fail|tests?|assertions?|suites?)|(^|[^A-Za-z])(tests?|test result|overall|smoke|suites?|pass|fail)[[:space:]]*[:：]|✓|✗|(^|[^A-Za-z])ok[[:space:]]+[0-9]+|(cargo|go|npm|pnpm|yarn)[[:space:]]+test|pytest|tsc|shellcheck|eslint|prettier'

# The last code edit splits the stream: evidence produced BEFORE it cannot be
# evidence about it. Bash commands are indexed so a tool_result can be joined
# back to the command that produced it — a result whose tool_use_id belongs to
# a Read or a Grep is not command output.
VERDICT=$(printf '%s\n' "$STREAM" | awk -F'\t' -v t1="$T1_CMD_RE" -v t2="$T2_OUT_RE" '
  $1 == "E" { lastedit = NR; next }
  $1 == "U" { cmd[$2] = $3; next }
  $1 == "R" { n++; ridx[n] = NR; rid[n] = $2; rerr[n] = $3; rtxt[n] = $4; next }
  END {
    if (lastedit == 0) { print "no-code-edit"; exit }
    tier = 0
    for (i = 1; i <= n; i++) {
      if (ridx[i] <= lastedit) continue
      if (rerr[i] == "1") continue
      if (!(rid[i] in cmd)) continue
      if (tier < 1) tier = 1
      if (cmd[rid[i]] ~ t1) { tier = 3; break }
      if (rtxt[i] ~ t2 && tier < 2) tier = 2
    }
    if (tier >= 2) print "verified"
    else if (tier == 1) print "command-but-no-runner"
    else print "no-command-output"
  }' 2>/dev/null)

case "$VERDICT" in
  verified | no-code-edit | '') exit 0 ;;
esac

if [[ "$VERDICT" == "command-but-no-runner" ]]; then
  DETAIL='commands ran after the last code edit, but none of them produced test / typecheck / build output.'
else
  DETAIL='no command output at all after the last code edit.'
fi

EXTRA=$(jq -cn --arg v "$VERDICT" --argjson w "$EG_WINDOW" '{verdict:$v, window:$w}' 2>/dev/null) || EXTRA='null'
hook_record evidence-gate evidence-advisory "$EXTRA" '§iron-law-2' "$SESSION_ID"

printf '[claudemd] §7 Iron Law #2 — a completion claim this session has no verification output behind it.\n' >&2
printf '  This session edited code files, the last assistant message makes a Done claim, and %s\n' "$DETAIL" >&2
printf '  Run the verification and cite its output, or restate the claim as [PARTIAL: <what is unverified>].\n' >&2
printf '  Checked the transcript, not the wording: the last %s rows, for a non-error Bash result after the last code edit.\n' "$EG_WINDOW" >&2
printf '  Advisory. Disable: EVIDENCE_GATE=0 or DISABLE_EVIDENCE_GATE_HOOK=1.\n' >&2

exit 0
