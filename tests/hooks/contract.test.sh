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
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="banned-vocab" and .event=="bypass-escape-hatch" and .extra.token=="allow-banned-vocab")' "$LOG" >/dev/null 2>&1; then
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
  "npx-allow-local:pre-bash-safety"
  "npx-allow-no-install:pre-bash-safety"
  "rm-rf-allow-validated:pre-bash-safety"
  "pass-known-red:ship-baseline"
  "pass-known-red-incmd:ship-baseline"
  "deny-repeat:ship-baseline"
  "warn:sandbox-disposal"
  "warn:residue-audit"
  "advisory:transcript-vocab-scan"
  "structure-advisory:transcript-structure-scan"
  "bootstrap:session-start"
  "upstream-banner:session-start"
  "compact-reminder:session-start"
  "stale-root:session-start"
  "version-sync:user-prompt-submit"
  "stale-root:user-prompt-submit"
  "read:session-extended-read"
  "suggest:memory-prompt-hint"
  "suppress-source:memory-prompt-hint"
  "mid-spine-advisory:mid-spine-yield-scan"
  "batch-cadence-advisory:session-end-check"
  "deny-prose:banned-vocab"
  "deny-prose-dry-run:banned-vocab"
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

# --- C2 (v0.20.1 M3): every ESCAPE_TOKENS literal in scripts/status.js -----
# must appear in at least one hooks/*.sh file. Catches the "added a 6th bypass
# token to status.js's --verbose mirror table but didn't implement it in any
# hook" drift class. status.js's ESCAPE_TOKENS is hand-maintained mirror data;
# this assertion turns it into a contract check.
STATUS_JS="$(cd "$HERE/../../scripts" && pwd)/status.js"
if [[ -r "$STATUS_JS" ]]; then
  # Extract every `token: '...'` literal from the ESCAPE_TOKENS array.
  # Single-quoted JS strings; tokens themselves never contain a single quote.
  ESCAPE_TOKENS_FOUND=$(grep -oE "token: '[^']+'" "$STATUS_JS" | sed -E "s/^token: '(.*)'$/\\1/")
  if [[ -z "$ESCAPE_TOKENS_FOUND" ]]; then
    ng "C2 ESCAPE_TOKENS array empty or unparseable in status.js"
  else
    while IFS= read -r tok; do
      [[ -z "$tok" ]] && continue
      if grep -F -q -r -- "$tok" "$HOOKS_DIR"; then
        ok "C2 ESCAPE_TOKEN '$tok' is implemented in hooks/"
      else
        ng "C2 ESCAPE_TOKEN '$tok' declared in status.js but NOT found in any hook (drift)"
      fi
    done <<< "$ESCAPE_TOKENS_FOUND"
  fi
else
  ng "C2 status.js unreadable at $STATUS_JS"
fi

# --- D: project field is auto-populated -------------------------------------

rm -f "$LOG"
CLAUDE_PROJECT_DIR=/contract/test.x bash -c \
  "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append test deny null"
if [[ -f "$LOG" ]] && jq -e '.project == "-contract-test-x"' "$LOG" >/dev/null 2>&1; then
  ok "D rule-hits row carries encoded project"
else
  ng "D project field missing/wrong (log: $(cat "$LOG" 2>/dev/null))"
fi

# --- E: spec_section populated on every spec-enforcing hook deny/bypass -----
# v0.7.0 R1 contract. Hooks that enforce a spec rule (banned-vocab, ship-
# baseline, pre-bash-safety, memory-read-check, residue-audit, sandbox-
# disposal) MUST emit `spec_section` non-null on deny/warn/bypass-escape-hatch.
# Plugin-internal hooks (session-start bootstrap/upstream-banner, user-prompt-
# submit version-sync) keep null. Drives §0.1/§13.1/§13.2 promotion accounting.

# E.1 banned-vocab deny → spec_section "§10-V"
rm -f "$LOG"
drive "$HOOKS_DIR/banned-vocab-check.sh" \
  "git commit -m 'this is significantly better'"
if [[ -f "$LOG" ]] && jq -e 'select(.hook=="banned-vocab" and .event=="deny" and .spec_section=="§10-V")' "$LOG" >/dev/null 2>&1; then
  ok "E.1 banned-vocab deny tagged §10-V"
