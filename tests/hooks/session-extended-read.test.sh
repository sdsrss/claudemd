#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/session-extended-read.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"
LOG="$HOME/.claude/logs/claudemd.jsonl"
EXT_PATH="$HOME/.claude/CLAUDE-extended.md"

PASS=0; FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
ng() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

mkevent() {
  local file_path="$1" sess="${2:-sess-A}" tool="${3:-Read}" tuid="${4:-toolu_01abc}"
  jq -cn --arg fp "$file_path" --arg s "$sess" --arg t "$tool" --arg tu "$tuid" \
    '{session_id:$s, tool_name:$t, tool_input:{file_path:$fp}, tool_use_id:$tu}'
}

# Case 1: canonical user-global path → records `read` with §13.1-extended-read
rm -f "$LOG" "$HOME/.claude/.claudemd-state/"ext-read-*.ts 2>/dev/null
mkevent "$EXT_PATH" "sess-1" | bash "$HOOK" >/dev/null 2>&1 || true
if jq -e 'select(.hook=="session-extended-read" and .event=="read" and .spec_section=="§13.1-extended-read" and .session_id=="sess-1" and .tool_use_id=="toolu_01abc")' "$LOG" >/dev/null 2>&1; then
  ok "1 canonical extended path → records read row"
else
  ng "1 expected row missing (log: $(cat "$LOG" 2>/dev/null))"
fi
# Sentinel created
if [[ -f "$HOME/.claude/.claudemd-state/ext-read-sess-1.ts" ]]; then
  ok "1b sentinel created for sess-1"
else
  ng "1b sentinel missing"
fi

# Case 2: same session, second Read → silent skip (no second row)
mkevent "$EXT_PATH" "sess-1" | bash "$HOOK" >/dev/null 2>&1 || true
N=$(grep -c '"hook":"session-extended-read"' "$LOG" 2>/dev/null || echo 0)
if [[ "$N" -eq 1 ]]; then
  ok "2 dedup: 2nd Read in sess-1 → still 1 row"
else
  ng "2 expected 1 row, got $N"
fi

# Case 3: different session → new row
mkevent "$EXT_PATH" "sess-2" | bash "$HOOK" >/dev/null 2>&1 || true
N=$(grep -c '"session_id":"sess-2"' "$LOG" 2>/dev/null || echo 0)
if [[ "$N" -eq 1 ]]; then
  ok "3 new session → new row"
else
  ng "3 expected 1 sess-2 row, got $N"
fi

# Case 4: project source spec/CLAUDE-extended.md → skipped (not §2.2 EXT-load)
rm -f "$LOG"
mkevent "/work/repo/spec/CLAUDE-extended.md" "sess-3" | bash "$HOOK" >/dev/null 2>&1 || true
[[ ! -s "$LOG" ]] && ok "4 project spec/ path → no row" || ng "4 unexpected row (log: $(cat "$LOG"))"

# Case 5: wrong tool (Bash) → skipped
rm -f "$LOG"
mkevent "$EXT_PATH" "sess-4" "Bash" | bash "$HOOK" >/dev/null 2>&1 || true
[[ ! -s "$LOG" ]] && ok "5 tool=Bash → no row" || ng "5 unexpected row (log: $(cat "$LOG"))"

# Case 6: missing session_id → skipped (fail-open). Inline event because
# `mkevent "" ""` would expand the default; need a literal empty session_id.
rm -f "$LOG"
jq -cn --arg fp "$EXT_PATH" '{session_id:"", tool_name:"Read", tool_input:{file_path:$fp}}' \
  | bash "$HOOK" >/dev/null 2>&1 || true
[[ ! -s "$LOG" ]] && ok "6 missing session_id → fail-open no row" || ng "6 unexpected row (log: $(cat "$LOG"))"

# Case 7: kill-switch
rm -f "$LOG" "$HOME/.claude/.claudemd-state/"ext-read-*.ts 2>/dev/null
DISABLE_SESSION_EXTENDED_READ_HOOK=1 bash "$HOOK" <<<"$(mkevent "$EXT_PATH" "sess-5")" >/dev/null 2>&1 || true
[[ ! -s "$LOG" ]] && ok "7 kill-switch → no row" || ng "7 unexpected row (log: $(cat "$LOG"))"

# Case 8: hook never produces stdout (PreToolUse silent — no permission decision)
OUT=$(mkevent "$EXT_PATH" "sess-6" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && ok "8 hook stdout silent" || ng "8 unexpected stdout: $OUT"

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
