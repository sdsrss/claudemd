#!/usr/bin/env bash
# transcript-structure-scan.test.sh — v0.9.10 P1.2 hook coverage.
# Verifies opt-in gate, three detections, FP mitigations, kill-switches.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/transcript-structure-scan.sh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"

FAIL=0
PASS=0

# Helper: write a transcript jsonl with a single assistant text turn,
# then drive the hook with a Stop event referencing that path.
seed_transcript() {
  local body="$1"
  local tx
  tx=$(mktemp)
  jq -cn --arg t "$body" \
    '{type:"assistant",message:{content:[{type:"text",text:$t}]}}' \
    > "$tx"
  printf '%s' "$tx"
}

drive() {
  local transcript="$1" extra_env="${2:-}"
  local fix
  fix=$(mktemp)
  jq -cn --arg p "$transcript" \
    '{session_id:"test",transcript_path:$p}' > "$fix"
  if [[ -n "$extra_env" ]]; then
    eval "$extra_env" bash "$HOOK" < "$fix" 2>/tmp/structure-stderr-$$
  else
    bash "$HOOK" < "$fix" 2>/tmp/structure-stderr-$$
  fi
  local rc=$?
  STDERR=$(cat /tmp/structure-stderr-$$); rm -f /tmp/structure-stderr-$$ "$fix" "$transcript"
  return $rc
}

