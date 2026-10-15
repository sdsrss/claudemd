# 脚手架与全局规范对齐 Claude Fable 5.1 的优化方案（2026-10-15）

- **对象**：本插件放进每个会话的全部文字和脚本：全局规范核心 `spec/CLAUDE.md`（v7.3.0，23,182 B）、10 个按需模块 `spec/spec-modules/`（合计 40,967 B）、27 个 hook `hooks/`、16 个命令、项目 `CLAUDE.md`，以及和它们叠在一起的其他常驻文字（harness 系统提示词、技能清单、`MEMORY.md`、claude-mem-lite 和 code-graph 两个插件的 hook 注入）。
- **问题**：模型换成 Claude Fable 5.1、Claude Code 升到 2.1.301 以后，规范里哪些东西 harness 已经自己做了，哪些和它冲突，哪些还在承重；并按用户这次提出的 15 项要求（语言、原则、spec 模板、TDD、分档流程、上下文管理、记忆管理、工具与技能、无人值守、长任务、文件存放、测试清理、git 流程、英文规范、汇报格式）逐项给出改法。
- **依据**：
  - 本会话的 harness 系统提示词原文（Fable 5.1，Claude Code 2.1.301，`bypassPermissions` 模式），逐段和规范对照（第 2 节）；
  - 本机转录：2026-09-30 至 10-15 的 48 个交互会话、10,936 次工具调用、215 条回合末回复，全部跑在 Opus 5.5 上（第 3 节）；
  - hook 日志 `~/.claude/logs/claudemd.jsonl` 同期的记录（3.3 节）；
  - 前两轮分析已经核实过的官方资料和实验结果，本文只引用不重做：`docs/spec-optimization-plan-2026-09-29.md`（核心精简，v7.2.0）、`docs/spec-model-capability-review-2026-10-15.md`（技能路由与"模型已会"的规则，v7.3.0）。
- **底稿**（本地、不入库）：`tasks/spec-v8-2026-10-15/`，两个扫描脚本和复现说明。

---

## 0. 结论

**一句话**：规范现在最大的问题不再是体积，而是它和 harness 重复、和 harness 冲突、以及一层没人照做的"仪式"文字。改法是把规范收成用户这次给出的四块短文（语言、原则、spec 模板、汇报）加上已经证实承重的约束（先复现、先红、发版前评审、硬授权清单、§8 安全），把流程性的保证交给 hook，把"何时问、何时停、怎样写"交给 harness。估计核心从 23.2 KB 收到 12 KB 上下，每会话固定上下文从约 92 KB 收到约 45 KB；两个数都要在实施后复测。

1. **harness 这一代的系统提示词已经自己写了六块规范里的内容**：自主推进不中途问、如实报告、先给推荐、四类记忆与 `MEMORY.md` 索引、压缩后继续、子代理报告的交付语义。这些段落在核心里合计约 4 KB，可以删到只剩规范比 harness 更严的那一句（2.1 表）。
2. **有三处直接冲突**，模型会在两种指令之间摇摆，比多出几 KB 更伤：
   - harness 的 Bash 工具说明写着"用户没要求就不要提交"，核心 §7 要求每个验证通过的改动各自提交一次；
   - harness 的写作规则禁止 500 词以下的回复用标题、禁止整句加粗，核心 §10 和用户要的 `## 汇报` 都是带标题的固定格式；
   - `bypassPermissions` 下 harness 明确要求"能用 Bash 就不用 Read/Edit/Write"，而按 `Edit|Write` 匹配的 hook 看不到这条通道（09-26 已测到 83% 的编辑走 Bash）。
   三处都要在规范里写一句明确的裁决，而不是靠模型自己选。
3. **"仪式"层基本没人照做**。v7.2/7.3 期间 211 条 Opus 5.5 的回合末回复里：四段结构标签 53/211（25%），等级声明 12/211（6%），`[PARTIAL]` 0 次，`Checked:` 证据句式 0 次，`[AUTH REQUIRED]` 10/211（5%）。这层文字（等级声明、`[PARTIAL]`、四段顺序、技能宣告、模式宣告）可以换成用户给的三段汇报和 `[AUTH REQUIRED]` 一个信号。
4. **上下文的大头不在核心**。每会话固定载入约 66 KB（核心 23.2、`MEMORY.md` 19.3、技能清单 22.0、项目 `CLAUDE.md` 3.9 以下、语言规则 0.3），hook 再注入约 25.6 KB，其中 claude-mem-lite 18.6 KB（每次 Bash 前都注入一段，1,180 次、每次约 336 B、无一为空），本插件自己只有 1.0 KB。所以"少占上下文"的前三项是：记忆索引行、兄弟插件的逐次召回、技能清单，核心排第四。
5. **hook 已经是"只拦高风险"**。同期本插件的日志有 1,900 余行，真正拒绝的只有 11 次（`rm -rf $VAR` 4、提交信息含禁用词 3、CI 红时推送 2、发版前没读 runbook 2）；另有 32 次 Stop 拦截来自回复语言检查（48 个会话里 32 次，67%），它拦的是对的，根因在 harness 侧的非人类消息把回复带成英文。无人值守模式不需要再放松 hook，需要改的是规范里"不确定就问"的默认值。
6. **承重的约束不动**：先复现再修、先写失败的测试、打 tag 前独立评审（无规范对照 5/5 对 0/5）、§5 硬授权清单、§8 安全规则、"完成声明附本次会话的工具证据"。Fable 5 的官方指南正是这样分的：删"多验证几遍"，留"按工具结果核对每条声明"。
7. **实施是 L3**：改的是 LLM 可见的元数据，走发版流程；汇报格式和信号的变化会影响三个解析它们的 hook 和采样审计，所以规范升到 v8.0.0。两份预注册评估的窗口 10-26 才关，建议在 `release/0.109.0` 分支上做完、评审完，10-26 后再合入 `main`（第 7 节）。

---

## 1. 判据

沿用前两轮的判定方法，补一条给"用户要求"用的：

