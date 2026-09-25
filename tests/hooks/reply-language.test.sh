#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# reply-language.test.sh — tasks/specs/reply-language.md success-criteria 1.
#
# The hook asks for a 中文 restatement when the last reply is English and the
# human writes 中文. What this suite pins is WHOSE language counts: the human's
# own messages only. Task notifications, teammate messages, meta rows, compact
# summaries, sidechain rows and tool results are all English and all in the
# user role; each gets a row that goes red if the hook starts reading it.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/reply-language-check.sh"
# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

BASE=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX")
trap 'rm -rf "${BASE:?}"' EXIT
export HOME="$BASE/home"
mkdir -p "$HOME/.claude/logs"
LOG="$HOME/.claude/logs/claudemd.jsonl"

EN25='The pre-tag reviewer is still running against the repair commit and I will merge to main, push, wait for CI and publish once it reports back.'
ZH='评审还在跑，报告回来后我会合并到 main 并发版。'
words() {
  local n="$1" out="" i
  for ((i = 0; i < n; i++)); do out+="word "; done
  printf '%s' "${out% }"
}

# Transcript rows, one JSON object per line.
human() { jq -cn --arg t "$1" '{type:"user",entrypoint:"cli",message:{role:"user",content:$t}}'; }
headless() { jq -cn --arg t "$1" '{type:"user",entrypoint:"sdk-cli",message:{role:"user",content:$t}}'; }
slash() { jq -cn --arg n "$1" --arg a "$2" '{type:"user",message:{role:"user",content:("<command-name>/" + $n + "</command-name>\n<command-message>" + $n + "</command-message>\n<command-args>" + $a + "</command-args>")}}'; }
human_arr() { jq -cn --arg t "$1" '{type:"user",message:{role:"user",content:[{type:"text",text:$t}]}}'; }
meta() { jq -cn --arg t "$1" '{type:"user",isMeta:true,message:{role:"user",content:$t}}'; }
compact() { jq -cn --arg t "$1" '{type:"user",isCompactSummary:true,message:{role:"user",content:$t}}'; }
side() { jq -cn --arg t "$1" '{type:"user",isSidechain:true,message:{role:"user",content:$t}}'; }
# A tool_result row carrying a text block beside the result, so the row has
# readable English in it and only the tool_result exclusion keeps it out. The
# grep prefilter and the jq check both exclude it; each alone is enough.
result() { jq -cn --arg t "$1" '{type:"user",message:{role:"user",content:[{type:"tool_result",tool_use_id:"t1",content:$t},{type:"text",text:$t}]}}'; }
said() { jq -cn --arg t "$1" '{type:"assistant",message:{role:"assistant",content:[{type:"text",text:$t}]}}'; }
NOTIF='<task-notification> <task-id>a1</task-id> <status>completed</status> <summary>Agent "Pre-merge review" finished</summary> <result>Verdict: merge. No findings.</result> </task-notification>'
MATE='Another Claude session sent a message: <teammate-message>The branch you asked about is merged and deleted on the remote side now.</teammate-message>'

N=0
# tx ROW... — write a transcript from rows given as already-built JSON lines.
tx() {
  N=$((N + 1))
  TX="$BASE/t$N.jsonl"
  printf '%s\n' "$@" > "$TX"
}
# stop MSG [ACTIVE] — a Stop event over the current $TX.
stop() {
  jq -cn --arg p "$TX" --arg m "$1" --argjson a "${2:-false}" --arg s "sid$N" \
    '{hook_event_name:"Stop",session_id:$s,transcript_path:$p,stop_hook_active:$a,last_assistant_message:$m}'
}
run() { printf '%s' "$1" | REPLY_LANGUAGE_CHECK="${MODE:-1}" bash "$HOOK" 2>/dev/null; }
decision() { printf '%s' "$1" | jq -r '.decision // ""' 2>/dev/null; }
reason() { printf '%s' "$1" | jq -r '.reason // ""' 2>/dev/null; }
row_of() {
  [[ -f "$LOG" ]] || return 0
  jq -r --arg s "sid$1" 'select(.hook=="reply-language" and .session_id==$s) | "\(.event) \(.extra.trigger // "")"' "$LOG" 2>/dev/null
}
expect_block() {
  if [[ "$(decision "$2")" == block ]]; then ok "$1"; else ng "$1 (expected a block, got: ${2:-<silent>})"; fi
}
expect_silent() {
  if [[ -z "$2" ]]; then ok "$1"; else ng "$1 (expected silent, got: $2)"; fi
}

