#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/rule-hits.sh"
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX")
trap 'rm -rf "$TMP_HOME"' EXIT

export HOME="$TMP_HOME"
LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"

run() { bash -c "source $LIB; $*"; }

# Case 1: basic append
run 'rule_hits_append banned-vocab deny null'
[[ -f "$LOG" ]] || { echo "FAIL: log file not created"; exit 1; }
LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$LINES" == "1" ]] || { echo "FAIL: expected 1 line, got $LINES"; exit 1; }
jq -e '.hook == "banned-vocab" and .event == "deny"' "$LOG" >/dev/null \
  || { echo "FAIL: row missing expected fields"; exit 1; }

# Case 2: extra JSON
run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":4521}'\'''
SECOND=$(tail -n 1 "$LOG")
echo "$SECOND" | jq -e '.extra.run_id == 4521' >/dev/null \
  || { echo "FAIL: extra not preserved"; exit 1; }

# Case 3: DISABLE_RULE_HITS_LOG suppresses
LINE_BEFORE=$(wc -l < "$LOG" | tr -d ' ')
DISABLE_RULE_HITS_LOG=1 run 'rule_hits_append banned-vocab deny null'
LINE_AFTER=$(wc -l < "$LOG" | tr -d ' ')
[[ "$LINE_BEFORE" == "$LINE_AFTER" ]] || { echo "FAIL: log appended despite kill-switch"; exit 1; }

# Case 4: size-capped rotation — grow log past max, next append rotates.
# Use CLAUDEMD_LOG_MAX_MB=0 + ~1KB log so any non-empty file triggers rotate.
# (0*1024*1024 = 0 bytes threshold; real log is ~100 bytes, so size > 0 → rotate.)
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
run 'rule_hits_append banned-vocab deny null'
PRE_LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$PRE_LINES" == "2" ]] || { echo "FAIL: setup expected 2 lines, got $PRE_LINES"; exit 1; }
CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
# After rotation: primary has 1 new line, .1 holds the 2 old ones.
POST_LINES=$(wc -l < "$LOG" | tr -d ' ')
ROTATED_LINES=$(wc -l < "$LOG.1" | tr -d ' ')
[[ "$POST_LINES" == "1" ]] || { echo "FAIL: post-rotation primary expected 1 line, got $POST_LINES"; exit 1; }
[[ "$ROTATED_LINES" == "2" ]] || { echo "FAIL: .1 expected 2 lines, got $ROTATED_LINES"; exit 1; }

# Case 5: second rotation pushes .1 to .2, drops any prior .2.
echo '{"stale":true}' > "$LOG.2"
CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
# .2 now holds what .1 held before; prior .2 is gone.
[[ -f "$LOG.2" ]] || { echo "FAIL: .2 missing after second rotation"; exit 1; }
NEW_TWO_LINES=$(wc -l < "$LOG.2" | tr -d ' ')
[[ "$NEW_TWO_LINES" == "2" ]] || { echo "FAIL: .2 expected 2 lines (old .1 content), got $NEW_TWO_LINES"; exit 1; }
grep -q '"stale":true' "$LOG.2" && { echo "FAIL: stale .2 content not evicted"; exit 1; }

# Case 6: under threshold → no rotation.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
CLAUDEMD_LOG_MAX_MB=5 run 'rule_hits_append banned-vocab deny null'
[[ -f "$LOG.1" ]] && { echo "FAIL: rotated despite being under threshold"; exit 1; }
UNDER_LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$UNDER_LINES" == "2" ]] || { echo "FAIL: under-threshold expected 2 lines, got $UNDER_LINES"; exit 1; }

# Case 7: project field — CLAUDE_PROJECT_DIR encoded with `/` and `.` → `-`.
rm -rf "$TMP_HOME/.claude/logs"
CLAUDE_PROJECT_DIR=/work/my.project run 'rule_hits_append banned-vocab deny null'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.project == "-work-my-project"' >/dev/null \
  || { echo "FAIL: Case 7 project encoding wrong (got: $(echo "$LAST" | jq -r .project))"; exit 1; }

# Case 8: project field falls back to PWD when CLAUDE_PROJECT_DIR unset.
rm -rf "$TMP_HOME/.claude/logs"
unset_run() { unset CLAUDE_PROJECT_DIR; bash -c "source $LIB; $*"; }
(cd "$TMP_HOME" && unset_run 'rule_hits_append banned-vocab deny null')
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.project | length > 0' >/dev/null \
  || { echo "FAIL: Case 8 project field empty under PWD fallback (got: $LAST)"; exit 1; }

# Case 9: existing 'extra' payload still preserved alongside new project field.
rm -rf "$TMP_HOME/.claude/logs"
CLAUDE_PROJECT_DIR=/p run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":99}'\'''
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.project == "-p" and .extra.run_id == 99' >/dev/null \
  || { echo "FAIL: Case 9 project + extra both required (got: $LAST)"; exit 1; }

# Case 10 (v0.7.0): spec_section 4th positional arg lands as `spec_section`
# field, populated only when non-empty (omitted arg → null).
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null "§10-V"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.spec_section == "§10-V"' >/dev/null \
  || { echo "FAIL: Case 10 spec_section not threaded through (got: $LAST)"; exit 1; }