# --------------------------------------------------------------------------
# Case 1: opt-out by default → silent regardless of transcript content.
# --------------------------------------------------------------------------
TX=$(seed_transcript $'Done: refactored auth\nNot done: x\nFailed: y\nUncertain: z')
unset TRANSCRIPT_STRUCTURE_SCAN
drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 1 default OFF → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 1 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 2: opt-in but no transcript_path → silent (fail-open).
# --------------------------------------------------------------------------
fix=$(mktemp)
jq -cn '{session_id:"test"}' > "$fix"
TRANSCRIPT_STRUCTURE_SCAN=1 bash "$HOOK" < "$fix" 2>/tmp/se-$$
rc=$?; STDERR=$(cat /tmp/se-$$); rm -f /tmp/se-$$ "$fix"
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 2 opt-in + missing transcript → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 2 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 3: well-formed four-section with evidence → silent.
# --------------------------------------------------------------------------
TX=$(seed_transcript "Done: pagination cursor on /orders (pytest tests/api/test_orders_pagination.py: 12 passed in 1.4s, covers empty / single-page / mid-page).
Not done: header X-RateLimit (deferred).
Failed: (none)
Uncertain: (none)")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 3 four-section with evidence + ordered → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 3 (stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 4: four-section REVERSED order (Uncertain before Done) → flag.
# --------------------------------------------------------------------------
TX=$(seed_transcript "Uncertain: cursor opacity uncertain because urlsafe_b64 not encrypted (file.py:42).
Failed: (none)
Not done: header X-RateLimit (deferred).
Done: pagination cursor (pytest 12 passed).")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§10-four-section-order'; then
  echo "PASS: 4 reversed four-section → §10-four-section-order"; PASS=$((PASS+1))
else
  echo "FAIL: 4 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 5: four-section block but Done: line lacks evidence → §iron-law-2 flag.
# --------------------------------------------------------------------------
TX=$(seed_transcript "Done: refactored the auth module per discussion.
Not done: bullet 2 deferred.
Failed: (none)
Uncertain: env behaviour because new envs untested.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§iron-law-2'; then
  echo "PASS: 5 Done without evidence in block → §iron-law-2"; PASS=$((PASS+1))
else
  echo "FAIL: 5 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 6: SINGLE Done: line (no other section labels) → silent (L1 short-form).
# --------------------------------------------------------------------------
TX=$(seed_transcript "Done: refactored the auth module.

Other prose continues here without any other report-style section labels.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 6 single Done: (no four-section context) → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 6 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 7: short Uncertain: without "because" → §10-honesty flag.
# --------------------------------------------------------------------------
TX=$(seed_transcript "Some prose here.

Uncertain: maybe broken.

Other prose.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§10-honesty'; then
  echo "PASS: 7 short Uncertain without rationale → §10-honesty"; PASS=$((PASS+1))
else
  echo "FAIL: 7 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 8: Uncertain: (none) → silent (legitimate L3 zero-issue).
# --------------------------------------------------------------------------
TX=$(seed_transcript "Done: thing.
Uncertain: (none)")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 8 Uncertain: (none) → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 8 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 9: Uncertain: with explicit "because" → silent (rationale connector).
# --------------------------------------------------------------------------
TX=$(seed_transcript "Some prose.

Uncertain: cursor opacity because urlsafe_b64 unencrypted; reversible.

End.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 9 Uncertain with 'because' → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 9 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 10: kill-switch DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK=1 → silent.
# --------------------------------------------------------------------------
TX=$(seed_transcript "Uncertain: short hedge.")
TRANSCRIPT_STRUCTURE_SCAN=1 DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 10 hook kill-switch → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 10 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 11: global kill DISABLE_CLAUDEMD_HOOKS=1 → silent.
# --------------------------------------------------------------------------
TX=$(seed_transcript "Uncertain: short hedge.")
TRANSCRIPT_STRUCTURE_SCAN=1 DISABLE_CLAUDEMD_HOOKS=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 11 global kill-switch → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 11 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 13: markdown-header four-section with evidence in 15-line window
# (## Done — title; blank line; evidence in next-N lines) → silent.
# v0.9.11 broadening: hook must accept `## Done` style.
# --------------------------------------------------------------------------
TX=$(seed_transcript "## Done — pagination shipped

具体证据：
- pytest tests/api/test_orders_pagination.py: 12 passed
- baseline 1453 → 1490 tests (+2.5%)

## Not done

- (none)

## Failed

- (none)

## Uncertain

cursor opacity uncertain because urlsafe_b64 not encrypted; reversible.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 13 ## Done markdown-header form with evidence in window → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 13 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 14: markdown-header four-section but Done window lacks evidence
# (Done capped before Not done section) → §iron-law-2 fires.
# --------------------------------------------------------------------------
TX=$(seed_transcript "## Done

refactored auth module per discussion.

## Not done

- bullet 2 deferred (because untested in staging, will follow up)

## Failed

- (none)

## Uncertain

env behaviour uncertain because new envs were not exercised.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 ]] && echo "$STDERR" | grep -q '§iron-law-2'; then
  echo "PASS: 14 ## Done markdown-header without evidence → §iron-law-2"; PASS=$((PASS+1))
else
  echo "FAIL: 14 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 15: bare `## Uncertain` (header standalone, rationale on next line)
# → silent. Markdown-header form for Uncertain is normal report style.
# --------------------------------------------------------------------------
TX=$(seed_transcript "## Done — thing

## Uncertain

This is a multi-line rationale that explains why I'm uncertain because of various reasons.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ "$rc" -eq 0 && -z "$STDERR" ]]; then
  echo "PASS: 15 ## Uncertain header alone (rationale follows) → silent"; PASS=$((PASS+1))
else
  echo "FAIL: 15 (rc=$rc, stderr='$STDERR')"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 12: rule-hits row written with new event class structure-advisory.
# --------------------------------------------------------------------------
rm -f "$HOME/.claude/logs/claudemd.jsonl"
TX=$(seed_transcript "Some prose.

Uncertain: hedge no reason.

End.")
TRANSCRIPT_STRUCTURE_SCAN=1 drive "$TX"; rc=$?
if [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] \
   && jq -e 'select(.hook=="transcript-structure-scan" and .event=="structure-advisory" and .spec_section=="§10-honesty")' \
        "$HOME/.claude/logs/claudemd.jsonl" >/dev/null 2>&1; then
  echo "PASS: 12 rule-hits row tagged §10-honesty / structure-advisory"; PASS=$((PASS+1))
else
  echo "FAIL: 12 (no row or wrong section: $(cat $HOME/.claude/logs/claudemd.jsonl 2>/dev/null))"; FAIL=$((FAIL+1))
fi

# --------------------------------------------------------------------------
# Case 13 (v0.23.11): only the LAST assistant turn is scanned. A stale
# wrong-order report from an EARLIER turn must NOT be re-flagged as "last turn"
# drift when the actual last turn is clean. Pre-fix all turns were concatenated.
# --------------------------------------------------------------------------
TX13=$(mktemp)
cat > "$TX13" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"text","text":"Done: w\nNot done: z\nFailed: y\nUncertain: x"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"thanks"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Glad to help. Anything else?"}]}}
EOF
FIX13=$(mktemp); jq -cn --arg p "$TX13" '{session_id:"test",transcript_path:$p}' > "$FIX13"
STDERR13=$(TRANSCRIPT_STRUCTURE_SCAN=1 bash "$HOOK" < "$FIX13" 2>&1)
if [[ -z "$STDERR13" ]]; then
  echo "PASS: 13 stale prior-turn report not flagged when last turn is clean"; PASS=$((PASS+1))
else
  echo "FAIL: 13 phantom flag from earlier turn (out: $STDERR13)"; FAIL=$((FAIL+1))
fi
rm -f "$TX13" "$FIX13"

# Case 14: a genuinely out-of-order report in the ACTUAL last turn still flags.
TX14=$(mktemp)
cat > "$TX14" <<'EOF'
{"type":"assistant","message":{"content":[{"type":"text","text":"hello there"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Done: a\nUncertain: b\nFailed: c\nNot done: d"}]}}
EOF
FIX14=$(mktemp); jq -cn --arg p "$TX14" '{session_id:"test",transcript_path:$p}' > "$FIX14"
STDERR14=$(TRANSCRIPT_STRUCTURE_SCAN=1 bash "$HOOK" < "$FIX14" 2>&1)
if [[ -n "$STDERR14" ]]; then
  echo "PASS: 14 out-of-order last turn still flagged"; PASS=$((PASS+1))
else
  echo "FAIL: 14 missed real out-of-order in last turn"; FAIL=$((FAIL+1))
fi
rm -f "$TX14" "$FIX14"

# --------------------------------------------------------------------------
# Result
# --------------------------------------------------------------------------
TOTAL=$((PASS+FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"; exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