# --- L0: default OFF, and free ---------------------------------------------------
SHIM="$BASE/shim"
mkdir -p "$SHIM"
printf '#!/usr/bin/env bash\necho x >> "%s/jq.count"\nexec "%s" "$@"\n' "$BASE" "$(command -v jq)" > "$SHIM/jq"
chmod +x "$SHIM/jq"
tx "$(human "$ZH")"
EV=$(stop "$EN25")
OUT=$(printf '%s' "$EV" | PATH="$SHIM:$PATH" bash "$HOOK" 2>/dev/null)
if [[ -z "$OUT" && ! -f "$BASE/jq.count" && ! -f "$LOG" ]]; then
  ok "L0 default OFF: silent, no jq, no row"
else
  ng "L0 default OFF (out: ${OUT:-<none>}, jq spawned: $([[ -f "$BASE/jq.count" ]] && echo yes || echo no))"
fi
OUT=$(printf '%s' "$EV" | REPLY_LANGUAGE_CHECK=yes bash "$HOOK" 2>/dev/null)
expect_silent "L0b an unknown mode value is OFF" "$OUT"

# --- L1: the positive case, and what the reason carries --------------------------
tx "$(human "$ZH")" "$(said "$ZH")"
OUT=$(run "$(stop "$EN25")")
expect_block "L1 English reply after a 中文 human prompt is blocked once" "$OUT"
R=$(reason "$OUT")
for want in '§1' '中文' 'same content' 'no tool calls' 'DISABLE_REPLY_LANGUAGE_HOOK=1' 'task notifications'; do
  assert_contains "L1 reason carries: $want" "$want" "$R"
done
assert_eq "L1 exactly one JSON object on stdout" 1 "$(printf '%s\n' "$OUT" | grep -c .)"
assert_eq "L1 row: restate, triggered by the human" "reply-language-restate human" "$(row_of "$N")"

MODE=log
tx "$(human "$ZH")"
OUT=$(run "$(stop "$EN25")")
unset MODE
expect_silent "L2 log mode prints nothing" "$OUT"
assert_eq "L2 log mode still records the row" "reply-language-logged human" "$(row_of "$N")"

tx "$(human "$ZH")"
expect_silent "L3 stop_hook_active: the restatement turn is let through" "$(run "$(stop "$EN25" true)")"

# --- L4-L6: the reply classifier -------------------------------------------------
tx "$(human "$ZH")"
expect_silent "L4 one CJK character makes the reply not-English" "$(run "$(stop "$EN25 好")")"
tx "$(human "$ZH")"
expect_silent "L5a 9 English words stay under the default threshold" "$(run "$(stop "$(words 9)")")"
tx "$(human "$ZH")"
expect_block "L5b 10 English words reach it" "$(run "$(stop "$(words 10)")")"
tx "$(human "$ZH")"
OUT=$(printf '%s' "$(stop "$EN25")" | REPLY_LANGUAGE_CHECK=1 REPLY_LANGUAGE_MIN_WORDS=40 bash "$HOOK" 2>/dev/null)
expect_silent "L5c REPLY_LANGUAGE_MIN_WORDS raises the threshold" "$OUT"
tx "$(human "$ZH")"
expect_silent "L5d the harness's own 'API Error:' line is not a reply" \
  "$(run "$(stop 'API Error: Connection lost mid-response. The response above may be incomplete and was cut.')")"
tx "$(human "$ZH")"
expect_silent "L6a English inside a fenced code block does not count" \
  "$(run "$(stop "$(printf '```\n%s\n```' "$(words 30)")")")"
tx "$(human "$ZH")"
expect_silent "L6b nor inside inline backticks" "$(run "$(stop "\`$(words 30)\`")")"