# Case 11: omitted spec_section arg → null in JSONL row (back-compat for
# meta hooks like session-start bootstrap / version-sync that aren't
# enforcing a spec rule).
run 'rule_hits_append session-start bootstrap null'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.spec_section == null' >/dev/null \
  || { echo "FAIL: Case 11 omitted section should be null (got: $LAST)"; exit 1; }

# Case 12: empty-string spec_section arg also normalizes to null (defends
# against accidental `hook_record h e null ""` becoming an empty-string row,
# which would muddle audit `bySection` `(unset)` bucket attribution).
run 'rule_hits_append banned-vocab deny null ""'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.spec_section == null' >/dev/null \
  || { echo "FAIL: Case 12 empty spec_section should normalize to null (got: $LAST)"; exit 1; }

# Case 13 (v0.10.0): session_id 5th positional arg lands as `session_id`
# field. Drives audit `unique_invocations` dedup — disambiguates hook
# double-fire (same session_id) from fast-retry across sessions.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null "§10-V" "abc-123-session"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.session_id == "abc-123-session"' >/dev/null \
  || { echo "FAIL: Case 13 session_id not threaded through (got: $LAST)"; exit 1; }

# Case 14: omitted/empty session_id arg → null in JSONL row (back-compat for
# pre-v0.10.0 callers + hooks that can't extract session_id from EVENT).
run 'rule_hits_append banned-vocab deny null "§10-V"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.session_id == null' >/dev/null \
  || { echo "FAIL: Case 14 omitted session_id should normalize to null (got: $LAST)"; exit 1; }
run 'rule_hits_append banned-vocab deny null "§10-V" ""'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.session_id == null' >/dev/null \
  || { echo "FAIL: Case 14b empty-string session_id should normalize to null (got: $LAST)"; exit 1; }

