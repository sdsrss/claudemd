#!/usr/bin/env bash
# memory-prompt-hint.test.sh — tests for v0.11.0 UserPromptSubmit memory
# tag pre-matcher hook. Proactive twin of memory-read-check.sh.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/memory-prompt-hint.sh"
TMP_HOME=$(mktemp -d -t claudemd-hint-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

CWD="/work/proj"
ENCODED=$(echo "$CWD" | tr '/._' '-')
PROJ_DIR="$HOME/.claude/projects/$ENCODED"
MEM_DIR="$PROJ_DIR/memory"
mkdir -p "$MEM_DIR"

cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — atomic ship convention
- [macOS portability](feedback_macos.md) `[macos, bsd-wc, timeout]` — CI breakages
- [Untagged legacy](project_old.md) — no tag block, agent decides
EOF
touch "$MEM_DIR/feedback_ship.md" "$MEM_DIR/feedback_macos.md" "$MEM_DIR/project_old.md"

FAIL=0
ok() { echo "PASS: $1"; }
ng() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

mkevent() {
  local prompt="$1" sess="$2"
  jq -cn --arg p "$prompt" --arg s "$sess" --arg c "$CWD" \
    '{hook_event_name:"UserPromptSubmit", session_id:$s, prompt:$p, cwd:$c}'
}

# Case 1: prompt matches `macos` tag, no transcript yet → emit hint w/ macos file
SESS="sess1"
OUT=$(mkevent "How do I fix the macos CI failure?" "$SESS" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
if [[ -n "$CTX" ]] \
   && echo "$CTX" | grep -qF "feedback_macos.md" \
   && ! echo "$CTX" | grep -qF "feedback_ship.md"; then
  ok "1 macos prompt → hint cites feedback_macos.md only"
else
  ng "1 (out: $OUT)"
fi

# Case 2: prompt has no tag match → silent (no stdout)
SESS="sess2"
OUT=$(mkevent "tell me a joke" "$SESS" | bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "2 no tag match → silent" || ng "2 (out: $OUT)"

# Case 3: prompt matches but memory file already Read this session → silent.
# Transcript records the absolute path; hook checks transcript for substring.
SESS="sess3"
cat > "$PROJ_DIR/$SESS.jsonl" <<EOF
{"tool":"Read","file_path":"$MEM_DIR/feedback_macos.md"}
EOF
OUT=$(mkevent "fix the macos CI issue" "$SESS" | bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "3 prior Read → no redundant hint" || ng "3 (out: $OUT)"

# Case 4: multi-tag match — single prompt fires multiple files
SESS="sess4"
OUT=$(mkevent "ship the macos fix to release branch" "$SESS" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
if echo "$CTX" | grep -qF "feedback_ship.md" \
   && echo "$CTX" | grep -qF "feedback_macos.md"; then
  ok "4 multi-tag match → both files in hint"
else
  ng "4 (out: $OUT)"
fi

# Case 5: kill-switch via DISABLE_MEMORY_HINT_HOOK=1 → silent
SESS="sess5"
OUT=$(DISABLE_MEMORY_HINT_HOOK=1 bash "$HOOK" <<<"$(mkevent "macos ship" "$SESS")" 2>/dev/null)
[[ -z "$OUT" ]] && ok "5 kill-switch → silent" || ng "5 (out: $OUT)"

# Case 6: untagged entry must NOT be suggested
SESS="sess6"
OUT=$(mkevent "legacy something about old project" "$SESS" | bash "$HOOK" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
# project_old.md is untagged → never in hint output. Empty OUT acceptable.
if [[ -z "$OUT" ]] || ! echo "$CTX" | grep -qF "project_old.md"; then
  ok "6 untagged entry not in hint output"
else
  ng "6 (out: $OUT)"
fi

# Case 7: MEMORY.md missing → fail-open silent
SESS="sess7"
rm -f "$MEM_DIR/MEMORY.md"
OUT=$(mkevent "ship macos fix" "$SESS" | bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "7 missing MEMORY.md → fail-open silent" || ng "7 (out: $OUT)"

# Restore MEMORY.md for subsequent cases.
cat > "$MEM_DIR/MEMORY.md" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — atomic ship convention
- [macOS portability](feedback_macos.md) `[macos, bsd-wc, timeout]` — CI breakages
EOF

# Case 8: empty prompt → silent
SESS="sess8"
OUT=$(mkevent "" "$SESS" | bash "$HOOK" 2>/dev/null)
[[ -z "$OUT" ]] && ok "8 empty prompt → silent" || ng "8 (out: $OUT)"

# Case 9: cwd encoding — underscore + dot mapped to `-` (parity w/ §11 hook)
US_CWD="/work/my_proj.v2"
US_ENCODED=$(echo "$US_CWD" | tr '/._' '-')
US_PROJ="$HOME/.claude/projects/$US_ENCODED"
US_MEM="$US_PROJ/memory"
mkdir -p "$US_MEM"
cat > "$US_MEM/MEMORY.md" <<'EOF'
- [Cli shape](feedback_cli_shape.md) `[cli-shape, parseStrict]` — flag-shape silent fallback
EOF
touch "$US_MEM/feedback_cli_shape.md"
SESS="sess9"
EVENT_9=$(jq -cn --arg p "review parseStrict usage in argv" --arg s "$SESS" --arg c "$US_CWD" \
  '{hook_event_name:"UserPromptSubmit", session_id:$s, prompt:$p, cwd:$c}')
OUT=$(bash "$HOOK" <<<"$EVENT_9" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
if echo "$CTX" | grep -qF "feedback_cli_shape.md"; then
  ok "9 underscore+dot cwd encoded → hint fires in that project"
else
  ng "9 (out: $OUT)"
fi

# Case 10: regex meta in tag matched literally (no FP via regex `.`).
# Tag `v6.9` should NOT match `v6X9` in prompt.
META_CWD="/work/proj-meta"
META_ENCODED=$(echo "$META_CWD" | tr '/._' '-')
META_PROJ="$HOME/.claude/projects/$META_ENCODED"
META_MEM="$META_PROJ/memory"
mkdir -p "$META_MEM"
cat > "$META_MEM/MEMORY.md" <<'EOF'
- [Versioned](feedback_versioned.md) `[v6.9]` — version-specific note
EOF
touch "$META_MEM/feedback_versioned.md"
SESS="sess10"
EVENT_10=$(jq -cn --arg p "discuss v6X9 deployment" --arg s "$SESS" --arg c "$META_CWD" \
  '{hook_event_name:"UserPromptSubmit", session_id:$s, prompt:$p, cwd:$c}')
OUT=$(bash "$HOOK" <<<"$EVENT_10" 2>/dev/null)
[[ -z "$OUT" ]] && ok "10 regex-meta tag (v6.9) escaped — no FP on v6X9" || ng "10 (out: $OUT)"

# Case 11: telemetry — rule-hits.jsonl row written on hint emission
SESS="sess11"
RULE_LOG="$HOME/.claude/logs/claudemd.jsonl"
rm -f "$RULE_LOG"
OUT=$(mkevent "ship release macos" "$SESS" | bash "$HOOK" 2>/dev/null)
if [[ -f "$RULE_LOG" ]]; then
  LAST=$(tail -n 1 "$RULE_LOG")
  if echo "$LAST" | jq -e '.event == "suggest" and .spec_section == "§11-memory-hint" and (.extra.suggested | length) > 0' >/dev/null 2>&1; then
    ok "11 telemetry row: event=suggest, section=§11-memory-hint, suggested[]"
  else
    ng "11 telemetry row missing or wrong (got: $LAST)"
  fi
else
  ng "11 rule-hits log not written"
fi

# Case 12: cap output at 5 — 7 matching tags should still surface only 5 lines
CAP_CWD="/work/proj-cap"
CAP_ENCODED=$(echo "$CAP_CWD" | tr '/._' '-')
CAP_PROJ="$HOME/.claude/projects/$CAP_ENCODED"
CAP_MEM="$CAP_PROJ/memory"
mkdir -p "$CAP_MEM"
{
  for i in 1 2 3 4 5 6 7; do
    echo "- [Entry $i](feedback_$i.md) \`[shipcap$i]\` — desc"
    touch "$CAP_MEM/feedback_$i.md"
  done
} > "$CAP_MEM/MEMORY.md"
SESS="sess12"
PROMPT_12="touching shipcap1 shipcap2 shipcap3 shipcap4 shipcap5 shipcap6 shipcap7 all at once"
EVENT_12=$(jq -cn --arg p "$PROMPT_12" --arg s "$SESS" --arg c "$CAP_CWD" \
  '{hook_event_name:"UserPromptSubmit", session_id:$s, prompt:$p, cwd:$c}')
OUT=$(bash "$HOOK" <<<"$EVENT_12" 2>/dev/null)
CTX=$(echo "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null)
# Should see exactly 5 file lines + "... and 2 more" footer.
LINE_COUNT=$(echo "$CTX" | grep -cE "^\s+- " || true)
if [[ "$LINE_COUNT" == "5" ]] && echo "$CTX" | grep -qF "2 more"; then
  ok "12 cap at 5 + overflow footer"
else
  ng "12 expected 5 lines + overflow footer (got line_count=$LINE_COUNT)"
fi

if (( FAIL > 0 )); then
  echo "Tests: $((12 - FAIL))/12 passed"
  exit 1
fi
echo "Tests: 12/12 passed"
