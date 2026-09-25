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
#     nor the harness's own `API Error:` line, nor a reply whose first line is
#     a conventional-commit subject (a commit message is English by §1).
#   - the human: see rl_human_lang below — the human's own messages only, a
#     reply-language directive first, then a request for an English artifact,
#     then the majority language of the newest 20.
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

# Positive decimal integers only: `08` would be an arithmetic error, `010`
# octal, and `0` would judge an empty reply English.
RL_MIN="${REPLY_LANGUAGE_MIN_WORDS:-10}"
[[ "$RL_MIN" =~ ^[1-9][0-9]*$ ]] || RL_MIN=10
RL_WINDOW="${REPLY_LANGUAGE_WINDOW:-3000}"
[[ "$RL_WINDOW" =~ ^[1-9][0-9]*$ ]] || RL_WINDOW=3000

# The text a language is judged on: code, URLs, paths and tags removed — an
# English identifier inside a 中文 sentence is still a 中文 sentence, and a
# fenced block of English is code, not the reply's language. Every text is
# cut to its first 4000 characters first: jq's gsub is quadratic in its match
# count, and the opening of a message says what language it is in.
# No \s \w \S (hook sources use POSIX classes); the path class is spelled out
# in ASCII because Oniguruma's [[:alnum:]] also matches CJK. A fence is three
# backticks, a run holding no three in a row, and three more.
RL_JQ_DEFS='
  def rl_strip:
    .[0:4000]
    | gsub("```([^`]|`[^`]|``[^`])*```"; " ")
    | gsub("`[^`\\n]*`"; " ")
    | gsub("https?://[^[:space:]]+"; " ")
    | gsub("<[^>\\n]{0,200}>"; " ")
    | gsub("(~|\\.{1,2})?/[A-Za-z0-9_.~/-]+"; " ");
  def rl_cjk: [scan("[㐀-鿿豈-﫿]")] | length;
  def rl_kana: test("[ぁ-ヿ]");
  def rl_words: [scan("[A-Za-z]{2,}")] | length;
'

# First parse through hook_jq_field, which attributes a broken jq. It is also
# the whole of the work on the Stop that follows a block: `stop_hook_active`
# is let through before anything else is read.
RL_ACTIVE=$(hook_jq_field reply-language "$EVENT" '.stop_hook_active // false') || exit 0
[[ "$RL_ACTIVE" == true ]] && exit 0

