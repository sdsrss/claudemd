#!/usr/bin/env bash
# reply-language-check.sh — Stop hook (opt-in): an English reply to a 中文 user
# is sent back once for a 中文 restatement.
#
# Spec §1 Language contract: the user's language is the one the HUMAN types
# in, fixed for the session. Measured 2026-09-25 over 1448 final messages in
# 158 interactive sessions of a 中文-writing user: 93 came out English, and 70
# of them ended turns started by a machine message in the user's role —
# another session's teammate message (49) or a `<task-notification>` (21). The
# wording fix in spec v6.33.0 lowers the rate; it cannot reach the model-level
# part (Opus 5.5 ended 20 of 64 notification turns in English, Opus 5 1 of
# 104). This hook is the mechanical half: tasks/specs/reply-language.md.
#
# What it reads:
#   - the reply: `last_assistant_message` from the event (it does not lag the
#     transcript). English = after stripping fenced code, inline code, URLs,
#     paths and <tags>, no CJK character and at least REPLY_LANGUAGE_MIN_WORDS
#     (default 10) words of two or more letters. Mixed text is never judged,
#     and neither is the harness's own `API Error:` line.
#   - the human: user-role rows in the transcript tail that are the human's
#     own — not tool results, meta rows, compact summaries, sidechain rows,
#     task notifications, teammate messages, command/bash relays — except a
#     slash command's `<command-args>`, which the human typed. The newest
#     one that is classifiable decides: >=2 CJK characters is 中文, no CJK and
#     >=3 words is English, anything else (`1`, `y`) defers to the one before.
#     A human request for English (`用英文` / `in English`) newer than that
#     message lets every reply through.
#   - the entrypoint: a headless run (`claude -p`, entrypoint `sdk-*` on the
#     newest user row) is left alone — nobody reads it as it is written, and
#     a restatement there only costs a turn.
#
# Only when the human is 中文 and the reply is English does it act:
#   REPLY_LANGUAGE_CHECK=1    {"decision":"block"} with a reason asking for the
#                             same content in 中文 — no new work, no tools.
#   REPLY_LANGUAGE_CHECK=log  records the row and prints nothing (the §13.3
#                             false-positive collection mode).
# A block keeps the turn going for one more message; the English text already
# shown stays on screen. `stop_hook_active` (set on the Stop that follows a
# block) is let through, so it asks at most once per turn.
#
# Every English verdict writes `reply-language-restate` or
# `reply-language-logged` with {mode, words, trigger}; trigger is what started
# the turn (human / task-notification / teammate / other).
#
# Opt-in: REPLY_LANGUAGE_CHECK=1|log (default OFF). §EXT §13.3.
# Kill-switches:
#   DISABLE_REPLY_LANGUAGE_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1      — global

set -uo pipefail

# Opt-in gate (default OFF), before any work.
case "${REPLY_LANGUAGE_CHECK:-0}" in
  1 | log) RL_MODE="$REPLY_LANGUAGE_CHECK" ;;
  *) exit 0 ;;
esac

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch REPLY_LANGUAGE || exit 0
hook_require_jq || {
  hook_record_failopen reply-language jq-missing
  exit 0
}

EVENT=$(hook_read_event) || exit 0

RL_MIN="${REPLY_LANGUAGE_MIN_WORDS:-10}"
[[ "$RL_MIN" =~ ^[0-9]+$ ]] || RL_MIN=10
RL_WINDOW="${REPLY_LANGUAGE_WINDOW:-3000}"
[[ "$RL_WINDOW" =~ ^[0-9]+$ ]] || RL_WINDOW=3000

# The text a language is judged on: code, URLs, paths and tags removed — an
# English identifier inside a 中文 sentence is still a 中文 sentence, and a
# fenced block of English is code, not the reply's language.
# POSIX classes only, as every hook source here (no \s \w \S): a fence is
# three backticks, then any run holding no three in a row, then three more.
RL_JQ_DEFS='
  def rl_strip:
    gsub("```([^`]|`[^`]|``[^`])*```"; " ")
    | gsub("`[^`\\n]*`"; " ")
    | gsub("https?://[^[:space:]]+"; " ")
    | gsub("<[^>\\n]{0,200}>"; " ")
    | gsub("(~|\\.{1,2})?/[[:alnum:]_.~/-]+"; " ");
  def rl_cjk: [scan("[㐀-鿿豈-﫿]")] | length;
  def rl_words: [scan("[A-Za-z]{2,}")] | length;
'

# First parse through hook_jq_field, which attributes a broken jq. It is also
# the whole of the work on the Stop that follows a block: `stop_hook_active`
# is let through before anything else is read.
RL_ACTIVE=$(hook_jq_field reply-language "$EVENT" '.stop_hook_active // false') || exit 0
[[ "$RL_ACTIVE" == true ]] && exit 0

