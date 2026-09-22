#!/usr/bin/env bash
# evidence-gate.sh — Stop hook (G1b, advisory only).
#
# Iron Law #2 says no completion claim without fresh evidence. It is one of the
# 16 HARD rules the manifest marks `self`, and nothing that can BLOCK checks it:
# `transcript-structure-scan.sh` does emit `§iron-law-2` rows, but it is
# advisory and ships default-OFF.
#
# Why that scan is not enough, and why this hook is shaped differently: the
# 2026-07-24 labeling pass hand-labeled all 178 flagged instances across the
# detectors then collecting and closed six of the eight, at a pooled precision
# upper bound of 0.17 over the labeled set. The closed reasons are not one
# failure but several — `§5-hard-auth` could not separate an executed command
# from a command string passed as data, `§11-post-compaction` hardcoded this
# repo's plan-file naming. The one that matters here is `§iron-law-2`, which
# hunted an evidence fingerprint in PROSE (`Checked:`, digits, the word
# `passed`), and whose closed reason is that the fingerprint misses bolded
# numbers and N/N ratios. Prose has unbounded shapes.
#
# So this one does not read prose for evidence. It reads the TRANSCRIPT for the
# command output, which is a structural fact: either a Bash tool_result exists
# after the last code edit or it does not. The prose is used only to decide
# whether a claim was made at all.
#
# Verdict, three tiers (roadmap G1b):
#   T1  a smoke entry point ran (the G1a anchor's command shape)   -> silent
#   T2  a runner ran — by its command name, or by output shape    -> silent
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

# Completion-claim shapes. Wider than scripts/sampling-audit.js's, deliberately
# — that one is `/^(?:#{1,4}\s*)?(?:\*\*)?Done\b(?:\*\*)?\s*[:：]/m`: no 中文, no
# list prefix, colon mandatory. A pre-ship replay of this project's own 22
# transcripts matched their FINAL assistant message exactly once. A detector
# that cannot see its corpus's completion shapes collects nothing in 30 days,
# which makes the §13.3 promotion decision uninterpretable rather than safe.
#
# Two patterns. DONE_RE is the labelled form — `Done:` / `## Done` / `**Done**`
# / `### Done` / `- **Done:**` / `Shipped:`. DONE_TAIL_RE is what the replay
# actually found: 中文 completion reads as a verb compound, not a label
# (`发布完成。`, `清理完成。`, `审核完成,报告已生成`, `**v0.78.0 已发布。**`).
# The character class excludes 没 / 未 / 不 before 完成, so "还没完成" — the
# negation, which is the opposite claim — does not match.
#
# Widening a CLAIM detector buys false positives, and a false positive here is
# a nag. All three FP controls still gate every shape added: a code edit must
# have happened, `[PARTIAL` suppresses, and the evidence lookup still has to
# come up empty.
DONE_RE='(^|\n)[[:space:]]*(#{1,4}[[:space:]]*)?(-[[:space:]]+)?(\*\*)?(Done|Shipped|完成)(\*\*)?[[:space:]]*([:：]|\*\*[[:space:]]*$|$)'
DONE_TAIL_RE='[^[:space:]]完成|已(发布|上线|实现|修复|生成|完成)'
# Round-17 ALG-M2. The exclusion used to live inside the class as
# `[^[:space:]没未不]完成`, which only rejected a negation sitting IMMEDIATELY
# before the word — so `任务不能完成`, `无法完成验证` and `这个还没有完成` all
# read as completion claims, 3 of 3 measured. A negation and the word it negates
# are normally a word or two apart.
#
# Bounded distance rather than a clause split: splitting on Chinese punctuation
# needs a multibyte bracket expression, and a bracket of multibyte characters is
# byte-wise and wrong under LC_ALL=C — which is also what the old class was, its
# 没未不 decomposing into nine individual bytes there. Both greps below therefore
# FIX the locale to C and the window is counted in BYTES: 9 of them, i.e. up to
# three CJK characters between the negation and 完成. Same window on every
# machine, instead of nine characters here and three there.
#
# Wide enough for 不能 / 还没有 / 无法…; narrow enough that
# `修复了不少问题，功能完成` (six characters of gap) stays a claim. The veto is
# message-scoped, so a message carrying BOTH a real claim and a negated one is
# suppressed — the conservative direction for an advisory whose cost is a nag,
# and the structural `Done:` form above is checked first and is not vetoed.
DONE_NEG_RE='(不|没|未|无法|尚未|还没|难以)(.{0,9})?完成'
if ! printf '%s' "$LAST_MSG" | grep -Eq "$DONE_RE"; then
  printf '%s' "$LAST_MSG" | LC_ALL=C grep -Eq "$DONE_TAIL_RE" || exit 0
  printf '%s' "$LAST_MSG" | LC_ALL=C grep -Eq "$DONE_NEG_RE" && exit 0