# rl_reply_is_english — one more jq spawn: the transcript path, the session id,
# whether the reply is one the hook never judges, and its CJK and word counts,
# NUL-separated. Never judged: the harness's own "API Error: …" line after a
# dropped response, and a conventional-commit subject as the first line — a
# commit message the human asked for, which §1 names English.
TRANSCRIPT_PATH=""
SESSION_ID=""
RL_SKIP=""
RL_CJK=""
RL_WORDS=""
{
  IFS= read -r -d '' TRANSCRIPT_PATH &&
    IFS= read -r -d '' RL_SKIP &&
    IFS= read -r -d '' SESSION_ID &&
    IFS= read -r -d '' RL_CJK &&
    IFS= read -r -d '' RL_WORDS
} < <(printf '%s' "$EVENT" | jq -j "$RL_JQ_DEFS"'
    ((.last_assistant_message // "") | tostring) as $raw
    | ($raw | rl_strip) as $m
    | ((.transcript_path // "") | tostring) + "\u0000"
    + ($raw | test("^API Error:|^(feat|fix|docs|chore|refactor|test|perf|ci|build|revert|style|change)(\\([^)\\n]*\\))?!?: ") | tostring) + "\u0000"
    + ((.session_id // "") | tostring) + "\u0000"
    + ($m | rl_cjk | tostring) + "\u0000"
    + ($m | rl_words | tostring) + "\u0000"' 2>/dev/null) || exit 0
rl_reply_is_english() {
  [[ "$RL_SKIP" != true ]] && [[ "$RL_CJK" == 0 && "$RL_WORDS" =~ ^[0-9]+$ ]] && ((RL_WORDS >= RL_MIN))
}
rl_reply_is_english || exit 0

if [[ -z "$TRANSCRIPT_PATH" || ! -f "$TRANSCRIPT_PATH" ]]; then
  hook_record_failopen reply-language transcript-missing
  exit 0
fi

# rl_human_lang — prints "<verdict>\t<trigger>".
#   verdict: zh | en | none | en-request | artifact | headless
#   trigger: human | task-notification | teammate | other — the newest
#            user-role message, i.e. what started this turn.
# A fixed-string grep keeps only user rows without a tool_result, plus the
# `queued_command` attachments a message typed mid-turn is written as, so a
# long agentic turn does not push the human prompt out of the one jq pass.
# `-a`: a stray NUL must not turn grep's output into "Binary file matches".
#
# Whose words count: user rows that are real turns (is_user_turn), not compact
# summaries or sidechain rows, whose `origin.kind` (when the row carries one)
# is `human`, and that do not open with a machine prefix — except a slash
# command's `<command-args>`, which the human typed. Of the newest 20 of
# those:
#   - the newest reply-language DIRECTIVE decides first — "后面都用英文回复" /
#     "reply in English" (en-request), "用中文回复" / "中文输出" (zh). It holds
#     until another directive, so "继续" after it does not end it. A directive
#     phrase under a negation or a complaint ("不要用英文", "为什么用英文") is
#     not one.
#   - else, when the NEWEST human message is short (<=300 characters) and asks
#     for an English artifact (a commit message, PR text, release notes, a
#     translation, "英文版"), this reply is let through (artifact).
#   - else the majority of the classifiable messages: >=2 CJK and at least
#     half as many CJK characters as English words is 中文; no CJK and >=3
#     words is English; kana makes a message neither. A pasted English log
#     among 中文 messages does not flip the session's language.
rl_human_lang() {
  tail -n "$RL_WINDOW" "$TRANSCRIPT_PATH" 2>/dev/null \
    | grep -aE '"type":"user"|"type":"queued_command"' 2>/dev/null \
    | grep -avF '"type":"tool_result"' 2>/dev/null \
    | jq -R -n -r "$HOOK_USER_TURN_JQ$RL_JQ_DEFS"'
      def machine:
        test("^[[:space:]]*(<task-notification>|Another Claude session sent a message|<command-|<local-command|<bash-|This session is being continued|\\[Request interrupted)");
      def rl_neg:
        gsub("(不要|别再?|不用|不必|不许|禁止|为什么|为何|怎么|干嘛|又)[^，。！？,.!?\\n]{0,8}(英文|英语|[Ee]nglish)"; " ");
      def rl_directive:
        (.[0:4000] | rl_neg) as $t
        | if ($t | test("(中文|汉语)(来)?(回复|回答|输出|交流|沟通|对话)|(回复|回答|输出|交流|沟通)(都|全部|请|就)?(用|以)?(中文|汉语)|说中文")) then "zh"
          elif ($t | test("(用|以|改用|换成|改成|切换到|切到)(英文|英语)(来)?(回复|回答|输出|交流|沟通|对话|说|写)|(回复|回答|输出|交流|沟通)(都|全部|请|就)?(用|以)?(英文|英语)|(英文|英语)(回复|回答|输出)|(reply|respond|answer|talk|speak|write)[^.\\n]{0,24}in english|(switch|stick) to english|english only"; "i")) then "en"
          else empty end;
      # Short messages only: a request for an artifact is a sentence, and a
      # long pasted brief that merely mentions a commit message is not one.
      def rl_artifact:
        (rl_strip | length) <= 300
        and ((.[0:4000] | rl_neg)
             | test("commit message|提交信息|commit 信息|pr ?(描述|说明|正文|body|description)|release notes|翻译(成|为)?(英文|英语)|(英文|英语)版|(英文|英语)的|into english|translate"; "i"));
      def rl_class:
        rl_strip as $t | ($t | rl_cjk) as $c | ($t | rl_words) as $w
        | if ($t | rl_kana) then empty
          elif $c >= 2 and $c * 2 >= $w then "zh"
          elif $c == 0 and $w >= 3 then "en"
          else empty end;
      [inputs | try fromjson catch empty] as $rows
      # A headless run (`claude -p`, entrypoint sdk-*) has no one reading the
      # reply as it is written; a restatement there only costs a turn.
      | (($rows | map(.entrypoint? // empty) | last) // "") as $ep
      | [$rows[]
        | if .type == "attachment" then
            select((.attachment.type? // "") == "queued_command")
            | {t: (.attachment.prompt | if type == "string" then . else tostring end),
               k: (.attachment.origin.kind? // "human")}
          else
            select(is_user_turn and (.isCompactSummary != true) and (.isSidechain != true))
            | {k: (.origin.kind? // .message.origin.kind? // "human"),
               t: (.message.content
                   | if type == "array" then ([.[] | select((.type? // "") == "text") | .text] | join("\n"))
                     else tostring end)}
          end
      ] as $all
      | ($all | last // {t: "", k: "human"}) as $newest
      | (if ($newest.t | test("^[[:space:]]*<task-notification>")) or $newest.k == "task-notification" then "task-notification"
         elif ($newest.t | test("^[[:space:]]*Another Claude session sent a message")) or $newest.k == "peer" then "teammate"
         elif ($newest.t | machine) or $newest.k != "human" then "other"
         else "human" end) as $trigger
      | [$all[]
          | select(.k == "human")
          | .t
          # A slash command row is machine text, except its arguments.
          | (if machine then
               (if test("^[[:space:]]*<command-") and contains("<command-args>")
                then (split("<command-args>")[1] | split("</command-args>")[0])
                else empty end)
             else . end)
          | select(length > 0)
        ][-20:] as $human
      | (first($human | reverse[] | rl_directive) // "") as $dir
      | ([$human[] | rl_class]) as $cls
      | ([$cls[] | select(. == "zh")] | length) as $zh
      | ([$cls[] | select(. == "en")] | length) as $en
      | (if ($ep | test("^sdk")) then "headless"
         elif $dir == "en" then "en-request"
         elif (($human | last // "") | rl_artifact) then "artifact"
         elif $dir == "zh" then "zh"
         elif $zh == 0 and $en == 0 then "none"
         elif $zh >= $en then "zh"
         else "en" end) + "\t" + $trigger' 2>/dev/null
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