| 类别 | 判定方法 | 处理 |
|---|---|---|
| harness 已写 | 本会话系统提示词里逐句出现 | 删；规范比 harness 更严的那一句保留 |
| 与 harness 冲突 | 两边读出相反的动作 | 规范里写一句裁决，说明谁赢、为什么 |
| 仪式文字 | 转录里的可见遵循率 | 遵循率低于三成且没有 hook 依赖它 → 换成用户要的格式 |
| 承重约束 | 无规范对照有差异，或 hook 兜底 | 不动 |
| 用户要求 | 与现状逐项对照 | 现状已有 → 指出位置，改写成用户的措辞；没有 → 补，写进最薄的位置（核心、模块、hook、项目 `CLAUDE.md` 四选一） |

两条底线不变：删除是待验证的假设，不是结论（官方审计规则原话，见 10-15 评审第 1 节）；"短"本身不是目标，删的理由必须是"这条不再合适"。

---

## 2. harness 现在自己做什么

下表左列是本会话系统提示词的原文片段（Fable 5.1，Claude Code 2.1.301，`bypassPermissions`）。它随版本、模型和权限模式变化，第 9 节有说明。

### 2.1 重复：可以删的

| harness 原文 | 核心中的对应条款 | 处理 |
|---|---|---|
| "When you have enough information to act, act. Do not re-derive facts already established … give a recommendation, not an exhaustive survey" | §1 Recommend-first、Single obvious option | 删。两条合计约 450 B。§5.1 引用了 "single obvious option"，§5.1 整段一起删（下一行） |
| "You are operating autonomously … For reversible actions that follow from the original request, proceed without asking. Stop only for destructive actions or genuine scope changes the user must decide." | §0 Initial-prompt ambiguity 的默认 (a) ASK、§0.2、§1 Zero-assume "unsure → ASK"、§11 Correction pressure "ASK-first" | 改写成一条（R2）。harness 的方向和用户要的"低风险可逆的歧义自己决定"一致，规范现行默认与之相反 |
| "Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done … do that work now … Do not stop because the context or session is long." | §11 Mid-SPINE turn-yield（约 1.2 KB，HARD） | 删到只剩子代理那一句（见下） |
| "Subagents run in the background; you'll be notified when one completes. Never fabricate or predict a pending agent's results … if the user asks before it arrives, say it's still running." | §11 "awaiting a spawned subagent … the yield IS the delivery"、`orchestrate.md` "Output reaches main only at turn end" | 保留一句："等子代理时结束回合就是交付，不要 sleep 或 ping"，这是 09-26 用 3 小时、126 次调用换来的本机教训，harness 没有写"不要等" |
| "Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging." | §10 Honesty 中 "no may/could"、"yes/no first" | 删这两条；Iron Law #2（证据要新鲜、bugfix 要引用修前的失败）保留，它比 harness 严，且有 Fable 5 指南的数据支持 |
| "The requested scope is the deliverable — don't quietly narrow, widen, or transform it … Stop short of actions or changes clearly beyond what the user's ask implies." | §1 Smallest diff、§0 Hard-AUTH override 里"相邻 bug 一律再问" | 用用户的"精准修改：无关的问题只指出，不顺手修"替换这两处 |
| "If you find an uncertainty mid-task, first do everything that doesn't depend on the answer; for what does, state your assumption or ask your question to the user at the right time." | 用户要的"先把能做的做了，需要拍板的统一留在后面" | harness 已写，规范只需在汇报的"遗留"段给它一个落点 |
| "You have a persistent file-based memory … type: user \| feedback \| project \| reference … add a one-line pointer in MEMORY.md … one line per memory, no frontmatter, never put memory content there … Before saving, check for an existing file … Don't save what the repo already records … if asked to remember one of those, ask what was non-obvious about it and save that instead." | `memory.md` 的 User-override filter、Auto-memory decision tree 第 3 步和"Always skip"清单、§11 Auto-memory 第三句 | 删。`memory.md` 从 5.4 KB 收到约 1.5 KB（R7）。保留的是 harness 不知道的：两层记忆的分工、索引行的标签语法（hook 解析它）、发版 runbook 只放一个文件、§3 的记忆信任等级 |
| "When the conversation grows long, some or all of the current context is summarized … you don't need to wrap up early or hand off mid-task." | §11 Post-compaction、`session.md` Context pressure (a)–(d) | 保留一句"压缩后先重读 spec 文件"，其余删 |
| "when answering would mean reading across several files — delegate it and you keep the conclusion, not the file dumps … Once you've delegated a search, don't also run it yourself" | `orchestrate.md` "Delegate only large, independent work" | 方向相反：harness 和 Fable 5 指南都要求多用子代理。删规范这条，留"报告超过 4,000 字符要写文件"和"同一子任务失败三次不派第四个"两条本机知识 |
| "Before you start, say in a line what you're about to do; brief updates while you work … Close with a short recap" | 用户的"动手前用一两句话说明理解和假设（微改免）"、§2 的等级声明 | 等级声明删（6% 遵循）；用户那句保留，它多了"假设"二字 |
| "Before running a command that changes system state (such as restarts, deletes, or config edits), check that the evidence actually supports that specific action." | §8.V3 Destructive-smoke | 保留 V3，它要求的是先在沙箱跑，比 harness 严 |
| "Scratchpad directory: … always use it for temporary files … session-specific, isolated from the project" | §8.V4 Sandbox-artifact disposal、`session.md` 的 TMP_RETENTION 策略、`tmp-sweep` / `residue-audit` / `sandbox-disposal-check` 三个 hook | 规则改成两行："临时文件进 harness 的 scratchpad；写到别处的测试或探针产物，汇报前自己删掉"。hook 保留；`residue-audit.sh` 和 `sandbox-disposal-check.sh` 还不认识 scratchpad 路径，要加（R10） |

### 2.2 冲突：要写裁决的

