#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# ledger-staleness.test.sh — G7 arm (iii)
# (docs/spec-optimization-roadmap-2026-09-21.md, 第 7 节, the Stop arm of G7).
#
# The claim under test is "this session did code work and did not record it in
# the ledger". Both halves are read from the TRANSCRIPT's structure, so the
# assertions that matter hold everything else constant and move one row:
# case 1 and case 2 differ by a single Edit on the ledger file and must differ
# in verdict. A control that only proves the hook CAN fire proves nothing about
# what makes it stop.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/ledger-staleness.sh"

# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

TMP_HOME=$(mktemp -d -t claudemd-ls-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/projects/test"
TRANSCRIPT="$HOME/.claude/projects/test/session.jsonl"

PROJ="$TMP_HOME/proj"
mkdir -p "$PROJ/tasks"
LEDGER="$PROJ/tasks/demo-ledger.md"
write_ledger() {
  printf '# ledger\n\n## Goal\n\ng\n\n## Decisions\n\nd\n\n## Next\n\nn\n' > "$LEDGER"
}
write_ledger

export LEDGER_STALENESS=1

# --- transcript builders ----------------------------------------------------
row_edit() { jq -cn --arg f "$1" '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_e",name:"Edit",input:{file_path:$f}}]}}'; }
row_write() { jq -cn --arg f "$1" '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_w",name:"Write",input:{file_path:$f}}]}}'; }
row_text() { jq -cn --arg t "$1" '{type:"assistant",message:{content:[{type:"text",text:$t}]}}'; }
# A Bash command's result row with the files Claude Code saw it modify.
row_bash_edit() { jq -cn --arg f "$1" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"tu_b",content:""}]},toolUseResult:{stdout:"",bashEditDiff:{files:[{filePath:$f,hunks:[]}]}}}'; }

run_hook() {
  jq -cn --arg c "${1-$PROJ}" --arg t "${2-$TRANSCRIPT}" \
    '{hook_event_name:"Stop",session_id:"ls1",cwd:$c,transcript_path:$t}' \
    | bash "$HOOK" 2>&1
}

