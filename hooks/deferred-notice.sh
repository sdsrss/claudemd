#!/usr/bin/env bash
# deferred-notice.sh — UserPromptSubmit: hands the model the observations a
# Stop hook left for it at the end of the previous turn
# (tasks/specs/evidence-gate-deferred.md, R5 plan B).
#
# Why a second hop. A Stop hook CAN put text in front of the model since Claude
# Code 2.1.163 (hookSpecificOutput.additionalContext), but on Stop that keeps
# the turn going: the model writes one more reply per firing. For an advisory
# whose verdict is often wrong (evidence-gate: at most 3 of 21 firings right),
# that is a turn spent per false alarm. So the Stop hook writes
# ~/.claude/.claudemd-state/notice-<session>.<source> and this hook delivers it
# with the next prompt of the same session: no extra turn, and nothing at all
# if the conversation ends there.
#
# Writers today: evidence-gate.sh (opt-in twice: EVIDENCE_GATE=1 and
# EVIDENCE_GATE_DELIVER=1). A notice is
# delivered once — the file is renamed before it is read, so two prompts
# arriving together cannot both deliver it — and at most 2,000 bytes of it
# (`head -c`, so a multi-byte character at the cut becomes U+FFFD). A notice nobody collects (the session ended) is reaped by
# /claudemd-clean-residue past the retention window.
#
# Cost when there is nothing to deliver: one glob, before anything is sourced;
# this runs on every prompt of every session.
#
# Kill-switches:
#   DISABLE_DEFERRED_NOTICE_HOOK=1 — stop delivering (writers still write)
#   DISABLE_CLAUDEMD_HOOKS=1       — global

set -uo pipefail

STATE_DIR="${HOME:-}/.claude/.claudemd-state"
[[ -n "${HOME:-}" ]] || exit 0
compgen -G "$STATE_DIR/notice-*" >/dev/null 2>&1 || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch DEFERRED_NOTICE || exit 0
hook_require_jq || { hook_record_failopen deferred-notice jq-missing; exit 0; }

EVENT=$(hook_read_event) || exit 0
SESSION_ID=$(hook_jq_field deferred-notice "$EVENT" '.session_id // ""') || exit 0
[[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] || exit 0

ctx=""
sources=""
for f in "$STATE_DIR/notice-$SESSION_ID".*; do
  [[ -f "$f" ]] || continue
  src="${f##*.}"
  [[ "$src" =~ ^[a-z][a-z0-9-]*$ ]] || continue
  claim="$f.delivering.$$"
  mv "$f" "$claim" 2>/dev/null || continue
  body=$(head -c 2000 "$claim" 2>/dev/null)
  rm -f "$claim" 2>/dev/null
  [[ -n "$body" ]] || continue
  ctx+="$body"$'\n'
  sources+="${sources:+,}$src"
done
[[ -n "$ctx" ]] || exit 0

# The rule a notice speaks for is its writer's: evidence-gate's is Iron Law #2.
section=''
[[ "$sources" == evidence-gate ]] && section='§iron-law-2'
hook_record deferred-notice notice-delivered "$(jq -cn --arg s "$sources" '{sources: $s}' 2>/dev/null || echo 'null')" "$section" "$SESSION_ID" 2>/dev/null || true
jq -cn --arg c "$ctx" '{suppressOutput: true, hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $c}}'
exit 0