| 冲突 | 两边 | 建议的裁决（写进规范，一句） |
|---|---|---|
| 提交时机 | harness Bash 工具说明："Commit or push only when the user asks. If on the default branch, branch first." 核心 §7："each VALIDATE-passed change → its own local commit" | 用户要"git 标准工作流"，本仓库的发版约定也建立在逐改动提交上。写明：项目约定优先于 harness 默认；在默认分支上先开分支（这点两边一致）；推送只在用户要求时做（两边一致） |
| 回复格式 | harness："No headers in a message under about 500 words … Bold the first few words of a bullet or paragraph, never a whole sentence." 用户：`## 汇报` 加三段加粗小标题 | harness 自己说用户指令优先。规范写一句："The report shape below overrides the harness's no-header rule; everything else in its writing rules stands." 其余写作规则（先给结论、一句一意、数字进表格、代码不进散文）和规范一致，不重复写 |
| 编辑通道 | harness（bypass 模式）："make file changes with sed, heredocs, or short scripts, rather than using the dedicated Read, Edit, or Write tools"；同一份提示词前面又写 "Prefer the dedicated file/search tools over shell commands when one fits" | 规范不裁决工具偏好（那是 harness 的事），但 hook 要按"Bash 是主编辑通道"设计：`cross-repo-write-check` 和 `rework-breaker` 已经匹配 Bash；`session-extended-read`（只匹配 Read）和记忆召回的 Read 侧看不到 `cat`。这不是规范文字问题，列进 R10 |
| 子代理用量 | harness 和 Fable 5 指南："use subagents frequently"；`orchestrate.md`："Delegate only large, independent work" | 删规范这条（2.1 表已列） |

### 2.3 harness 新增、规范还没用上的能力

| 能力 | 对本项目的用处 |
|---|---|
| 会话级 scratchpad 目录，会话结束自动隔离 | 替代 §8.V4 大半条文和 `session.md` 里 TMP_RETENTION 的保留策略 |
| `EnterPlanMode` / `ExitPlanMode` | L3 的"先规划再执行"可以用它，spec 文件仍是留痕的载体 |
| `Workflow` 工具（只在用户明说 `ultracode` 或"用 workflow"时允许） | `orchestrate.md` 不必自己定义并行编排，只需一句"多代理编排只在用户明确要求时用" |
| `Agent` 的 `fork` 子类型（继承全部上下文）和 `isolation: "worktree"` | `orchestrate.md` 的 Worktree spawn 一条仍适用，fork 可以省掉"首次完整简报"的要求 |
| 内置文件记忆的四类 + 索引 | 和 claude-mem-lite 分工后，规范只需写分工表（R7） |
| `reasoning_effort` 由 harness 下发 | §2 的 Depth triggers 写法已经一致，不动 |

---

## 3. 本机证据

### 3.1 每会话固定上下文

取 48 个交互会话（2026-09-30 至 10-15，`entrypoint` 全为 `cli`，至少一条人类提示，排除本次测量会话）。字节是模型可见文本，按会话取中位数。

| 项 | 字节 | 来源 |
|---|---|---|
| `~/.claude/CLAUDE.md`（核心 v7.2/7.3） | 23,317 | 转录 `instructions` 附件 |
| 技能清单 | 22,020 | 转录 `skill_listing` 附件 |
| `MEMORY.md`（本项目） | 19,330（磁盘）/ 17,642（转录中位数） | 文件在增长 |
| 项目 `CLAUDE.md` | 本仓库 3,864；claude-mem-lite 20,264；daagu 20,394；code-graph-mcp 2,870 | 另两个仓库的文件不在本文范围，但说明"项目文件"也会长到 20 KB |
| `~/.claude/rules/reply-language.md` | 267 | |
| **固定合计（本仓库）** | **约 66 KB** | 不含 harness 自己的系统提示词和工具说明 |

`.claude/plugin_claude_mem_lite.md`（10.3 KB）和 `.claude/plugin_code_graph_mcp.md`（12.7 KB）不自动载入，只在被 Read 时进入上下文，不计。

### 3.2 hook 注入

同一批会话，按 `hook_success` 附件里的 `additionalContext` / 纯 stdout 计模型可见字节，按脚本归属到插件：

| 插件 | 触发次数 | 可见字节合计 | 每会话 | hook 耗时/会话 |
|---|---|---|---|---|
| claude-mem-lite | 1,834 | 890.7 KB | 18.6 KB | 3.8 s |
| superpowers（10-15 已在用户级停用） | 56 | 186.9 KB | 3.9 KB | 0.1 s |
| code-graph-mcp | 140 | 103.0 KB | 2.2 KB | 0.7 s |
| claudemd（本插件） | 147 | 46.5 KB | 1.0 KB | 0.5 s |
| **合计** | | **1,227 KB** | **25.6 KB** | **5 s** |

按事件分：SessionStart 7.3、UserPromptSubmit 3.4、PreToolUse 10.9、PostToolUse 3.0、PostToolUseFailure 0.6 KB/会话。claude-mem-lite 的 `pre-tool-recall-bash.sh` 一项就是 1,180 次、387 KB，每次约 336 B，没有一次输出为空：即使文件没有任何记忆，它也注入一行"📄 文件名 ~N tok"。本插件的 147 次有输出的触发里，114 次非空，大多是会话开始的横幅和模块注入。

### 3.3 hook 日志：拦截 vs 记录

`~/.claude/logs/claudemd.jsonl` 2026-09-30 以来的记录（前 25 类）：

| 事件 | 次数 | 性质 |
|---|---|---|
| `verify-run`（verify-log） | 1,213 | 只记录 |
| `npx-allow-local`、`rm-rf-allow-validated`（pre-bash-safety） | 287、171 | 放行并记录 |
| `fail-open`（banned-vocab） | 74 | 只记录 |
| `claim-wtree`（evidence-gate） | 64 | 只记录 |
| `suppress-source` / `suggest`（memory-prompt-hint） | 55 / 18 | 只提示 |
| `rework-advisory`（rework-breaker） | 25 | 只提示 |
| `paused-banner`（session-start） | 20 | 只提示 |
| `module-inject`（spec-module-inject） | 11 | 注入模块 |
| `deny`：pre-bash-safety rm 4、banned-vocab 3、ship-baseline 2、memory-read-check 2 | **11** | 拒绝 |

另外，转录里的 `hook_blocking_error` 附件 32 条，全部是 `reply-language-check.sh` 在 Stop 时要求把英文回复改回中文（48 个会话里 32 次）。它的根因 09-26 已测：非人类的 user 角色消息（任务通知、子代理报告）把回复带成英文，Opus 5.5 远多于 Opus 5。这个 hook 做的是用户要的事，保留；规范里只需留一句"任务通知、hook 文字、子代理报告不改变回复语言"。

