#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# mem-audit.test.sh — claudemd v0.9.5 hotfix coverage.
# Locks down the three v0.9.4 bugs (Stop schema misuse / double-slash path /
# regex covers only one Why-form) plus baseline cases.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/mem-audit.sh"
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
# stderr capture inside the sandbox, not a hand-built /tmp path (2026-07-28).
# `2>/tmp/mem-audit-stderr-$$` failed every case with "Read-only file system"
# wherever /tmp is not writable — an agent sandbox, a hardened CI image — and the
# failure mode was 12 assertions reporting empty stderr, which reads like a hook
# regression rather than a harness problem. Same rule the suites already follow
# for $HOME: everything the test writes goes under its own mktemp dir.
ERRF="$TMP_HOME/stderr"
mkdir -p "$HOME/.claude/.claudemd-state" "$HOME/.claude/logs"

FAIL=0

reset_sentinel() { rm -f "$HOME/.claude/.claudemd-state/mem-audit.lastrun"; }

# Helper: spawn a project-encoded memory dir + a file with given content.
seed() {
  local enc="$1" name="$2" content="$3"
  local dir="$HOME/.claude/projects/$enc/memory"
  mkdir -p "$dir"
  printf '%s\n' "$content" > "$dir/$name"
}

# --------------------------------------------------------------------------
# Case 1: no projects dir → silent exit, no stdout, no stderr.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 1 no projects dir → silent"
else
  echo "FAIL: 1 (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 2: empty memory dir → silent.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
mkdir -p "$HOME/.claude/projects/-foo-/memory"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 2 empty memory dir → silent"
else
  echo "FAIL: 2 (stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 3: feedback memory with **Why:** + **How to apply:** (CC canonical
# punctuation, colon-inside-bold) → silent (compliant).
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
COMPLIANT_INSIDE='---
name: ok-inside
type: feedback
---
**Rule**: do X.

**Why:** because Y. blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah.

**How to apply:** when Z. blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah.'
seed "-proj-" "feedback_compliant_inside.md" "$COMPLIANT_INSIDE"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 3 **Why:** form (colon inside) accepted"
else
  echo "FAIL: 3 (got stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 4: alt punctuation `**Why**:` + `**How to apply**:` (colon-outside-
# bold) → silent. v0.9.4 regex only matched `**Why:**`; v0.9.5 must accept
# both. Locks the false-positive bug seen on user's existing memories.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
COMPLIANT_OUTSIDE='---
name: ok-outside
type: feedback
---
**Rule**: do X.

**Why**: because Y. blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah.

**How to apply**: when Z. blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah blah.'
seed "-proj-" "feedback_compliant_outside.md" "$COMPLIANT_OUTSIDE"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 4 **Why**: form (colon outside) accepted"
else
  echo "FAIL: 4 (got stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 5: feedback memory missing both markers → emits stderr warning,
# zero stdout. Locks Stop schema fix (no JSON to stdout).
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
MISSING_BODY='---
name: missing
type: feedback
---
This is a feedback memory with no Why or How to apply markers — just a long
prose blob that exceeds the 400-byte stub threshold. xxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
seed "-proj-" "feedback_missing.md" "$MISSING_BODY"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" ]] && echo "$ERR" | grep -q "mem-audit:"; then
  echo "PASS: 5 missing markers → stderr warn, no stdout"
else
  echo "FAIL: 5 (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 5b: the stub threshold is BYTES, and it is measured by find, not by
# awk's length(). A short marker-less memory stays silent (a stub with nothing
# to say yet is not the target); a CJK memory just over 400 BYTES — 150
# three-byte characters, which a character-oriented awk would score as 150 and
# let through — must warn. Pre-fix the threshold was awk length(), so on gawk /
# recent macOS awk this file counted ~450 characters short of the floor and the
# audit went quiet on exactly the memories it exists for (条目 17).
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
SHORT_BODY='---
name: short
type: feedback
---
Too short to be a stub worth flagging.'
seed "-proj-" "feedback_short.md" "$SHORT_BODY"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" ]] && ! echo "$ERR" | grep -q "feedback_short"; then
  echo "PASS: 5b sub-threshold memory stays silent"
else
  echo "FAIL: 5b (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

reset_sentinel
rm -rf "$HOME/.claude/projects"
CJK_PAD=$(awk 'BEGIN { for (i = 0; i < 150; i++) printf "%s", "中" }')
CJK_BODY="---
name: cjk
type: feedback
---
$CJK_PAD"
seed "-proj-" "feedback_cjk.md" "$CJK_BODY"
CJK_BYTES=$(wc -c < "$HOME/.claude/projects/-proj-/memory/feedback_cjk.md" | tr -d ' ')
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if (( CJK_BYTES > 399 )) && [[ "$RC" -eq 0 && -z "$OUT" ]] && echo "$ERR" | grep -q "feedback_cjk"; then
  echo "PASS: 5b CJK memory over 400 BYTES warns (file is ${CJK_BYTES}B)"
