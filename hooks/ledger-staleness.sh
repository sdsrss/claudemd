#!/usr/bin/env bash
# ledger-staleness.sh — Stop hook (G7 iii, advisory only).
#
# G7 defines `tasks/<slug>-ledger.md` and gives it three hook arms
# (docs/spec-optimization-roadmap-2026-09-21.md §7). Two shipped in v0.90.0:
# `session-start-check.sh` re-injects `Decisions` + `Next` after a compaction or
# a resume, and the format itself went into docs/ARCHITECTURE.md. This is the
# third: at Stop, a session that did code work and never wrote to its ledger
# gets one line saying so.
#
# Which matters because of what the ledger is FOR. Its value is entirely in
# being current — the SessionStart arm re-injects `Decisions` and `Next` after a
# compaction, and a ledger last written three items ago re-injects a state the
# task left behind. Nothing else observes that: the file is a convention, so a
# task that stops updating it produces no error, just a quietly wrong injection
# on the other side of the next compaction.
#
# What it reads, and what it deliberately does not. The verdict is two facts
# about the TRANSCRIPT's structure — did a code-file Edit/Write happen in the
# window, and was there an Edit/Write on the resolved ledger — plus one about
# the filesystem, that a recent ledger exists at all. No timestamp arithmetic
# between the two: row-level `.timestamp` is present in real transcripts and
# absent from this repo's own fixtures, and a gate that silently reads empty on
# a missing field is the shape that already cost this project one release
# (the reverse-join that returned `[]` after a table edit, v0.90.1 H1).
#
# False-positive control, in the order it matters:
#   - no ledger under the event's cwd     -> never fires (the convention is not
#     in use in this project, and the hook has no opinion about that)
#   - the newest ledger is older than
#     CLAUDEMD_LEDGER_MAX_AGE_DAYS        -> never fires (a finished task)
#   - no code-file Edit/Write in window   -> never fires, which keeps L0 /
#     L1-copy / docs-only sessions out of it entirely
#   - any Edit/Write on that ledger       -> never fires
#
# No per-session firing claim, deliberately, and unlike `rework-breaker.sh`
# next door. The condition it reports is not an event but a STATE, and the
# state is cleared by the act the advisory asks for: write the ledger and the
# next Stop is silent, because the write is in the window the hook reads. A
# claim file would buy nothing here and would add a state class for
# clean-residue / uninstall to carry.
#
# Known limit, in the under-reporting direction: the transcript is read from the
# tail (LEDGER_STALENESS_WINDOW rows). A ledger write older than that window
# reads as no write — but so does the code edit that would make it matter, and
# the code edit is the thing that has to be seen first, so the window closes on
# the firing side before it closes on the silencing side.
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
# transcript fail-open it did not actually need.
[[ -n "$EVT_CWD" && -d "$EVT_CWD/tasks" ]] || exit 0

SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

# Newest by mtime, same resolution as session-start-check.sh's injector — the
# two arms must agree on WHICH ledger, or this one nags about a file the other
# one never injects. `ls -t` over the glob rather than `find -printf`: the
# latter is GNU-only and the macOS leg would silently pick nothing.
# shellcheck disable=SC2012  # ordering by mtime is the point; names here are repo-controlled
LEDGER=$(ls -t "$EVT_CWD"/tasks/*-ledger.md 2>/dev/null | head -n 1)
[[ -n "$LEDGER" && -r "$LEDGER" ]] || exit 0

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

# Tail bound, same shape and default as evidence-gate.sh's: large enough to hold
# a working stretch, small enough that a Stop hook on a multi-hour session stays
# inside its budget.
LS_WINDOW="${LEDGER_STALENESS_WINDOW:-1200}"
[[ "$LS_WINDOW" =~ ^[0-9]+$ ]] || LS_WINDOW=1200

LS_BASE=${LEDGER##*/}

# One pass over the tail, emitting one character per interesting tool_use:
#   L  an Edit/Write whose target is the resolved ledger
#   E  an Edit/Write on a code file
# The ledger arm is checked FIRST so a ledger that ends in a code extension
# cannot be counted as code work about itself. Matched on the BASENAME: the
# transcript records absolute paths and the event's cwd may be spelled through a
# different symlink, while a ledger edited under another name cannot be the one
# resolved above — writing it would have made it the newest.
#
# Rows are classified by the CONTENT ITEM's own type. tool_use items appear only
# on assistant rows, so the item type is the whole signal and no row-level
# `.type` test is needed (same reasoning as evidence-gate.sh).
# Same extension list as evidence-gate.sh and rework-breaker.sh — three copies
# in three languages, pinned by the roadmap's G0 pre-registration, so they are
# changed together or not at all.
STREAM=$(tail -n "$LS_WINDOW" "$TRANSCRIPT_PATH" 2>/dev/null | jq -R -r --arg lb "$LS_BASE" '
  try fromjson catch empty
  | ((.message.content // []) | if type == "array" then . else [] end)
  | map(
      if .type == "tool_use" and (.name == "Edit" or .name == "Write") then
        ((.input.file_path // "") | split("/") | last) as $b
        | if $b == $lb then "L"
          elif ((.input.file_path // "") | test("\\.(m?[jt]sx?|cjs|cts|rs|py|go|sh|rb|java|c|cpp|h)$"; "i")) then "E"
          else empty end
      else empty end)
  | .[]' 2>/dev/null)

# `grep -c` prints 0 and exits 1 on no match, so the `|| true` keeps `set -o
# pipefail` from mattering here; a non-numeric count means "no tally", not
# "zero", and is treated as nothing to say.
LS_EDITS=$(printf '%s\n' "$STREAM" | grep -c '^E$' 2>/dev/null || true)
LS_WRITES=$(printf '%s\n' "$STREAM" | grep -c '^L$' 2>/dev/null || true)
[[ "$LS_EDITS" =~ ^[0-9]+$ && "$LS_WRITES" =~ ^[0-9]+$ ]] || exit 0
(( LS_EDITS > 0 )) || exit 0
(( LS_WRITES == 0 )) || exit 0

EXTRA=$(jq -cn --arg l "$LS_BASE" --argjson n "$LS_EDITS" --argjson w "$LS_WINDOW" \
  '{ledger:$l, edits:$n, window:$w}' 2>/dev/null) || EXTRA='null'
hook_record ledger-staleness ledger-stale-advisory "$EXTRA" '§11-ledger' "$SESSION_ID"

printf '[claudemd] §11 / G7 — this session edited code and never wrote to its ledger.\n' >&2
printf '  Ledger: %s (%s code-file edit(s) in the window, no Edit/Write on it).\n' "$LEDGER" "$LS_EDITS" >&2
printf '  Add the finished item to Verified-done with its command and exit code, and move Next, before the task goes on.\n' >&2
printf '  A ledger that is behind is what SessionStart re-injects after the next compaction.\n' >&2
printf '  Advisory. Disable: LEDGER_STALENESS=0 or DISABLE_LEDGER_STALENESS_HOOK=1.\n' >&2

exit 0