# --- L7-L14: whose language counts --------------------------------------------------
# The human's language is the majority of their classifiable messages, so a row
# that must NOT count is written twice after one 中文 message: read as the
# human's, it would outvote the 中文 one and silence the hook.
tx "$(human "$ZH")" "$(human 'please restate the plan for the release in plain words')" "$(human 'and keep it short, the reviewer reads English')"
expect_silent "L7 most of the human's messages are English: nothing to correct" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(human 'TypeError: Cannot read properties of undefined (reading map) at render')"
expect_block "L7b one pasted English log does not flip a 中文 session (a tie stays 中文)" "$(run "$(stop "$EN25")")"

tx "$(human "$ZH")" "$(said "$ZH")" "$(human "$NOTIF")" "$(human "$NOTIF")"
OUT=$(run "$(stop "$EN25")")
expect_block "L8a a task-notification does not switch the language" "$OUT"
assert_eq "L8a row names the trigger" "reply-language-restate task-notification" "$(row_of "$N")"
tx "$(human "$ZH")" "$(human "$MATE")" "$(human "$MATE")"
OUT=$(run "$(stop "$EN25")")
expect_block "L8b a teammate message does not switch it" "$OUT"
assert_eq "L8b row names the trigger" "reply-language-restate teammate" "$(row_of "$N")"

tx "$(human "$ZH")" "$(human '1')"
expect_block "L9a an unclassifiable latest message ('1') defers to the one before" "$(run "$(stop "$EN25")")"
tx "$(human '1')"
expect_silent "L9b nothing classifiable at all: silent" "$(run "$(stop "$EN25")")"

tx "$(human "$ZH")" "$(human '后面都用英文回复')"
expect_silent "L10a the human asked for English" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(human '下面这段 reply in English 就行')"
expect_silent "L10b the 'in English' form, inside a 中文 message" "$(run "$(stop "$EN25")")"
tx "$(human '后面都用英文回复')" "$(said "$EN25")" "$(human '继续')"
expect_silent "L10c an English directive holds past a later plain 中文 message" "$(run "$(stop "$EN25")")"
tx "$(human '后面都用英文回复')" "$(said "$EN25")" "$(human '还是用中文回复吧')"
expect_block "L10d a later 中文 directive ends it" "$(run "$(stop "$EN25")")"
LONG="$(printf '请按下面的清单继续：%.0s' {1..10}) 修完之后更新 CHANGELOG 和 commit message，再跑一遍测试，最后汇报结果。$(printf '每一步都要有命令输出作为证据，不要跳步。%.0s' {1..12})"
tx "$(human "$LONG")"
expect_block "L10i a long brief that mentions a commit message is not an artifact request" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")"
expect_silent "L10h a reply shaped as a conventional commit is not judged" \
  "$(run "$(stop "$(printf 'fix(hooks): stop the scan before the transcript tail grows past the window\n\nBody text explaining the change.')")")"
# The request forms a reviewer found missed (each must let the reply through).
REQ_OK=0
for m in '用英语回复' '后面都用英语写' 'answer in english please 谢谢' '翻译成英语' '把这段翻译为英文' \
  '写一段英文的 commit message' '给我英文版' 'translate this into English 吧' '英文回复就行'; do
  tx "$(human "$ZH")" "$(human "$m")"
  [[ -z "$(run "$(stop "$EN25")")" ]] && REQ_OK=$((REQ_OK + 1)) || echo "  L10e blocked after: $m"
done
assert_eq "L10e nine ways of asking for English all let the reply through" 9 "$REQ_OK"
# Complaints and negations are not requests; nor is saying which FILES are English.
NEG_OK=0
for m in '为什么用英文回复我？' '不要用英文' '别再用英文了，中文输出' '你怎么又用英文了' \
  '编程的回复应该用中文、编写的docs目录项目文档用中文。其它的编程的思考和代码文件、注释、项目相关文件用英文'; do
  tx "$(human "$ZH")" "$(human "$m")"
  [[ "$(decision "$(run "$(stop "$EN25")")")" == block ]] && NEG_OK=$((NEG_OK + 1)) || echo "  L10f silent after: $m"
