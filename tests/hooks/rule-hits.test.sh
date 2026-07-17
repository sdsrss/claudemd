#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/rule-hits.sh"
TMP_HOME=$(mktemp -d)
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
for f in "${ARCH2_FIXTURES[@]}"; do
  bash_enc=$(run "hook_encode_project '$f'")
  js_enc=$(js_encode "$f")
  [[ -n "$bash_enc" && "$bash_enc" == "$js_enc" ]] \
    || { echo "FAIL: ARCH-2 parity on '$f': bash='$bash_enc' js='$js_enc'"; exit 1; }
done
echo "PASS: hook_encode_project ≡ encodeProjectCwd (cross-language parity, ${#ARCH2_FIXTURES[@]} fixtures)"