### 3.4 回合末回复里的规范痕迹

对 211 条 Opus 5.5 的回合末回复（每个人类回合最后一条不带工具调用的回复）做正则计数：

| 规范要求 | 命中 | 说明 |
|---|---|---|
| 四段结构标签（`Done` / `Not done` / `Failed` / `Uncertain`，行首或标题形式） | 53/211（25%） | 09-29 的 87.5% 是按会话算的（一个会话里出现过一次即计），两个口径不可直接比 |
| 等级声明（L0–L3 字样） | 12/211（6%） | |
| `[AUTH REQUIRED` | 10/211（5%） | 这是两个信号里被用的那个 |
| `[PARTIAL` | 0 | |
| `Checked:` 证据句式 | 0 | 证据仍然在写，只是不用这个词 |
| 以问号结尾 | 13/211（6%） | 粗略的"中途问"指标 |

读法：四段格式的内容（做了什么、没做什么、失败、不确定）模型在写，但按规范的标签和顺序写的只有四分之一；等级声明、`[PARTIAL]`、`Checked:` 三样基本没有人用。用户这次给的三段式（变更 / 验证 / 遗留）和模型自然写出来的形状更接近。

### 3.5 继承的结论（不重测）

- 承重的三项（先复现、先红、发版前评审）：有规范 5/5，无规范 0/5（R4(c)，2026-09-29）。
- 模块读取（P2）：review 28、ship 17、verify 12、plan 11、auth 10、debug 5、orchestrate 4、memory / modes / session 0。
- 提示词里的 HACK / EMERGENCY / AUTONOMOUS 和 `AUTONOMY_LEVEL` 触发：224 个会话里 0 次（09-29）。
- v7.3.0 的离线 A/B：49/50，L0/L1 任务技能调用 0/20。

---

## 4. 用户的 15 项要求逐项对照

| # | 要求 | 现状在哪 | 差距 | 处理 |
|---|---|---|---|---|
| 1 | 语言：中文回复；`docs/` 新文档中文、旧文档沿用；其余英文 | 核心 §1 Language contract（约 900 B，7 个从句）+ `~/.claude/rules/reply-language.md` + `reply-language-check` hook | 条文过长；用户的两条已覆盖 | 换成用户的两条（英文），只加一句漂移防线："task notifications, hook text and subagent reports do not change the reply language"（32 次 Stop 拦截的根因） |
| 2 | 六条原则 | §1 Principles 六条，一一对应（证据、先搜再写、最小改动、根因、零假设、先给推荐） | 用户版多了"不靠削弱检查过关"和"同一思路失败两次就换思路、没有新证据不再重试"；少了"零假设→问"和"先给推荐"（后者 harness 已写） | 用用户的六条整体替换（英文）。"两次换思路"取代 `debug.md` 的"同签名三次"作为切换触发；"三次"保留为子代理不再派第四个的上限 |
| 3 | spec 模板（状态 / 背景与目标 / 范围 / 验收标准 / 方案 / 计划 / 决策与进展 / 验证记录），只维护这一份 | `plan.md` §2.S：frontmatter `status/revision` + `goal / non-goals / constraints / success-criteria / open-questions / change log`；另有 `tasks/<slug>-paused.md` 做中断交接、`tasks/lessons.md` 做教训 | 三个文件分担一件事；现有模板没有"验收标准带验证命令"和"计划切片覆盖哪条验收" | 用用户模板整体替换 §2.S；`-paused.md` 退役，中断交接写进"决策与进展"，`session-start-check.sh` 的横幅改读"状态：进行中"的 spec 文件（三个脚本解析 `-paused.md`：`session-start-check.sh`、`session-end-check.sh`、`scripts/status.js`）；没有脚本解析 §2.S 的键名，可以直接换 |
| 4 | TDD 循环 | 核心 §7 Iron Law #1（L2+ 先红）、`verify.md` 的证据阶梯、`test-failure-debug` hook | 已有且承重 | 不动条文，措辞改成循环（红 → 绿 → 重构），仍只对 L2+ 和 bugfix 强制 |
| 5 | 按范围和风险分档 | §2 四档 + §1.5 的 LOC / Local-Δ / Module / Δ-contract 定义（合计约 2.6 KB） | 定义靠行数和文件数，模型 6% 的回合声明等级；真正起作用的是"硬升级"清单（migration / infra / 发布物默认行为 / LLM 可见元数据） | 保留四档，改成按风险和可逆性的一段话定义（R6）；删行数阈值和等级声明；硬升级清单原样保留，那是本项目的真实坑 |
| 6 | 上下文智能管理 | 按需模块 + 触发词注入（11 次/16 天）、核心 HTML 注释剥离、`claudemd` 命令 `disable-model-invocation` | 大头在 `MEMORY.md` 索引（19 KB）、兄弟插件逐次召回（18.6 KB/会话）、技能清单（22 KB） | R3（核心）、R7（索引行）、R8（召回去重）、R11（技能清单）；目标和复测方法见第 6 节 |
| 7 | 记忆智能管理 | 三层：harness 内置四类 + `MEMORY.md`；claude-mem-lite（SQLite、`mem_*`、deferred）；规范 `memory.md`（分工表、决策树、标签语法）+ §11 Auto-memory + 项目 `CLAUDE.md` 的 mem-lite 表 | 写入规则三处各写一遍；harness 现在原生写了"先查重、不存仓库已有的、问非显然之处" | 一张分工表 + 三条写入触发 + 一条读取规则，放核心（≤8 行）；`memory.md` 删决策树和过滤器（R7） |
| 8 | 智能工具和技能调用 | v7.3.0 已把技能路由删到一句；§2.1 还有工具升级阶梯（Grep → 语义搜索 → 影响分析）；项目 `CLAUDE.md` 有 code-graph 表 | 阶梯和项目表重复；bypass 模式下 harness 自己偏好 Bash | 核心只留"did we / why → memory first"一句；工具表留在项目 `CLAUDE.md`（那是项目的事实） |
| 9 | 无人值守：低风险可逆的歧义自己决定、记下理由继续；需要拍板的列选项、代价、推荐 | harness 自主推进段；核心 §0 默认 (a) ASK、§1 Zero-assume、§0.2、§11 Correction pressure | 规范默认与 harness 和用户要求相反 | R2：一条"决定—记录—继续"规则；问只保留两种情形（§5 硬授权、不可逆且读法分歧）；拍板项统一进汇报的"遗留" |
| 10 | 长任务 / yolo：hook 只拦高风险；深入思考、按建议执行；拍板留在后面 | 11 次拒绝 / 48 会话，全部是 §8 或发版关卡；§11 turn-yield 禁止中途停 | hook 已满足；规范文字约 1.2 KB 与 harness 重复 | hook 不放松；删 §11 turn-yield 散文（§2.1）；"深入思考"由 effort 控制，不加"think carefully"类指令（官方建议） |
| 11 | 文件和文档科学存放 | 约定散在记忆里：`docs/` 文档、`docs/audit/` 轮次报告、`tasks/specs/` spec、`tasks/*` 本地（`.gitignore` 第 97 行，有 54 个被显式跟踪的例外） | 没有一处写成规则 | 核心加 4 行目录约定（R10）；本仓库的例外写进项目 `CLAUDE.md` |
| 12 | 测试完自动清理 | §8.V4、`residue-audit` / `sandbox-disposal-check` / `tmp-sweep` 三个 Stop/PostToolUse hook、harness scratchpad | 规则没提 scratchpad；两个 hook 不认识它 | 规则两行（2.1 表末行）；hook 加 scratchpad 路径（R10） |
| 13 | git 标准工作流 | §7 Commit 行、项目 `CLAUDE.md` 的发版分支约定、`ship.md`、`branch-prune` / `ship-baseline-check` hook | 与 harness "用户没要求不提交"冲突 | R9：一段四句的工作流，写明优先于 harness 默认 |
| 14 | 全局规范用英文 | 核心是英文；§7 的中文禁用语、§10 的中文速查是刻意的 | 中文禁用语已在 `hooks/banned-vocab.patterns` 里由 hook 匹配 | 核心删中文禁用语清单，hook 保留；中文只留触发词（例如模块触发正则） |
| 15 | 汇报：`## 汇报`，变更 / 验证 / 遗留，空的省略，微改一句话 | §10（约 1.9 KB）：四段 HARD 顺序、L0/L1/L2 三种变体、Honesty 五条、Specificity、禁用词速查；`verify.md` §10-R 再写一遍 | 四段标签 25% 遵循；`[PARTIAL]` 0 | R1：用用户格式替换；保留三条诚实规则（证据句写"查了什么、看到什么"；"做好了吗"先答是否；遗留项不加"小 / 可选"一类评价）；三个解析四段格式的脚本改判据 |

