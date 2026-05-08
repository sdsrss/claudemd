#!/usr/bin/env bash
# contract.test.sh — locks the hook ↔ rule-hits-schema contract.
#
# Three invariants:
#   A. Every hook with a documented bypass token records `bypass-escape-hatch`
#      when the token is present (driven end-to-end via fixture commands).
#   B. Every (event, emitter) pair documented in docs/RULE-HITS-SCHEMA.md
#      has a matching `hook_record <hook> <event>` in source.
#   C. Every event emitted in hooks/ source is documented in the schema.
#
# When (B) or (C) fail, the schema and the hooks have drifted — fix the
# whichever side is wrong, not the test.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$HERE/../../hooks" && pwd)"
SCHEMA="$HERE/../../docs/RULE-HITS-SCHEMA.md"

TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
LOG="$TMP_HOME/.claude/logs/claudemd.jsonl"

PASS=0; FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
ng() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# --- A: bypass-token end-to-end recording -----------------------------------

drive() {
  local hook_path="$1" cmd="$2" cwd="${3:-/tmp/contract}"
  local fix
  fix=$(mktemp)
  jq -cn --arg c "$cmd" --arg cwd "$cwd" \
    '{session_id:"contract",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' > "$fix"
  bash "$hook_path" < "$fix" >/dev/null 2>&1 || true
  rm -f "$fix"
}

# A.1 banned-vocab + [allow-banned-vocab]
rm -f "$LOG"
drive "$HOOKS_DIR/banned-vocab-check.sh" \
  "git commit -m 'should work [allow-banned-vocab]'"
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="banned-vocab" and .event=="bypass-escape-hatch")' "$LOG" >/dev/null 2>&1; then
  ok "A.1 banned-vocab [allow-banned-vocab] records bypass"
else
  ng "A.1 banned-vocab bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# A.2 pre-bash-safety + [allow-rm-rf-var]
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'rm -rf $FOO [allow-rm-rf-var]'
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .extra.token=="allow-rm-rf-var")' "$LOG" >/dev/null 2>&1; then
  ok "A.2 pre-bash-safety [allow-rm-rf-var] records bypass"
else
  ng "A.2 pre-bash-safety rm-rf bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# A.3 pre-bash-safety + [allow-npx-unpinned]
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'npx some-pkg [allow-npx-unpinned]'
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .extra.token=="allow-npx-unpinned")' "$LOG" >/dev/null 2>&1; then
  ok "A.3 pre-bash-safety [allow-npx-unpinned] records bypass"
else
  ng "A.3 pre-bash-safety npx bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# A.4 memory-read-check + [skip-memory-check]
CWD_A4="/work/contract-mem"
ENC=$(echo "$CWD_A4" | tr '/.' '-')
PROJ_DIR="$HOME/.claude/projects/$ENC"
MEM="$PROJ_DIR/memory"
mkdir -p "$MEM"
cat > "$MEM/MEMORY.md" <<'EOF'
- [Push lessons](feedback_push.md) `[push]` — required
EOF
touch "$MEM/feedback_push.md"
echo '' > "$PROJ_DIR/contract.jsonl"
rm -f "$LOG"
jq -cn --arg c "git push origin main [skip-memory-check]" --arg cwd "$CWD_A4" \
  '{session_id:"contract",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' \
  | bash "$HOOKS_DIR/memory-read-check.sh" >/dev/null 2>&1 || true
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="memory-read-check" and .event=="bypass-escape-hatch")' "$LOG" >/dev/null 2>&1; then
  ok "A.4 memory-read-check [skip-memory-check] records bypass"
else
  ng "A.4 memory-read-check bypass not recorded (log: $(cat "$LOG" 2>/dev/null))"
fi

# --- B: every documented (event, emitter) pair has a hook_record call -------

# Extracted from docs/RULE-HITS-SCHEMA.md "Events" table. Updating this list
# requires updating the schema in the same commit.
DOCUMENTED=(
  "pass:ship-baseline"
  "deny:banned-vocab"
  "deny:ship-baseline"
  "deny:memory-read-check"
  "deny:pre-bash-safety"
  "bypass-escape-hatch:banned-vocab"
  "bypass-escape-hatch:pre-bash-safety"
  "bypass-escape-hatch:memory-read-check"
  "pass-known-red:ship-baseline"
  "warn:sandbox-disposal"
  "warn:residue-audit"
  "bootstrap:session-start"
  "upstream-banner:session-start"
  "version-sync:user-prompt-submit"
)

for entry in "${DOCUMENTED[@]}"; do
  event="${entry%%:*}"
  hook_name="${entry#*:}"
  if grep -hRE "hook_record[[:space:]]+${hook_name}[[:space:]]+${event}([[:space:]]|$)" "$HOOKS_DIR" >/dev/null 2>&1; then
    ok "B documented '$hook_name' emits '$event'"
  else
    ng "B documented '$hook_name'/'$event' has no hook_record call in source"
  fi
done

# --- C: every emitted event in source is documented -------------------------

DOC_EVENTS_UNIQ=$(printf '%s\n' "${DOCUMENTED[@]}" | cut -d: -f1 | sort -u)
EMITTED=$(grep -hRE 'hook_record[[:space:]]+[a-zA-Z_-]+[[:space:]]+[a-z-]+' "$HOOKS_DIR" \
  | sed -E 's/.*hook_record[[:space:]]+[a-zA-Z_-]+[[:space:]]+([a-z-]+).*/\1/' \
  | sort -u)

for e in $EMITTED; do
  if echo "$DOC_EVENTS_UNIQ" | grep -qx "$e"; then
    ok "C emitted '$e' is documented"
  else
    ng "C emitted '$e' is NOT documented in RULE-HITS-SCHEMA.md (drift)"
  fi
done

# --- D: project field is auto-populated -------------------------------------

rm -f "$LOG"
CLAUDE_PROJECT_DIR=/contract/test.x bash -c \
  "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append test deny null"
if [[ -f "$LOG" ]] && jq -e '.project == "-contract-test-x"' "$LOG" >/dev/null 2>&1; then
  ok "D rule-hits row carries encoded project"
else
  ng "D project field missing/wrong (log: $(cat "$LOG" 2>/dev/null))"
fi

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
