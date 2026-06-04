#!/usr/bin/env bash
# transcript-vocab-scan.test.sh — tests for v0.8.3 R-N8 PostToolUse hook.
# Covers: opt-in gate (default OFF), advisory-only behavior, transcript jsonl
# parsing, banned-vocab pattern matching against assistant text, kill-switch.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/transcript-vocab-scan.sh"

TMP_HOME=$(mktemp -d -t claudemd-tvs-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs" "$HOME/.claude/projects/test"

TRANSCRIPT="$HOME/.claude/projects/test/session.jsonl"
EVENT_BASE='{"session_id":"tvs","transcript_path":"'"$TRANSCRIPT"'","tool_name":"Read","tool_input":{}}'

FAIL=0
ok() { echo "PASS: $1"; }
ng() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# Helper: write a transcript with a single assistant text turn
write_transcript() {
  local text="$1"
  jq -cn --arg t "$text" '{type:"assistant",message:{content:[{type:"text",text:$t}]}}' > "$TRANSCRIPT"
}

# Helper: count rule-hits log lines tagged by transcript-vocab-scan
log_hits() {
  [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]] || { echo 0; return; }
  jq -r 'select(.hook=="transcript-vocab-scan") | .event' "$HOME/.claude/logs/claudemd.jsonl" 2>/dev/null \
    | wc -l | tr -d ' '
}

# --- Case 1: default OFF (no flag) → silent + no log row ---------------------
write_transcript "this is significantly improved"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(echo "$EVENT_BASE" | bash "$HOOK" 2>&1)
HITS=$(log_hits)
if [[ -z "$OUT" && "$HITS" == "0" ]]; then
  ok "1: default OFF → silent + no log"
else
  ng "1: default OFF leaked output (out: $OUT, log hits: $HITS)"
fi

# --- Case 2: flag ON + clean text → silent + no log row ----------------------
write_transcript "added pagination cursor; tests 1453 → 1490 (+2.5%)"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
HITS=$(log_hits)
if [[ -z "$OUT" && "$HITS" == "0" ]]; then
  ok "2: flag ON + clean prose → silent"
else
  ng "2: clean prose triggered hook (out: $OUT, log hits: $HITS)"
fi

# --- Case 3: flag ON + banned word → advisory stderr + log row ---------------
write_transcript "the migration is significantly faster than before"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
HITS=$(log_hits)
EVENT_TYPE=""
if [[ -f "$HOME/.claude/logs/claudemd.jsonl" ]]; then
  EVENT_TYPE=$(jq -r 'select(.hook=="transcript-vocab-scan") | .event' "$HOME/.claude/logs/claudemd.jsonl" | head -n1)
fi
if echo "$OUT" | grep -q '§10-V drift detected' \
   && echo "$OUT" | grep -qi 'significantly' \
   && [[ "$HITS" == "1" && "$EVENT_TYPE" == "advisory" ]]; then
  ok "3: banned word in prose → advisory + log event=advisory"
else
  ng "3: advisory wrong (out: $OUT, hits: $HITS, event: $EVENT_TYPE)"
fi

# --- Case 4: PostToolUse cannot block — exit 0 even on hit -------------------
write_transcript "this should work and is robust"
EXIT=0
TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' >/dev/null 2>&1" || EXIT=$?
if [[ "$EXIT" == "0" ]]; then
  ok "4: hook exits 0 on hit (advisory-only, never blocks)"
else
  ng "4: hook exited non-zero on hit (got $EXIT)"
fi

# --- Case 5: kill-switch DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK suppresses --------
write_transcript "significantly improved"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 DISABLE_TRANSCRIPT_VOCAB_SCAN_HOOK=1 \
  bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
HITS=$(log_hits)
if [[ -z "$OUT" && "$HITS" == "0" ]]; then
  ok "5: kill-switch suppresses despite opt-in flag"
else
  ng "5: kill-switch ignored (out: $OUT, hits: $HITS)"
fi

# --- Case 6: ratio @ratio patterns are SKIPPED in transcript scan ------------
# `70% faster` would match `\b[0-9]+%\s+(faster|slower|...)\b` (an @ratio
# pattern) — we explicitly skip these in chat prose because narrative text
# uses ratios with different baseline conventions than commit messages.
write_transcript "the new render is 70% faster on the homepage"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
HITS=$(log_hits)
if [[ -z "$OUT" && "$HITS" == "0" ]]; then
  ok "6: @ratio patterns skipped in transcript scan"