fi

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
          (if ((.input.file_path // "") | test("\\.(m?[jt]sx?|cjs|cts|rs|py|go|sh|rb|java|c|cpp|h)$"; "i"))
           then "E" else empty end)
        elif .name == "Bash" then
          "U\t" + (.id // "") + "\t"
          + ((.input.command // "") | gsub("[\\r\\n\\t]+"; " ") | .[0:300])
        elif .name == "BashOutput" then
          # A backgrounded run answers its own Bash call with "Command running
          # in background", and the real output arrives later on a BashOutput
          # whose id is a different one. Indexed with an EMPTY command so T1 and
          # the command half of T2 cannot match it and only its OUTPUT can,
          # which is the honest reading: we know what it printed, not what ran.
          "U\t" + (.id // "") + "\t"
        else empty end
      elif .type == "tool_result" then
        "R\t" + (.tool_use_id // "") + "\t"
        + (if .is_error == true then "1" else "0" end) + "\t"
        + ((.content // "")
           | if type == "array" then (map(.text // "") | join(" ")) else tostring end
           | gsub("[\\r\\n\\t]+"; " ")
           | (if length > 900 then .[:100] + " … " + .[-800:] else . end))
      else empty end)
  | .[]' 2>/dev/null)
[[ -n "$STREAM" ]] || exit 0

# A smoke entry point, per the G1a anchor. Recognised from the COMMAND rather
# than the output: `npm run smoke` prints whatever the project's suites print,
# and there is no output shape common to every project's smoke entry.
T1_CMD_RE='(^|[;&|[:space:]])((npm|pnpm|yarn|bun)[[:space:]]+run[[:space:]]+smoke|make[[:space:]]+smoke|\.?/?scripts?/smoke)([[:space:]]|$)'
# T2 has two halves, and the split is the whole point. The runner's NAME lives
# in the command; its VERDICT lives in the output. The first draft matched names
# against the output, where they do not appear, so every silent-success verifier
# read as no-evidence — `tsc --noEmit` and `eslint .` print nothing at all when
# clean, and §7's L1 row is literally "lint + typecheck". The hook fired on
# exactly the evidence the spec asks for. Found in pre-ship review.
T2_CMD_RE='(^|[;&|[:space:]])((cargo|go|npm|pnpm|yarn|bun|deno)[[:space:]]+(test|check)|(npm|pnpm|yarn|bun)[[:space:]]+run[[:space:]]+(test|check|lint|typecheck|types|build|verify)|(npx[[:space:]]+)?(tsc|eslint|prettier|jest|vitest|mocha|ava|biome|ruff|mypy|shellcheck)|pytest|python[[:space:]]+-m[[:space:]]+(pytest|unittest)|node[[:space:]]+--test|cargo[[:space:]]+clippy|make[[:space:]]+(test|check|lint)|ctest|gradle[[:space:]]+test|mvn[[:space:]]+test|dotnet[[:space:]]+test|rspec|bundle[[:space:]]+exec[[:space:]]+rspec)([[:space:]]|$)'
# Output verdicts, for runners the command pattern does not name: a
# digit-plus-verdict, a label-colon, a tick/cross, a TAP `ok N`, or go test's
# `ok <pkg> <time>`. Plain prose containing the word "failed" does not match —
# a loose pattern here buys silence, and silence is this hook saying "evidence
# exists".
T2_OUT_RE='[0-9]+[[:space:]]+(passed|failed|pass|fail|tests?|assertions?|suites?)|(^|[^A-Za-z])(tests?|test result|overall|smoke|suites?|pass|fail)[[:space:]]*[:：]|✓|✗|(^|[^A-Za-z])ok[[:space:]]+[0-9]+|(^|[^A-Za-z])ok[[:space:]]+[^[:space:]]+[[:space:]]+[0-9.]+m?s|no[[:space:]]+issues[[:space:]]+found|All[[:space:]]+matched[[:space:]]+files'

# The last code edit splits the stream: evidence produced BEFORE it cannot be
# evidence about it. Bash commands are indexed so a tool_result can be joined
# back to the command that produced it — a result whose tool_use_id belongs to
# a Read or a Grep is not command output.
VERDICT=$(printf '%s\n' "$STREAM" | awk -F'\t' -v t1="$T1_CMD_RE" -v t2c="$T2_CMD_RE" -v t2="$T2_OUT_RE" '
  $1 == "E" { lastedit = NR; next }
  $1 == "U" { cmd[$2] = $3; next }
  $1 == "R" { n++; ridx[n] = NR; rid[n] = $2; rerr[n] = $3; rtxt[n] = $4; next }
  END {
    if (lastedit == 0) { print "no-code-edit"; exit }
    tier = 0
    for (i = 1; i <= n; i++) {
      if (ridx[i] <= lastedit) continue
      if (!(rid[i] in cmd)) continue
      # Round-17 HK-M4/FLW-M1: an errored result is still a result. Skipping it
      # silently left tier at 0, and the advisory then told the agent there was
      # "no command output at all" — the more serious state described as the
      # absence of anything. The join is the same one the tiers use, so this
      # counts only errors belonging to a command this stream actually saw.
      if (rerr[i] == "1") { errored = 1; continue }
      if (tier < 1) tier = 1
      if (cmd[rid[i]] ~ t1) { tier = 3; break }
      if ((cmd[rid[i]] ~ t2c || rtxt[i] ~ t2) && tier < 2) tier = 2
    }
    if (tier >= 2) print "verified"
    else if (tier == 1) print "command-but-no-runner"
    else if (errored) print "error-output-only"
    else print "no-command-output"
  }' 2>/dev/null)

case "$VERDICT" in
  verified | no-code-edit | '') exit 0 ;;
esac

case "$VERDICT" in
  command-but-no-runner)
    DETAIL='commands ran after the last code edit, but none of them was a test / typecheck / build runner and none produced runner output.'
    ;;
  error-output-only)
    DETAIL='every command after the last code edit FAILED. A failing run is not the verification a Done claim needs — it is evidence against it.'
    ;;
  *)
    DETAIL='no command output at all after the last code edit.'
    ;;
esac

EXTRA=$(jq -cn --arg v "$VERDICT" --argjson w "$EG_WINDOW" '{verdict:$v, window:$w}' 2>/dev/null) || EXTRA='null'
hook_record evidence-gate evidence-advisory "$EXTRA" '§iron-law-2' "$SESSION_ID"

printf '[claudemd] §7 Iron Law #2 — a completion claim this session has no verification output behind it.\n' >&2
printf '  This session edited code files, the last assistant message makes a Done claim, and %s\n' "$DETAIL" >&2
printf '  Run the verification and cite its output, or restate the claim as [PARTIAL: <what is unverified>].\n' >&2
printf '  Checked the transcript, not the wording: the last %s rows, for a non-error Bash result after the last code edit.\n' "$EG_WINDOW" >&2
printf '  Advisory. Disable: EVIDENCE_GATE=0 or DISABLE_EVIDENCE_GATE_HOOK=1.\n' >&2

exit 0
