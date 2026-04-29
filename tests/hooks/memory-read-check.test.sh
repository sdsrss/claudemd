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

# Case 10: plain-form tag block (spec §11 syntax `[tag, tag]` without
# backticks). Pre-fix the hook only matched the backtick-wrapped form, so
# any plain-form line was treated as untagged → matched every push command.
# Asserts: a plain-form tag whose tags do NOT match the command keywords
# does NOT trigger a deny.
PLAIN_DIR="$HOME/.claude/projects/${ENCODED}-plain"
PLAIN_MEM="$PLAIN_DIR/memory"
mkdir -p "$PLAIN_MEM"
cat > "$PLAIN_MEM/MEMORY.md" <<'EOF'
- [Plain-form tags](feedback_plain.md) [unrelated, sometag] — plain spec §11 syntax
EOF
touch "$PLAIN_MEM/feedback_plain.md"
SESS="sess10"
PLAIN_CWD="${CWD}-plain"
echo '{"tool":"Read","path":"/unrelated"}' > "$PLAIN_DIR/$SESS.jsonl"
EVENT_10="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$PLAIN_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_10" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 10 plain-form tag, no keyword match → no false deny" \
  || { echo "FAIL: 10 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 11: plain-form tag block, keyword IN tag list → deny when unread.
# Confirms plain-form parser actually extracts tags (Case 10 alone could
# pass via the untagged-fallback path that was always too eager).
SESS="sess11"
cat > "$PLAIN_MEM/MEMORY.md" <<'EOF'
- [Plain-form tags](feedback_plain.md) [push, deploy] — plain spec §11 syntax
EOF
echo '{"tool":"Read","path":"/unrelated"}' > "$PLAIN_DIR/$SESS.jsonl"
EVENT_11="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$PLAIN_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_11" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 11 plain-form tag, keyword match + unread → deny" \
  || { echo "FAIL: 11 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 12 (B): untagged-only MEMORY.md entry must NOT auto-block. Pre-fix the
# hook treated every untagged line as "always required Read", forcing the
# user to Read N unrelated files on every push. Spec §11 "Index is a router,
# not a substitute" — untagged matching is the agent's responsibility, not
# the hook's. Locks: ship command + only-untagged entries → pass.
UNTAG_DIR="$HOME/.claude/projects/${ENCODED}-untag"
UNTAG_MEM="$UNTAG_DIR/memory"
mkdir -p "$UNTAG_MEM"
cat > "$UNTAG_MEM/MEMORY.md" <<'EOF'
- [Untagged one](project_a.md) — no tag block at all
- [Untagged two](project_b.md) — also no tags
EOF
touch "$UNTAG_MEM/project_a.md" "$UNTAG_MEM/project_b.md"
SESS="sess12"
UNTAG_CWD="${CWD}-untag"
echo '{"tool":"Read","path":"/unrelated"}' > "$UNTAG_DIR/$SESS.jsonl"
EVENT_12="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$UNTAG_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_12" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 12 untagged-only MEMORY → no auto-block" \
  || { echo "FAIL: 12 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 13 (B): mixed tagged + untagged. Tagged matching keyword + unread →
# deny, but the deny message must mention ONLY the tagged file, not the
# untagged ones. Locks: untagged entries are silent at hook level even when
# a sibling tagged entry triggers a block.
MIX_DIR="$HOME/.claude/projects/${ENCODED}-mix"
MIX_MEM="$MIX_DIR/memory"
mkdir -p "$MIX_MEM"
cat > "$MIX_MEM/MEMORY.md" <<'EOF'
- [Tagged ship](feedback_ship.md) `[push]` — tagged
- [Untagged sibling](project_other.md) — should not appear in deny
EOF
touch "$MIX_MEM/feedback_ship.md" "$MIX_MEM/project_other.md"
SESS="sess13"
MIX_CWD="${CWD}-mix"
echo '{"tool":"Read","path":"/unrelated"}' > "$MIX_DIR/$SESS.jsonl"
EVENT_13="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin main\"},\"cwd\":\"$MIX_CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_13" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
REASON=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecisionReason 2>/dev/null)
if [[ "$DEC" == "deny" ]] && echo "$REASON" | grep -qF "feedback_ship.md" \
  && ! echo "$REASON" | grep -qF "project_other.md"; then
  echo "PASS: 13 mixed tagged+untagged → deny only on tagged"
else
  echo "FAIL: 13 (out: $OUT)"; FAIL=$((FAIL+1))
fi

# Case 14 (C): ship-word inside quoted commit message must NOT trigger,
# even when MEMORY has a tag that would match the quoted word. Pre-fix the
# regex `(git push|release|deploy|ship)` matched anywhere, so
# `git commit -m "release notes"` triggered the scan; the tagged `release`
# entry then demanded a Read. Locks anchor: trigger words must be at
# command-segment-start, not embedded in quoted args.
SESS="sess14"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Release lessons](feedback_release.md) `[release]` — would false-match in quotes pre-fix
EOF
touch "$MEM_DIR/feedback_release.md"
EVENT_14="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m 'fix: release notes update'\"},\"cwd\":\"$CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_14" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 14 ship-word in quoted commit msg → no trigger" \
  || { echo "FAIL: 14 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 15 (C): glab mr create is a real ship verb at command-start; the
# trigger filter must fire so tagged matches are still enforced. With no
# tag matching the command keywords, the file requirement set is empty →
# pass. Confirms `glab mr` got added to the trigger list without breaking
# the no-tag-match exit path.
SESS="sess15"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Push lessons](feedback_push.md) `[migration, schema]` — neither tag in the command
EOF
touch "$MEM_DIR/feedback_push.md"
EVENT_15="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"glab mr create --title bump\"},\"cwd\":\"$CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_15" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 15 glab mr + non-matching tags → no deny" \
  || { echo "FAIL: 15 (out: $OUT)"; FAIL=$((FAIL+1)); }

# Case 16 (C): standalone shipping verb (`release-please`, `deploy.sh`,
# `&& deploy`) at command-segment-start must STILL trigger the filter so
# tagged matches are enforced. Locks: tightening C didn't accidentally
# kill real ship-tool detection.
SESS="sess16"
echo '{"tool":"Read","path":"/unrelated"}' > "$PROJ_DIR/$SESS.jsonl"
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Deploy lessons](feedback_deploy.md) `[deploy]` — fires on real deploy
EOF
touch "$MEM_DIR/feedback_deploy.md"
EVENT_16="{\"session_id\":\"$SESS\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cd dist && deploy --env prod\"},\"cwd\":\"$CWD\"}"
OUT=$(bash "$HOOK" <<<"$EVENT_16" 2>&1)
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 16 standalone deploy after && → still triggers" \
  || { echo "FAIL: 16 (out: $OUT)"; FAIL=$((FAIL+1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((16 - FAIL))/16 passed"; exit 1
fi
echo "Tests: 16/16 passed"