else
  ng "6: @ratio FP triggered (out: $OUT, hits: $HITS)"
fi

# --- Case 7: missing transcript file → fail-open (silent exit 0) ------------
EVENT_NOTF='{"session_id":"tvs","transcript_path":"/nonexistent/path.jsonl","tool_name":"Read","tool_input":{}}'
EXIT=0
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_NOTF' | bash '$HOOK' 2>&1") || EXIT=$?
if [[ "$EXIT" == "0" && -z "$OUT" ]]; then
  ok "7: missing transcript file → fail-open silent"
else
  ng "7: missing transcript leaked (exit $EXIT, out: $OUT)"
fi

# --- Case 8: transcript with multiple turns picks the LAST assistant text ---
{
  jq -cn '{type:"user",message:{content:"hi"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"some early clean text"}]}}'
  jq -cn '{type:"user",message:{content:"more"}}'
  jq -cn '{type:"assistant",message:{content:[{type:"text",text:"final turn says significantly improved"}]}}'
} > "$TRANSCRIPT"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
if echo "$OUT" | grep -qi 'significantly'; then
  ok "8: scanner targets the LAST assistant text turn"
else
  ng "8: did not pick last turn (out: $OUT)"
fi

# --- Case 9: multi-paragraph turn — banned word in FIRST paragraph caught ---
# Pre-fix, `jq join(" ")` only joined CONTENT BLOCKS — embedded `\n` inside a
# single .text block survived. Then `tail -n 1` picked only the last line of
# the turn, silently dropping banned vocab in earlier paragraphs. The
# per-text-block `gsub("[\\r\\n]+"; " ")` collapses internal newlines before
# the outer join, so the whole turn becomes one scan-friendly line.
jq -cn --arg t 'I significantly improved the latency.

The remaining work is straightforward.' '{type:"assistant",message:{content:[{type:"text",text:$t}]}}' > "$TRANSCRIPT"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
if echo "$OUT" | grep -qi 'significantly'; then
  ok "9: multi-paragraph turn — first-paragraph banned word caught"
else
  ng "9: missed multi-paragraph banned vocab (out: $OUT)"
fi

# --- Case 10: multi-paragraph turn — clean first para + dirty last para ----
# Anchor that case 9's fix doesn't regress the basic detect — both paragraphs
# in scope, either-position banned word fires.
jq -cn --arg t 'I shipped the patch.

Follow-up: robust pattern.' '{type:"assistant",message:{content:[{type:"text",text:$t}]}}' > "$TRANSCRIPT"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
if echo "$OUT" | grep -qi 'robust'; then
  ok "10: multi-paragraph turn — last-paragraph banned word also caught"
else
  ng "10: missed last-paragraph banned vocab (out: $OUT)"
fi

# --- Case 11/12 (v0.23.11): per-session dedup. PostToolUse fires after every
# tool call; the same prose turn must NOT re-emit the advisory on each tool call
# in a chain — fires once, silent on identical re-scan, fires again on NEW prose.
jq -cn '{type:"assistant",message:{content:[{type:"text",text:"this is significantly better overall"}]}}' > "$TRANSCRIPT"
rm -f "$HOME/.claude/logs/claudemd.jsonl"
OUT_A=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
OUT_B=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
if echo "$OUT_A" | grep -qi significantly && [[ -z "$OUT_B" ]]; then
  ok "11: identical prose re-scan deduped (fires once, silent on repeat)"
else
  ng "11: dedup failed (A nonempty=$([[ -n "$OUT_A" ]] && echo y), B='$OUT_B')"
fi

jq -cn '{type:"assistant",message:{content:[{type:"text",text:"now it is robust and comprehensive"}]}}' > "$TRANSCRIPT"
OUT_C=$(TRANSCRIPT_VOCAB_SCAN=1 bash -c "echo '$EVENT_BASE' | bash '$HOOK' 2>&1")
if echo "$OUT_C" | grep -qiE 'robust|comprehensive'; then
  ok "12: new prose after dedup still fires"
else
  ng "12: dedup wrongly suppressed new prose (out: $OUT_C)"
fi

if (( FAIL > 0 )); then
  echo "Tests: $((12 - FAIL))/12 passed"
  exit 1
fi
echo "Tests: 12/12 passed"
