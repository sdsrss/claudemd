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

# Case 8: cwd with dots encodes via `/.` → `-` (H2) — must match Claude Code's
# project-dir encoding. Previously hook used `tr '/' '-'` and silently failed
# on any project path containing a dot (e.g. `~/.config/...`, `my.project/`),
# turning the HARD §11 rule into a silent no-op.
DOT_CWD="/work/my.project"
DOT_ENCODED=$(echo "$DOT_CWD" | tr '/.' '-')
DOT_PROJ="$HOME/.claude/projects/$DOT_ENCODED"
DOT_MEM="$DOT_PROJ/memory"
mkdir -p "$DOT_MEM"
cat > "$DOT_MEM/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — don't skip baseline
EOF
touch "$DOT_MEM/feedback_ship.md"
SESS="sess8"
echo '{"tool":"Read","path":"/unrelated"}' > "$DOT_PROJ/$SESS.jsonl"
EVENT_8="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$DOT_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_8" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 8 dot-in-cwd → correct encoding → deny" \
  || { echo "FAIL: 8 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 9: tag containing regex metacharacters is matched literally (H3). Before
# the v6.10.1 `-qiF` fix, a tag like `v6.9` would regex-match `v6X9`, `v699`,
# etc. — drifting into false-positive territory as tag vocab grows. Locks the
# intent: tags are plain strings, not BREs.
SESS="sess9"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Specific release lessons](feedback_release.md) `[v6.9, deploy.prod]` — only match literally
EOF
touch "$MEM_DIR/feedback_release.md"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
# `v6X9` would match `v6.9` under regex (`.` = any char); under -F it does not.
# Command contains neither literal `v6.9` nor literal `deploy.prod`, but DOES
# contain `deploy` (fires the ship/release/deploy/push keyword filter). Tags
# are NOT substrings of CMD → no tag-based file should match → no deny.
OUT=$(mkevent "deploy --env v6X9 deployXprod" "$SESS" | bash "$HOOK" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 9 regex-metachar tag matched literally → no false deny" \
  || { echo "FAIL: 9 (out: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((9 - FAIL))/9 passed"; exit 1
fi
echo "Tests: 9/9 passed"