done
assert_eq "L10f complaints, negations and a file-language remark are not English requests" 5 "$NEG_OK"
tx "$(human '帮我写个 commit message')"
expect_silent "L10g a commit message the human asked for is let through" \
  "$(run "$(stop "$(printf 'feat(0.96.0): opt-in reply-language-check Stop hook\n\nAdds an opt-in Stop hook that asks for a restatement when the reply is English.')")")"

M1='Caveat: the messages below were generated by the user while running local commands.'
tx "$(human "$ZH")" "$(meta "$M1")" "$(meta "$M1")"
expect_block "L11 an isMeta row is not the human" "$(run "$(stop "$EN25")")"
M1='This session is a summary of a previous conversation that ran out of context and is long.'
tx "$(human "$ZH")" "$(compact "$M1")" "$(compact "$M1")"
expect_block "L12 a compact summary is not the human" "$(run "$(stop "$EN25")")"
M1='Review the commit range and report findings with file and line numbers please.'
tx "$(human "$ZH")" "$(side "$M1")" "$(side "$M1")"
expect_block "L13 a sidechain row is not the human" "$(run "$(stop "$EN25")")"
M1='Tests: 43/43 passed. All suites are green and nothing was written to stderr at all.'
tx "$(human "$ZH")" "$(result "$M1")" "$(result "$M1")"
expect_block "L14a a tool_result is not the human" "$(run "$(stop "$EN25")")"
tx "$(human_arr "$ZH")"
expect_block "L14b a human prompt in array form is read" "$(run "$(stop "$EN25")")"

# --- L19-L20: slash-command arguments; headless runs ----------------------------------
tx "$(slash goal '按第 12 节施工，直到全部完成')" "$(human "$NOTIF")"
expect_block "L19a a slash command's arguments are the human's words" "$(run "$(stop "$EN25")")"
tx "$(slash polish '')" "$(human "$NOTIF")"
expect_silent "L19b a slash command without arguments says nothing about the language" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(slash polish 'run the full polish pass over the scheduler scripts')" "$(slash polish 'then run it again on the driver scripts')"
expect_silent "L19c English command arguments count as the human writing English" "$(run "$(stop "$EN25")")"
tx "$(headless "$ZH")" "$(headless "$NOTIF")"
expect_silent "L20a a headless run (entrypoint sdk-*) is not restated" "$(run "$(stop "$EN25")")"
tx "$(headless "$ZH")" "$(human "$NOTIF")"
expect_block "L20b the newest row's entrypoint decides (interactive)" "$(run "$(stop "$EN25")")"

# --- L21: what the classifiers strip, and the human thresholds -------------------------
tx "$(human "$ZH")"
expect_silent "L21a a URL's words do not count" \
  "$(run "$(stop "Done: https://example.com/search?q=many+english+words+here+and+more+words+in+the+query")")"
tx "$(human "$ZH")"
expect_silent "L21b a tag's words do not count" "$(run "$(stop "Done <task-notification with many english words inside the tag here>")")"
tx "$(human "$ZH")"
expect_silent "L21c a path's words do not count" "$(run "$(stop "Done: ./tests/hooks/the-long-english/path/with/many/words/in/it.sh")")"
tx "$(human "$ZH")"
expect_silent "L21d a path next to 中文 does not strip the 中文" \
  "$(run "$(stop "English text about this change, see /用中文回复吧 okay then and more words")")"
