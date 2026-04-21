#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/memory-read-check.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

CWD="/work/proj"
ENCODED=$(echo "$CWD" | tr '/' '-')
PROJ_DIR="$HOME/.claude/projects/$ENCODED"
MEM_DIR="$PROJ_DIR/memory"
mkdir -p "$MEM_DIR"

cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
- [Untagged legacy](project_old.md) — scan always
EOF
touch "$MEM_DIR/feedback_ship.md" "$MEM_DIR/project_old.md"

FAIL=0
mkevent() {
  local cmd="$1" sess="$2"
  cat <<EOF
{"session_id":"$sess","tool_name":"Bash","tool_input":{"command":"$cmd"},"cwd":"$CWD"}
EOF
}

# Case 1: ship keyword, tag matches, file unread → deny
SESS="sess1"
echo '{"tool":"Read","path":"/other/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 1 tag match + unread → deny" || { echo "FAIL: 1 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 2: ship keyword, memory file read → pass
SESS="sess2"
cat > "$PROJ_DIR/$SESS.jsonl" <<EOF
{"tool":"Read","file_path":"$MEM_DIR/feedback_ship.md"}
{"tool":"Read","file_path":"$MEM_DIR/project_old.md"}
EOF
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 2 both read → pass" || { echo "FAIL: 2 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 3: escape hatch
SESS="sess3"
echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git push origin main [skip-memory-check]" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 3 escape hatch" || { echo "FAIL: 3 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 4: transcript missing (CC version drift) → fail-open pass
SESS="sess-nonexistent"
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 4 missing transcript → fail-open" || { echo "FAIL: 4 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 5: MEMORY.md missing → fail-open pass
rm "$MEM_DIR/MEMORY.md"
SESS="sess5"; echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git push origin main" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 5 missing MEMORY.md → fail-open" || { echo "FAIL: 5 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 6: non-matching keyword (git status) → pass
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
SESS="sess6"; echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(mkevent "git status" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 6 non-matching keyword → pass" || { echo "FAIL: 6 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 7: kill-switch
SESS="sess7"; echo '' > "$PROJ_DIR/$SESS.jsonl"
OUT=$(DISABLE_MEMORY_READ_HOOK=1 bash "$HOOK" <<<"$(mkevent "git push origin main" "$SESS")" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 7 kill-switch" || { echo "FAIL: 7 (out: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((7 - FAIL))/7 passed"; exit 1
fi
echo "Tests: 7/7 passed"
