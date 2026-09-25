---
status: draft
revision: 1
---

# Reply-language restatement (Stop hook)

## goal

用户用中文写，而一轮的最后一条回复却是英文时，在这一轮结束前拦一次，让模型把同一段话用中文重说一遍。这是 spec v6.33.0 §1 措辞修正之外的机械兜底：措辞只能降低漂移概率，管不到 Opus 5.5 在子代理通知触发的轮次里的倾向。

基线（2026-09-25，`tasks/lang-drift/lang.py` + `rows.json`，8 个非沙箱项目目录，约 20 天）：

- 1544 条轮末回复、166 个会话里，146 条是英文，分布在 25 个会话。
- 按触发来源：`<task-notification>` 73、另一会话消息 49、用户中文提问 23、skill 正文 1。
- 用户中文提问的 23 条里，16 条是"等待评审/让出"说明，其中 15 条所在轮次刚派出子代理。
- 模型：Opus 5.5 在通知触发轮次 55/101 为英文，Opus 5 为 18/156。
- Stop hook 在三类轮次上都会触发：`stop_hook_summary` 记录显示，人类轮 610/653、通知轮 264/270、会话消息轮 661/669 有 Stop 记录（其余是中断或 `/exit`）。

## non-goals

- 不删除、不替换已经显示的英文回复。Stop hook 做不到，英文那段会留在屏幕上，下面多一段中文。
- 不管子代理自己的输出（那是 SubagentStop，且子代理 prompt 按 §1 本来就是英文）。
- 不管思考语言。
- 不判断"中英混排是否合适"：只处理"零个 CJK 字、至少 N 个英文单词"这一种明确情况。
- 不做 deny：Stop 的 block 不阻止任何动作，只要求多说一段话。

## constraints

- 挂在 `Stop`，文件 `hooks/reply-language-check.sh`，bash 3.2 兼容，shellcheck warning 级干净，timeout 3s。
- 默认关闭（§EXT §13.3）。开启：`REPLY_LANGUAGE_CHECK=1`（拦一次、要求重说）或 `REPLY_LANGUAGE_CHECK=log`（只记录，不拦）。关闭开关：`DISABLE_REPLY_LANGUAGE_HOOK=1` 与全局 `DISABLE_CLAUDEMD_HOOKS=1`。未开启时不 source 公共库、不起 jq。
- 防循环：输入里 `stop_hook_active == true` 直接放行。每轮最多拦一次，远低于 harness 的 8 次上限。
- 回复语言：取输入的 `last_assistant_message`（不滞后），去掉代码块、反引号片段、URL、路径、尖括号标签后，CJK 字数为 0 且英文单词数 ≥ `REPLY_LANGUAGE_MIN_WORDS`（默认 20）才算英文。
- 用户语言：只看人类自己打的消息。从 `transcript_path` 尾部窗口（默认 400 行）里取，排除 tool_result、`isMeta`、`isCompactSummary`、`isSidechain`、`<task-notification>`、`Another Claude session sent a message`、`<command-`、`<local-command`、`<bash-`、`This session is being continued`、`[Request interrupted`。从最近一条往前找第一条"可判定"的：含 ≥2 个 CJK 字 → 中文；0 个 CJK 且 ≥3 个英文单词 → 英文；都不满足（如 `1`、`y`）→ 继续往前。窗口内找不到可判定的消息 → 放行。
- 用户明确要英文时不拦：窗口内最近的人类消息匹配 `(用|写成?|翻译成?|换成?|改成?|输出)英文|in English` → 放行。
- 语言分类在 jq 里做（Oniguruma 支持 Unicode 区间），全程最多两次 jq 调用，不起其他子进程循环。
- 拦截输出只走 stdout 一个 JSON：`{"decision":"block","reason":…}`。reason 用英文写（日志字符串按 §1 为英文），内容：上一段回复是英文、用户写中文、§1 规定哪些消息不改变语言、请把同一内容用中文重说一遍、不做新工作、不调用工具、关闭方式。
- 每次判定为英文都记录 `hook_record reply-language reply-language-restate|reply-language-logged {mode, words, human_lang, trigger}`，其中 trigger ∈ human / task-notification / teammate / other，用于 30 天误报统计。
- 登记点与 cross-repo-write 相同的一串：hooks.json、hook-registry、toggle 命令、README、ARCHITECTURE、RULE-HITS-SCHEMA、HOOK-PROTOCOL、hook-budget probe、doctor liveness、registry 计数。

## success-criteria

1. 测试套件 `tests/hooks/reply-language.test.sh`，每条规则至少一行正例和一行对照，删掉任何一条规则至少一行变红：
   - 默认关闭时零输出、零 jq 调用；
   - 英文回复 + 中文用户 → block，reason 含全部固定要素（§1 出处、重说同一内容、不做新工作不调用工具、关闭方式）；`log` 模式只记录不输出；
   - `stop_hook_active: true` → 放行；
   - 回复含 1 个 CJK 字 → 放行；19 个英文单词 → 放行，20 个 → block；代码块里的英文不计；
   - 最近的人类消息是英文 → 放行；最近的是 `<task-notification>`、再往前是中文人类消息 → block；
   - 人类消息只有 `1`、再往前是中文 → 按中文；
   - 用户说"用英文回复" → 放行；
   - transcript 缺失、坏 JSON、无 jq → fail-open 并记录。
2. 历史回放：把 `rows.json` 覆盖的每个轮末（Stop 点）喂给 hook 的判定逻辑，报告触发数。对全部触发逐条人工标注"用户是否确实需要中文"，精确率 ≥ 95%；相对 lang.py 分类出的 146 条英文轮末，召回 ≥ 90%（差额逐条列原因）。
3. 最大 transcript 上 p95 ≤ 300ms；状态目录无新增文件（本 hook 不写状态）。
4. `npm run check` 退出码 0，`npm run smoke` 通过。

## open-questions

1. 开启值是否需要两档（`1` 拦截重说 / `log` 只记录）？建议要：`log` 给 §13.3 的 30 天误报数据，`1` 给想要效果的用户，两者可以同时有人用。
2. 阈值 20 个英文单词是否合适？回放时同时报告 10 / 20 / 40 三档的触发数和精确率再定。
3. 轮末是纯代码/命令输出（例如用户要一段英文 commit message，放在代码块外）会被拦。回放标注会给出这类的比例；超过 5% 再加排除规则。

Produces:

- Produces: `hooks/reply-language-check.sh` — the opt-in Stop hook (`REPLY_LANGUAGE_CHECK=1|log`).
- Produces: `tests/hooks/reply-language.test.sh` — success-criteria 1 rows.
- Produces: `rl_human_lang` — the human's language from the transcript tail, machine user-role messages skipped.
- Produces: `rl_reply_is_english` — the reply classifier (code, paths and tags stripped; zero CJK and at least N words).

# Change log

- r1 (2026-09-25): initial draft, from the drift measurement in `tasks/lang-drift/`.