# Case 15: session_id + project + spec_section + extra all coexist on one
# row — full-shape sample. Byte-exact prod sample per
# feedback_test_fixture_format_drift.md: pin to the exact field set today's
# audit.js consumes.
rm -rf "$TMP_HOME/.claude/logs"
CLAUDE_PROJECT_DIR=/work/p run 'rule_hits_append ship-baseline pass-known-red '\''{"run_id":42}'\'' "§7-ship-baseline" "sess-xyz"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '
  .hook == "ship-baseline" and
  .event == "pass-known-red" and
  .project == "-work-p" and
  .session_id == "sess-xyz" and
  .spec_section == "§7-ship-baseline" and
  .extra.run_id == 42 and
  (.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
' >/dev/null \
  || { echo "FAIL: Case 15 full-shape row mismatch (got: $LAST)"; exit 1; }

# Case 16 (v0.9.34): tool_use_id 6th positional arg lands as `tool_use_id`
# field. Required for audit `unique_invocations` dedup — disambiguates true
# single-invocation double-fire (same tool_use_id) from Claude fast-retry
# (different tool_use_id, same second).
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null "§10-V" "sess-abc" "toolu_01XYZ"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.tool_use_id == "toolu_01XYZ" and .session_id == "sess-abc"' >/dev/null \
  || { echo "FAIL: Case 16 tool_use_id not threaded through (got: $LAST)"; exit 1; }

# Case 17: omitted/empty tool_use_id → null. Hooks without per-tool context
# (Stop / SessionStart / SessionEnd / UserPromptSubmit) emit null in this
# column.
run 'rule_hits_append sandbox-disposal warn '\''{"count":1}'\'' "§8.V4" "sess-abc"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.tool_use_id == null and .session_id == "sess-abc"' >/dev/null \
  || { echo "FAIL: Case 17 omitted tool_use_id should normalize to null (got: $LAST)"; exit 1; }
run 'rule_hits_append banned-vocab deny null "§10-V" "sess-abc" ""'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '.tool_use_id == null' >/dev/null \
  || { echo "FAIL: Case 17b empty-string tool_use_id should normalize to null (got: $LAST)"; exit 1; }

# Case 18: full-shape row with both session_id + tool_use_id (PreToolUse
# emitter pattern). Byte-exact assertion locks v0.9.34 consumer field set.
rm -rf "$TMP_HOME/.claude/logs"
CLAUDE_PROJECT_DIR=/work/p run 'rule_hits_append banned-vocab deny '\''{"matched":["significantly"]}'\'' "§10-V" "sess-xyz" "toolu_42"'
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e '
  .hook == "banned-vocab" and
  .event == "deny" and
  .project == "-work-p" and
  .session_id == "sess-xyz" and
  .tool_use_id == "toolu_42" and
  .spec_section == "§10-V" and
  (.extra.matched | type == "array")
' >/dev/null \
  || { echo "FAIL: Case 18 full-shape row with tool_use_id mismatch (got: $LAST)"; exit 1; }

# Case 19 (vNEXT): reserved test sentinel — session_id "t" must NOT write a
# row. Fixtures across the hook suite use session_id:"t"; ad-hoc manual hook
# invocations in the real $HOME with such a fixture leaked 309 rows (11.5% of
# production telemetry) into ~/.claude/logs/claudemd.jsonl, inflating
# banned-vocab deny counts ~2x and obscuring real signal (2026-06-03 impact
# audit). Sandboxed test runs that assert on log *content* use distinct ids
# (e.g. sess35, "test"), so guarding only "t" never hides a real assertion.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null "§10-V" "t"'
[[ ! -f "$LOG" ]] || { echo "FAIL: Case 19 sentinel session_id 't' wrote a row: $(cat "$LOG")"; exit 1; }

# Case 20a (vNEXT regression): a real (UUID-ish) session_id still writes — the
# sentinel skip must be surgical.
run 'rule_hits_append banned-vocab deny null "§10-V" "abc-123-real"'
[[ -f "$LOG" && "$(wc -l < "$LOG" | tr -d ' ')" == "1" ]] \
  || { echo "FAIL: Case 20a real session_id did not write (got: $(cat "$LOG" 2>/dev/null))"; exit 1; }

# Case 20b (vNEXT regression): "test" is NOT guarded — transcript-*-scan tests
# assert on rows written with the "test" sentinel, so it must still write.
run 'rule_hits_append transcript-structure-scan structure-advisory null "§10-honesty" "test"'
[[ "$(wc -l < "$LOG" | tr -d ' ')" == "2" ]] \
  || { echo "FAIL: Case 20b 'test' sentinel should still write (got: $(cat "$LOG" 2>/dev/null))"; exit 1; }

echo "All cases passed"

# ARCH-1 (2026-07-12 audit): hook_encode_project is the single source for the
# CC projects-dir encoding (every non-[a-zA-Z0-9-] char → '-'). Binds the leaf
# definition so the 4 former inline `tr -c` copies can't silently diverge.
EObase="/mnt/data_ssd/dev/projects/claude.md_v2"
EOgot=$(run "hook_encode_project '$EObase'")
EOexp="-mnt-data-ssd-dev-projects-claude-md-v2"
[[ "$EOgot" == "$EOexp" ]] || { echo "FAIL: hook_encode_project got '$EOgot' expected '$EOexp'"; exit 1; }
# empty input → empty output (no crash)
[[ -z "$(run 'hook_encode_project ""')" ]] || { echo "FAIL: hook_encode_project empty should be empty"; exit 1; }
echo "PASS: hook_encode_project encoding"

# ARCH-2 (2026-07-17 audit): CROSS-LANGUAGE parity — bash hook_encode_project
# must agree with scripts/lib/paths.js#encodeProjectCwd for every BMP input.
# The two sides of the seam are consumed jointly (bash hooks WRITE encoded
# project fields / CC writes ~/.claude/projects dirs; JS auditors READ both);
# pre-fix the bash side was byte-wise so any CJK cwd diverged (`/home/项目x` →
# bash `-home-------x` vs JS `-home---x`) and JS auditors silently mis-located
# the project dir. Fixtures stress each divergence class: multibyte CJK
# (byte-vs-codepoint), accented Latin (locale range collation), specials
# (`+`/`@`/space — the feedback_cc_cwd_encoding_dots class), plain ASCII.
# Non-BMP (emoji) is a documented residual (UTF-16 units vs codepoints), not
# tested. Skips (with FAIL) if node is unavailable — CI always has it.
PATHS_JS="$(cd "$(dirname "$0")/../../scripts/lib" && pwd)/paths.js"
js_encode() {
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const [lib, raw] = process.argv.slice(1);
    const m = await import(pathToFileURL(lib).href);
    process.stdout.write(m.encodeProjectCwd(raw));
  ' "$PATHS_JS" "$1"
}
if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: ARCH-2 parity needs node on PATH"; exit 1
fi
ARCH2_FIXTURES=(
  "/home/项目x"
  "/home/usér/prôjet"
  "/home/user/my proj+x@y"
  "/mnt/data_ssd/dev/projects/claude.md_v2"
)
# LC_CTYPE is PINNED here (2026-07-26 audit). rule-hits.sh:24-26 documents that
# `${s:i:1}` slicing needs a UTF-8 LC_CTYPE and "under LC_ALL=C it degrades to
# byte-wise — exactly the old tr behavior", but nothing in env-hygiene, run-all,
# or this suite set it: the verdict was inherited from whatever shell invoked the
# test, so a green run proved nothing about which mode had been exercised.
# Take the first candidate the host ACTUALLY lists. An earlier form asked whether
# EITHER candidate existed and then kept the first unconditionally — on macOS,
# which ships en_US.UTF-8 but no C.UTF-8 (a glibc locale), that pinned an absent
# locale, bash fell back to byte-wise slicing, and the CJK parity fixture failed.
# An unavailable name is worse than no pin at all, so fail loudly if none match.
# Probe by BEHAVIOR, not by parsing `locale -a`. Two earlier forms were wrong in
# opposite directions: the first asked whether EITHER candidate was listed and
# then kept the first regardless (pinning a C.UTF-8 macOS does not ship); the
# second matched `locale -a` lines exactly and found nothing on the macOS runner,
# then hard-failed. What actually matters is whether bash slices by CODEPOINT
# under the candidate — measure that directly on a known 3-codepoint string.
_arch2_locale=""
for _cand in C.UTF-8 en_US.UTF-8 C.utf8 en_US.utf8 UTF-8; do
  if [[ "$(LC_ALL="$_cand" bash -c 'x="项目x"; printf %s "${#x}"' 2>/dev/null)" == "3" ]]; then
    _arch2_locale="$_cand"; break
  fi
done
if [[ -z "$_arch2_locale" ]]; then
  # Loud skip, not a failure: with no codepoint-aware locale the parity property
  # is genuinely unassertable on this host, and rule-hits.sh documents the
  # byte-wise degradation as accepted. Same posture as upgrade-lifecycle's
  # unreachable-tag skip — the operator should see it, not be blocked by it.
  echo "SKIP: ARCH-2 parity — no codepoint-slicing locale on this host (tried C.UTF-8/en_US.UTF-8/UTF-8)"
  echo "SKIP: to exercise it, install a UTF-8 locale; byte-wise degradation is documented in rule-hits.sh"
  ARCH2_FIXTURES=()
fi
_arch2_saved_lc_all="${LC_ALL-}"; _arch2_saved_lc_ctype="${LC_CTYPE-}"
[[ -n "$_arch2_locale" ]] && export LC_ALL="$_arch2_locale" LC_CTYPE="$_arch2_locale"
for f in ${ARCH2_FIXTURES[@]+"${ARCH2_FIXTURES[@]}"}; do
  bash_enc=$(run "hook_encode_project '$f'")
  js_enc=$(js_encode "$f")
  [[ -n "$bash_enc" && "$bash_enc" == "$js_enc" ]] \
    || { echo "FAIL: ARCH-2 parity on '$f' under $_arch2_locale: bash='$bash_enc' js='$js_enc'"; exit 1; }
done
if [[ -n "$_arch2_locale" ]]; then
  echo "PASS: ARCH-2 parity fixtures ran under a pinned UTF-8 locale ($_arch2_locale)"
fi

# Degradation floor: under LC_ALL=C the encoder is DOCUMENTED to fall back to
# byte-wise. That is acceptable (it matches the pre-2026-07-17 tr behavior) but
# must never produce something a path lookup could not survive — assert it still
# yields a non-empty, dash-and-alnum-only name for every fixture.
for f in ${ARCH2_FIXTURES[@]+"${ARCH2_FIXTURES[@]}"}; do
  c_enc=$(LC_ALL=C run "hook_encode_project '$f'")
  [[ -n "$c_enc" && "$c_enc" =~ ^[A-Za-z0-9-]+$ ]] \
    || { echo "FAIL: ARCH-2 C-locale degradation on '$f' produced '$c_enc'"; exit 1; }
done
if (( ${#ARCH2_FIXTURES[@]} > 0 )); then
  echo "PASS: hook_encode_project degrades safely under LC_ALL=C (${#ARCH2_FIXTURES[@]} fixtures)"
fi

# Restore: the pin is for the parity block only, not the ~150 lines after it.
if [[ -n "$_arch2_saved_lc_all" ]]; then export LC_ALL="$_arch2_saved_lc_all"; else unset LC_ALL; fi
if [[ -n "$_arch2_saved_lc_ctype" ]]; then export LC_CTYPE="$_arch2_saved_lc_ctype"; else unset LC_CTYPE; fi
if (( ${#ARCH2_FIXTURES[@]} > 0 )); then
  echo "PASS: hook_encode_project ≡ encodeProjectCwd (cross-language parity, ${#ARCH2_FIXTURES[@]} fixtures)"
fi


# Case ARCH-3 (2026-07-25 audit, loop-F2): every row carries hook_version =
# the emitting plugin build's package.json version, so telemetry written by a
# STALE registered hook dir (0.52.0 hooks while 0.55.0 installed — 242
# stale-root events across 12 version gaps in the live log) can be stratified
# instead of pooled indistinguishably into calibration windows.
run 'rule_hits_append banned-vocab deny null "§10-V" sess-hv'
PKG_VER=$(jq -r '.version' "$(cd "$(dirname "$0")/../.." && pwd)/package.json")
LAST=$(tail -n 1 "$LOG")
echo "$LAST" | jq -e --arg v "$PKG_VER" '.hook_version == $v' >/dev/null \
  || { echo "FAIL: ARCH-3 hook_version missing or wrong (want $PKG_VER, got: $LAST)"; exit 1; }


# --- Rotation: claim-based, v0.76.3 ----------------------------------------
# The mkdir mutex these cases used to describe is gone. A rotator now renames
# the live log to a private `<log>.rotating.<pid>.<n>` and archives from there,
# so ownership of a generation is established by rename(2) unlinking the source.
# The reason is measured: on the development host /usr/bin/mkdir is uutils
# coreutils 0.8.0 and 200 four-way races produced 206 wins where 200 were
# expected, while /usr/bin/mv is GNU coreutils 9.7 and the same 200 races over a
# rename produced exactly one winner every time.

# Case ROT-1: the loser of a claim leaves both archives alone. Under the mutex
# this was "a second process arriving mid-rotation"; the claim expresses it as a
# rename that finds no source. Deterministic stand-in: an `mv` shim that fails
# only for the claim, which is the state of every process but the winner.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'ARCHIVE-1\n' > "$LOG.1"
printf 'ARCHIVE-2\n' > "$LOG.2"
MVSHIM="$TMP_HOME/mvshim"
mkdir -p "$MVSHIM"
cat > "$MVSHIM/mv" <<'SHIM'
#!/usr/bin/env bash
# `mv` lives in /bin on macOS and /usr/bin on GNU hosts; a hard-coded path makes
# the shim fail for EVERY call, not just the one it means to intercept.
REAL_MV=$(command -v -p mv 2>/dev/null || echo /bin/mv)
for a in "$@"; do case "$a" in *.rotating.*) exit 1;; esac; done
exec "$REAL_MV" "$@"
SHIM
chmod +x "$MVSHIM/mv"
PATH="$MVSHIM:$PATH" CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
[[ "$(cat "$LOG.1")" == "ARCHIVE-1" ]] \
  || { echo "FAIL: ROT-1 .1 rotated by a process that lost the claim: $(cat "$LOG.1")"; exit 1; }
[[ "$(cat "$LOG.2")" == "ARCHIVE-2" ]] \
  || { echo "FAIL: ROT-1 .2 overwritten by a process that lost the claim: $(cat "$LOG.2")"; exit 1; }
echo "PASS: ROT-1 losing the claim leaves both archives untouched"

# Case ROT-2: an orphan claim — a rotator killed between the claim and the
# placement — holds a full generation of ROWS, so the reaper completes the
# interrupted rotation rather than deleting it. The old stale-lock reap could
# only ever `rmdir`; there was nothing in a lock to preserve.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
rm -f "$LOG.1" "$LOG.2"
printf 'ORPHANED-GENERATION\n' > "$LOG.rotating.999.1"
touch -t 200001010000 "$LOG.rotating.999.1"
run 'rule_hits_append banned-vocab deny null'
[[ "$(cat "$LOG.1" 2>/dev/null)" == "ORPHANED-GENERATION" ]] \
  || { echo "FAIL: ROT-2 orphan rows not recovered into .1: $(ls "$TMP_HOME/.claude/logs")"; exit 1; }
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-2 orphan claim survived the reap"; exit 1; }
echo "PASS: ROT-2 an orphan claim is completed into a free archive slot"

# Case ROT-3: the happy path leaves no residue — nothing for the reaper to find
# after a rotation that completed.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
[[ -f "$LOG.1" ]] || { echo "FAIL: ROT-3 no rotation happened"; exit 1; }
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-3 claim left behind after a completed rotation"; exit 1; }
echo "PASS: ROT-3 a completed rotation leaves no claim behind"

# Case ROT-4 (2026-09-05 post-ship review, finding 1): the mtime FALLBACK must
# not be `find -mmin`. BSD find — macOS, i.e. half the CI matrix — rounds the age
# UP to the next full minute, so an entry two seconds old reads as "1 minute" and
# `-mmin -1` prints nothing.
#
# Claims written by the rotator carry their birth epoch in the NAME and never
# reach this path (ROT-11). The fallback is for an entry whose name carries no
# numeric stamp — a hand-made fixture, or a file a user dropped in the log dir —
# and reaping one of those early is still a generation destroyed. The shim stands
# in for the rounding find: it prints nothing, whatever it is asked.
#
# The original fixture here was `printf … > "$LOG.rotating.998.1"`, which the
# 0.77.0 pre-tag review named as the right lesson with the wrong fixture: `998`
# is an epoch in 1970, so once aging read the name that entry was correctly
# ancient and the case asserted nothing about freshness.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'ARCHIVE-1\n' > "$LOG.1"
printf 'IN-FLIGHT\n' > "$LOG.rotating.notanepoch.1"
SHIMDIR="$TMP_HOME/shim"
mkdir -p "$SHIMDIR"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SHIMDIR/find"
chmod +x "$SHIMDIR/find"
sleep 2
PATH="$SHIMDIR:$PATH" CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
[[ "$(cat "$LOG.rotating.notanepoch.1" 2>/dev/null)" == "IN-FLIGHT" ]] \
  || { echo "FAIL: ROT-4 a 2s-old unstamped claim was reaped (fallback depends on find rounding)"; exit 1; }
rm -f "$LOG.rotating.notanepoch.1"
echo "PASS: ROT-4 the mtime fallback keeps a fresh unstamped claim"

# Case ROT-5 (same review, finding 3): the reap must not sit inside the size
# check. A rotator killed mid-rotation leaves the log already claimed and so
# UNDER the cap — nested inside `size > max_bytes` the branch is unreachable and
# the orphan is permanent (measured then: a lock survived 10 appends with the
# live log at 1,960 bytes against the 5 MB default cap).
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
rm -f "$LOG.1" "$LOG.2"
printf 'STRANDED\n' > "$LOG.rotating.997.1"
touch -t 200001010000 "$LOG.rotating.997.1"
run 'rule_hits_append banned-vocab deny null'   # default 5 MB cap: no rotation
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-5 orphan claim survived an append under the size cap"; exit 1; }
echo "PASS: ROT-5 an orphan claim is reaped even when the log is under the cap"

# Case ROT-6 (2026-09-05 audit Q-01, carried across the redesign): the size that
# AUTHORIZES an archive must be re-read on the file actually held.
#
# The claim closes the arm the mutex lost on — after the winner's rename there is
# nothing left for a second process to claim. It does not close the same
# interleaving one step further out: P2 reads the size, P1 claims and archives, a
# THIRD process appends and re-creates the log, and P2's rename now succeeds
# against a BRAND-NEW generation of a few hundred bytes. Archiving that would
# push P1's just-placed `.1` onto `.2` and drop the generation in `.2` — the
# P1-1 signature by a different route.
#
# Deterministic stand-in, same trick as ROT-4's find shim: a counting `stat`
# answers the FIRST size query with an over-cap number and every later one
# truthfully. That is exactly P2's state — an outer check that passed against a
# generation it no longer holds.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'ARCHIVE-1\n' > "$LOG.1"
printf 'ARCHIVE-2\n' > "$LOG.2"
ROWS_BEFORE=$(wc -l < "$LOG" | tr -d ' ')
STATSHIM="$TMP_HOME/statshim"
mkdir -p "$STATSHIM"
cat > "$STATSHIM/stat" <<'SHIM'
#!/usr/bin/env bash
# Size queries only (-c %s / -f %z); everything else goes to the real stat.
if [[ "${1:-}" == "-c" && "${2:-}" == "%s" ]] || [[ "${1:-}" == "-f" && "${2:-}" == "%z" ]]; then
  N=0
  [[ -f "$SHIM_COUNT" ]] && N=$(cat "$SHIM_COUNT")
  echo $((N + 1)) > "$SHIM_COUNT"
  if (( N == 0 )); then echo 999999999; exit 0; fi
fi
exec /usr/bin/env -u PATH /usr/bin/stat "$@" 2>/dev/null || exec /bin/stat "$@"
SHIM
chmod +x "$STATSHIM/stat"
SHIM_COUNT="$TMP_HOME/statshim.count" PATH="$STATSHIM:$PATH" \
  CLAUDEMD_LOG_MAX_MB=1 run 'rule_hits_append banned-vocab deny null'
[[ "$(cat "$LOG.1")" == "ARCHIVE-1" ]] \
  || { echo "FAIL: ROT-6 .1 rotated on a stale size reading: $(cat "$LOG.1" 2>&1)"; exit 1; }
[[ "$(cat "$LOG.2")" == "ARCHIVE-2" ]] \
  || { echo "FAIL: ROT-6 .2 clobbered on a stale size reading: $(cat "$LOG.2" 2>&1)"; exit 1; }
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-6 the no-op branch left the claim behind"; exit 1; }
# The rows in the wrongly-claimed generation are telemetry, not scratch: the
# no-op branch gives them back to the live log rather than dropping them.
ROWS_AFTER=$(wc -l < "$LOG" | tr -d ' ')
(( ROWS_AFTER >= ROWS_BEFORE + 1 )) \
  || { echo "FAIL: ROT-6 claimed rows were dropped ($ROWS_BEFORE -> $ROWS_AFTER)"; exit 1; }
echo "PASS: ROT-6 a stale over-cap reading neither archives nor loses the claimed rows"

# Case ROT-8: orphan placement is CHRONOLOGICAL. An orphan predates any `.1`
# written after the crash that stranded it, so with `.1` occupied it belongs at
# `.2`. Placing it at `.1` would leave `.1` older than `.2`, and
# rule-hits-parse.js#logGenerations reads the three files as one sequence.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'NEWER-ARCHIVE\n' > "$LOG.1"
rm -f "$LOG.2"
printf 'OLDER-ORPHAN\n' > "$LOG.rotating.996.1"
touch -t 200001010000 "$LOG.rotating.996.1"
run 'rule_hits_append banned-vocab deny null'
[[ "$(cat "$LOG.1")" == "NEWER-ARCHIVE" ]] \
  || { echo "FAIL: ROT-8 the newer archive was displaced by an older orphan"; exit 1; }
[[ "$(cat "$LOG.2" 2>/dev/null)" == "OLDER-ORPHAN" ]] \
  || { echo "FAIL: ROT-8 orphan did not land in .2: $(cat "$LOG.2" 2>&1)"; exit 1; }
echo "PASS: ROT-8 an orphan lands behind a newer archive, not in front of it"

# Case ROT-9: with both slots holding newer generations the orphan is the oldest
# of three, and the two-archive retention drops it. What must NOT happen is a
# newer archive being evicted to make room.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'KEEP-1\n' > "$LOG.1"
printf 'KEEP-2\n' > "$LOG.2"
printf 'OLDEST\n' > "$LOG.rotating.995.1"
touch -t 200001010000 "$LOG.rotating.995.1"
run 'rule_hits_append banned-vocab deny null'
[[ "$(cat "$LOG.1")" == "KEEP-1" && "$(cat "$LOG.2")" == "KEEP-2" ]] \
  || { echo "FAIL: ROT-9 a newer archive was evicted for an older orphan"; exit 1; }
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-9 orphan left behind when both slots were full"; exit 1; }
echo "PASS: ROT-9 an orphan older than both archives is dropped, not swapped in"

# Case ROT-10: the v0.76.0-v0.76.2 mutex was a DIRECTORY at `<log>.rotating`.
# Nothing creates one any more, so a machine upgraded while one was held would
# carry it in ~/.claude/logs forever.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
mkdir "$LOG.rotating"
run 'rule_hits_append banned-vocab deny null'
[[ ! -d "$LOG.rotating" ]] \
  || { echo "FAIL: ROT-10 the legacy mutex directory survived the upgrade"; exit 1; }
echo "PASS: ROT-10 the legacy mutex directory is removed on the next append"

# Case ROT-11 (0.77.0 pre-tag review, HIGH 1): a claim's age is the age of the
# CLAIM, and it comes from the name the rotator wrote — not from a file
# timestamp. `rename(2)` preserves mtime, so a claim aged by mtime carries the
# age of its ROWS: whenever the previous append was over a minute ago, the claim
# is born past the reap threshold, a concurrent append steals it, finds both
# archive slots full, and deletes a whole generation. Stamping the file after the
# rename does not close it either — `mv` then `touch` is two steps and a reaper
# lands between them (measured 41/200 on 32-way concurrency; the name-based form
# measures 0/200 on the same arm).
#
# Two assertions, because the mechanism has two halves.
# (a) production writes a claim whose name carries a CURRENT epoch. An `mv` shim
#     that fails only the placement leaves one in flight to inspect.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'OLD-GENERATION\n' > "$LOG"
touch -d '2 hours ago' "$LOG" 2>/dev/null || touch -t 200001010000 "$LOG"
MVSHIM2="$TMP_HOME/mvshim2"
mkdir -p "$MVSHIM2"
cat > "$MVSHIM2/mv" <<'SHIM'
#!/usr/bin/env bash
# See the ROT-1 shim: /usr/bin/mv does not exist on macOS. Hard-coding it made
# the CLAIMING rename fail too, so no claim was ever left in flight and ROT-11a
# reported "the shim did not bite" on both macOS legs (caught by CI before the
# 0.77.0 tag).
REAL_MV=$(command -v -p mv 2>/dev/null || echo /bin/mv)
for a in "$@"; do case "$a" in *.jsonl.1) exit 1;; esac; done
exec "$REAL_MV" "$@"
SHIM
chmod +x "$MVSHIM2/mv"
PATH="$MVSHIM2:$PATH" CLAUDEMD_LOG_MAX_MB=0 run 'rule_hits_append banned-vocab deny null'
STRANDED=$(ls "$LOG".rotating.* 2>/dev/null | head -1)
[[ -n "$STRANDED" ]] || { echo "FAIL: ROT-11a no claim left in flight — the shim did not bite"; exit 1; }
STAMP=${STRANDED##*.rotating.}; STAMP=${STAMP%%.*}
NOW=$(date +%s)
if [[ ! "$STAMP" =~ ^[0-9]+$ ]] || (( NOW - STAMP >= 60 )); then
  echo "FAIL: ROT-11a in-flight claim names no current epoch (stamp=$STAMP, now=$NOW) — a concurrent append will reap it"
  exit 1
fi
# (b) the reaper reads that name. A claim whose ROWS are ancient but whose stamp
#     is current is in flight and must survive; one whose stamp is old is an
#     orphan and must be collected.
touch -d '2 hours ago' "$STRANDED" 2>/dev/null || touch -t 200001010000 "$STRANDED"
run 'rule_hits_append banned-vocab deny null'
[[ -f "$STRANDED" ]] \
  || { echo "FAIL: ROT-11b a live claim with old ROWS was reaped — aging read the timestamp, not the name"; exit 1; }
mv "$STRANDED" "$LOG.rotating.100.999.1"
run 'rule_hits_append banned-vocab deny null'
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-11c a claim stamped long ago was not reaped"; exit 1; }
echo "PASS: ROT-11 claim age comes from the name, so an in-flight claim is never reaped"

# Case ROT-12 (same review, HIGH 2): an orphan is not automatically the OLDEST
# generation. In the ordinary sequence — two rotations, then a kill — it is the
# NEWEST, and both archive slots hold older ones. Placing by slot occupancy alone
# therefore deleted the newest generation and kept two older ones, with no
# concurrency needed. v0.76.2 had no orphan class at all and self-healed at this
# kill point, so this was a regression against it.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
printf 'GEN-A-OLDEST\n' > "$LOG.2"; touch -d '3 hours ago' "$LOG.2" 2>/dev/null || touch -t 200001010000 "$LOG.2"
printf 'GEN-B-MIDDLE\n' > "$LOG.1"; touch -d '2 hours ago' "$LOG.1" 2>/dev/null || touch -t 200001020000 "$LOG.1"
printf 'GEN-C-NEWEST\n' > "$LOG.rotating.12345.7"
touch -d '1 hour ago' "$LOG.rotating.12345.7" 2>/dev/null || touch -t 200001030000 "$LOG.rotating.12345.7"
run 'rule_hits_append banned-vocab deny null'
if ! grep -qh 'GEN-C-NEWEST' "$LOG.1" "$LOG.2" 2>/dev/null; then
  echo "FAIL: ROT-12 the NEWEST generation was dropped while older ones were kept (.1=$(cat "$LOG.1" 2>&1 | head -1), .2=$(cat "$LOG.2" 2>&1 | head -1))"
  exit 1
fi
if grep -qh 'GEN-A-OLDEST' "$LOG.1" "$LOG.2" 2>/dev/null; then
  echo "FAIL: ROT-12 the oldest of three generations was retained over a newer one"; exit 1
fi
[[ -z "$(ls "$LOG".rotating.* 2>/dev/null)" ]] \
  || { echo "FAIL: ROT-12 orphan left behind"; exit 1; }
echo "PASS: ROT-12 the two newest of three generations survive, whichever was the orphan"

# Case ROT-13 (same review, LOW 3): an unmatched glob under `failglob` aborted
# the `for` command, so `rule_hits_append` returned 1 and everything after it —
# including the JSONL write — was skipped. No gate decision depends on the row,
# but losing every row silently is not an acceptable answer to a shell option.
rm -rf "$TMP_HOME/.claude/logs"
OUT=$(env HOME="$TMP_HOME" BASHOPTS=failglob bash -c "set -uo pipefail; source $LIB; rule_hits_append banned-vocab deny null '' 'sess-fg'; echo rc=\$?" 2>&1)
if [[ "$OUT" != *"rc=0"* ]] || [[ ! -f "$LOG" ]]; then
  echo "FAIL: ROT-13 failglob dropped the telemetry row (out: $OUT, log present: $([[ -f "$LOG" ]] && echo yes || echo no))"
  exit 1
fi
echo "PASS: ROT-13 an unmatched orphan glob under failglob still writes the row"

# Case ROT-7 (0.76.2 pre-tag review, CRITICAL-1): a size read must never put
# non-numeric text into the arithmetic.
#
# `stat -c %s F || stat -f %z F || echo 0` looks like a GNU/BSD dual and is not
# one. On GNU coreutils `-f` is --file-system and `%z` parses as an OPERAND, so
# on an existing file the fallback prints the filesystem block to STDOUT and
# exits 1 — the `||` chain then continues and appends `0` to that blob. Under
# `set -u`, `(( size > max_bytes ))` dereferences the word `File` and the shell
# EXITS 127. hook_record calls rule_hits_append inline and every deny path
# records BEFORE it denies, so the abort turns a §8 deny into an allow with no
# row and no fail-open marker. It was reachable through the second read (ROT-6),
# which runs with no `[[ -f ]]` guard above it. The claim redesign narrows that
# — the second read now stats a path this process owns — but the guard stays on
# both reads: the outer one still runs against a shared path, and a stat that
# prints to stdout and exits 1 is a shape neither read may hand to arithmetic.
#
# The shim reproduces exactly that pair: first call fails, second prints the GNU
# --file-system blob and exits 1.
rm -rf "$TMP_HOME/.claude/logs"
run 'rule_hits_append banned-vocab deny null'
BEFORE_LINES=$(wc -l < "$LOG" | tr -d ' ')
STATSHIM2="$TMP_HOME/statshim2"
mkdir -p "$STATSHIM2"
cat > "$STATSHIM2/stat" <<'SHIM'
#!/usr/bin/env bash
if [[ "${1:-}" == "-c" && "${2:-}" == "%s" ]]; then exit 1; fi
if [[ "${1:-}" == "-f" && "${2:-}" == "%z" ]]; then
  printf '  File: "%s"\n    ID: 96ff6e103d5991fd Namelen: 255     Type: tmpfs\n' "${3:-}"
  exit 1
fi
exec /usr/bin/stat "$@"
SHIM
chmod +x "$STATSHIM2/stat"
# `set -uo pipefail` is what makes this fatal, and it is what every hook sets
# before sourcing this lib — the suite's own `run` helper does not, so calling
# through it would exercise a shell production never uses.
OUT=$(PATH="$STATSHIM2:$PATH" CLAUDEMD_LOG_MAX_MB=1 \
  bash -c "set -uo pipefail; source $LIB; rule_hits_append banned-vocab deny null" 2>&1)
RC=$?
[[ "$RC" == "0" ]] \
  || { echo "FAIL: ROT-7 append aborted (rc=$RC) — a caller's deny would be lost: $OUT"; exit 1; }
[[ "$OUT" != *"unbound variable"* ]] \
  || { echo "FAIL: ROT-7 non-numeric size reached the arithmetic: $OUT"; exit 1; }
AFTER_LINES=$(wc -l < "$LOG" | tr -d ' ')
[[ "$AFTER_LINES" == "$((BEFORE_LINES + 1))" ]] \
  || { echo "FAIL: ROT-7 row not written ($BEFORE_LINES -> $AFTER_LINES)"; exit 1; }
echo "PASS: ROT-7 a non-numeric stat fallback cannot abort the append"

echo "rule-hits: all cases passed"