tx "$(human "$ZH")" "$(human 'https://github.com/owner/repo/pull/12/files')"
expect_block "L21e a human message that is only a URL is not English" "$(run "$(stop "$EN25")")"
tx "$(human 'fix the flaky test in the scheduler')" "$(human '好')"
expect_silent "L21f one CJK character does not make a message 中文" "$(run "$(stop "$EN25")")"
tx "$(human 'fix the flaky test in the scheduler')" "$(human '继续')" "$(human '好的继续')"
expect_block "L21g two CJK characters do" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(human 'ok go')" "$(human 'ok go')"
expect_block "L21h two English words are not a message in English" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(human 'ok go now')" "$(human 'ship it now')"
expect_silent "L21i three are" "$(run "$(stop "$EN25")")"
tx "$(human 'Please review the whole branch and report back, 谢谢')"
expect_silent "L21j two CJK characters inside an English sentence do not make it 中文" "$(run "$(stop "$EN25")")"
tx "$(human '確認してください、テストは全部通りましたか？')"
expect_silent "L21k Japanese is not 中文" "$(run "$(stop "$EN25")")"
MACH_OK=0
for m in '<local-command-stdout>Set model to Opus and saved as your default for new sessions</local-command-stdout>' \
  '<bash-stdout>all tests passed and nothing was written to stderr</bash-stdout>' \
  'This session is being continued from a previous conversation that ran out of context.' \
  '[Request interrupted by user for tool use]'; do
  tx "$(human "$ZH")" "$(human "$m")" "$(human "$m")"
  [[ "$(decision "$(run "$(stop "$EN25")")")" == block ]] && MACH_OK=$((MACH_OK + 1)) || echo "  L21l read as human: ${m:0:40}"
done
assert_eq "L21l local-command, bash, continuation and interruption rows are not the human" 4 "$MACH_OK"
tx "$(human "$ZH")" "$(human '<bash-stdout>all tests passed and nothing was written to stderr</bash-stdout>')"
run "$(stop "$EN25")" >/dev/null
assert_eq "L21m a machine row that is none of the named kinds is trigger 'other'" "reply-language-restate other" "$(row_of "$N")"
W=$(jq -r --arg s "sid$N" 'select(.hook=="reply-language" and .session_id==$s) | .extra.words' "$LOG" 2>/dev/null)
assert_eq "L21n the row records the reply's word count" 26 "$W"

# --- L22: rows that are not user rows, or not the human's -------------------------------
queued() { jq -cn --arg t "$1" --arg k "$2" '{type:"attachment",attachment:{type:"queued_command",prompt:$t,origin:{kind:$k}}}'; }
tx "$(human "$ZH")" "$(queued '后面都用英文回复' human)"
expect_silent "L22a a message typed mid-turn (queued_command) is the human's" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(queued 'please answer in English from now on' peer)"
expect_block "L22b a queued message from a peer is not" "$(run "$(stop "$EN25")")"
tx "$(human "$ZH")" "$(jq -cn '{type:"user",origin:{kind:"task-notification"},message:{role:"user",content:"Agent finished: all checks pass and the review is complete now."}}')"
expect_block "L22c a row whose origin.kind is not human is not the human's, whatever its text" "$(run "$(stop "$EN25")")"

# --- L23: cost and odd inputs -----------------------------------------------------------
PASTE=$(awk 'BEGIN { printf "这是测试输出："; for (i = 0; i < 6000; i++) printf "PASS `tests/hooks/case-%d.test.sh` ok\n", i }')
# Built through stdin: a 200 KB --arg is over the kernel's per-argument limit.
tx "$(human "$ZH")" "$(printf '%s' "$PASTE" | jq -Rsc '{type:"user",entrypoint:"cli",message:{role:"user",content:.}}')"
assert_eq "L23a (fixture) the paste row is in the transcript" 1 "$(grep -c 'case-5999' "$TX")"
T0=$SECONDS
OUT=$(awk 'BEGIN { for (i = 0; i < 3000; i++) printf "see `a%d` in hooks/x%d.sh ", i, i }' \
  | jq -Rsc --arg p "$TX" '{hook_event_name:"Stop",session_id:"big",transcript_path:$p,stop_hook_active:false,last_assistant_message:.}' \
  | REPLY_LANGUAGE_CHECK=1 bash "$HOOK" 2>/dev/null)
assert_eq "L23a a 200 KB paste and a reply of 3,000 code spans finish inside 2 s" 1 "$((SECONDS - T0 <= 2 ? 1 : 0))"
tx "$(human "$ZH")"
ERR=$(printf '%s' "$(stop "$(words 12)")" | REPLY_LANGUAGE_CHECK=1 REPLY_LANGUAGE_MIN_WORDS=08 bash "$HOOK" 2>&1 >/dev/null)
assert_eq "L23b a malformed threshold falls back without an error" "" "$ERR"
tx "$(human "$ZH")"
expect_silent "L23c REPLY_LANGUAGE_MIN_WORDS=0 is not 'every reply'" \
  "$(printf '%s' "$(stop "")" | REPLY_LANGUAGE_CHECK=1 REPLY_LANGUAGE_MIN_WORDS=0 bash "$HOOK" 2>/dev/null)"
