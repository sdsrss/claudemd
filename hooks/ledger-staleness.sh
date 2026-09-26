#!/usr/bin/env bash
# ledger-staleness.sh — Stop hook (G7 arm (iii), advisory only).
#
# G7 defines `tasks/<slug>-ledger.md` and gives it three hook arms
# (docs/spec-optimization-roadmap-2026-09-21.md, 第 7 节): (i) `SessionStart`
# re-injection, (ii) a `PreCompact` line into the ledger's own log, (iii) this
# one. Arm (i) shipped in v0.90.0 — `session-start-check.sh` re-injects
# `Decisions` + `Next` after a compaction or a resume — alongside the format in
# docs/ARCHITECTURE.md, which is the convention rather than an arm. Arm (ii) is
# deferred: `PreCompact`'s behaviour under AUTOMATIC compaction is unverified
# here, and the fact it would record is already available to arm (i)'s
# `source=="compact"` branch. This is arm (iii): at Stop, a session that did
# code work and never wrote to its ledger gets one line saying so.
#
# Which matters because of what the ledger is FOR. Its value is entirely in
# being current, and arm (i) re-injects it whether or not it is. Nothing else
# observes that: the file is a convention, so a task that stops updating it
# produces no error, just a quietly wrong injection on the other side of the
# next compaction.
#
# What it reads, and what it deliberately does not. The verdict is two facts
# about the TRANSCRIPT's structure — did a code-file Edit/Write happen, and was
# there an Edit/Write on the resolved ledger — plus one about the filesystem,
# that a recent ledger exists at all. No timestamp arithmetic between the two:
# row-level `.timestamp` is present in real transcripts and absent from this
# repo's own hook-budget fixture, and a gate that silently reads empty on a
# missing field is the shape that already cost this project one release (the
# reverse join that returned `[]` for every row after a table edit, v0.90.1 H1
# — that one was pointed at the wrong column rather than at an optional field;
# the shared half is the empty key set nothing downstream noticed).
#
# THE WINDOW IS A STALENESS THRESHOLD, not a scanning budget, and both sides are
# read over it. Two pre-ship review rounds argued this from opposite ends and
# they are the same argument. Round one: write the ledger's `Next` first — the
# order docs/ARCHITECTURE.md asks for — then do the code work, and on a long
# enough session the ledger write slides out of the window while the code edits
# do not, so the hook nags a session that did what it asks. Round two, against
# the fix for that (scan the whole transcript for the ledger write): one ledger
# write at minute three then two thousand code edits over six hours goes silent
# forever, because the session "wrote its ledger" once.
#
# Both describe the same quantity — how much work may pass between two ledger
# writes — and neither "ever" nor "this turn" is an answer to it. A threshold
# is. The window IS that threshold, in transcript rows: the hook fires when
# there is code work in the last LEDGER_STALENESS_WINDOW rows and no write to
# the ledger in that same span. At the shipped 1200 that means roughly "an item
# went by unrecorded", which is the rule docs/ARCHITECTURE.md states. What the
# first round actually found was a FALSE CLAIM — an earlier header said the
# window could only ever under-report — not a false positive, and that claim is
# gone rather than patched.
#
# So the failure modes are symmetric and both are real: a session that writes
# its ledger every 1200+ rows is nagged, and one that writes it just inside
# every window is never nagged however little it records. That is what a
# threshold buys, it is why this hook ships default-OFF, and the §13.3 decision
# is where the number gets revisited — from data, not from argument.
#
# False-positive control, in the order it matters:
#   - no ledger under the event's cwd     -> never fires (the convention is not
#     in use in this project, and the hook has no opinion about that)
#   - the newest ledger is older than
#     CLAUDEMD_LEDGER_MAX_AGE_DAYS        -> never fires (a finished task).
#     Skipped, not guessed, when platform_stat_mtime is unavailable, so on that
#     path an old ledger can still draw the advisory.
#   - no code-file Edit/Write in window   -> never fires, which keeps L0 /
#     L1-copy / docs-only sessions out of it entirely
#   - any Edit/Write on that ledger       -> never fires
#
# No per-session firing claim, deliberately, and unlike `rework-breaker.sh`
# next door. The condition it reports is not an event but a STATE, and the
# state is cleared by the act the advisory asks for: write the ledger and the
# next Stop is silent. A claim file would add a state class for clean-residue
# and uninstall to carry, for a nag that is already self-clearing. The cost is
# that a session which decides the ledger does not apply is told so at every
# turn boundary, and that the §13.3 promotion rate this hook is default-OFF to
# collect has a numerator counted per Stop rather than per session — and no
# denominator at all, because nothing counts Stops in projects that HAVE a
# ledger. Both are recorded in docs/RULE-HITS-SCHEMA.md; the promotion decision
# needs instrumentation this release does not ship.
#
# Known limits, all in the under-reporting direction, all deliberate:
#   - an Edit on the ledger that FAILED still silences: the classifier reads
#     tool_use items and never joins to tool_result, so the semantics are
#     attempt, not outcome.
#   - a sidechain (subagent) row's code edit counts as this session's work. No
#     hook in this repo filters `isSidechain`; matching that is the consistent
#     choice until one of them does.
#   - the match is on the ledger's BASENAME, so a same-named ledger in another
#     project silences this one — see the scan below for why a prefix compare
#     would get more cases wrong than the collision it prevents.
#   - a code edit anywhere counts, not only under the event's cwd. Cross-repo
#     work still belongs in the ledger of the task driving it.
#
# Opt-in: LEDGER_STALENESS=1 (default OFF). §EXT §13.3: behaviour-layer hooks
# ship default-OFF for >=30d of FP signal collection before default-ON advisory,
# and only then is a `deny` form even on the table.
#
# Kill-switches:
#   DISABLE_LEDGER_STALENESS_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1        — global

