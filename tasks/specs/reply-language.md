---
status: implemented
revision: 3
---

# Reply-language restatement (Stop hook)

## goal

用户用中文写，而一轮的最后一条回复却是英文时，在这一轮结束前拦一次，让模型把同一段话用中文重说一遍。这是 spec v6.33.0 §1 措辞修正之外的机械兜底：措辞只能降低漂移概率，管不到 Opus 5.5 在子代理通知触发的轮次里的倾向。

基线（2026-09-25，`tasks/lang-drift/lang.py` + `rows.json`，8 个非沙箱项目目录，约 20 天）：

- 交互会话：1448 条轮末回复、158 个会话里，93 条是英文，分布在 22 个会话。
- 按触发来源：另一会话消息 49、用户中文提问 23、`<task-notification>` 21。
- 用户中文提问的 23 条里，16 条是"等待评审/让出"说明，其中 15 条所在轮次刚派出子代理。
- 模型：Opus 5.5 在通知触发轮次 20/64 为英文，Opus 5 为 1/104。
- r1 时的数字（1544 条、146 条英文、通知 73）把 8 个无人值守的 `claude -p` 会话（96 条轮末、54 条英文）算了进去；那些会话只由斜杠命令驱动，没有人类打字，没有可对照的用户语言。
- Stop hook 在三类轮次上都会触发：`stop_hook_summary` 记录显示，人类轮 610/653、通知轮 264/270、会话消息轮 661/669 有 Stop 记录（其余是中断或 `/exit`）。

## non-goals

- 不删除、不替换已经显示的英文回复。Stop hook 做不到，英文那段会留在屏幕上，下面多一段中文。
- 不管子代理自己的输出（那是 SubagentStop，且子代理 prompt 按 §1 本来就是英文）。
- 不管思考语言。
- 不判断"中英混排是否合适"：只处理"零个 CJK 字、至少 N 个英文单词"这一种明确情况。
- 不做 deny：Stop 的 block 不阻止任何动作，只要求多说一段话。
- 不管无人值守的会话（`claude -p`，transcript 行上 `entrypoint` 为 `sdk-*`）：没人实时读，重说只多花一轮。（r3 新增，待用户确认。）

## constraints

- 挂在 `Stop`，文件 `hooks/reply-language-check.sh`，bash 3.2 兼容，shellcheck warning 级干净，timeout 3s。
- 默认关闭（§EXT §13.3）。开启：`REPLY_LANGUAGE_CHECK=1`（拦一次、要求重说）或 `REPLY_LANGUAGE_CHECK=log`（只记录，不拦）。关闭开关：`DISABLE_REPLY_LANGUAGE_HOOK=1` 与全局 `DISABLE_CLAUDEMD_HOOKS=1`。未开启时不 source 公共库、不起 jq。
- 防循环：输入里 `stop_hook_active == true` 直接放行。每轮最多拦一次，远低于 harness 的 8 次上限。
- 回复语言：取输入的 `last_assistant_message`（不滞后），去掉代码块、反引号片段、URL、路径、尖括号标签后，CJK 字数为 0 且英文单词数 ≥ `REPLY_LANGUAGE_MIN_WORDS`（默认 10，r3 按回放定）才算英文。harness 自己的 `API Error:` 行不算回复。
- 用户语言：只看人类自己打的消息。从 `transcript_path` 尾部窗口（`REPLY_LANGUAGE_WINDOW`，默认 3000 行，先用定长 grep 只留 `"type":"user"` 且不含 tool_result 的行，再交给 jq）里取，排除 tool_result、`isMeta`、`isCompactSummary`、`isSidechain`、`<task-notification>`、`Another Claude session sent a message`、`<command-`、`<local-command`、`<bash-`、`This session is being continued`、`[Request interrupted`；但斜杠命令的 `<command-args>` 是人类打的字，按正文判定（r3）。从最近一条往前找第一条"可判定"的：含 ≥2 个 CJK 字 → 中文；0 个 CJK 且 ≥3 个英文单词 → 英文；都不满足（如 `1`、`y`）→ 继续往前。窗口内找不到可判定的消息 → 放行。
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
   - 回复含 1 个 CJK 字 → 放行；9 个英文单词 → 放行，10 个 → block；代码块里的英文不计；`API Error:` 行放行；
   - 斜杠命令的参数按人类文字判定，无参数的命令不提供语言；无人值守会话（`sdk-*`）放行；
   - 最近的人类消息是英文 → 放行；最近的是 `<task-notification>`、再往前是中文人类消息 → block；
   - 人类消息只有 `1`、再往前是中文 → 按中文；
   - 用户说"用英文回复" → 放行；
   - transcript 缺失、坏 JSON、无 jq → fail-open 并记录。
2. 历史回放：把 `rows.json` 覆盖的每个轮末（Stop 点）喂给 hook 的判定逻辑，报告触发数。对全部触发逐条人工标注"用户是否确实需要中文"，精确率 ≥ 95%；相对 lang.py 分类出的交互会话 93 条英文轮末，召回 ≥ 90%（差额逐条列原因）。（r3 由 146 条改为交互会话的 93 条，待用户确认。）
3. 最大 transcript 上 p95 ≤ 300ms；状态目录无新增文件（本 hook 不写状态）。
4. `npm run check` 退出码 0，`npm run smoke` 通过。

## replay result (r3)

`tasks/lang-drift/replay.py`，1634 个轮末，每个轮末喂给 hook 的正是它在 3000 行尾窗内 grep 预过滤后会读到的行：

| 阈值 | 触发 | 交互会话召回 | 触发中无人值守会话 |
|---|---|---|---|
| 10 | 93 | 89/93 = 0.957 | 0 |
| 20 | 84 | 80/93 = 0.860 | 0 |
| 40 | 64 | 61/93 = 0.656 | 0 |

- 阈值 10 的 93 次触发逐条人工看过（标注者是作者本人，单人标注），全部是中文用户交互会话里的英文轮末，精确率 93/93。其中 4 条不在 lang.py 的 93 条里：会话 325003ff 在 rows.json 快照之后新增的轮次。
- 召回差的 4 条：会话 bc46ca82 里 9 个单词的状态行（"Acknowledged. Four audits still outstanding…"），低于阈值。
- 0 次非零退出，0 次 stderr。
- 开放问题 3（纯英文内容作为回复）：93 次触发里 0 条。

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
- r3 (2026-09-25): replay-driven. Threshold 20 → 10 (open question 2; recall 0.860 → 0.957 at unchanged precision). Slash-command `<command-args>` count as human text; the harness `API Error:` line is not a reply. Headless (`sdk-*`) sessions are a new non-goal and the recall base moves from 146 to the 93 interactive finals — a success-criteria change, pending the user's confirmation. A `REPLY_LANGUAGE_DEFAULT=zh` variant (assume 中文 when nothing human is classifiable) reached 0.94 recall only by firing in headless and sandbox runs, and was dropped.
- r2 (2026-09-25): approved by the user ("确认"); open questions taken as recommended. Constraint tightening: human messages are pre-filtered with a fixed-string grep over a larger tail (default 3000 rows) before jq, so a long agentic turn does not push the human prompt out of the window.
