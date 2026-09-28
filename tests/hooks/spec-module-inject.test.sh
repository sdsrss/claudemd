#!/usr/bin/env bash
# spec-module-inject.test.sh — tier-2 spec-module injection (core §2.2;
# tasks/specs/spec-modules.md). Runs against the repo's built modules installed
# into a sandbox HOME, so the triggers under test are the shipped ones.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
HOOK="$REPO/hooks/spec-module-inject.sh"
SSHOOK="$REPO/hooks/session-start-check.sh"
TMP_HOME=$(mktemp -d -t claudemd-modinj-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/spec-modules" "$HOME/.claude/logs"
cp "$REPO"/spec/spec-modules/*.md "$HOME/.claude/spec-modules/"
LOG="$HOME/.claude/logs/claudemd.jsonl"

# shellcheck source=tests/lib/assert.sh
source "$HERE/../lib/assert.sh"

inject() { # PROMPT SESSION -> additionalContext ("" when silent)
  jq -cn --arg p "$1" --arg s "$2" '{prompt:$p, session_id:$s, cwd:"/work/p", hook_event_name:"UserPromptSubmit"}' \
    | bash "$HOOK" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null
}
mods() { grep -oE '<spec-module name="[a-z-]+">' <<<"$1" | sed -E 's/.*name="([a-z-]+)".*/\1/' | tr '\n' ' '; }

# 1. a release prompt injects ship, wrapped, with the module's own rules.
C1=$(inject 'Please ship v1.2.3 to npm today' s1)
if [[ "$(mods "$C1")" == "ship " ]] && grep -q '^</spec-module>$' <<<"$C1" && grep -q 'Ship-pipeline hardening' <<<"$C1" \
   && ! grep -q '^trigger-window:' <<<"$C1"; then
  ok "1 a release prompt injects ship.md's body, wrapped, without its frontmatter"
else ng "1 ship injection wrong: $(mods "$C1") / ${C1:0:200}"; fi

# 2. once per session.
C2=$(inject 'ship it again' s1)
[[ -z "$C2" ]] && ok "2 the same module is not injected twice in one session" || ng "2 re-injected: $(mods "$C2")"

# 3. an unrelated prompt injects nothing (control for 1).
C3=$(inject 'hello, what does this function return?' s3)
[[ -z "$C3" ]] && ok "3 an unrelated prompt injects nothing" || ng "3 unexpected: $(mods "$C3")"

# 4. head window: a debug word in the first 300 characters counts, past them it does not.
C4=$(inject 'fix the bug in parser.js please' s4)
LONG=$(printf 'x%.0s' $(seq 1 320))
C4B=$(inject "${LONG} fix the bug in parser.js" s4b)
if [[ "$(mods "$C4")" == "debug " && -z "$C4B" ]]; then
  ok "4 head-window modules match only the prompt's first 300 characters"
else ng "4 head window wrong: early=$(mods "$C4") late=$(mods "$C4B")"; fi

# 5. whole window: ship matches past 300 characters.
C5=$(inject "${LONG} and then ship it" s5)
[[ "$(mods "$C5")" == "ship " ]] && ok "5 ship reads the whole prompt" || ng "5 ship missed past 300 chars: $(mods "$C5")"

# 6. at most two per prompt, ship first.
C6=$(inject 'fix the bug, refactor the parser, then ship it' s6)
M6=$(mods "$C6")
if [[ "$M6" == "ship "* ]] && [[ $(wc -w <<<"$M6") -eq 2 ]]; then
  ok "6 at most two modules per prompt, ship first ($M6)"
else ng "6 cap/order wrong: $M6"; fi

# 7. a module without triggers is never injected by prompt.
C7=$(inject 'verify the tests and check the evidence ladder for this change' s7)
grep -q 'name="verify"' <<<"$C7" && ng "7 verify (no triggers) was injected" || ok "7 a module with no triggers is reached through the index only"

# 8. kill switch and machine-sent turns.
C8=$(DISABLE_SPEC_MODULE_INJECT_HOOK=1 inject 'ship it' s8)
C8B=$(inject '<task-notification>ship it</task-notification>' s8b)
# A teammate message (D#110 L10): 256 of 711 since 2026-09-05 matched a trigger.
C8C=$(inject 'Another Claude session sent a message: <teammate-message teammate_id="r1">ready to ship</teammate-message>' s8c)
C8D=$(inject '<teammate-message teammate_id="r1">ready to ship</teammate-message>' s8d)
if [[ -z "$C8" && -z "$C8B" && -z "$C8C" && -z "$C8D" ]]; then ok "8 kill switch and machine-sent turns (task-notification, teammate) inject nothing"
else ng "8 kill=${C8:0:40} notif=${C8B:0:40} teammate=${C8C:0:40} bare=${C8D:0:40}"; fi

# 9. telemetry row names the modules.
if jq -e 'select(.hook=="spec-module-inject" and .event=="module-inject" and .spec_section=="§2.2-modules" and .extra.modules=="ship")' "$LOG" >/dev/null 2>&1; then
  ok "9 a module-inject row carries the injected module names"
else ng "9 no module-inject row ($(tail -2 "$LOG" 2>/dev/null))"; fi

# 10. compaction forgets the session's injections, so ship can be injected again.
jq -cn '{session_id:"s1", source:"compact", cwd:"/work/p"}' | bash "$SSHOOK" >/dev/null 2>&1
C10=$(inject 'ship it once more' s1)
[[ "$(mods "$C10")" == "ship " ]] && ok "10 after compaction the module is injected again" || ng "10 not re-injected after compact: $(mods "$C10")"

# 11. no modules installed: silent (a plugin whose spec was not synced yet).
mv "$HOME/.claude/spec-modules" "$HOME/.claude/spec-modules.off"
C11=$(inject 'ship it' s11)
mv "$HOME/.claude/spec-modules.off" "$HOME/.claude/spec-modules"
[[ -z "$C11" ]] && ok "11 no installed modules, no output" || ng "11 output without modules"

# 12. an empty module directory (every file deleted by hand): silent, exit 0,
# nothing on stderr. The loop over an empty array under `set -u` aborts on
# bash 3.2 (macOS /bin/bash), which bash 5 does not show (0.101.0 pre-tag
# review, NOT CHECKED item).
mv "$HOME/.claude/spec-modules" "$HOME/.claude/spec-modules.off"
mkdir "$HOME/.claude/spec-modules"
E12=$(jq -cn '{session_id:"s12", prompt:"ship it", cwd:"/work/p"}' | bash "$HOOK" 2>&1 >/dev/null); RC12=$?
rmdir "$HOME/.claude/spec-modules"
mv "$HOME/.claude/spec-modules.off" "$HOME/.claude/spec-modules"
[[ "$RC12" == 0 && -z "$E12" ]] && ok "12 an empty module directory: exit 0, no stderr" || ng "12 empty module dir: rc=$RC12 stderr=$E12"

# 13. a typo / spelling fix is L0, not debugging: "Fix the typo …", "Fix the
# typos …", 修复错别字 and 修复一下错别字 inject nothing (B7 A/B: the typo task drew
# debug.md in every B run). The negative rows pin every excluded word (typo,
# typos, spelling, 错别字, 一下错别字, 拼写); the positive rows match ONLY through
# the `fix the` / 修复 arm, each with a next word that also names code (link,
# formatting, comment, readme, docstring, wording, 格式化, 文案, 排版, 措辞) — the
# words 0.102.0's first draft excluded — so dropping an excluded word or widening
# to any of those turns this red. Runs through jq, the hook's regex engine.
N13=0; BAD13=0
for p in 'Fix the typo in README.md.' 'Fix the typos in README' 'Fix the spelling in the docs' '修复错别字：recieve 应为 receive' '修复一下错别字' '修复拼写'; do
  N13=$((N13+1)); [[ -z "$(inject "$p" "s13n$N13")" ]] || { ng "13 wording fix drew a module: $p"; BAD13=1; }
done
P13=0
for p in 'Fix the link resolver, it returns null for relative paths' 'Fix the formatting function returning NaN' \
  'Fix the comment parser that throws on nested blocks' 'Fix the readme generator script, it skips files' \
  'Fix the docstring extractor, it drops the first line' 'Fix the wording module, it returns null' \
  '修复格式化函数返回空值' '修复文案接口返回500' '修复排版引擎的换行计算' '修复措辞校验，返回空值'; do
  P13=$((P13+1)); [[ "$(mods "$(inject "$p" "s13p$P13")")" == "debug " ]] || { ng "13 real fix missed debug: $p"; BAD13=1; }
done
[[ $BAD13 == 0 ]] && ok "13 typo/spelling fixes draw no debug.md; code fixes whose next word also names code still do"

# 14. release requests the v0.102.0 ship trigger missed (D#110 L20): the
# 发 <version> and 推送/合并 … 发布 prompts are the real misses from sessions that
# later ran a release command; create-release / merge-and-push are core §2.2's
# own ship triggers. Negative rows sit next to each new arm: 发 without a dotted
# version, a version without 发, 发布 not after 推送/合并, and release not
# followed by "to npm". Runs through jq, the hook's regex engine. Batch review
# (D#110 L8/L9): the English arms also match right after CJK text (no \b, which
# jq reads differently there), 开发/触发 + a version is not a release, and
# full-width digits do not count (jq's \d took them, JS's did not).
BAD14=0; N14=0
for p in '发 v6.17.0' '推送并发 0.99.0' '合 #13 再一起发 0.12' '提交 推送 合并 发布' \
  'run create-release for 0.9' 'merge-and-push this branch' 'Release the CLI to npm' \
  '跑一下create-release' '先merge-and-push' 'release这个包 to npm' 'ship一下' '帮我deploy一下' '先cut a release吧'; do
  N14=$((N14+1)); [[ "$(mods "$(inject "$p" "s14p$N14")")" == "ship "* ]] || { ng "14 release request missed ship: $p"; BAD14=1; }
done
N14=0
for p in '发一下这个文件给我看看' '看看 v6.17.0 的 CHANGELOG' '文章发布在哪里' 'release notes look wrong' '合并这两个函数' \
  '开发 2.0 版本的登录功能' '开发v2.0的功能' '触发 1.5 秒延迟' '发 ０.９９.０' '研发 2.0 进度' '出发 1.5 小时后' \
  '批发 3.0 折' '激发 1.2 倍' '散发 0.5 秒' '引发 1.0 错误' 'The release notes link to npmjs.com' \
  'prerelease builds go to npm later' 'relationship status' 'redeployment plan'; do
  N14=$((N14+1)); [[ -z "$(inject "$p" "s14n$N14")" ]] || { ng "14 non-release prompt drew a module: $p -> $(mods "$(inject "$p" "s14m$N14")")"; BAD14=1; }
done
[[ $BAD14 == 0 ]] && ok "14 发 <version>, 推送/合并…发布, create-release, merge-and-push and release…to npm inject ship; neighbours do not"

# 15. every English arm is bounded by (?<![A-Za-z0-9_]) … (?![A-Za-z0-9_]), not
# \b (D#142 LOW-13, LOW-3): jq counts a CJK character as a word character, so
# `\bbug\b` missed 这个bug怎么修 while the JS calibration copy matched it. One
# positive row per converted debug/plan/orchestrate/review/memory arm with CJK
# on both sides (the ship arms' old bound already matched beside CJK); negative rows put _ or a
# digit beside the word, which the old (?<![A-Za-z]) ship bound accepted.
BAD15=0; N15=0
for row in 'debug|这个bug怎么修' 'debug|测试failing了' 'debug|抛了个exception出来' 'debug|帮我fix the登录接口' \
  'plan|依次完成三个l3事项' 'plan|做一次refactor吧' 'plan|数据库migration脚本' \
  'orchestrate|开几个subagent一起查' 'orchestrate|这三件事in parallel做' \
  'review|帮我review the改动' 'review|做个PR review吧' 'memory|把这条remember this下来' 'memory|调用mem_save存一下'; do
  N15=$((N15+1)); want="${row%%|*}"; p="${row#*|}"
  [[ "$(mods "$(inject "$p" "s15p$N15")")" == "$want " ]] || { ng "15 CJK-glued arm missed $want: $p"; BAD15=1; }
done
N15=0
for p in 'ship_date 字段为空时' 'deploy_utils.py 在哪' 'ship2 是哪个分支' 'bug_id 列的索引' 'L30 行的注释' \
  'subagents_dir 配置项' 'refactor_log 表' 'cut a release2 branch' 'release_v2 to npm 的脚本'; do
  N15=$((N15+1)); [[ -z "$(inject "$p" "s15n$N15")" ]] || { ng "15 _/digit-glued word drew a module: $p -> $(mods "$(inject "$p" "s15m$N15")")"; BAD15=1; }
done
[[ $BAD15 == 0 ]] && ok "15 English arms match next to CJK and not next to _ or a digit"

claudemd_assert_summary