set -uo pipefail

# Opt-in gate (default OFF), before any work.
[[ "${LEDGER_STALENESS:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# platform.sh for platform_stat_mtime (BSD vs GNU `stat`). `|| true`: a missing
# platform.sh must not take the hook down, and the age bound below is skipped
# rather than guessed when the helper is absent.
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch LEDGER_STALENESS || exit 0
hook_require_jq || { hook_record_failopen ledger-staleness jq-missing; exit 0; }

EVENT=$(hook_read_event) || exit 0
EVT_CWD=$(hook_jq_field ledger-staleness "$EVENT" '.cwd // ""') || exit 0
# No cwd, no project to resolve a ledger in. Checked before the transcript so a
# synthetic or field-stripped event exits here rather than recording a
# transcript fail-open it did not actually need. It is also what keeps an empty
# cwd from turning the glob below into `/tasks/*-ledger.md`, which would resolve
# against the filesystem root on a machine that happens to have one. (The
# suite's no-cwd and no-tasks cases reach `exit 0` through the glob as well, so
# they do not discriminate this line — noted rather than dressed up.)
[[ -n "$EVT_CWD" && -d "$EVT_CWD/tasks" ]] || exit 0

SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

# Newest by mtime, same resolution as session-start-check.sh's injector — the
# two arms must agree on WHICH ledger, or this one nags about a file the other
# one never injects. `ls -t` over the glob rather than `find -printf`: the
# latter is GNU-only and the macOS leg would silently pick nothing.
# shellcheck disable=SC2012  # ordering by mtime is the point; names here are repo-controlled
LS_LIST=$(ls -t "$EVT_CWD"/tasks/*-ledger.md 2>/dev/null)
LEDGER=$(printf '%s\n' "$LS_LIST" | head -n 1)
[[ -n "$LEDGER" && -r "$LEDGER" ]] || exit 0
# How many candidates there were. `ls -t` picks the most recently TOUCHED one,
# which is not always the task the session's work belongs to — with two live
# ledgers the advisory can name the wrong file. Rather than guess better, the
# message says how many it chose between.
LS_COUNT=$(printf '%s\n' "$LS_LIST" | grep -c . 2>/dev/null || true)
[[ "$LS_COUNT" =~ ^[0-9]+$ ]] || LS_COUNT=1

LS_MAX_AGE_DAYS="${CLAUDEMD_LEDGER_MAX_AGE_DAYS:-14}"
[[ "$LS_MAX_AGE_DAYS" =~ ^[0-9]+$ ]] || LS_MAX_AGE_DAYS=14
if command -v platform_stat_mtime >/dev/null 2>&1; then
  LS_MT=$(platform_stat_mtime "$LEDGER" 2>/dev/null) || exit 0
  LS_NOW=$(date +%s 2>/dev/null) || exit 0
  [[ "$LS_MT" =~ ^[0-9]+$ && "$LS_NOW" =~ ^[0-9]+$ ]] || exit 0
  (( (LS_NOW - LS_MT) / 86400 <= LS_MAX_AGE_DAYS )) || exit 0
fi

TRANSCRIPT_PATH=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  hook_record_failopen ledger-staleness transcript-missing
  exit 0
fi

# Tail bound for the FIRING side only, same shape and default as
# evidence-gate.sh's: large enough to hold a working stretch, small enough that
# a Stop hook on a multi-hour session stays inside its budget.
LS_WINDOW="${LEDGER_STALENESS_WINDOW:-1200}"
[[ "$LS_WINDOW" =~ ^[0-9]+$ ]] || LS_WINDOW=1200

LS_BASE=${LEDGER##*/}

# Code-file Edit/Write in the tail window. Rows are classified by the CONTENT
# ITEM's own type; tool_use items appear only on assistant rows, so the item
# type is the whole signal and no row-level `.type` test is needed (same
# reasoning as evidence-gate.sh). The ledger cannot reach this arm at all: the
# resolver's glob ends in `-ledger.md`, and `.md` is not a code extension.
#
# Extension list: the same set as `rework-breaker.sh`'s case glob and, since
# v0.91.0, `evidence-gate.sh`'s regex — three copies in three languages, pinned
# to each other by tests/scripts/code-ext-parity.test.js and to the roadmap's
# G0 pre-registration, so they are changed together or not at all.
#
# Both edit channels count: an Edit/Write tool_use, and each file a Bash command
# modified as Claude Code records it on the result row (`toolUseResult.
# bashEditDiff`, CC >=2.1.278). Under Opus 5.5 most edits take the Bash route
# (analysis 2026-09-26, B1), so reading tool_use alone left this hook silent on
# most of that model's sessions. `bash_edit_paths` is the one definition both
# jq passes below use.
# `changedFiles` is the complete list; `files[]` holds at most 5 rendered diffs
# and can be empty (0.99.0 pre-tag review M1). Both are read, once per path.
LS_BED_JQ='def bash_edit_paths: [.toolUseResult | objects | .bashEditDiff | objects | ((.changedFiles | arrays | .[] | strings), (.files | arrays | .[] | objects | .filePath | strings))] | unique;'
LS_EDITS=$(tail -n "$LS_WINDOW" "$TRANSCRIPT_PATH" 2>/dev/null | jq -R -r "$LS_BED_JQ"'
  def is_code: test("\\.(m?[jt]sx?|cjs|cts|rs|py|go|sh|rb|java|c|cpp|h)$"; "i");
  try fromjson catch empty
  | (bash_edit_paths | map(select(is_code) | "E"))
    + ((.message.content // []) | if type == "array" then . else [] end
  | map(
      if .type == "tool_use" and (.name == "Edit" or .name == "Write")
         and ((.input.file_path // "") | is_code)
      then "E" else empty end))
  | .[]' 2>/dev/null | grep -c '^E$' 2>/dev/null || true)
# `grep -c` prints 0 and exits 1 on no match; a non-numeric count means "no
# tally", not "zero", and is treated as nothing to say.
[[ "$LS_EDITS" =~ ^[0-9]+$ ]] || exit 0
(( LS_EDITS > 0 )) || exit 0

# Silencing side, over the SAME window — see the header for why that span and
# not the whole file. Matched on the BASENAME: the transcript records absolute
# paths and the event's cwd may be spelled through a different symlink, while a
# ledger edited under another name cannot be the one resolved above, because
# writing it would have made it the newest.
LS_WRITES=$(tail -n "$LS_WINDOW" "$TRANSCRIPT_PATH" 2>/dev/null | jq -R -r --arg lb "$LS_BASE" "$LS_BED_JQ"'
  try fromjson catch empty
  | (bash_edit_paths | map(select((split("/") | last) == $lb) | "L"))
    + ((.message.content // []) | if type == "array" then . else [] end
  | map(
      if .type == "tool_use" and (.name == "Edit" or .name == "Write")
         and (((.input.file_path // "") | split("/") | last) == $lb)
      then "L" else empty end))
  | .[]' 2>/dev/null | grep -c '^L$' 2>/dev/null || true)
[[ "$LS_WRITES" =~ ^[0-9]+$ ]] || exit 0
(( LS_WRITES == 0 )) || exit 0

EXTRA=$(jq -cn --arg l "$LS_BASE" --argjson n "$LS_EDITS" --argjson w "$LS_WINDOW" --argjson c "$LS_COUNT" \
  '{ledger:$l, edits:$n, window:$w, ledgers:$c}' 2>/dev/null) || EXTRA='null'
hook_record ledger-staleness ledger-stale-advisory "$EXTRA" '§11-ledger' "$SESSION_ID"

printf '[claudemd] §11 / G7 — this session edited code and never wrote to its ledger.\n' >&2
printf '  Ledger: %s (%s code-file edit(s) in the last %s transcript rows, and no Edit/Write on it in that span).\n' \
  "$LEDGER" "$LS_EDITS" "$LS_WINDOW" >&2
if (( LS_COUNT > 1 )); then
  printf '  Chosen as the most recently modified of %s ledgers under tasks/ — if the work belongs to another one, this names the wrong file.\n' "$LS_COUNT" >&2
fi
printf '  Add the finished item to Verified-done with its command and exit code, and move Next, before the task goes on.\n' >&2
printf '  A ledger that is behind is what SessionStart re-injects after the next compaction.\n' >&2
printf '  Advisory. Disable: LEDGER_STALENESS=0 or DISABLE_LEDGER_STALENESS_HOOK=1.\n' >&2

exit 0