N=$((N + 1))
TX="$BASE/t$N.jsonl"
{ human "$ZH"; printf '{"type":"assistant","message":{"content":[{"type":"text","text":"a\u0000b"}]}}\n'; printf 'junk\000junk\n'; } > "$TX"
expect_block "L23d a NUL byte in the transcript does not blind the scan" "$(run "$(stop "$EN25")")"

# --- L15: the window ------------------------------------------------------------------
ROWS=("$(human "$ZH")")
for ((i = 0; i < 12; i++)); do ROWS+=("$(said "step $i")"); done
tx "${ROWS[@]}"
OUT=$(printf '%s' "$(stop "$EN25")" | REPLY_LANGUAGE_CHECK=1 REPLY_LANGUAGE_WINDOW=5 bash "$HOOK" 2>/dev/null)
expect_silent "L15a a human prompt outside the window is not guessed at" "$OUT"
expect_block "L15b the default window reaches it" "$(run "$(stop "$EN25")")"

# --- L16-L18: fail-open and switches ------------------------------------------------------
N=$((N + 1))
TX="$BASE/missing.jsonl"
OUT=$(run "$(stop "$EN25")")
expect_silent "L16 transcript missing: silent" "$OUT"
FO=$(jq -r 'select(.hook=="reply-language" and .event=="fail-open") | .extra.reason' "$LOG" 2>/dev/null | tail -1)
assert_eq "L16 and recorded as fail-open" transcript-missing "$FO"
OUT=$(printf 'not json' | REPLY_LANGUAGE_CHECK=1 bash "$HOOK" 2>&1)
RC=$?
if [[ -z "$OUT" && $RC -eq 0 ]]; then ok "L17 malformed event: exit 0, silent"; else ng "L17 (rc $RC, out: $OUT)"; fi
FO=$(jq -r 'select(.hook=="reply-language" and .event=="fail-open") | .extra.reason' "$LOG" 2>/dev/null | tail -1)
assert_eq "L17 and recorded as bad-event" bad-event "$FO"
# jq absent: PATH holds only a dir without jq (bash is invoked by absolute path).
NOJQ="$BASE/nojq"
mkdir -p "$NOJQ"
for t in cat grep tail tr sed awk mkdir date head wc dirname basename mv rm; do
  command -v "$t" >/dev/null 2>&1 && ln -sf "$(command -v "$t")" "$NOJQ/$t"
done
tx "$(human "$ZH")"
EV=$(stop "$EN25")
OUT=$(printf '%s' "$EV" | PATH="$NOJQ" REPLY_LANGUAGE_CHECK=1 "$(command -v bash)" "$HOOK" 2>/dev/null)
expect_silent "L17b jq missing: silent" "$OUT"
FO=$(grep -F '"reply-language"' "$LOG" | grep -F 'jq-missing' | tail -1)
assert_contains "L17b and recorded as jq-missing" "jq-missing" "$FO"
tx "$(human "$ZH")"
EV=$(stop "$EN25")
expect_silent "L18a DISABLE_REPLY_LANGUAGE_HOOK=1" \
  "$(printf '%s' "$EV" | REPLY_LANGUAGE_CHECK=1 DISABLE_REPLY_LANGUAGE_HOOK=1 bash "$HOOK" 2>/dev/null)"
expect_silent "L18b DISABLE_CLAUDEMD_HOOKS=1" \
  "$(printf '%s' "$EV" | REPLY_LANGUAGE_CHECK=1 DISABLE_CLAUDEMD_HOOKS=1 bash "$HOOK" 2>/dev/null)"
ERR=$(printf '%s' "$EV" | REPLY_LANGUAGE_CHECK=1 bash "$HOOK" 2>&1 >/dev/null)
assert_eq "L18c nothing on stderr on the block path" "" "$ERR"

echo
claudemd_assert_summary