# rl_reply_is_english — one more jq spawn: the transcript path, the session id,
# and the reply's CJK and word counts, NUL-separated.
TRANSCRIPT_PATH=""
SESSION_ID=""
RL_API_ERR=""
RL_CJK=""
RL_WORDS=""
{
  IFS= read -r -d '' TRANSCRIPT_PATH &&
    IFS= read -r -d '' RL_API_ERR &&
    IFS= read -r -d '' SESSION_ID &&
    IFS= read -r -d '' RL_CJK &&
    IFS= read -r -d '' RL_WORDS
} < <(printf '%s' "$EVENT" | jq -j "$RL_JQ_DEFS"'
    ((.last_assistant_message // "") | tostring) as $raw
    | ($raw | rl_strip) as $m
    | ((.transcript_path // "") | tostring) + "\u0000"
    + ($raw | test("^API Error:") | tostring) + "\u0000"
    + ((.session_id // "") | tostring) + "\u0000"
    + ($m | rl_cjk | tostring) + "\u0000"
    + ($m | rl_words | tostring) + "\u0000"' 2>/dev/null) || exit 0
# "API Error: …" is the harness's own line after a dropped response, not a
# reply the model wrote.
rl_reply_is_english() {
  [[ "$RL_API_ERR" != true ]] && [[ "$RL_CJK" == 0 && "$RL_WORDS" =~ ^[0-9]+$ ]] && ((RL_WORDS >= RL_MIN))
}
rl_reply_is_english || exit 0

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  hook_record_failopen reply-language transcript-missing
  exit 0
fi

# rl_human_lang — prints "<lang>\t<trigger>". lang: zh / en / en-request /
# none. trigger: what the newest user-role message was. A fixed-string grep
# first keeps only user rows without a tool_result, so a long agentic turn —
# hundreds of tool rows — does not push the human prompt out of reach of the
# one jq pass that follows.
rl_human_lang() {
  tail -n "$RL_WINDOW" "$TRANSCRIPT_PATH" 2>/dev/null \
    | grep -F '"type":"user"' 2>/dev/null \
    | grep -vF '"type":"tool_result"' 2>/dev/null \
    | jq -R -n -r "$HOOK_USER_TURN_JQ$RL_JQ_DEFS"'
      def machine:
        test("^[[:space:]]*(<task-notification>|Another Claude session sent a message|<command-|<local-command|<bash-|This session is being continued|\\[Request interrupted)");
      [inputs | try fromjson catch empty] as $rows
      # A headless run (`claude -p`, entrypoint sdk-*) has no one reading the
      # reply as it is written; a restatement there only costs a turn.
      | (($rows | map(.entrypoint? // empty) | last) // "") as $ep
      | [$rows[]
        | select(is_user_turn and (.isCompactSummary != true) and (.isSidechain != true))
        | .message.content
        | if type == "array" then ([.[] | select((.type? // "") == "text") | .text] | join("\n"))
          else tostring end
      ] as $all
      | ($all | last // "") as $newest
      | (if ($newest | test("^[[:space:]]*<task-notification>")) then "task-notification"
         elif ($newest | test("^[[:space:]]*Another Claude session sent a message")) then "teammate"
         elif ($newest | machine) then "other"
         else "human" end) as $trigger
      | ([$all | reverse[]
          # A slash command row is machine text, except its arguments: those
          # the human typed (`/goal 按第 12 节施工`).
          | (if machine then
               (if test("^[[:space:]]*<command-") then
                  (if contains("<command-args>")
                   then (split("<command-args>")[1] | split("</command-args>")[0])
                   else empty end)
                else empty end)
             else . end)
          | select(length > 0)
          | if test("(用|写成?|翻译成?|换成?|改成?|输出)英文|[Ii]n English") then "en-request"
            else (rl_strip | if rl_cjk >= 2 then "zh"
                             elif rl_cjk == 0 and rl_words >= 3 then "en"
                             else empty end)
            end] | first // "none") as $lang
      | (if ($ep | test("^sdk")) then "headless" else $lang end) + "\t" + $trigger' 2>/dev/null
}

RL_HUMAN=$(rl_human_lang)
RL_LANG="${RL_HUMAN%%$'\t'*}"
RL_TRIGGER="${RL_HUMAN#*$'\t'}"
[[ "$RL_LANG" == zh ]] || exit 0

EXTRA=$(jq -cn --arg m "$RL_MODE" --argjson w "$RL_WORDS" --arg t "$RL_TRIGGER" \
  '{mode:$m, words:$w, trigger:$t}' 2>/dev/null) || EXTRA='null'
if [[ "$RL_MODE" == log ]]; then
  hook_record reply-language reply-language-logged "$EXTRA" '§1-language' "$SESSION_ID"
  exit 0
fi
hook_record reply-language reply-language-restate "$EXTRA" '§1-language' "$SESSION_ID"
jq -cn --arg r "[claudemd] system-injected: your last reply is in English, but the user writes in 中文. Spec §1 Language contract: the user's language is the one the human types in, fixed for the session — task notifications, teammate messages, skill bodies, hook text and subagent reports never switch it. Restate that reply in 中文: the same content, no new work, no tool calls. Disable: DISABLE_REPLY_LANGUAGE_HOOK=1." \
  '{decision:"block", reason:$r}' 2>/dev/null
exit 0