---

## 5. 建议（按优先级）

每项写依据、效果、风险、验证。P0 为同一个版本（规范 v8.0.0，插件 0.109.0）；P1 可以同版或下一版；P2 由用户决定。

### R1（P0）汇报格式换成用户的三段式

- **改**：核心 §10 整段和 `verify.md` §10-R 替换为（英文，放核心）：

  ```
  ## REPORT
  Write `## 汇报` in the user's language, three parts, omit empty ones:
  **变更** what changed, files, commit and branch, spec path if one exists;
  **验证** each command with one of 通过 / 失败 / 未运行 / 无法运行; pre-existing failures and regressions you introduced on separate lines;
  **遗留** unfinished items, risks, decisions the user must make (options, cost, your pick).
  A trivial change reports in one sentence. This shape overrides the harness's no-header rule; its other writing rules stand.
  Evidence: a claim of done / fixed / passing names what was run and what was observed in this session; a bugfix also names the failure seen before the fix. Asked "did it work?", answer yes or no first. Do not grade 遗留 items (no "minor", "optional").
  ```

- **删**：`[PARTIAL]` 信号（0 次使用；它的内容就是"验证：未运行 / 无法运行"和"遗留"）；四段顺序 HARD；L0/L1/L2 三种报告变体；Specificity 的措辞清单和禁用词速查（hook `banned-vocab.patterns` 继续在提交信息上拦，`transcript-vocab-scan` 继续记录）。
- **依据**：3.4 节的遵循率；harness 的写作规则（先结论、数字进表格）与新格式一致；用户明确要求。
- **效果**：核心 −1.5 KB 左右，`verify.md` −1 KB。
- **风险与联动**：三个脚本解析旧格式。`transcript-structure-scan.sh` 的 `§10-four-section-order` 和 `iron-law-2-anchor` 两项检查按 `Done:` / `Not done:` 找行；`evidence-gate.sh` 把 `[PARTIAL` 当作"证据不足的合法说法"；`scripts/sampling-audit.js` 有四段格式的检测器。三处改成识别 `**验证**` 段里的 通过 / 失败 / 未运行 / 无法运行 四个词，`[PARTIAL` 的豁免改成"验证段含 未运行 或 无法运行"。`evidence-gate` 的通道受 G1b 预注册约束（10-26 前不改它的判定或通道），所以这一项的 hook 改动放在 10-26 之后发。
- **验证**：离线 A/B 任务 h（第 7 节）：10 次里 ≥9 次回合末是三段式且验证段每条带四个词之一。

### R2（P0）"不确定就问"改成"决定、记录、继续"

- **改**：§0 的 Initial-prompt ambiguity、§0.2、§1 Zero-assume、§11 Correction pressure 四处合成一条，放核心 §0：

  ```
  Ambiguity: when the readings differ and the wrong pick is reversible within the task, pick one, write the choice and the reason into the spec's 决策与进展 (or the report's 遗留 when there is no spec), and continue. Ask only (a) at a §5 hard-AUTH boundary, or (b) when readings lead to materially different work and the wrong pick is not reversible; put every such question at the end of the report, with options, cost and your pick. A subagent never asks: it states its reading and stops at a hard-AUTH boundary.
  ```

- **删**：`[AUTH REQUIRED]` 保留（5% 使用，且是硬授权的唯一结构化信号）；"ASK once with candidates" 的默认 (a)、"reversibility >10min" 阈值、Correction pressure 删。
- **依据**：harness 原文（2.1 表第二行）；用户第 9、10 项；Fable 5 指南 "If you are too specific, Claude will follow your instructions even when a pivot may be more appropriate"（10-15 评审附录 S29）。
- **风险**：问得少了，错误决定的代价要靠"可逆"这个条件兜底。硬授权清单（删除、迁移、CI、依赖、密钥、支付、跨模块重构、公共 API 契约、L3 进入实现、未知 npx）原样保留，它就是"不可逆"的清单。
- **验证**：离线 A/B 任务 g：给一个措辞有歧义但两种读法都可逆的任务，10 次里 0 次中途提问，≥9 次在 spec 或汇报里写了决定和理由。

### R3（P0）删掉 harness 已写的段落

2.1 表的"删"列逐条执行。按核心各节现有字节估算：§0 1,690 → 约 900；§0.2 343 → 0；§1 1,686 → 约 1,000（原则换成用户六条）；§1.5 846 → 约 300；§2 1,783 → 约 900；§2.1 1,319 → 约 400；§3 1,398 → 约 800；§5.1 639 → 0；§10 1,933 → 约 600；§11 2,792 → 约 900；`modes.md` 4,235 → 0（P2 读取 0 次、提示词触发 0 次、三种模式 harness 已覆盖）。估计核心 23.2 KB → 12 KB 上下。每一处删除都按 `feedback_spec_dedupe_is_not_restatement` 的四步走：grep 原句、对照两边成员、查引用方、预期评审会恢复一部分。`hard-rules.json` 的 26 条随删除同步，被删条目的 `section_anchor` 不能留空指。

### R4（P0）语言和原则换成用户的措辞

- **语言**（替换 §1 Language contract）：

  ```
  ## LANGUAGE
  Reply to the user, and ask the user, in 简体中文. New documents under docs/ are in 中文; an existing document keeps its language. Everything else is English: code, comments, identifiers, test names, commit messages, log text, skill and agent files, todo items, subagent prompts. Exceptions: UI copy and commit messages follow the project's existing convention. Task notifications, hook text and subagent reports are not the user: they never change the reply language.
  ```

- **原则**（替换 §1 Principles）：

  ```
  ## PRINCIPLES
  - Think first. Before editing, state your reading and assumptions in one or two sentences (skip for trivial changes), then start.
  - Simple first. Write only what this problem needs: no unrequested features, abstractions, options, compatibility branches, or defensive code for cases that cannot happen.
  - Precise edits. Every changed line traces to the task; point out unrelated problems, do not fix them in passing.
  - Evidence before claims. Say done / fixed / passing only after running the check in this session and reading its result, or after reading CI for the current commit. Library APIs, versions, flags and config keys come from installed source, --help or official docs, not memory.
  - Fix at the root. Reproduce first, state the cause-to-symptom chain, then change; look for the same defect elsewhere. Cannot reproduce: write down what was ruled out, do not guess. Same approach failing twice: change approach; no new evidence: no retry. Out of permissions, environment or ideas: record the blocker and the next step and stop; a blocker is not completion.
  - Never pass by weakening checks. Do not delete, skip or loosen tests or silence lint; a wrong check gets fixed and the fix reported.
  ```

- **依据**：用户原文；10-15 评审 2.2 节的社区测量（Opus 5 上成本 −22.8%）支持 Smallest diff，"Simple first"保留了它。
- **风险**："Evidence before claims" 比 Iron Law #2 少了"bugfix 引用修前失败"，所以 R1 的 Evidence 行把它补回；两处不重复写第三遍。

### R5（P0）spec 模板整体替换 §2.S，`-paused.md` 退役

- **改**：`plan.md` §2.S 的 Body 换成用户模板（spec 文件正文用用户语言，标题沿用用户的中文；规范里给英文说明和中文骨架）；路径仍是 `tasks/specs/<slug>.md`；L3 必建，L2 跨模块或 >50 LOC 时建（现行条件不变）。
- **退役**：`tasks/<slug>-paused.md` 和 `tasks/lessons.md`。中断交接写进"决策与进展"（当前进行到哪、阻塞、待确认），教训按 R7 进记忆。`session-start-check.sh` 的 `paused-banner`（16 天 20 次，说明交接在用）改为列出 `tasks/specs/` 下"状态：进行中"的文件；`session-end-check.sh` 和 `scripts/status.js` 同步。
- **依据**：用户"只维护这一份"；harness 压缩后恢复靠摘要，spec 文件是摘要之外唯一稳定的锚，§11 "压缩后重读 spec" 一句指向它。
- **风险**：中断时不再有专门文件，依赖模型及时更新"决策与进展"。缓解：`session-end-check.sh` 在有"进行中"spec 且本会话未改它时提示一次。
- **验证**：现有 `paused` 相关测试改写；A/B 任务 j：长任务中途 `/exit` 再恢复，spec 文件能让新会话接上。

### R6（P0）分档改成按风险定义

- **改**：§2 的表和 §1.5 的 LOC / Local-Δ / Module 定义换成：

  ```
  ## LEVELS
  L0 wording only (docs, comments, style) → do it, one-line report.
  L1 small and local: one or two files, no exported symbol, config, schema or CLI change → tests for the change, affected tests green.
  L2 crosses a contract or a module boundary, adds a test surface or an optional schema element → failing test first, full suite and smoke green, report with numbers.
  L3 architecture, breaking schema or migration, prod, infra, a released artifact's default behaviour, LLM-visible metadata (tool descriptions, prompt templates, this spec) → spec file first, hard AUTH before implementation, independent review before tag.
  Pick the level by risk and reversibility, not by line count; a bugfix that restores documented behaviour is at most L2. Upgrade the moment the scope grows; say so in one line.
  ```

- **删**：等级声明要求、Provisional、Bugfix triage 三行、Schema-Δ 细则（并入 L2/L3 两行）、Depth triggers（和 harness 的 effort 机制一致，不需要说）。
- **依据**：等级声明 6% 遵循；硬升级清单是本项目两次事故的来源（发布物默认行为、LLM 可见元数据），保留原意。
- **风险**：去掉行数后"L1 还是 L2"的边界靠判断。这正是 Fable 5 指南说的"brief instruction rather than enumerating"，A/B 任务 a–d 覆盖四档。

### R7（P1）记忆：一张分工表，索引行限长

- **改**：核心 §11 Auto-memory 三句和 `memory.md` 合并成（放核心）：

  ```
  ## MEMORY
  Durable (harness file memory, MEMORY.md index): user preferences, corrections to how you work (feedback), project decisions and constraints not derivable from code, external references. Recall plugin (claude-mem-lite): bugfix lessons and decisions tied to a diff, recent state; it ages out. Spec file: decisions made inside a task.
  Write: user corrects you → feedback; a non-obvious decision or sequencing → decision; a non-trivial bug fixed → bugfix with root cause. Index lines ≤ 120 characters: title, tags, one hook.
  Read: index tags that match the task → Read the file before shipping, deleting or releasing; otherwise the hooks' injected recall is enough. A recalled note describes the code as it was: check it against the code before acting on it, and replace it when the code disagrees.
  ```

- **删**：`memory.md` 的 User-override filter、决策树三步、Always-skip 清单（harness 原文已写）；保留标签语法（hook `memory-tags.sh` 解析）和 ship-runbook 单文件规则，模块从 5.4 KB 收到约 1.5 KB。
- **索引行**：本项目 `MEMORY.md` 30 行、19.3 KB，每行约 640 B，带整段摘要。harness 要求"one line per memory … never put memory content there"。改成 ≤120 字符后约 4–5 KB。`doctor.js` 加一项 `memory:index-line-length` 提示。
- **风险**：索引变短后，`memory-prompt-hint` 的标签匹配不受影响（标签保留），但靠摘要判断"要不要读"的信息少了；R7 的"匹配即读"规则补上。
- **验证**：复测 3.1 节的 `MEMORY.md` 字节；`memory-prompt-hint` 的测试全绿。

### R8（P1）兄弟插件的逐次召回去重（claude-mem-lite，同一维护者）

- **现状**：每次 Bash 前注入一段，1,180 次全部非空，18.6 KB/会话，占 hook 注入的七成。
- **建议**（在 claude-mem-lite 仓库做）：没有命中记忆时不输出；同一条记忆一个会话只注入一次；"📄 文件 ~N tok"的体积提示只在文件超过阈值时出现。
- **效果**：估计 hook 注入 25.6 → 8 KB/会话以下；要在那个仓库复测。
- **不是本插件的改动**，列在这里是因为用户第 6 项的目标在那里。

### R9（P1）git 工作流写成四句，裁决与 harness 的冲突

```
## GIT
On the default branch, branch first. Each validated change is its own commit with a conventional prefix (fix / feat / test / docs / release); this project convention overrides the harness's commit-only-when-asked default. Push, tag and release only when the user asks, through the project's release runbook; CI must be green on the pushed branch. Project `AUTO_COMMIT: off` opts out.
```

### R10（P1）目录约定、清理规则、hook 的 Bash 通道

- **目录约定**（核心 4 行）：`docs/` 面向人的文档（分析文档带日期，参考文档大写名）；`docs/audit/` 轮次报告；`tasks/specs/` spec 文件；`tasks/<slug>/` 任务底稿，本地不入库；临时文件只进 harness scratchpad。本仓库 54 个被跟踪的 `tasks/` 例外写进项目 `CLAUDE.md` 一句。
- **清理规则**（§8.V4 替换）：临时文件进 scratchpad；写到别处的测试或探针产物在汇报前删除；创建者负责，不靠定时。`residue-audit.sh`、`sandbox-disposal-check.sh` 加 scratchpad 路径（`cross-repo-write-check.sh`、`session-end-check.sh`、`pre-bash-safety-check.sh` 已认识）。
- **Bash 通道**：`session-extended-read.sh` 增加对 `cat` / `sed -n` 读规范文件的识别，或者退役（它的作用是记录 extended 被整读，v7.2 拆模块后这个指标意义已变）。

### R11（P2，用户决定）技能清单

技能清单 22 KB 是固定上下文的第二大项。40 天里按 description 被模型选中的 16 次调用没有一次来自 anthropic-skills（docx / pptx / xlsx / pdf / docs，4.4 KB）。可以在用户级停用不用的插件，或给只由用户调用的技能加 `disable-model-invocation`。这是用户习惯，不替用户定。

### R12（P2）K6 消融、K9 补理由、K7 子代理 `omitClaudeMd`

维持 10-15 评审 9.2 节 的决定：K6/K9 等 10-29 复测后再定，K7 不做。本文的 R3 删除如果让核心降到 12 KB，K6 的候选项大多已随 harness 重复段一起删掉，消融的对象会变小，到时重算。

---

## 6. 上下文预算：现在和目标

| 项 | 现在 | 目标 | 手段 |
|---|---|---|---|
| 核心 | 23.2 KB | ≤12 KB | R1–R6 |
| 按需模块（合计） | 41.0 KB | 约 28 KB | `modes.md` 删（−4.2）、`memory.md` −3.9、`verify.md` −1、`session.md` −1.5、`orchestrate.md` −1 |
| `MEMORY.md` | 19.3 KB | ≤5 KB | R7 索引行限长 |
| 技能清单 | 22.0 KB | 用户定 | R11 |
| 项目 `CLAUDE.md` + 规则 | 4.1 KB | 不变 | |
| hook 注入 / 会话 | 25.6 KB | <8 KB | R8（兄弟插件）、superpowers 停用已省 3.9 |
| **固定 + hook** | **约 92 KB** | **约 45 KB** | |

目标列是估计值，不是承诺；实施后用 `tasks/spec-v8-2026-10-15/` 的两个脚本复测，复测数写进发版说明。

---

## 7. 实施与验证

### 7.1 顺序

1. 在 `release/0.109.0` 分支上做，规范版本 v8.0.0（汇报格式和信号变了，解析它们的 hook 跟着变，按语义化版本算破坏性）。
2. R4 → R6 → R2 → R3 → R1 → R5 → R7 → R9 → R10，每项一个提交，提交前 `npm run check` 和 `npm run smoke` 绿。
3. `hard-rules.json`、`spec-structure` 的整行钉、`hard-rules-drift`、`spec-coherence-audit --strict` 同步；版本级联六处。
4. 离线 A/B（7.2），打 tag 前独立评审，再按 runbook 发版。
5. **时机**：lang-drift 和 G2 两个评估窗口 10-26 关闭，G1b 预注册禁止在那之前改 `evidence-gate` 的通道。建议分支上做完、评审完，10-26 后合入 `main` 并打 tag。要提前发，就得在两份 PREREG 里写明窗口作废，这是用户的决定（第 8 节）。

### 7.2 离线 A/B（实施前的关卡）

- **模型**：Fable 5.1。本机 09-30 以来的 211 条回复全部是 Opus 5.5，还没有 Fable 5.1 的会话数据，所以这次 A/B 同时是新模型上的第一次基线。
- **环境**：`claude -p`，`--setting-sources project`，临时 HOME 装同样的插件；多回合任务要持久化会话并 `env -u CLAUDE_CODE_COORDINATOR_MODE`（`feedback_measure_offline_before_waiting_for_windows`）。
- **臂**：A 为 v7.3.0；B 为 v8.0.0 草案。
- **任务**：

  | 任务 | 内容 | 判据 |
  |---|---|---|
  | a–f | 沿用 10-15 评审 7.2 节 的六个（L0 改字、L1 小改、难复现 bug、新功能、研究、fixture 发版） | 技能调用 L0/L1 为 0；先复现、先红、发版前评审各 ≥ A 臂 − 1 |
  | g | 措辞有歧义、两种读法都可逆的任务 | 中途提问 0/10；决定和理由写进 spec 或汇报 ≥9/10 |
  | h | 任一多步任务的回合末回复 | 三段式且验证段每条带 通过 / 失败 / 未运行 / 无法运行 ≥9/10 |
  | i | 在 `main` 上的多改动任务 | 先开分支、逐改动提交、不推送 10/10 |
  | j | 长任务中途退出再恢复 | 新会话从 spec 文件接上，不重做已验证的切片 ≥8/10 |
  | k | 写探针脚本的任务 | scratchpad 之外无残留 10/10 |

- **规模**：11 个任务 × 2 臂 × 10 次 = 220 次。按 v7.3.0 A/B 的单价（多步任务约 $0.65、短任务约 $0.22）估 $80–100；先跑 5 次/格做筛，只对差异处补到 10 次，可以压到 $50 上下。
- **通过标准**：a、b、f、i、k 为硬性；c、d 的承重行为不低于 A 臂减 1；g、h、j 达标。

### 7.3 发版后测量

时钟从第一条 `hook_version` 为新版的日志行开始（`feedback_eval_clock_starts_at_exposure`）。

| 指标 | 基线（第 3 节） | 预期 |
|---|---|---|
| 固定上下文 / 会话 | 约 66 KB | ≤45 KB（含 R7，不含 R11） |
| hook 注入 / 会话 | 25.6 KB | R8 落地后 <8 KB |
| 回合末三段式汇报 | 四段标签 25% | ≥70% |
| 中途提问（以问号结尾） | 6% | 不升 |
| 先复现 / 先红 / 发版前评审（A/B） | 5/5 | 不降 |
| `[AUTH REQUIRED]` | 5% | 只记录 |
| hook 拒绝 | 11 / 16 天 | 不升 |

---

## 8. 需要用户拍板的事

| # | 事项 | 选项 | 我的建议 |
|---|---|---|---|
| 1 | 发版时机 | (a) 分支上做完，10-26 后合入；(b) 现在发，两份 PREREG 窗口作废 | (a)。两个窗口只剩 11 天，作废的代价是 D#72、D#172 两项评估重来 |
| 2 | 汇报格式换成三段式 | (a) 换，三个解析脚本随之改；(b) 保留四段 | (a)。四段标签 25% 遵循，`[PARTIAL]` 0 |
| 3 | 提交约定 | (a) 逐改动提交，明示覆盖 harness 默认；(b) 跟 harness，只在用户要求时提交 | (a)。本仓库的发版流程和 `branch-prune` 都建立在它上面 |
| 4 | `-paused.md` 和 `lessons.md` 退役 | (a) 退役，交接进 spec；(b) 保留 | (a)。用户要求只维护一份 |
| 5 | spec 文件正文语言 | (a) 中文（用户模板原样）；(b) 英文 | (a)。它是给用户审阅和交接的，不是代码 |
| 6 | 技能清单 | 停用 anthropic-skills 等 40 天 0 调用的插件 | 建议停用，但这是使用习惯 |
| 7 | claude-mem-lite 召回去重 | 在兄弟仓库开一个任务 | 建议做，收益是本文最大的单项 |

---

## 9. 局限

- **没有 Fable 5.1 的本机数据**。§3 的 211 条回复全部来自 Opus 5.5；本文对 Fable 5.1 的判断来自官方指南和本会话的系统提示词，7.2 的 A/B 是第一次实测。
- **系统提示词只读了一种模式**。§2 的原文取自 `bypassPermissions` 的 CLI 主会话；"自主推进"一段和"用 Bash 编辑"一段可能只在这个模式下出现，SDK 和 `--system-prompt` 用户看不到它们。规范仍要跨模式成立，所以 R2 写的是规则，不是"harness 已说过所以删"。
- **回合末回复的正则**只认英文标签和中文"汇报"字样，可能漏掉其他写法；6% 的"以问号结尾"是粗指标。
- **16 天、48 个会话、一台机器、一个使用者**。
- **hook 字节按 `hook_success` 附件计**，Claude Code 似乎只在有输出时记这条记录，所以"触发次数"低于日志里的行数；可见字节不受影响。
- **目标字节是估计**，核心的删减在评审后通常会恢复一部分（v7.2.0 恢复了 8 处）。

---

## 附录 A：复现

```bash
python3 -I tasks/spec-v8-2026-10-15/ctx_scan.py    # section 3.1: fixed attachments + skill listing
python3 -I tasks/spec-v8-2026-10-15/hook_scan.py   # section 3.2: hook bytes by plugin
jq -r 'select(.ts >= "2026-09-30") | "\(.event)\t\(.hook)\t\(.spec_section)"' ~/.claude/logs/claudemd.jsonl | sort | uniq -c | sort -rn | head -25   # section 3.3
```

脚本里的 `SELF` 是本次测量会话的 id，复测时换掉；`SINCE` 决定起点。