else
  echo "FAIL: 5b CJK (bytes=$CJK_BYTES, rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 6: stderr path has NO double slash (v0.9.4 bug:
# `<encoded>//memory/foo.md`). Locks the trailing-slash strip in mem_dir.
# --------------------------------------------------------------------------
reset_sentinel
# Reuse Case 5 seed.
rm -rf "$HOME/.claude/projects"
seed "-proj-" "feedback_missing.md" "$MISSING_BODY"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if echo "$ERR" | grep -q '//memory/'; then
  echo "FAIL: 6 (path has double-slash: $ERR)"; FAIL=$((FAIL+1))
elif echo "$ERR" | grep -q '/memory/feedback_missing.md'; then
  echo "PASS: 6 path single-slash, file basename present"
else
  echo "FAIL: 6 (no expected path in stderr: $ERR)"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 7: 24h sentinel debounce — second invocation in same 24h is silent
# regardless of missing markers.
# --------------------------------------------------------------------------
# Sentinel was just touched in Case 6.
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 7 24h sentinel debounce → silent"
else
  echo "FAIL: 7 (rc=$RC, stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 8: kill-switch `DISABLE_MEM_AUDIT_HOOK=1` → silent regardless.
# --------------------------------------------------------------------------
reset_sentinel
OUT=$(DISABLE_MEM_AUDIT_HOOK=1 bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 8 kill-switch → silent"
else
  echo "FAIL: 8 (rc=$RC, stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 9: MEMORY.md as the only file in a memory dir → MISSING=0 (no
# feedback/project files to scan), DRIFT=1 (index links to feedback_x.md
# but no such file). v0.9.7 added drift detection — this case used to
# expect silent, now expects index_orphan warn.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
seed "-proj-" "MEMORY.md" "# Memory index
- [Some entry](feedback_x.md) — text"
# No feedback_*.md / project_*.md present at all.
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" ]] && echo "$ERR" | grep -q 'index_orphan.*feedback_x.md'; then
  echo "PASS: 9 index_orphan (MEMORY.md links file that does not exist)"
else
  echo "FAIL: 9 (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 10: drift detection — file_orphan branch. v0.9.7 added cross-check:
# memory file present but MEMORY.md doesn't link to it → file_orphan warn.
# Setup: a compliant feedback file (so MISSING=0), MEMORY.md with NO link
# to it. Expectation: stderr contains 'file_orphan'.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
COMPLIANT_NO_LINK='---
name: orphan
type: feedback
---
**Rule**: do X.
**Why**: because Y. xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.
**How to apply**: when Z. xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.'
seed "-proj-" "feedback_orphan.md" "$COMPLIANT_NO_LINK"
seed "-proj-" "MEMORY.md" "# Memory index
- [Some other entry](feedback_unrelated.md) — text"
# Note: MEMORY.md links feedback_unrelated.md (not present → index_orphan)
# AND feedback_orphan.md is on disk but not linked → file_orphan.
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" ]] && echo "$ERR" | grep -q 'file_orphan.*feedback_orphan.md'; then
  echo "PASS: 10 file_orphan (memory file present but MEMORY.md missing link)"
else
  echo "FAIL: 10 (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 11: aligned MEMORY.md ↔ files (one compliant feedback + matching
# index entry) → silent. Verifies the drift detection doesn't FP on
# correctly-aligned dirs.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
seed "-proj-" "feedback_aligned.md" "$COMPLIANT_NO_LINK"
seed "-proj-" "MEMORY.md" "# Memory index
- [Aligned](feedback_aligned.md) — text"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 11 aligned MEMORY.md ↔ files → silent"
else
  echo "FAIL: 11 (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 12 (v0.18.0 / spec v6.12.0): project_*.md exempted from Why/How
# body-structure scan. incident-log pattern `project_<topic>_<date>.md`
# is fact-only by nature; spec §11-EXT explicitly exempts it. Same body
# as Case 5 (missing markers) but project_ prefix → silent, not warned.
# --------------------------------------------------------------------------
reset_sentinel
rm -rf "$HOME/.claude/projects"
PROJECT_MISSING_BODY='---
name: incident-2026-05-20
type: project
---
2026-05-20 14:30 — scheduler ghost completion incident in worker queue.
Cause: stale row not GC-collected; mitigation: nightly sweep. xxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
seed "-proj-" "project_incident_2026_05_20.md" "$PROJECT_MISSING_BODY"
OUT=$(bash "$HOOK" </dev/null 2>"$ERRF"); RC=$?
ERR=$(cat "$ERRF"); rm -f "$ERRF"
if [[ "$RC" -eq 0 && -z "$OUT" && -z "$ERR" ]]; then
  echo "PASS: 12 project_*.md missing markers → silent (exempted)"
else
  echo "FAIL: 12 (rc=$RC, stdout='$OUT', stderr='$ERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Result
# --------------------------------------------------------------------------
if (( FAIL > 0 )); then
  echo "Tests: $((14 - FAIL))/14 passed"; exit 1
fi
echo "Tests: 14/14 passed"