log_rows() {
  [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || {
    echo 0
    return
  }
  jq -r 'select(.hook=="ledger-staleness") | .event' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | wc -l | tr -d ' '
}
reset_log() { rm -f "$HOME/.claude/logs/claudemd.jsonl"; }

# --- Case 0: default OFF (§13.3) --------------------------------------------
{
  row_edit /p/src/a.js
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(LEDGER_STALENESS=0 bash -c "jq -cn --arg c '$PROJ' --arg t '$TRANSCRIPT' '{hook_event_name:\"Stop\",session_id:\"ls1\",cwd:\$c,transcript_path:\$t}' | bash '$HOOK' 2>&1")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "0: default OFF → silent (behaviour-layer hooks ship off, §EXT §13.3)"
else
  ng "0: fired without the opt-in flag: $OUT"
fi

# --- Case 1: code edits, ledger untouched → advisory -------------------------
reset_log
OUT=$(run_hook)
RC=$?
if [[ "$OUT" == *"ledger"* && "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "1: code edits + an active ledger nobody wrote to → advisory, one rule-hits row"
else
  ng "1: expected the staleness advisory naming the ledger, got: $OUT (rows $(log_rows))"
fi
# Exit status on the FIRING path. Every shipped hook exits 0 on every branch;
# `exit 2` is undefined behaviour to the harness (docs/HOOK-PROTOCOL.md), and
# the repo's one exit-0 sweep (tests/integration/user-journey.test.sh) cannot
# reach this path — it builds a Stop event with no transcript_path and never
# sets the opt-in, so this hook exits at its gate there. Found in pre-ship
# review: rewriting the terminal `exit 0` to `exit 2` left the suite green.
if [[ "$RC" == "0" ]]; then
  ok "1c: the advisory path still exits 0 (advisory, not a deny)"
else
  ng "1c: the firing path exited $RC — hooks exit 0 on every branch"
fi
# The message IS the product. Asserting only the filename let two mutations
# through in pre-ship review: deleting the three actionable lines, and printing
# the ledger-write count in place of the code-edit count, so a firing advisory
# read "0 code-file edit(s)".
if [[ "$OUT" == *"1 code-file edit(s)"* \
   && "$OUT" == *"Verified-done"* && "$OUT" == *"exit code"* \
   && "$OUT" == *"re-injects"* && "$OUT" == *"DISABLE_LEDGER_STALENESS_HOOK=1"* ]]; then
  ok "1d: the message carries the real edit count, what to do, why, and how to disable"
else
  ng "1d: the advisory text lost content or reports the wrong count: $OUT"
fi
V=$(jq -r 'select(.hook=="ledger-staleness") | "\(.event) \(.spec_section) \(.extra.edits)"' "$HOME/.claude/logs/claudemd.jsonl" | head -n1)
if [[ "$V" == "ledger-stale-advisory §11-ledger 1" ]]; then
  ok "1b: row carries the event, the section and the code-edit count ($V)"
else
  ng "1b: unexpected row: $V"
fi

# --- Case 2: the SAME transcript plus one Edit on the ledger → silent --------
# The discriminating control. Everything above is held constant; one row moves.
{
  row_edit /p/src/a.js
  row_edit "$LEDGER"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "2: one Edit on the ledger silences the identical transcript"
else
  ng "2: fired although the ledger was edited this session: $OUT"
fi

# --- Case 2b: Write counts as writing it, not only Edit ----------------------
{
  row_edit /p/src/a.js
  row_write "$LEDGER"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "2b: Write on the ledger silences it too"
else
  ng "2b: Write on the ledger did not count: $OUT"
fi

# --- Case 2c: a DIFFERENT ledger file does not count -------------------------
# Basename-matched against the ledger this hook actually resolved. A write to
# some other task's ledger is not a record of this one's work — and it cannot
# be the resolved one, because writing it would have made it the newest.
{
  row_edit /p/src/a.js
  row_edit "$PROJ/tasks/other-ledger.md"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "2c: an edit to another task's ledger does not count as writing this one"
else
  ng "2c: a foreign ledger silenced the gate: $OUT (rows $(log_rows))"
fi

# --- Case 3: no code edit → silent (FP control: docs / L0 / L1-copy work) ----
{
  row_edit /p/docs/readme.md
  row_edit /p/notes.txt
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "3: a session that edited no code file never fires (docs-only work)"
else
  ng "3: fired on a session with no code edit: $OUT"
fi

# --- Case 4: no ledger under cwd → silent ------------------------------------
{
  row_edit /p/src/a.js
  row_text "some work"
} > "$TRANSCRIPT"
NOLEDGER="$TMP_HOME/noledger"
mkdir -p "$NOLEDGER/tasks"
reset_log
OUT=$(run_hook "$NOLEDGER")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "4: no ledger file under cwd → the convention is not in use here, silent"
else
  ng "4: fired without a ledger: $OUT"
fi

# --- Case 4b: no tasks/ dir at all → silent ----------------------------------
NOTASKS="$TMP_HOME/notasks"
mkdir -p "$NOTASKS"
reset_log
OUT=$(run_hook "$NOTASKS")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "4b: no tasks/ directory → silent"
else
  ng "4b: fired with no tasks/ directory: $OUT"
fi

# --- Case 5: an abandoned ledger past the age bound → silent -----------------
touch -t 200001010000 "$LEDGER"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "5: a ledger older than CLAUDEMD_LEDGER_MAX_AGE_DAYS is an old task, not this one"
else
  ng "5: fired on an abandoned ledger: $OUT"
fi
# Control for case 5: the same file, current mtime, fires. Without this the
# assertion above passes for any reason at all, including a broken glob.
write_ledger
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "5b: control — the same ledger with a current mtime does fire"
else
  ng "5b: control failed, the age bound was not what silenced case 5: $OUT"
fi

# --- Case 6: window bound ----------------------------------------------------
# The code edit is pushed out of the tail window by filler rows. Under-reporting
# is the intended direction: an edit older than the window reads as no edit.
{
  row_edit /p/src/a.js
  for i in $(seq 1 30); do row_text "filler $i"; done
} > "$TRANSCRIPT"
# The knob is exported inside a subshell, never as a `VAR=x run_hook` prefix:
# bash 3.2 (the macOS leg) keeps an assignment made in front of a FUNCTION call
# after the call returns, so the next case would inherit it silently.
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=10; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "6: a code edit older than the tail window reads as no edit, silent"
else
  ng "6: read past its own window: $OUT"
fi
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=40; run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$(log_rows)" == "1" ]]; then
  ok "6b: control — the same transcript with a window that reaches the edit fires"
else
  ng "6b: control failed, the window was not what silenced case 6: $OUT"
fi
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=notanumber; run_hook)
if [[ "$OUT" == *"demo-ledger.md"* ]]; then
  ok "6c: a non-numeric window falls back to the default instead of reaching tail -n"
else
  ng "6c: non-numeric window changed the verdict: $OUT"
fi

# --- Case 6d: the SHIPPED default window, with no knob set -------------------
# Cases 6/6b/6c all set the knob. Pre-ship review changed the default from 1200
# to 5 and the suite stayed green — and given case 6e below, the default is not
# a tuning detail but the boundary that decides the false-positive rate.
BIG="$TMP_HOME/big.jsonl"
{
  row_edit /p/src/deep.js
  FILLER=$(row_text "filler")
  i=0
  while [[ $i -lt 1250 ]]; do
    printf '%s\n' "$FILLER"
    i=$((i + 1))
  done
} > "$BIG"
reset_log
OUT=$(run_hook "$PROJ" "$BIG")
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "6d: with no knob set, an edit 1250 rows back is outside the default window"
else
  ng "6d: the default window is not 1200 rows: $OUT"
fi
{
  row_edit /p/src/deep.js
  FILLER=$(row_text "filler")
  i=0
  while [[ $i -lt 1100 ]]; do
    printf '%s\n' "$FILLER"
    i=$((i + 1))
  done
} > "$BIG"
reset_log
OUT=$(run_hook "$PROJ" "$BIG")
if [[ "$OUT" == *"demo-ledger.md"* ]]; then
  ok "6e: control — the same shape 1100 rows back is inside it, so 6d is the bound and not the fixture"
else
  ng "6e: control failed, the default window is smaller than claimed: $OUT"
fi

# --- Case 6f: the window is the staleness threshold, on BOTH sides -----------
# Two pre-ship rounds argued this from opposite ends and it is one argument:
# how much work may pass between two ledger writes. Scanning the whole file for
# the ledger write (round one's fix) made the first write of a session an
# exemption for the rest of it — round two's finding. Both sides read the same
# span, so the threshold is a threshold in both directions.
{
  row_edit "$LEDGER"
  for i in $(seq 1 20); do row_text "filler $i"; done
  row_edit /p/src/a.js
  row_edit /p/src/b.js
} > "$TRANSCRIPT"
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=10; run_hook)
if [[ "$OUT" == *"2 code-file edit(s)"* ]]; then
  ok "6f: a ledger write older than the window is stale — code work since it fires"
else
  ng "6f: a ledger write outside the threshold still silenced: $OUT"
fi
# This session DID write the ledger, before the window. The headline said it
# "never wrote to its ledger", which the hook cannot know: it reads the window.
if [[ "$OUT" != *"never wrote"* && "$OUT" == *"edited code and did not write to its ledger in the last 10 transcript rows"* ]]; then
  ok "6f2: the headline claims only the window it read"
else
  ng "6f2: the headline overclaims: $(printf '%s' "$OUT" | head -n 1)"
fi
# Control: the same transcript with a window that reaches the ledger write is
# silent, so 6f is the threshold and not the rows themselves.
reset_log
OUT=$(export LEDGER_STALENESS_WINDOW=100; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "6g: control — widen the window past the ledger write and the same session is silent"
else
  ng "6g: control failed, the window is not what decided 6f: $OUT"
fi

# --- Case 6h: one early ledger write does not exempt the whole session -------
# The regression the whole-file scan introduced: write the ledger once at the
# start, then do a session's worth of code work, and it went silent forever.
{
  row_edit "$LEDGER"
  for i in $(seq 1 1400); do row_edit "/p/src/m$i.js"; done
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$OUT" == *"1200 code-file edit(s)"* ]]; then
  ok "6h: 1400 code edits after one early ledger write still fires at the default window"
else
  ng "6h: an early ledger write exempted the rest of the session: $OUT"
fi

# --- Case 10: which ledger, when tasks/ holds more than one ------------------
# `ls -t` resolution was untested: the suite never put two ledger FILES on
# disk, so changing `head -n 1` to `tail -n 1` left it green. The property is
# load-bearing — session-start-check.sh's injector resolves the same way, and
# the two arms have to name the same file.
MANY="$TMP_HOME/many"
mkdir -p "$MANY/tasks"
printf '# a\n' > "$MANY/tasks/aaa-ledger.md"
printf '# z\n' > "$MANY/tasks/zzz-ledger.md"
touch -t 202601010000 "$MANY/tasks/aaa-ledger.md"
{
  row_edit /p/src/a.js
  row_text "work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook "$MANY")
if [[ "$OUT" == *"zzz-ledger.md"* && "$OUT" != *"aaa-ledger.md"* ]]; then
  ok "10: with two ledgers on disk the advisory names the newest by mtime"
else
  ng "10: resolved the wrong ledger: $OUT"
fi
if [[ "$OUT" == *"most recently modified of 2 ledgers"* ]]; then
  ok "10b: and says it chose between 2, because the newest is not always the right task"
else
  ng "10b: the multi-ledger caveat is missing: $OUT"
fi
# Control: flip the mtimes and the other one is named.
touch "$MANY/tasks/aaa-ledger.md"
reset_log
OUT=$(run_hook "$MANY")
if [[ "$OUT" == *"aaa-ledger.md"* && "$OUT" != *"zzz-ledger.md"* ]]; then
  ok "10c: control — touch the older one and it becomes the resolved one"
else
  ng "10c: resolution does not follow mtime: $OUT"
fi

# --- Cases 10d-10h: the two arms resolve through ONE function ----------------
# Both hooks call hook_newest_ledger (hooks/lib/hook-common.sh). Each case puts
# the same tasks/ in front of both and checks they name the same file:
# ledger-staleness by the basename in its rule-hits row, session-start by the
# Decisions marker it injects. Fixed mtimes in 2020, so the age window is
# widened for both; only the pick decides.
SS_HOOK="$HERE/../../hooks/session-start-check.sh"
PAR="$TMP_HOME/parity"
par_ledger() { printf '## Decisions\n\n- D1: %s\n\n## Next\n\nn\n' "$2" > "$PAR/tasks/$1"; }
ss_ctx() {
  CLAUDEMD_LEDGER_MAX_AGE_DAYS=99999 bash "$SS_HOOK" <<<"{\"session_id\":\"par\",\"source\":\"compact\",\"cwd\":\"$PAR\"}" 2>/dev/null \
    | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null
}
ls_par() { reset_log; (export CLAUDEMD_LEDGER_MAX_AGE_DAYS=99999; run_hook "$PAR"); }
ls_row_is() { # BASENAME COUNT — the advisory row names BASENAME, chosen among COUNT
  jq -e --arg b "$1" --argjson c "$2" \
    'select(.hook=="ledger-staleness" and .event=="ledger-stale-advisory" and .extra.ledger==$b and .extra.ledgers==$c)' \
    "$HOME/.claude/logs/claudemd.jsonl" >/dev/null 2>&1
}
{
  row_edit /p/src/a.js
  row_text "work"
} > "$TRANSCRIPT"

# 10d (item 141b): a newest ledger with a newline in its name. `ls -t` split it
# into `…/tasks/a` and `b-ledger.md`, the first does not exist, and the advisory
# went silent while session-start injected the real file.
mkdir -p "$PAR/tasks"
NLB="a"$'\n'"b-ledger.md"
par_ledger old-ledger.md PAR-OLD
par_ledger "$NLB" PAR-NL
touch -t 202001010000 "$PAR/tasks/old-ledger.md"
touch -t 202001020000 "$PAR/tasks/$NLB"
OUT=$(ls_par)
SS=$(ss_ctx)
# The path reaches the user's terminal: control characters print as `?`, as in
# session-start's banner (0.115.0 pre-tag review L5).
if ls_row_is "$NLB" 2 && [[ "$OUT" == *"$PAR/tasks/a?b-ledger.md"* && "$OUT" != *"$PAR/tasks/$NLB"* \
      && "$OUT" == *"most recently modified of 2 ledgers"* ]] \
   && [[ "$SS" == *"PAR-NL"* && "$SS" != *"PAR-OLD"* ]]; then
  ok "10d: a newline-named newest ledger is the one both arms name, chosen among 2"
else
  ng "10d: arms disagree or lost the newline-named ledger: staleness=$OUT | row=$(cat "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null) | session-start=$SS"
fi
# Control: with that file gone both name the older one, so it was not picked
# above, rather than unpickable.
rm -f "$PAR/tasks/$NLB"
OUT=$(ls_par)
SS=$(ss_ctx)
if ls_row_is old-ledger.md 1 && [[ "$SS" == *"PAR-OLD"* ]]; then
  ok "10e: control — without it both arms name old-ledger.md"
else
  ng "10e: control failed: staleness=$OUT | session-start=$SS"
fi

# 10f: two ledgers in the same second, half a second apart. platform_stat_mtime
# reads whole seconds, so they tie and the first name in glob order wins in both
# hooks. In 0.114.0 both used `ls -t`, which compares nanoseconds, and named zzz:
# the pick moved to the name order, up to a second older, in exchange for one
# resolver (0.115.0 pre-tag review L6). Sub-second
# mtimes through node, because `touch -t` has no fraction field on either BSD or
# GNU and their `-d` syntaxes differ.
rm -rf "$PAR"
mkdir -p "$PAR/tasks"
par_ledger aaa-ledger.md PAR-AAA
par_ledger zzz-ledger.md PAR-ZZZ
node -e 'const fs = require("fs"); const [d] = process.argv.slice(1);
  fs.utimesSync(d + "/aaa-ledger.md", 1577836800.1, 1577836800.1);
  fs.utimesSync(d + "/zzz-ledger.md", 1577836800.6, 1577836800.6);' "$PAR/tasks"
OUT=$(ls_par)
SS=$(ss_ctx)
if ls_row_is aaa-ledger.md 2 && [[ "$SS" == *"PAR-AAA"* && "$SS" != *"PAR-ZZZ"* ]]; then
  ok "10f: a same-second tie goes to the first name in glob order, in both arms"
else
  ng "10f: tie resolved differently: staleness=$OUT | session-start=$SS"
fi
# Control: one whole second newer, and zzz is what both name.
touch -t 202001010001 "$PAR/tasks/zzz-ledger.md"
OUT=$(ls_par)
SS=$(ss_ctx)
if ls_row_is zzz-ledger.md 2 && [[ "$SS" == *"PAR-ZZZ"* && "$SS" != *"PAR-AAA"* ]]; then
  ok "10g: control — a strictly newer ledger wins in both arms"
else
  ng "10g: control failed: staleness=$OUT | session-start=$SS"
fi
rm -rf "$PAR"

# 10h: without platform_stat_mtime there is no order to pick by and no age to
# bound, so no ledger is resolved and the advisory stays silent. The `ls -t`
# resolver still picked one and skipped the age bound. The copy's platform.sh
# sources cleanly and defines nothing (the fail-open suite's truncated shape).
STUB_LS="$TMP_HOME/stubhooks"
mkdir -p "$STUB_LS"
cp -R "$HERE/../../hooks/." "$STUB_LS/"
printf '# truncated mid-definition\nplatform_' > "$STUB_LS/lib/platform.sh"
write_ledger
reset_log
OUT=$(jq -cn --arg c "$PROJ" --arg t "$TRANSCRIPT" '{hook_event_name:"Stop",session_id:"ls1",cwd:$c,transcript_path:$t}' \
  | bash "$STUB_LS/ledger-staleness.sh" 2>&1)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "10h: no mtime wrapper → no ledger resolved, no advisory"
else
  ng "10h: fired without platform_stat_mtime: $OUT (rows $(log_rows))"
fi
rm -rf "$STUB_LS"

# --- Case 11: the code-extension list, exercised past .js --------------------
# Every firing case used .js, so cutting the rest of the list out of the regex
# left the suite green (pre-ship review). A Python or Go session going silent
# would have been invisible.
for EXT in py go sh rs rb java c cpp h cjs cts mjs tsx; do
  {
    row_edit "/p/src/mod.$EXT"
    row_text "work"
  } > "$TRANSCRIPT"
  reset_log
  OUT=$(run_hook)
  if [[ "$OUT" == *"demo-ledger.md"* ]]; then
    ok "11.$EXT: a .$EXT edit counts as code work"
  else
    ng "11.$EXT: a .$EXT edit did not count: $OUT"
  fi
done
# Control: an extension that is NOT in the list stays silent, so case 11 is
# about the list rather than about everything matching.
{
  row_edit /p/src/notes.md
  row_edit /p/src/data.json
  row_text "work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "11.control: .md and .json are not code files"
else
  ng "11.control: a non-code extension fired: $OUT"
fi

# --- Case 7: kill-switches ---------------------------------------------------
{
  row_edit /p/src/a.js
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(export DISABLE_LEDGER_STALENESS_HOOK=1; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "7: DISABLE_LEDGER_STALENESS_HOOK=1 → silent"
else
  ng "7: kill-switch ignored: $OUT"
fi
reset_log
OUT=$(export DISABLE_CLAUDEMD_HOOKS=1; run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "8: DISABLE_CLAUDEMD_HOOKS=1 → silent"
else
  ng "8: global kill-switch ignored: $OUT"
fi

# --- Case 9: fail-open shapes ------------------------------------------------
reset_log
OUT=$(printf 'not json at all\n' | bash "$HOOK" 2>&1)
RC=$?
if [[ -z "$OUT" && "$RC" == "0" ]]; then
  ok "9: malformed event → exit 0, nothing on stdout or stderr"
else
  ng "9: malformed event produced rc=$RC out=$OUT"
fi
reset_log
OUT=$(printf '{}\n' | bash "$HOOK" 2>&1)
RC=$?
if [[ -z "$OUT" && "$RC" == "0" ]]; then
  ok "9b: empty event object → exit 0, silent"
else
  ng "9b: empty event produced rc=$RC out=$OUT"
fi
reset_log
OUT=$(run_hook "$PROJ" "$TMP_HOME/does-not-exist.jsonl")
FO=$(jq -r 'select(.hook=="ledger-staleness" and .event=="fail-open") | .extra.reason' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | head -n1)
if [[ -z "$OUT" && "$FO" == "transcript-missing" ]]; then
  ok "9c: a missing transcript records fail-open rather than guessing"
else
  ng "9c: expected a transcript-missing fail-open row, got out=$OUT row=$FO"
fi
reset_log
OUT=$(jq -cn --arg t "$TRANSCRIPT" '{hook_event_name:"Stop",session_id:"ls1",transcript_path:$t}' | bash "$HOOK" 2>&1)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "9d: an event with no cwd → silent (there is no project to resolve a ledger in)"
else
  ng "9d: fired with no cwd: $OUT"
fi

# --- Case 12 (analysis 2026-09-26 B1): the Bash edit channel -----------------
# Under Opus 5.5 most edits are Bash heredocs, recorded as bashEditDiff on the
# result row. Both halves of this hook have to read that channel: a Bash code
# edit is code work, and a Bash write to the ledger is a ledger write.
{
  row_bash_edit /p/src/a.py
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"demo-ledger.md"* && "$OUT" == *"1 code-file edit(s)"* ]]; then
  ok "12: a Bash-channel code edit with the ledger untouched → advisory"
else
  ng "12: a bashEditDiff code edit did not count: $OUT"
fi
{
  row_bash_edit /p/src/a.py
  row_bash_edit "$LEDGER"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "12b: a Bash write to the ledger silences it, as an Edit does"
else
  ng "12b: a bashEditDiff write to the ledger was not seen: $OUT"
fi
{
  row_bash_edit /p/docs/notes.md
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "12c: control — a Bash edit of a non-code file is not code work"
else
  ng "12c: a non-code bashEditDiff row counted as code work: $OUT"
fi

# 0.99.0 pre-tag review M1: `changedFiles` is the complete list; `files[]` is
# capped at 5 and can be empty. A path in both lists is one edit, not two.
row_bash_edit_cf() { jq -cn --arg f "$1" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"tu_c",content:""}]},toolUseResult:{stdout:"",bashEditDiff:{files:[],moreFiles:1,changedFiles:[$f]}}}'; }
row_bash_edit_both() { jq -cn --arg f "$1" '{type:"user",message:{content:[{type:"tool_result",tool_use_id:"tu_d",content:""}]},toolUseResult:{stdout:"",bashEditDiff:{files:[{filePath:$f,hunks:[]}],moreFiles:0,changedFiles:[$f]}}}'; }
{
  row_bash_edit_cf /p/src/a.py
  row_bash_edit_both /p/src/b.py
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ "$OUT" == *"2 code-file edit(s)"* ]]; then
  ok "12d: changedFiles-only and both-lists rows count one edit per file"
else
  ng "12d: expected 2 code-file edits from changedFiles/both rows: $OUT"
fi
{
  row_bash_edit /p/src/a.py
  row_bash_edit_cf "$LEDGER"
  row_text "some work"
} > "$TRANSCRIPT"
reset_log
OUT=$(run_hook)
if [[ -z "$OUT" && "$(log_rows)" == "0" ]]; then
  ok "12e: a ledger write named only in changedFiles silences it"
else
  ng "12e: a changedFiles-only ledger write was not seen: $OUT"
fi

claudemd_assert_summary
