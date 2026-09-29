#!/usr/bin/env bash
# deferred-notice.test.sh — Stop-hook observations delivered with the next
# prompt (tasks/specs/evidence-gate-deferred.md), end to end with evidence-gate.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/deferred-notice.sh"
EG="$HERE/../../hooks/evidence-gate.sh"
TMP_HOME=$(mktemp -d -t claudemd-dn-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
ST="$HOME/.claude/.claudemd-state"
mkdir -p "$ST" "$HOME/.claude/logs" "$HOME/.claude/projects/p"
LOG="$HOME/.claude/logs/claudemd.jsonl"

# shellcheck source=tests/lib/assert.sh
source "$HERE/../lib/assert.sh"

prompt() { jq -cn --arg s "$1" '{hook_event_name:"UserPromptSubmit", prompt:"next", session_id:$s, cwd:"/work/p"}' | bash "$HOOK" 2>/dev/null; }
ctx() { jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }

# 1. nothing queued: silent (the fast path, before any library is sourced).
[[ -z "$(prompt s1)" ]] && ok "1 nothing queued: silent" || ng "1 emitted with nothing queued"

# 2. a queued notice is delivered once, to its own session, and the file is consumed.
printf 'NOTICE-A for s2\n' >"$ST/notice-s2.evidence-gate"
printf 'NOTICE-B for s3\n' >"$ST/notice-s3.evidence-gate"
O2=$(prompt s2)
O2B=$(prompt s2)
if [[ "$(jq -r '.hookSpecificOutput.hookEventName' <<<"$O2")" == UserPromptSubmit ]] && grep -q 'NOTICE-A for s2' <<<"$(ctx <<<"$O2")" \
   && ! grep -q 'NOTICE-B' <<<"$(ctx <<<"$O2")" && [[ -z "$O2B" && ! -e "$ST/notice-s2.evidence-gate" && -f "$ST/notice-s3.evidence-gate" ]]; then
  ok "2 delivered once to its own session; another session's notice is left alone"
else ng "2 wrong: first=${O2:0:80} second=${O2B:0:40} s3-kept=$([[ -f "$ST/notice-s3.evidence-gate" ]] && echo y)"; fi

# 3. kill switch: nothing delivered, the notice stays.
O3=$(jq -cn '{prompt:"x", session_id:"s3"}' | DISABLE_DEFERRED_NOTICE_HOOK=1 bash "$HOOK" 2>/dev/null)
[[ -z "$O3" && -f "$ST/notice-s3.evidence-gate" ]] && ok "3 kill switch: silent, notice kept" || ng "3 kill switch ignored"

# 4. a notice is capped at 2,000 characters; a source name outside [a-z0-9-] is ignored.
head -c 5000 /dev/zero | tr '\0' 'x' >"$ST/notice-s4.evidence-gate"
printf 'EVIL\n' >"$ST/notice-s4.Bad_Name"
C4=$(prompt s4 | ctx)
if (( ${#C4} <= 2001 && ${#C4} >= 1990 )) && ! grep -q EVIL <<<"$C4"; then ok "4 capped at 2,000 characters; malformed source ignored"
else ng "4 len=${#C4} evil=$(grep -c EVIL <<<"$C4")"; fi

# 5. telemetry: one notice-delivered row naming the source, under Iron Law #2.
if jq -e 'select(.hook=="deferred-notice" and .event=="notice-delivered" and .extra.sources=="evidence-gate" and .spec_section=="§iron-law-2")' "$LOG" >/dev/null 2>&1; then
  ok "5 notice-delivered row carries its source and section"
else ng "5 no row: $(tail -1 "$LOG" 2>/dev/null)"; fi

# --- end to end with evidence-gate ------------------------------------------
TR="$HOME/.claude/projects/p/s.jsonl"
eg_stop() { # SESSION ENTRYPOINT
  {
    jq -cn --arg e "$2" '{type:"user",entrypoint:$e,message:{content:"fix it"}}'
    jq -cn '{type:"assistant",message:{content:[{type:"tool_use",id:"tu_e",name:"Edit",input:{file_path:"/p/src/a.js"}}]}}'
    jq -cn '{type:"assistant",message:{content:[{type:"text",text:"Done: rewrote the parser."}]}}'
  } >"$TR"
  # stderr (the human's note) captured, stdout dropped — the order is the point.
  # shellcheck disable=SC2069
  jq -cn --arg s "$1" --arg t "$TR" '{hook_event_name:"Stop", session_id:$s, last_assistant_message:"Done: rewrote the parser.", transcript_path:$t}' \
    | EVIDENCE_GATE=1 bash "$EG" 2>&1 >/dev/null
}

# 6. an interactive session: evidence-gate queues the observation, the human's
# note says the agent gets it next, and the next prompt carries it.
E6=$(eg_stop s6 cli)
C6=$(prompt s6 | ctx)
if grep -q 'reaches it with your next message' <<<"$E6" && grep -q '^\[claudemd\] system-injected — an observation from the end of your previous turn' <<<"$C6" \
   && grep -q 'no command output at all after the last code edit' <<<"$C6" && grep -q 'DISABLE_EVIDENCE_GATE_HOOK=1' <<<"$C6"; then
  ok "6 interactive: evidence-gate queues it, the next prompt delivers it"
else ng "6 stderr=${E6:0:120} ctx=${C6:0:160}"; fi

# 7. a headless run (entrypoint sdk-cli): nothing queued, and the human note says so.
E7=$(eg_stop s7 sdk-cli)
if [[ ! -e "$ST/notice-s7.evidence-gate" ]] && grep -q 'reaches you, not the agent' <<<"$E7"; then
  ok "7 headless: nothing queued"
else ng "7 queued=$([[ -e "$ST/notice-s7.evidence-gate" ]] && echo y) stderr=${E7:0:100}"; fi

# 8. the advisory row records whether it queued.
if jq -e 'select(.hook=="evidence-gate" and .session_id=="s6" and .extra.queued==true)' "$LOG" >/dev/null 2>&1 \
   && jq -e 'select(.hook=="evidence-gate" and .session_id=="s7" and .extra.queued==false)' "$LOG" >/dev/null 2>&1; then
  ok "8 evidence-advisory rows carry queued true/false"
else ng "8 rows: $(jq -c 'select(.hook=="evidence-gate")|.extra' "$LOG" 2>/dev/null | tr '\n' ' ')"; fi

claudemd_assert_summary