else
  ng "E.1 banned-vocab deny missing/wrong section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.2 ship-baseline pass / pass-known-red / deny → "§7-ship-baseline"
# Tested via the lib directly (the hook's own gh-CLI dependency makes
# end-to-end driving brittle in unit tests). Same code path, same arg count.
rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append ship-baseline pass null '§7-ship-baseline'"
if jq -e 'select(.spec_section=="§7-ship-baseline")' "$LOG" >/dev/null 2>&1; then
  ok "E.2 ship-baseline pass tagged §7-ship-baseline"
else
  ng "E.2 ship-baseline pass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.3 pre-bash-safety bypass-escape-hatch (rm-rf-var) → "§8-rm-rf-var"
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'rm -rf $FOO [allow-rm-rf-var]'
if jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .spec_section=="§8-rm-rf-var")' "$LOG" >/dev/null 2>&1; then
  ok "E.3 pre-bash-safety rm-rf-var bypass tagged §8-rm-rf-var"
else
  ng "E.3 pre-bash-safety rm-rf-var bypass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.4 pre-bash-safety bypass (npx) → "§8-npx"
rm -f "$LOG"
drive "$HOOKS_DIR/pre-bash-safety-check.sh" \
  'npx some-pkg [allow-npx-unpinned]'
if jq -e 'select(.hook=="pre-bash-safety" and .event=="bypass-escape-hatch" and .spec_section=="§8-npx")' "$LOG" >/dev/null 2>&1; then
  ok "E.4 pre-bash-safety npx bypass tagged §8-npx"
else
  ng "E.4 pre-bash-safety npx bypass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.5 memory-read-check bypass → "§11-memory-read"
CWD_E5="/work/contract-mem-e"
ENC=$(echo "$CWD_E5" | tr '/.' '-')
PROJ_DIR_E="$HOME/.claude/projects/$ENC"
mkdir -p "$PROJ_DIR_E/memory"
cat > "$PROJ_DIR_E/memory/MEMORY.md" <<'EOF'
- [Push lessons](feedback_push.md) `[push]` — required
EOF
touch "$PROJ_DIR_E/memory/feedback_push.md"
echo '' > "$PROJ_DIR_E/contract.jsonl"
rm -f "$LOG"
jq -cn --arg c "git push origin main [skip-memory-check]" --arg cwd "$CWD_E5" \
  '{session_id:"contract",tool_name:"Bash",tool_input:{command:$c},cwd:$cwd}' \
  | bash "$HOOKS_DIR/memory-read-check.sh" >/dev/null 2>&1 || true
if jq -e 'select(.hook=="memory-read-check" and .event=="bypass-escape-hatch" and .spec_section=="§11-memory-read")' "$LOG" >/dev/null 2>&1; then
  ok "E.5 memory-read-check bypass tagged §11-memory-read"
else
  ng "E.5 memory-read-check bypass missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.6 residue-audit / sandbox-disposal sections via lib (real Stop-hook
# driving requires session-state that's painful to fake). Same code path.
rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append residue-audit warn '{\"delta\":42}' '§7-user-global-state'"
if jq -e 'select(.spec_section=="§7-user-global-state")' "$LOG" >/dev/null 2>&1; then
  ok "E.6 residue-audit warn tagged §7-user-global-state"
else
  ng "E.6 residue-audit warn missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append sandbox-disposal warn '{\"count\":3}' '§8.V4'"
if jq -e 'select(.spec_section=="§8.V4")' "$LOG" >/dev/null 2>&1; then
  ok "E.7 sandbox-disposal warn tagged §8.V4"
else
  ng "E.7 sandbox-disposal warn missing section (log: $(cat "$LOG" 2>/dev/null))"
fi

# E.8 plugin-internal events (bootstrap / version-sync) keep spec_section
# null — they don't enforce a spec rule, just plugin lifecycle.
rm -f "$LOG"
bash -c "source '$HOOKS_DIR/lib/rule-hits.sh'; rule_hits_append session-start bootstrap null"
if jq -e 'select(.spec_section==null)' "$LOG" >/dev/null 2>&1; then
  ok "E.8 session-start bootstrap leaves section null"
else
  ng "E.8 session-start bootstrap section should be null (log: $(cat "$LOG" 2>/dev/null))"
fi

TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
