# Spec 优化路线图 — 2026-09-21(第三次审核版)

**针对对象**:AI-CODING-SPEC v6.30.0(core 24,940B = 25,000B 上限的 99.8%,余量 60B;extended 46,470B,余量 3,530B)+ claudemd plugin v0.89.0 + Claude Code 2.1.278。

**输入**:(1) 2026-09-21 对 `~/.claude/projects` 全量 178 份 transcript 的行为测量;(2) 使用者当日提出的目标与 7 条改进提案;(3) 仓库自有仪器 `tasks/sampling-audit-2026-09-07.md`、`tasks/sampling-detector-labeling-2026-07-24.md`、`scripts/spec-coherence-audit.js` 实跑;(4) Claude Code 官方 hooks / skills 文档(2026-09 版);(5) 仓库记忆层中与"评审后推翻"直接相关的四条记录。

**性质**:操作者决策文档。`docs/*` 默认 gitignore(白名单制),本文件未加入白名单 = local-only。**本文档不是执行授权**——涉及 spec 文本的改动走 §13 META,涉及 hook 行为的走 §13.3。

**与 `docs/spec-optimization-plan-2026-07-10.md` 的关系**:那份的 P1–P6 已全部落地。本文档不重开已关闭议题;其"全局不做清单"继续有效,第 10 节逐条声明关系。

**审核记录**:第一版有 4 处事实错误与 1 个建立在错误前提上的议题;第二版修正后,第三版按使用者重述的目标重组结构,新增第 0/1/6/8 节与 G7,并把 G1b 从"冒烟提醒"改为"证据存在性门"。全部修正清单见附 B。凡本版数字与口头讨论不一致,**以本版为准**。

**使用者裁定(2026-09-21,已落实到本版)**:(1) 技能选择无顺序,只按适配判据选最合适的(G4 表);(2) G4-A 重议通过——core §2.1 路由表压为指针,替换文本见附 C,执行走 §13 META;(3) 第 8 节 0a(hook 事件本机验证)与 0b(`doccheck.mjs` 固化)纳入执行序列。

---

## 0 目标、验收判据与全局约束

使用者的目标原话可归为四项。每项对应一个可测判据,判据的测量方式全部落在 G0(并入 `scripts/sampling-audit.js`)或现有遥测,**不新增测不到的目标**。

| # | 目标 | 判据(方向) | 测量来源 | 由哪些议题推进 |
|---|---|---|---|---|
| Q | 质量:多轮迭代后主功能仍不可用 | "完成声明无验证证据"的会话占比 ↓;有冒烟入口的项目其冒烟通过率 ↑ | G1b 遥测事件;G1a anchor 命中 | G1 → G5 |
| E | 效率:老是犯错、反复改 | 单文件 ≥8 次编辑的会话占比 ↓(基线 58.7%) | G0 `behaviorMetrics` | G2, G1 |
| L | 长任务:自动按规范推进、跨会话不丢状态 | compaction/resume 后 ledger 注入命中率;每任务 ask 次数;ledger 中"verified-done"条目均带证据指针 | G7 遥测;H4 计数 | G7(依赖 G1b) |
| S | 技能:三套插件任意子集下准确路由,小任务不调用 | L0/L1 段零 ceremony 调用(已成立:C1 rate 0);条件式路由表覆盖三套插件的存在/缺失组合;是否提高调用率由 B 实验判定 | C1;G4 实验判据 | G4 |

**全局约束(本路线图自设,HARD)**:**净新增 core 字节 = 0;G4-A 执行后 core 净减约 700B(附 C 逐项核算)。** 每个议题的机制只能是 hook 侧、Tier-2 anchor、或 extended(余量 3,530B);凡需 core 加字的,必须 paired deletion。理由见第 1 节 H-A 的裁决。

---

## 1 使用者提出的两个假设的裁决

### H-A "核心规范提示词太多,占据上下文分散注意力"

**裁决:未检验,且在本环境无法低成本检验。** 依据:

- 07-10 计划 B3 已明确"不做 token 成本优化",理由是"真实约束是注意力竞争,其可观测代理是 A5 遵从率"。**A5 的检测器已于 2026-07-24 全部标注失败并关闭**(第 2 节),所以 B3 选定的代理从未产出可用数字——H-A 既没有被支持,也没有被否定。
- 能区分 H-A 的实验(spec 有/无、长/短的对照)属研究级,在 07-10 不做清单内;core 自 2026-07 起一直贴着 25,000B 上限,没有自然的尺寸变化可做 ITS。
- 常驻上下文中 claudemd 只是一部分:superpowers 的 SessionStart 全文注入、约 80 条 skill description(每条 ≤1,536 字符)、三个 MCP server 的 instructions、MEMORY.md 索引、项目 CLAUDE.md 都常驻。单独压缩 claudemd 的效果有上界。

**处置**:不试图证明或证伪,把它转成约束——本路线图净新增 core 字节 = 0;G4-A 已裁定执行,core 净减约 700B(附 C)。

### H-B "规范和 hook 没有对应起来,没有牢牢把关"

**裁决:成立,且可以精确到条。** `spec/hard-rules.json` 的 26 条 HARD 规则:4 条 hook、5 条 both、**16 条 self**、1 条 external。这 16 条包括 Iron Law #1/#2/#3、§5 hard-AUTH、§8 verify-before-claim(V1–V4)、§10 四段式/诚实性、§11 turn-yield/post-compaction、§12 author-not-reviewer——**恰好是约束"声明是否有证据、是否前后一致、是否自审自批"的全部条款。**

hook 侧实测在工作的是另一类:§8-rm-rf-var 552 deny、§8-npx、§8-curl-sh、§7-ship-baseline、§8.V4、§11-memory-read。它们守的是**破坏性操作与流程**,不是**认知类失效**。使用者描述的三个症状(bug 多、前后矛盾、评审后推翻)全部属于认知类,而认知类 HARD 规则的 hook 覆盖是 0(唯一的相关 hook `hooks/transcript-structure-scan.sh` 是 advisory 且默认关闭,见 G1b)。

**这是本路线图的主线:把认知类规则中可机械判定的部分移到 hook 侧,起点是"完成声明必须对应会话内真实存在的验证输出"。**

---

## 2 先处理:决策点(零新增成本)

| 项 | 预登记处置 | 当前数据 | 建议动作 |
|---|---|---|---|
| **C2**(P3 superpowers 冲突) | over-ceremony < 5% → 保留,关闭 P3 | `sampling-audit-2026-09-07`:354 段 / 24 个 L0/L1 段 / ceremony 命中 **0** | **关闭 P3**;n=24 偏小,记入关闭说明 |
| **A4**(检测器标定) | precision ≥ 0.8 才进 dashboard | **已于 2026-07-24 完成**:178 个 flagged 全量标注,≥147 FP,precision 上界 **≤0.17**;6 个检测器 `closed`,§10-V 与 §11-turn-yield 修复后重新 `collecting` | **无逾期。** 本文档接受 closed 判定,**不引用任何 closed 检测器的率**(3.4) |
| **D1**(Provisional 升级正式化) | anchor 30d 命中 ≥3 sessions → core 放宽 | 未见命中统计 | 跑一次计数;够则走 §13 META(需 paired deletion),不够维持 anchor |

> **H4**(Default-ASK):42 次已回答的 ask,assent 0——每次 ask 都带来了方向性信息,不是纯仪式。维持收集;对 G7 的含义见 4.5。

---

## 3 新证据(2026-09-21 测量)

### 3.1 方法

`~/.claude/projects/*/*.jsonl`,178 份 transcript,397 MB,2026-09-05 → 2026-09-21,约 64,300 条 assistant 消息,33,140 次 tool_use,逐行流式读取。与 `/claudemd-sampling-audit` **方法独立**:后者是启发式分类器(受 precision 门约束),本轮是工具调用与编辑的**精确计数**(无 precision 问题,有效度问题,见第 11 节)。复现见附 A。

### 3.2 测量结果

**(a) 技能路由层不产生调用**

```
Skill 工具调用          61 / 33,140 tool_use  =  0.2%
  gstack 21 · superpowers:systematic-debugging 5 · writing-plans 2 · test-driven-development 1
  mattpocock 全部工程类 skill  0   (tdd / diagnosing-bugs / code-review / codebase-design / domain-modeling)
  gsd:* / superpowers:executing-plans  0
用户显式 slash 调用 242 次,技能类 ≈27 次;经 slash 调用 mattpocock / superpowers / gstack: 0
```

三套插件可用时间(`~/.claude/plugins/installed_plugins.json` 的 `installedAt`;gstack 为目录创建时间):superpowers 6.3.0 @ 2026-09-05T19:59Z、mattpocock-skills 1.2.3 @ 2026-09-05T20:01Z、gstack @ 2026-09-05 20:13Z。语料起点同日,**全程可用**。期间同时在场的路由层三个:core §2.1 表(1,836B)、superpowers SessionStart 全文注入、gstack router(13,578B)。

官方机制(skills 文档):`description`+`when_to_use` 以 1,536 字符上限进 system prompt,完整 SKILL.md 仅在调用时加载;**无**会话起始强制加载字段;`paths` 可按文件 glob 自动激活;subagent 可用 `skills` 字段预加载完整内容。**0.2% 是在原生渐进式披露已生效的前提下测得的。**

> 保留:§2.1 soft-trigger 在 L0–L2 非阻塞,低调用率部分是设计如此;模型可能内联等效动作(不可观测)。能排除的只有一条:**§2.1 的表不是"让技能被调用"的有效工具。**

**(b) 返工是主导模式**

126 个有编辑的会话,每会话"最热文件"的 Edit/Write 次数(代码文件):`1-2: 6 · 3-4: 14 · 5-7: 31 · 8-14: 35(众数) · 15-29: 18 · 30+: 6`。任一类文件 ≥8 次:**74/126 = 58.7%**;仅代码 59/126 = 46.8%;仅文档 42/126 = 33.3%;单会话最高 **58 次**(`code-graph-mcp/src/mcp/server/tools/search.rs`)。

**(c) 测试被改弱不是主要失效模式**

1,618 次测试文件 Edit:加强 804(49.7%)· 不变 763(47.2%)· 弱化 37(2.3%)· 用例删除 14(0.9%)。**弱化+删除 51 = 3.2%。**

**口径复核(2026-09-22,已撤回一次错误更正)**:本节声称的口径是对的——这组数出自附 A 预登记的**严口径**
(代码扩展名 AND 测试目录/命名)。加上 `--until` 后可精确复算:

```
node scripts/sampling-audit.js --global --days=30 --until=1790021507 --json
  → behaviorMetrics.testEdits 1618,四分类 804 / 763 / 37 / 14
```

四个子计数与总数**逐项 Δ=0**。同一时刻宽口径给的是 1644 / 806,787,37,14——`neutral` 差 24,不是这组数。

**撤回记录**:2026-09-21 本节曾被加上一条"更正",断言这组数出自宽口径 `testedit.mjs`。那条更正是错的。
它的依据是在**晚了两小时**的语料上跑两个 matcher 得到 1677 vs 1652,并由此反推 1,618 属于哪一边——而当时
没有上界参数,两个数都不是测量时刻的数,这个推断没有判据。结论反过来了:严口径复算是逐项精确的。
错误的更正与它要更正的对象属于同一类缺陷,记在这里而不是悄悄删掉。

**(d) 核心规范缺少"功能是否真的能跑"这一概念**

`smoke|e2e|end-to-end|端到端|integration` 在 `~/.claude/CLAUDE.md` 命中 **1 处**——`§8.V3 Destructive-smoke`,语义是破坏性路径先沙箱,不是功能验证;其余 0 命中,仅见于 extended(L3)。

**(e) banned-vocab 的"缺口"是记录在案的设计决策**(第一版误判,已撤回)

`node scripts/spec-coherence-audit.js` CHECK 5:`termCount=8, uncoveredCount=0, acknowledgedCount=1, ironLaw2TermCount=7, ironLaw2Unenforced=6`。§7 未声明 `banned-vocab.patterns` 为其枚举;`能跑`/`it runs`/`应该可以` 经 2026-08-16 实测为 FP 敌对字面量,**有意不机械化**。第一版宽正则的 61 次"命中"与 2026-07-24 标注 FP-1(8/8 在路径或引号里)同类,不作证据。

**(f) 工具分布**:Bash 22,517 · Edit 5,977 · Read 2,579 · Write 783 · Agent 393 · SendMessage 443 · Skill 61。Agent 是 Skill 的 6.4 倍——**委派存在,只是不经 skill 层**。

**(g) transcript 中可供 hook 使用的证据结构**:tool_result 记录带 `tool_use_id`、`content`、`is_error`(抽样一份 4,366 记录的 transcript:657 条 tool_result)。这是 G1b 的可行性基础。

### 3.3 分层(07-10 方法学附注 #5)

| 指标 | external(其他项目) | self(claudemd) |
|---|---|---|
| 返工 ≥8 次 | 65/109(**59.6%**) | 9/17(**52.9%**) |
| Skill 占 tool_use | 50/28,099(**0.2%**) | 11/5,055(**0.2%**) |
| 测试 Edit 弱化+删除 | 3.2% | 2.2% |

三项在两层接近一致,不是 dogfood 假象。

> **读取时刻(2026-09-22 补记)**:第二行的两个分母不是同一瞬间读出的(external 20:14:25 / self 20:14:49),
> 相加比 3.2 的 tool_use 多 14。按 3.2 的同一时刻复算是 external 28,091 与 self 5,048,相加与 3.2 差 1;
> 占比两层仍各为 0.2%,第一行与第三行逐项复现。推导命令与完整交代见附 A。

### 3.4 仓库自有仪器的现状——为什么不引用它的遵从率

`sampling-audit-2026-09-07` 报 §iron-law-2 = 8/30 = 0.267 等,但这些检测器已 **closed**(`scripts/sampling-audit.js` CALIBRATION 表):§iron-law-2 指纹认不出 `**264**` 与 N/N,标注 1/1 FP;§5-hard-auth ≤0.16;§7-bugfix-anchor ≤0.25;§11-post-compaction ≤0.41;§10-honesty 分母 4;§10-four-section-order 零正样本。仅 §10-V、§11-turn-yield 在 `collecting`。**仓库当前没有任何一条自执行 HARD 规则有可用的遵从率。**

关键教训(直接决定 G1b 的设计):这批检测器全部是**从 prose 里认证据**——找 `Checked:`、找数字、找 `passed`——而 prose 的形态无穷(加粗、比值、中文、表格),precision 因此崩塌。**可机械判定的不是"prose 说了有证据",而是"transcript 里存在证据"。**

### 3.5 "评审后推翻"在记忆层已有的画像

四条记录,全部来自本仓库近三个月的发版:

- claude-mem-lite #108(2026-09-13,v0.88.0):**代码从第一个提交起就是对的**——909 条命令差分 verdict_diffs=0、7 次 CI 全绿、4 次变异检验按预期;而五轮预发评审的每一条阻断项都是"陈述超出代码":行数虚报 881→898(真值 813→829)、说"两个 deny 闸门"实为三个、注释承诺的文件被 gitignore 挡住从未入库……十余处。根因:可推导的量被写成 prose 常量后,没有任何东西再去核它。
- `feedback_prose_repair_lands_in_the_neighbour`(v0.85.0):九处 prose 缺陷、零代码缺陷、七轮评审;修一条从句时缺陷落到相邻从句。
- `feedback_absence_only_assertions_miss_new_lies`:四轮评审都在同一条消息上,断言"不再说 X"约束不了"现在说的 Y 是否为真"。
- `feedback_revert_the_component_not_the_next_defect`:四轮评审五个假阴性同源一个组件,逐轮修下一个缺陷而不回退组件。

**含义**:使用者感受到的"修改后审核后又推翻",在本仓库的实测里**大部分是陈述层的往返,不是代码层的往返**。这一部分不是 hook 能拦的,也不是规范条款缺失——是 §10 精确性要求与"可推导量写成常量"的写作习惯之间的摩擦。处置在 4.4。

---

## 4 诊断:为什么多轮迭代仍留下缺陷、AI 为什么反复

**4.1 返工等于爬山,不等于诊断**。58.7% 的会话存在单文件 ≥8 次编辑,最高 58 次——"改 → 跑测试 → 红 → 再改"的循环。§1 "Root cause over patch" 是纯"劝"层规则。

**4.2 爬山收敛到的是测试套件,不是功能**。若测试带 mock,收敛得到绿色的 mock。本仓库实证:`feedback_replay_real_commands_not_corpus`——751 行语料全绿,同时 8 条真实命令是坏的。推论:**oracle 错位时,增加迭代轮数会加深对测试盲区的贴合。** 这是"迭代多次、主功能仍不可用且未被发现"的完整机制。

**4.3 规范在这条链路上的位置**。L2 验收 = `lint + typecheck + test → 带数字的证据`。"绿"强制、"带数字"强制、**"被测路径是否用户可见"无要求**(3.2d)。最省力的合规证据是 `tests N/N passed`——证据要求在无覆盖要求时,倾向选出对测试套件过拟合的行为。**这是规范可归因的部分**:不是缺陷成因,是缺陷通过验收的路径。

**4.4 陈述往返的成因与处置**。3.5 的四条记录指向同一根因:可推导的量写成 prose 常量。处置**不是**改 §10(它是诚实性层,且 core 无余量),而是两条已在记忆层的纪律:(i) 不写计数,写判据 + 推导命令;(ii) 断言必须是正向约束(说了什么为真),不是缺席约束(不再说什么)。G1b 的"证据存在性"设计与 (i) 同构:hook 核的是 transcript 里有没有那条命令,不核 prose 里的数字。

**4.5 长任务为什么发散**。上一会话对 `/converge` 的实测结论是"这个循环是发散的,不是收敛的",中途停下来 ask。H4 数据显示 42 次 ask 的 assent 为 0——ask 携带的是真实方向信息,**问题不在"问太多",在"该在任务开始时一次性定的决策,散落到了执行中途"**。加上 4.1–4.3:长任务把未经验证的"done"逐轮累积,到第 N 轮时账本上全是绿,而主功能不可用。长任务能力因此不是一个独立议题,它依赖 G1b(账本可信)+ G7(账本存在且跨 compaction 存活)。

**4.6 一处非对称(供 §13.1 参考,不据此提 demote)**:"教怎么干活"的条款随模型能力提升边际价值下降;"约束不要相信自己的信心"的条款边际价值上升。

---

## 5 四层执行模型与可用的 hook 机制

| 层 | 机制 | 确定性 | 现状 |
|---|---|---|---|
| **拦** | hook deny / block | 确定 | 9 条(4 hook + 5 both),守破坏性操作,实测在工作 |
| **测** | 外部 oracle:冒烟 / CI | 确定 | **缺失**(3.2d) |
| **隔** | 拓扑:写/验分离、状态外置 | 确定 | **缺失** |
| **劝** | 规范文本 | 概率性 | 16 条 self,其中认知类 hook 覆盖 0 |

**分配判据**:重要的规则落在 拦/测/隔;只能落"劝"的,要么写短,要么不写。

**Claude Code 2.1.278 可用事件**(官方 hooks 文档核实):

| 事件 | 可阻断 | additionalContext | 本仓库现状(`hooks/hooks.json`) | 本路线图用途 |
|---|---|---|---|---|
| `PreToolUse` | 是 | 是 | matcher 仅 `Bash`、`Read` | — |
| `PostToolUse` | 否 | **是(本轮实测:模型原样引回注入的 token)** | 两个条目:matcher `*`(transcript-vocab-scan)与 `Edit\|Write`(rework-breaker,v0.90.0) | G2 已落地 / G6 不做 |
| `UserPromptSubmit` | 是 | 是 | version-sync、memory-prompt-hint | G4-B2 |
| `Stop` | 是(exit 2) | 有限;有 `last_assistant_message`;`transcript_path` 可能滞后 | 6 个脚本;其中 5 个写 stderr advisory(`session-summary.sh` 不写),`transcript-structure-scan.sh` 与 v0.90.0 的 `evidence-gate.sh` 默认关闭 | **G1b** 已落地、G7 |
| `SessionStart` | 否 | 是 | `source=compact` 分支已实现(F4) | G7 注入 |
| `PreCompact` / `PostCompact` | — | — | 未注册;**PreCompact 实测会触发**(手动 `/compact`),PostCompact 本轮未取得证据 | G7 写账本 |
| `SubagentStart` / `SubagentStop` | — / 是 | — | 未注册;**两者实测都触发**,载荷带 `agent_id` / `agent_type` / `agent_transcript_path` | G5 |
| `TaskCompleted` | 文档列出 | — | 未注册;**实测 4 个会话全程未触发一次** | G1b 候选 → **不采用**,G1b 挂 `Stop` |

**0a 本机验证(2026-09-21,12.1 项 3)**。方法:scratchpad 建临时项目 + 临时 `.claude/settings.json`,把
上表 12 个事件全部注册到同一个把 `hook_event_name` 与载荷键名落盘的脚本,再用 `claude -p` 跑 4 个会话
(不触碰 `~/.claude/settings.json`)。**先立对照**:第 1 个会话(单轮问答)落盘 `SessionStart` /
`UserPromptSubmit` / `Stop` / `SessionEnd` 四条——探针本身确实在工作,所以某个事件"没出现"才是证据而不是噪声。

| 会话 | 驱动动作 | 落盘事件 |
|---|---|---|
| 1 对照 | 单轮问答 | SessionStart · UserPromptSubmit · Stop · SessionEnd |
| 2 | Agent 工具派一个 general-purpose 子代理 | 上述 + PreToolUse ×2 · PostToolUse ×2 · **SubagentStart** · **SubagentStop** · Stop ×2 |
| 3 | `/compact` | SessionStart · **PreCompact**(带 `trigger` / `custom_instructions`)· SessionEnd |
| 4 | 后台命令 + 等待(模型改派了子代理) | 同会话 2 的形状 |

结论三条:(a) **`PreCompact` 触发**——会话 3 里 Claude Code 随后回 "Not enough messages to compact",
即 hook 在"是否真的压缩"之前就已触发;**自动压缩(而非手动)是否同样触发,本轮没有证据**,所以 G7 仍
保留 Stop 侧刷新作为退路。(b) **`PostCompact` 无证据**——本轮没有任何一次压缩真正完成,属"未测"而非
"不触发"。(c) **`TaskCompleted` 不可用**——4 个会话、31 次 hook 调用,覆盖工具前后、子代理起止、主/子
Stop、会话起止与 PreCompact,一次都没有;二进制里有这个字符串(`grep -a -o TaskCompleted <binary> | wc -l` = 26)只说明它被编译进去了,
不说明它会被投递,这正是 §8.V1 "存在 ≠ 行为"。因此 **D7 裁定:G1b 挂 `Stop`**。

---

## 6 架构:议题之间的依赖

```
G0 行为指标并入 sampling-audit ──► 所有 ITS 验收的基线
        │
G1b 完成声明的证据存在性门(Stop) ◄── 基石:没有它,其余议题的"done"不可信
        │
   ┌────┴─────────┬──────────────┐
G1a 冒烟 anchor   G2 返工熔断     G7 长任务账本 + compaction 保全
(让证据有意义)   (打断爬山)      (账本条目引用 G1b 认可的证据)
        │                              │
G5 写/验分离 ◄─────────────────────────┘
(验证 subagent 预加载 skill;SubagentStop 核输出)
        │
G4 技能路由(条件式表 + 实验)──── 独立于上游,但其实验判据依赖 G0
G3 撤回 · G6 不做
```

**为什么 G1b 是基石**:质量(Q)、效率(E)、长任务(L)三个目标的判据都建立在"完成声明可信"上。长任务把 done 逐轮累积;评审把 done 当输入;返工熔断需要知道"这次改完到底验了没有"。G1b 是唯一一个把认知类 HARD 规则(Iron Law #2)从"劝"移到"拦"、且判定口径可机械化的点。

---

## 7 路线图

### G0 — 行为指标并入 sampling-audit【前置】

- **层**:测量。在 `scripts/sampling-audit.js` 新增 `behaviorMetrics`:返工率、测试弱化率、技能调用率,复用其 transcript 读取、project-class 分层与预登记框架。三者为精确计数,不需 precision 标注;需登记**效度声明**(返工率 = 编辑形状,与缺陷率关联未测;弱化率 = hunk 级上界)。
- **预登记**:返工阈值 **8**;`isTest` = 代码扩展名 AND(测试目录 OR 测试命名),不得仅按 `spec/` 目录判定。
- **验收**:产出与 3.2/3.3 一致(分母 ±1)。**不做清单**:无冲突。

### G1 — "测"层:让完成声明对应真实验证【基石】

**G1a — 冒烟入口 anchor**(Tier-2,零 core 字节):项目根存在冒烟入口(如 `npm run smoke` / `make smoke`)时,L2 完成声明必须含该命令的真实输出与退出码;不存在时声明 `[PARTIAL: no-smoke-entry]`。**前置**:盘点现有项目的冒烟入口,多数项目没有则先补入口再启动 anchor。

**G1b — 证据存在性门**(Stop hook,advisory 起步 → §13.3 促升):

- **判定口径**(全部对 transcript 结构,不对 prose):
  1. 触发条件:`last_assistant_message` 含完成声明(复用 `scripts/sampling-audit.js` 已修复的 Done 形态归一化:`Done:` / `**Done**` / `### Done` / `- **Done:**`)**且**本会话有对代码文件(`\.(m?[jt]sx?|rs|py|go|sh|rb|java|c|cpp|h)$`)的 Edit/Write。
  2. 证据检索:transcript 中最后一次代码 Edit/Write **之后**,是否存在 Bash 的 tool_result,其 `is_error` 为假且内容匹配验证签名。签名分三级:**T1** 冒烟入口命令(G1a 注册的命令名);**T2** 测试/类型/构建运行器输出(`passed|failed|✓|✗|ok \d|Tests:|test result:|PASS|FAIL|tsc|cargo test|pytest|go test`);**T3** 任意 Bash tool_result。
  3. 裁决:T1 或 T2 命中 → 通过;仅 T3 → advisory "完成声明之后没有测试运行器输出";无 → advisory "完成声明前没有任何命令输出——运行验证或改为 `[PARTIAL]`"。
- **与现有 `hooks/transcript-structure-scan.sh` 的关系**:那个 hook 也在 Stop 检查 Iron Law #2,但口径是 **prose 指纹**(`Checked:`、数字、`passed` 出现在 Done 行附近),与 3.4 中已标注失败的检测器同构,默认关闭(`TRANSCRIPT_STRUCTURE_SCAN=1` 才开)。G1b **不扩展它**,新建脚本,口径改为"tool_result 存在性"。两者可并存;G1b 稳定后建议把前者的 iron-law-2-anchor 检测退役,避免两个口径打架。
- **已知限制**:`transcript_path` 可能滞后于当轮最后几条消息(官方文档);用 `last_assistant_message` 取声明、用 transcript 取证据,证据在声明之前产生,滞后影响有限,但要登记为 FP 来源之一。
- **FP 控制**:L0/L1-copy 任务无代码编辑 → 不触发;文档类任务不触发;`[PARTIAL]` 声明不触发。
- **促升路径**(§13.3):advisory ≥30d,按 project-class 分层记 FP;precision ≥0.8 后申请改为 block(exit 2)。block 形态下才算把 Iron Law #2 从"劝"移到"拦"。
- **候选挂载点 (ii)**:`TaskCompleted` 事件语义更贴合"标记完成"时点,**需先在 2.1.278 验证**;默认走 Stop。
- **不做清单**:advisory 与 §13.3 促升均不新增 spec HARD 规则,无冲突。block 形态是 hook 层 enforcement,07-10 F4 先例:"hook advisory,§13.3 豁免 §13.2 HARD 配额"。

**G1c**(仅在 G1a 30d 命中 ≥3 sessions 时):core §7 正式化,需 paired deletion 与操作者批准。

### G2 — 返工熔断【行为数据最强】

- **层**:advisory。`hooks/hooks.json` 新增 `PostToolUse` 条目 `matcher: "Edit|Write"`;脚本按 `session_id` 在 `~/.claude/.claudemd-state/` 维护每文件计数,达阈值经 `hookSpecificOutput.additionalContext` 注入一行:"该文件本会话已修改 N 次——按 §1 Root cause over patch,先复现并定位根因,再继续编辑。"
- **阈值(预登记)**:**8**。**验收**:30d 后按 G0 基线做 ITS(plugin 版本为断点,分层)。**风险**:大重构合法反复编辑 → advisory 而非 deny;FP 高则改呈现,不改阈值。

### G3 — banned-vocab【撤回】

3.2e 已述:设计决策,非漂移。唯一可考虑的动作(§7 句尾加注 "not mechanized")需 core paired deletion,**建议不做**。

### G4 — 技能路由:条件式、分级、缺失无害

**已确立**:§2.1 的表不产出调用(0.2%);过度仪式不是问题(C1 rate 0);L0/L1 段零 ceremony 调用**已经成立**——使用者要求的"小任务不调用"现状即满足。

**未确立**:提高技能调用率是否改善 Q/E。Matt 工程类 0 调用,无对照组。

**设计(不新建 router,复用 extended §12 现有 Fallback 表)**:核实 `CLAUDE-extended.md` §12 已有 sp/gs 的 Fallback 表(每个 skill 一行"缺失 → 降级路径"),**mattpocock 0 行**(该插件 2026-09-05 才装,晚于 §12 成文)。处置 = 把该表改写为"任务类 → 候选(各带适配判据)→ 全部缺失时"的形态并补入 Matt,extended 余量 3,530B 足够,core 零字节。

**选择规则(使用者 2026-09-21 决定:无固定顺序,只选最合适的)**:
- 候选之间**没有优先级**。每个候选后面的判据直接取自该 skill 自己的 `description`(即模型在 system prompt 里实际看到的文本),表不引入第二套语义。
- 两个候选都适配时,取判据更具体的那个;同一阶段只调用一个,不叠加。
- 三套插件的任意子集缺失时,直接落到"全部缺失"列,不报错、不 ask。
- 这张表仍是"劝"层(0.2% 记录);确定性的版本是 B2(hook 把命中的那一行注入上下文)。

| 任务类(§2 分级) | 候选与适配判据 | 全部缺失时 | 说明 |
|---|---|---|---|
| L0 / L1 | **不调用任何 skill** | — | 现状已满足(C1) |
| L2 bug | `matt:diagnosing-bugs`:难复现 / 性能回归 / 间歇性 · `sp:systematic-debugging`:一般 bug、测试失败、行为异常,在提修法之前 · `gs:/investigate`:环境 / staging / 部署侧 | §6 + Iron Law #3 内联 | |
| L2 feature(additive) | `matt:tdd`:用户要求 test-first、red-green-refactor 或集成测试 · `sp:test-driven-development`:一般 feature/bugfix 的 RED-first | §7 阶梯手工 RED→GREEN | |
| L2/L3 design | `matt:domain-modeling`:术语 / CONTEXT.md / ADR · `matt:codebase-design`:模块接口、seam、可测性 · `sp:brainstorming`:需求意图未明的创造性工作 · `matt:prototype`:需要一次性原型回答设计问题 | self-ask 四步 | |
| review(任务级 / 预发) | `matt:code-review`:有固定基点(commit / branch / merge-base)且要 Standards + Spec 双轴 · `sp:requesting-code-review`:任务完成 / merge 前的一般评审 · `gs:/review`:web 项目预发 | fresh subagent + 评审简报 | Author ≠ reviewer 不变 |
| web 可见行为验证 | `gs:/browse` / `gs:/qa` | `[PARTIAL: no-browser]` | 无降级,只能声明 |
| ship / deploy | `gs:/ship` | `manual ship because <reason>` | 现有规则 |
| plan / execute(L3) | `sp:writing-plans`:有 spec 要拆步骤 · `sp:executing-plans`:执行已有计划 · `sp:subagent-driven-development`:子任务彼此独立 | 内联 `tasks/<n>.md` | `matt:to-spec/to-tickets/implement/wayfinder` 为 **user-only,永不模型路由** |
| research | `matt:research`:需要高信度一手来源并落成 md 文件 | context7 / WebFetch 内联 | |
| merge conflict | `matt:resolving-merge-conflicts` | 手工 | |
| 隔离工作区 | `sp:using-git-worktrees` | 单树 + 分支,切换前 stash | 现有 §12 行 |

- **与 core §2.1 现有"sp before gs"一行的关系**:该行是顺序规则,与上表的"无顺序、按判据"冲突。G4-A 已裁定执行,该子句随 §2.1 表一起删除(附 C)。
- **实验分支 B**(可选,先预登记判据:"技能被调用的会话其返工率低于未调用会话,分层后方向一致"):**B1 零 hook**——本地 skill 加 `paths` / `when_to_use`,对第三方 skill 写薄包装指向;**B2 hook 注入**——`skill-hint.sh`(UserPromptSubmit,同 `hooks/memory-prompt-hint.sh` 形态)按已装清单与关键词注入 1–3 行,未命中零字节。
- **G4-A(已裁定执行,2026-09-21)**:把 core §2.1 的路由表(实测 8 行数据 + 表头分隔 = 923B)压成一句指针,其余 §2.1 内容(工具升级阶梯、歧义触发 → ASK)保留;表中**不是 skill 路由**的三条信息(UI 验证只准 `gs:/browse`、2+ 独立任务 → `Agent`、Q&A 直接回答)以两行短句留在 core——它们在 L0–L2 也必须可见,extended 在那两级不加载(§3 取严格读法)。替换前后全文与逐项字节核算见 **附 C**,预计 core 净减约 700B。它触及 07-10 不做清单的"不 demote core 任何段落"(2026-06-03 判定:core 段落零遥测 = 基础性,不得裁);重议依据三条:(i) 真正的路由判据已搬进 extended §12,core 表若保留就是同一事实两个家,违反仓库自己的 one-home-per-fact;(ii) 06-03 的依据是"零遥测",0.2% 是行为测量,前提不同;(iii) core 余量 60B,G1c / D1 将来都要 core 字节,这是唯一体量足够的 paired-deletion 来源。风险:被替代的只是 skill 路由行,其行为已测得 0.2%,指针保证可达。级别 L3(LLM-visible spec 文本),走 §13 META。

### G5 — 写/验分离【依赖 G1b】

- **证据现状**:仅推理 + 返工形状。G1b 落地后"完成声明是否含验证输出"成为可计数指标,G5 才有定量论据。
- **机制**(官方能力已核实):验证 subagent 用 `skills` 字段**预加载**一份"只读实现、只跑命令、只报输出"的验证 skill(不依赖模型自选);`SubagentStop` hook 核其输出含 tool_result 级证据;主会话不得以 subagent 的"我已测试"为证据。Agent 调用已是既有模式(393 次)。
- **不做清单**:若最终为 HARD 形态需配额例外。**建议**:G1b 稳定后再设计。

### G6 — 测试弱化检测【不做】

3.2% 基率;原提案全量禁止会挡 804 次合法加强抓 51 次可疑。若将来做,窄化为"断言数下降 / 用例删除",挂 G2 同一 PostToolUse 条目。登记待复查。

### G7 — 长任务:账本 + compaction 保全【依赖 G1b】

- **问题**:4.5。长任务发散的三个来源——决策散落到中途、done 未经验证累积、compaction 后状态丢失。
- **现有基础**(不新建 orchestrator):`.converge/` 已有 INTENT / DECISIONS / BACKLOG / LOG / METRICS 五件套;§11 已有 `tasks/<slug>-paused.md` 约定;`gsd:start/resume`、`sp:executing-plans`、`converge`、harness `Workflow` 均为可用编排面(前两者语料中 0 调用)。**G7 不选编排器,只定义所有编排器共同读写的账本与其 hook 级保全。**
- **账本**:`tasks/<slug>-ledger.md`,固定五节:`Goal` / `Decisions`(每条:选项、选择、可逆性、决定时点)/ `Verified-done`(每条**必须**带证据指针 = 命令 + 退出码 + transcript 时间戳,即 G1b 认可的 T1/T2)/ `Open` / `Next`。**Decisions 在任务开始时一次性填**(brainstorm 阶段),可逆决策直接写默认值,不可逆的才留 ask——这是把 H4 观察到的"ask 携带真实方向"前移到起点。
- **hook**:(i) `SessionStart` `source=compact|resume` 时,若存在活动账本,把 `Decisions` + `Next` 作为 additionalContext 注入(F4 的 compact 分支已存在,加一段读取);(ii) `PreCompact`(文档列出,**本机未验证**)写一行"compaction at <ts>, ledger=<path>" 到账本 LOG——验证失败则退回到 Stop 时刷新;(iii) `Stop`:存在活动账本、本会话有代码编辑、账本未被修改 → advisory。
- **验收**:compaction/resume 后账本注入命中率;每任务 ask 数(H4 口径,前移后应集中在首轮);`Verified-done` 条目 100% 带证据指针(缺指针 = G1b 未通过)。
- **不做清单**:全部 advisory / 文件约定,无冲突。

---

## 8 执行顺序与解锁关系

| 序 | 项 | 前置 | 解锁 | 层 |
|---|---|---|---|---|
| 1 | 关闭 C2;A4 状态记入(第 2 节) | 无 | — | 文档 |
| 2 | **G0** 行为指标并入 sampling-audit | 无 | 所有 ITS 验收 | 测量 |
| 3 | **G1b** 证据存在性门(advisory) | G0 | Q 判据、G7、G5 | 拦(advisory) |
| 4 | **G2** 返工熔断(advisory) | G0 | E 判据 | 拦(advisory) |
| 5 | 冒烟入口盘点 → **G1a** anchor | 无 | G1b 的 T1 级 | 测 |
| 6 | **G4** extended §12 改为判据表 + 补 Matt | 无(顺序问题已由使用者裁定:无顺序) | S 判据 | 劝(extended) |
| 7 | **G7** 账本 + SessionStart 注入(PreCompact 待验证) | G1b | L 判据 | 隔 |
| 8 | G1b 促升评估(30d FP 数据) | 3 + 30d | Iron Law #2 进"拦"层 | §13.3 |
| 9 | **G5** 写/验分离设计文档 | G1b 促升 | — | 隔 |
| 10 | G4-A 执行(已裁定)→ core §2.1 表压为指针(附 C) | 6 完成(extended §12 表先落地,指针才有目标) | core 净减约 700B | §13 META |
| 11 | G4-B 实验(可选) | G0 数据 + 预登记判据 | — | — |
| 0a | 前置验证:`PreCompact` / `TaskCompleted` 在 2.1.278 是否触发 | 无;在 3 与 7 开工前各做一次 sandbox 验证(临时 settings 注册一个把 stdin 落盘的 hook) | 3 / 7 的挂载点选择 | 验证 |
| 0b | `doccheck.mjs` 固化为通用 `scripts/doc-check.mjs` + 1 个测试 | 与 G0 同批(同改 `scripts/`) | 本文档及后续 docs 的机械自检 | L2 |

**整体交付物**:core 净减约 700B(G4-A,附 C);extended +≤1,200B(Matt 行);hooks.json +2 条目(PostToolUse Edit|Write、Stop G1b)+ SessionStart 一段;`scripts/sampling-audit.js` +1 段落;1 个 Tier-2 anchor;1 个账本文件约定。

---

## 9 被数据否掉的提案

使用者 7 条提案中 1 条被否:"修 bug 时禁止 AI 改测试"——1,618 次测试编辑 96.8% 为加强或中性(G6)。两条已由现有机制覆盖:"定期纯清理" → `converge`;"项目地图" → `matt:domain-modeling`(0 调用,归 G4)。其余四条进入 G1/G2/G5/G7。

---

## 10 与"全局不做清单"的关系

| 不做项 | 关系 |
|---|---|
| 不 demote core 任何段落 | G4-A 触及;**使用者 2026-09-21 裁定重议通过**(理由见 G4),执行走 §13 META,替换文本见附 C。该裁定只覆盖 §2.1 的 skill 路由表,不解除本项对其他 core 段落的约束;**口头讨论中"删 §9 Parallel-first"正式撤回** |
| 不新增任何 HARD 规则 | G1a/G1b/G2/G6/G7 均 anchor / advisory / 文件约定;G1b 促升为 block 走 §13.3(F4 先例:hook 层豁免 §13.2);G1c 与 G5 若走 HARD 形态需例外;**口头讨论中"冒烟进 core §7 L2 强制"改为 G1a anchor** |
| 不合并双记忆层 | 无关 |
| 无测量数据前不动 superpowers | C1 已有数据(rate 0)→ 保留,关闭 P3 |
| 不做研究级实验 | H-A 不做对照实验(第 1 节);G2/G1b 验收用 ITS + 分层 |

自设约束:**不重开 2026-07-24 已 closed 的六个检测器**;**净新增 core 字节 = 0**。

---

## 11 风险与保留

1. **行为指标未经效度验证**:返工率是编辑形状,不是产出质量;关联为推理。G0 的效度声明就是为此。
2. **测量不覆盖 subagent**:全语料 `isSidechain` 为 0 而 Agent 调用 393 次;返工率是主会话口径,可能低估。
3. **G1b 的 FP 来源**:transcript 滞后;非 Bash 形态的验证(如 `gs:/qa` 浏览器输出);签名正则的语言覆盖。故 advisory 起步,30d 分层记 FP 后再促升。
4. **G7 依赖的 `PreCompact` 与 G1b 候选 `TaskCompleted` 均未在 2.1.278 验证**;两者都有退路(Stop 刷新 / Stop 挂载)。
5. **H-A 未裁决**:本路线图以"净零 core 字节 + G4-A 净减约 700B"规避,不解决。700B 相对 24,940B 是 2.8%,**不构成对 H-A 的检验**——若注意力稀释存在,这个量级测不出差异。
6. **§10-V 的 61 次宽正则命中不作证据**;**closed 检测器的率不作证据**。
7. **n=1 环境**:全部结论观察性,因果推断上限 ITS + 分层。

---

## 12 执行包(供长任务会话按本文档施工)

本节把第 7–8 节收敛成一个可在**单个长任务会话**内完成、可计算完成度的工作包。使用者 2026-09-21 已裁定:预授权照 12.2、发版两次(12.3)、G1a 冒烟入口只做 claudemd 仓库(项 4)。

### 12.1 范围与完成度分母

只计入本次会话**能够完成并验证**的项;时间闸门项(需 30d 数据)明确排除,不计入分母。

| # | 项 | 权重 | 完成判据(必须有当轮命令输出) |
|---|---|---:|---|
| 1 | 0b `scripts/doc-check.mjs` 通用化 + 测试 | 5 | `node scripts/doc-check.mjs docs/spec-optimization-roadmap-2026-09-21.md` exit 0;新增测试在 `npm test` 中通过 |
| 2 | G0 `behaviorMetrics` 并入 `scripts/sampling-audit.js` | 15 | `node scripts/sampling-audit.js --global --days=30 --json` 输出含返工率 / 测试弱化率 / 技能调用率三项及效度声明,数字与本文档 3.2/3.3 在分母 ±1 内一致;测试通过 |
| 3 | 0a hook 事件本机验证 | 5 | scratchpad 内临时 settings 注册落盘 hook,记录 `PreCompact` / `TaskCompleted` 在 2.1.278 是否触发;结论写入本文档第 5 节表格(两种结果都算完成) |
| 4 | G1a claudemd 自身冒烟入口 + Tier-2 anchor | 10 | `package.json` 新增 `smoke`(运行 `tests/integration/user-journey.test.sh` 与 `full-lifecycle.test.sh`);anchor 文件写入 `~/.claude/projects/-home-ai-dev-claudemd/memory/` 并进 MEMORY.md 索引 |
| 5 | G1b 证据存在性门(Stop,advisory) | 20 | 新 hook 脚本 + `hooks/hooks.json` 条目 + `tests/hooks/*.test.sh`(含三级签名各一个正例、一个 L0 无代码编辑负例、一个 `[PARTIAL]` 负例)+ 按 `docs/ADDING-NEW-HOOK.md` 第 3–5b 节完成注册表 / 遥测 schema / contract 登记;`npm run check` exit 0 |
| 6 | G2 返工熔断(PostToolUse `Edit\|Write`,advisory) | 15 | 同上流程;测试含阈值 8 的边界(7 不触发 / 8 触发)与 per-session 隔离 |
| 7 | G7 账本约定 + `SessionStart` `source=compact\|resume` 注入 + Stop 未更新提醒 | 10 | `docs/` 或 spec 附录写明 `tasks/<slug>-ledger.md` 五节格式;`session-start-check.sh` 的 compact 分支读取账本 `Decisions`/`Next` 注入;测试覆盖"有账本 / 无账本"两路;`PreCompact` 仅在 0a 验证通过时接入 |
| 8 | G4 extended §12 表改写为判据表(含 Matt) | 5 | `spec/CLAUDE-extended.md` §12 表按本文档 G4 表落地(实测本表 1,894B,余量 3,530B);`node scripts/spec-coherence-audit.js --strict` 全绿,Sizing 达定点 |
| 9 | G4-A core §2.1 指针化(附 C) | 5 | 按附 C 替换;spec 版本 minor bump(§13 META:规则放宽 = minor);spec 级联全部站点一致;`spec-coherence-audit --strict` 报 `coreDelta=0, extendedDelta=0` |
| 10 | 关闭 C2/P3、D1 命中计数 | 2 | 在 `docs/spec-optimization-plan-2026-07-10.md` 对应段落追加"✅ 关闭 2026-xx-xx + 依据";D1 计数结果写入同处 |
| 11 | 发版(见 12.3) | 8 | 每次发版:`gh run list --branch main --limit 1` 绿 → 六站点级联一致 → CHANGELOG 单独 lint → `npm run check` → ff-merge → CI 绿 → 预发评审(fresh subagent)→ 注解 tag(`-F`)→ `gh release create` → `npm view claudemd-cli version` 等于新版本 |

**完成度 = Σ(已达判据项的权重)/100。目标 ≥95%。** 缺失只能来自 3(hook 事件不触发不算缺失)或某项被"停止条件"阻断——阻断必须在最终报告中按 §10 四段式列在 Not done / Failed 下,附命令输出。

**明确排除(不计入分母)**:G1b 促升为 block(需 30d FP 数据)、G1c、G5、G4-B 实验、G6、G3。

### 12.2 预授权清单(使用者 2026-09-21 已照此授权)

以下操作在会话内**不再逐项 `[AUTH REQUIRED]`**,使用者已一次性授权;清单外的 §5 hard 操作仍须 ASK:

- 编辑仓库内任意文件,包括 `hooks/hooks.json`、`spec/CLAUDE.md`、`spec/CLAUDE-extended.md`、`spec/hard-rules.json`(仅 `spec_version`)、`.gitignore`(为本路线图加白名单行,格式同 `!docs/spec-optimization-plan-2026-07-10.md`,理由:G0 代码与 CHANGELOG 将引用本文档,沿用 07-10 先例)。
- 六站点插件版本级联与 spec 版本级联。
- `git commit`(分支)→ `git merge --ff-only` 到 main → `git push origin main` → `git tag -a -F` → `git push origin <tag>`(触发 npm publish)→ `gh release create`。
- 在 scratchpad 内创建临时项目与临时 `settings.json` 做 0a 验证(不触碰 `~/.claude/settings.json`)。
- 写入本项目的 memory 目录(anchor 文件、MEMORY.md 索引行)与 mem-lite(`mem_save`)。
- **不预授权**:修改 `~/.claude/settings.json` / 用户全局 hooks;运行 `claudemd-install` / `claudemd-update` 把新版本写入 `~/.claude/`(新会话的 SessionStart 会自动同步,无需手动);删除任何非本会话创建的文件;改动任何**现有 deny 闸门的判决**(见 12.4)。

### 12.3 发版策略(使用者 2026-09-21 裁定:两次)

| 发版 | 内容 | 版本 |
|---|---|---|
| R1 | 项 1–7(hook 与脚本;不动 spec) | plugin **minor**(0.89.0 → 0.90.0):新增 hook 与新 CLI 段落 |
| R2 | 项 8–10(spec 改动) | spec **minor**(6.30.0 → 6.31.0)+ plugin **patch**(0.90.0 → 0.90.1) |

分两次的理由:spec 级联与插件级联是两套站点、两套 gate,合在一次里失败面叠加;R1 先落地也让 R2 的 §2.1 指针有目标(第 8 节第 6/10 步的依赖)。若使用者选单次发版,则合并为 plugin minor + spec minor 一次级联。

### 12.4 停止条件(命中即停,报告后等待使用者)

1. 任何改动会改变**现有 deny 闸门的判决**(`pre-bash-safety-check.sh` / `banned-vocab-check.sh` / `ship-baseline-check.sh` / `memory-read-check.sh`)——本仓库规则要求先做真实命令回放(`feedback_replay_real_commands_not_corpus`),而回放工具目前不存在。本工作包设计上**不触碰**这四个脚本;若发现必须触碰,停。
2. `gh run list --branch main --limit 1` 为红且无法归因到本次改动之外。
3. spec Sizing 无法达定点(`spec-coherence-audit --strict` 的 delta 非 0)。
4. tag 冲突、push 被拒、npm publish 工作流红。
5. 发版后重跑 `npm test` 出现比发版前更多的失败(E#385 先例:12→17)——不进入下一次发版,先归因。
6. 需要清单外的 §5 hard 操作。

### 12.5 开工必读(按 §11 MEMORY.md read-the-file)

`feedback_claudemd_ship_from_main_atomic.md`(发版 10 步)· `feedback_rerun_gates_after_git_add.md` · `feedback_verify_by_exit_code_not_grep.md` · `feedback_repo_write_guard_during_test_run.md` · `feedback_replay_real_commands_not_corpus.md` · `docs/ADDING-NEW-HOOK.md` · `docs/HOOK-PROTOCOL.md` · `docs/RULE-HITS-SCHEMA.md` · extended §12 与 §13 · 本文档全文。

### 12.6 施工顺序(在第 8 节基础上按发版分组)

R1:1 → 2 → 3 → 4 → 6 → 5 → 7 → 发版 R1(含预发评审 yield)→ 发版后重跑 `npm test` 对比基线。
R2:8 → 9 → 10 → 发版 R2 → 最终报告(四段式;完成度按 12.1 计算;每项引用命令输出)。

**长任务纪律**(本工作包自身遵守 G7):开工时创建 `tasks/roadmap-2026-09-21-ledger.md`,`Decisions` 节写入 12.2/12.3 的裁定结果;每完成一项在 `Verified-done` 追加"项号 + 命令 + 退出码";compaction 后先读账本再继续。

### 12.7 `/goal` 条件文本与机制说明

**`/goal` 机制**(Claude Code 官方 `goal` 文档,2026-09 核实):`/goal <条件>` 为会话级 prompt-based Stop hook 的封装;每轮结束后由小模型(默认 Haiku)**只根据对话内容**判定"未达 / 已达 / 不可能",不会自己跑命令——所以每一项的达成证据都必须以命令输出的形式出现在对话里。条件上限 4,000 字符;可写轮数上限子句;subagent 或后台命令未结束时该轮不判定,结果回来后自动开新轮(预发评审的 yield 与此兼容);连续数轮无工具调用会暂停循环;`/goal` 不改变权限模式(本机 `bypassPermissions`);resume 会恢复未完成的 goal。`/goal clear` 取消。

**条件文本**(直接作为 `/goal` 的参数一行贴入;新会话的工作目录须为 `/home/ai/dev/claudemd`):

```
按 /home/ai/dev/claudemd/docs/spec-optimization-roadmap-2026-09-21.md 第 12 节施工,直到以下条件全部在本会话对话中以命令输出证明:(1) 12.1 表的 11 项按权重计算完成度 ≥95%,每个已达项的判据命令与退出码已出现在对话里;(2) 两次发版 R1、R2 均完成,每次都有:gh run list --branch main --limit 1 为绿、node scripts/version-cascade-check.js 报站点一致、npm run check exit 0、main CI 绿、fresh-subagent 预发评审已做且 Critical/High 已修、注解 tag 已推送、gh release view <tag> 存在、npm view claudemd-cli version 等于新版本;(3) 每次发版后重跑 npm test,失败数不高于发版前;(4) tasks/roadmap-2026-09-21-ledger.md(开工时创建)的 Verified-done 每条都带命令与退出码;(5) 最终以 §10 四段式报告(Done / Not done / Failed / Uncertain),写明完成度百分比,未达项列在 Not done 或 Failed 并附命令输出。约束:开工先读 12.5 必读清单再动手;只做 12.2 预授权范围内的操作,清单外的 §5 hard 操作停下来问我;命中 12.4 任一停止条件立即停止并报告,不绕过;不修改 12.4 列出的四个 deny 闸门脚本;不自行签发任何 [allow-…] 逃逸令牌;每完成一项先更新账本再进行下一项;compaction 后先读账本;发版按 feedback_claudemd_ship_from_main_atomic.md 的十步在一个 turn 内原子执行,只在预发评审处 yield。若累计 150 轮仍未满足,停止并按四段式报告当前完成度。
```

(以上实测 1,504 字符,低于 4,000 上限。)

## 附 A 复现

测量脚本(会话 scratchpad,非持久):`/tmp/claude-1000/-home-ai-dev-claudemd/<session>/scratchpad/{analyze,testedit,churn,verify,verify2,strat,doccheck}.mjs`。固化路径 = G0。核心口径:返工 = 按 session 聚合 Edit/Write 的 `file_path` 计数取最大值,阈值 8;`isTest` = 代码扩展名 AND(`tests?/`、`__tests__/` OR `.test.`/`.spec.`/`_test.`),**不可只判 `spec/`**;技能调用 = `tool_use.name === "Skill"`,用户侧另扫 `<command-name>`。

**本文档机械自检**(`doccheck.mjs`):引用的仓库路径 / `~/.claude` 路径必须存在(通配符跳过);`§` 锚点必须在 core / extended / `spec/hard-rules.json` / `scripts/sampling-audit.js` 之一;G 编号有对应 `###`;六个比率复算一致;已撤回表述只允许出现在修正记录节或带"撤回/第一版/口头"标记的行(`核心零命中`、`逾期约 6 周`、`G1/G6`、`确定性缺陷`、`待标定的信号`、Grep 工具句)。

**固化**(2026-09-21,12.1 项 1):上述自检已通用化为 `scripts/doc-check.mjs`,四项结构检查(路径 / §锚点 /
G 编号 / 比率复算)从文本自身推导,两项判断性检查(哪些表述已撤回、哪些比率只写在散文里)由本文件下方的
`doc-check` 配置块声明。运行:`node scripts/doc-check.mjs docs/spec-optimization-roadmap-2026-09-21.md`。
CI 侧由 `tests/scripts/doc-check.test.js` 带 `--allow-untracked-missing` 运行——本文件引用的
`tasks/sampling-audit-2026-09-07.md` 是 local-only 分析件,不在 git 里,CI 机器上不存在。

```doc-check
stale-section-exempt: 修正记录|附 A
stale-line-exempt: 撤回|第一版|口头
stale: 核心.{0,12}零命中
stale: 逾期约 6 周
stale: G1/G6
stale: Grep 工具全语料仅 1 次
stale: 确定性缺陷
stale: 待标定的信号
stale: 12 行的路由表
stale: ≈1\.5KB|约 1,500B
stale: 建议重议
ratio: 393/61 = 6.4x
ratio: 804/1618 = 49.7%
ratio: 763/1618 = 47.2%
ratio: 37/1618 = 2.3%
ratio: 14/1618 = 0.9%
ratio: 51/1618 = 3.2%
```

**基线可复算(2026-09-22,G0 补 `--until`)**:第 3 节的数是 2026-09-21 20:1x 的语料快照,而语料持续增长,
所以 `--days=30` 单侧窗口无法再产生同样的分母。`scripts/sampling-audit.js` 因此新增 `--until=<ISO|epoch>`,
把窗口两端都关上。定点复算(全部为 `--global --days=30`):

| 判据分母 | 命令 | 得数 | 本文档 | Δ |
|---|---|---|---|---|
| tool_use(3.2a/f) | `--until=1790021570` | 33139 | 33,140 | −1 |
| Skill 调用(3.2a) | 同上 | 61 | 61 | 0 |
| 有编辑会话(3.2b) | 同上 | 126 | 126 | 0 |
| 返工 ≥8 任一类(3.2b) | 同上 | 74 | 74 | 0 |
| 返工 ≥8 仅代码(3.2b) | 同上 | 59 | 59 | 0 |
| 测试文件 Edit(3.2c) | `--until=1790021507` | 1618(804/763/37/14) | 1,618(804/763/37/14) | 0(四项全 0) |
| external 有编辑会话(3.3) | `--until=1790021570` | 109 | 109 | 0 |
| external 返工 ≥8(3.3) | 同上 | 65 | 65 | 0 |
| external Skill(3.3) | 同上 | 50 | 50 | 0 |
| self 有编辑会话(3.3) | 同上 | 17 | 17 | 0 |
| self 返工 ≥8(3.3) | 同上 | 9 | 9 | 0 |
| self Skill(3.3) | 同上 | 11 | 11 | 0 |
| external tool_use(3.3) | 同上 | 28091 | 28,099 | −8 |
| self tool_use(3.3) | 同上 | 5048 | 5,055 | −7 |

**最后一处残差的结论(2026-09-22 补做)**:3.3 的 `28,099` 与 `5,055` 相加是 33,154,而 3.2 的 tool_use 是 33,140——
两节不是同一时刻测的。逐点定位:external 到 28,099 是 20:14:25(此刻 self=5,052),self 到 5,055 是 20:14:49
(此刻 external=28,102)。`strat.mjs` 按项目目录顺序逐个读,两层之间隔着几十秒,期间本机有活跃会话在写 transcript,
所以这两个数本来就不来自同一瞬间。

补做的是把这条从「不可复算」降成「已定位」:在 3.2 的同一时刻读两层,得 external 28,091 与 self 5,048,
**相加 33,139,与 3.2 的 33,140 差 1**。也就是说分层口径本身是可同刻复算的、且与总量自洽;
上表那两行 −8 / −7 的 Δ 是文档里那两个数各自晚一分多钟读出来的结果,不是两套口径的分歧。
3.3 表里其余各行在同一时刻逐项复现:第一行的 65/109 与 9/17 两项 Δ=0;第三行的两个弱化占比同样不变(见上表六行)。
原表数字**保留不改**,时刻差记在这里和 3.3 的脚注里——这是测量记录,不是可以就地修正的结论。

遥测:`~/.claude/logs/claudemd.jsonl`,按 `spec_section` × `event` 交叉;率必须带 opportunities 分母,按 `extra.matched` 归因后再排名。

## 附 C G4-A 的 §2.1 替换文本(供 §13 META 执行)

**执行前提**:第 8 节第 6 步(extended §12 判据表)已落地,否则指针指向空处。执行级别 L3,LLM-visible spec 文本,操作者批准后按 §13 META 记录版本、Sizing line 与 CHANGELOG。

**替换范围**:仅 `### §2.1 ROUTE (unified)` 小节。`**Tool escalation**` 段与 `**Ambiguous trigger**` 段**逐字保留**,下文不重复。

**替换前**(现行 v6.30.0,节选):

```
SPINE step 3. MCP-injected per-tool instructions are authoritative for that tool's own usage; conflict with this table → §3 order decides. Full L3 / composite / specialized-clarify matrix → §EXT §4.

| Trigger | Primary | Note |
|---|---|---|
| code/logic bug | … | … |            ← 共 8 行数据,表格合计 923B
…
**Skill soft-triggers** (L0–L2 non-blocking): name the skill at task entry + one-line why using/skipping. `sp` before `gs` except clarify/ship (gs). Ship-pipeline skills NOT soft (§EXT §12). A skill's own "MUST invoke" wording does not override this table at L0–L2 (§3).
```

**替换后**:

```
SPINE step 3. MCP-injected per-tool instructions are authoritative for that tool's own usage; conflict → §3 order decides. Skill routing = fit criteria, no precedence among skills, L0/L1 invoke none → §EXT §12 table. Full L3 / composite / specialized-clarify matrix → §EXT §4.

Non-skill defaults: UI/visual verify → `gs:/browse` ONLY (never `mcp__chrome` / computer-use); 2+ disjoint tasks → `Agent`; Q&A no code → direct answer + docs-lookup.

**Skill soft-triggers** (L0–L2 non-blocking): name the skill at task entry + one-line why using/skipping. Ship-pipeline skills NOT soft (§EXT §12). A skill's own "MUST invoke" wording does not override §EXT §12 at L0–L2 (§3).
```

**字节核算**(以 `awk '{b+=length($0)+1}'` 口径,执行时以实际 diff 为准):

| 项 | 变化 |
|---|---|
| 删除表格(8 行数据 + 表头 + 分隔行) | −923B |
| 引言句:"conflict with this table" → "conflict";新增 skill routing 指针子句 | +82B |
| 新增 Non-skill defaults 一行(保留三条 L0–L2 必须可见的信息,含前置空行) | +174B |
| soft-trigger 段:删 "`sp` before `gs` except clarify/ship (gs). ";"this table" → "§EXT §12" | −43B |
| **净** | **−710B**(2026-09-21 以替换文本对现行 v6.30.0 实算,`Buffer.byteLength` + 换行) |

**为什么保留那三条**:它们不是 skill 路由,而是禁令与默认动作(其中 `mcp__chrome`/computer-use 是禁止项)。extended 在 L0–L2 不加载,若随表迁走,L2 的 UI 验证任务将看不到禁令——§3 取严格读法,留在 core。

**验收**:`node scripts/spec-coherence-audit.js` 的 Sizing line 更新且 CHECK 全绿;`spec/hard-rules.json` 无需改动(§2.1 无 HARD 条目);extended §12 表头写明"judgment by fit; no precedence"与 core 指针互指。

## 附 B 事实修正记录

### 施工期修订(2026-09-21,第 12 节执行包)

1. ~~**3.2(c) 的匹配口径写错**~~ — **本条已于 2026-09-22 撤回,它本身是错的**。3.2(c) 声称的严口径
   就是实际用的口径:`--until=1790021507` 下严口径复算 1618 / 804,763,37,14,逐项 Δ=0。原更正是在晚两小时
   的语料上比较两个 matcher 反推出来的,当时没有上界参数,两个数都不是测量时刻的数。详见 3.2(c) 正文。
2. **另一份文档的节号被写成规范锚点形式**:12.1 项 5 曾用 § 前缀引用 `docs/ADDING-NEW-HOOK.md` 的第 3–5b 节,
   而本文档里 § 一律指 AI-CODING-SPEC 的锚点。已改为"第 3–5b 节"。由 `scripts/doc-check.mjs` 首次运行抓到
   ——这条也说明锚点检查没有"修正记录豁免":复述错误写法会把它重新变成一次命中。
3. **`docs/ARCHITECTURE.md` 的 `tests/` 行数字过期**:写 79 node suites,实为 80。同上,由门抓到。

### 第三版修订(2026-09-21,使用者裁定后)

| 变更 | 依据 |
|---|---|
| G4 表由"首选 / 缺失 / 再缺失"三段链改为"候选 + 适配判据 / 全部缺失"两段,判据取自各 skill 的 description | 使用者裁定:技能选择没有顺序,只选最合适的 |
| G4-A 从"须操作者重议"改为"建议重议通过",并写明其含义与三条理由 | 使用者要求给出建议 |
| 第 8 节新增 0a(hook 事件本机验证)与 0b(`doccheck.mjs` 固化)两项 | 使用者要求把未做的两件事做到位 |
| 三项建议改为裁定并落实:G4-A 从"建议重议"改为"已裁定执行",新增附 C 给出 §2.1 替换文本;0a/0b 纳入执行序列 | 使用者 2026-09-21:"将你的建议落实到文档" |
| G4-A 字节口径修正:第一稿写"12 行 / 约 1,500B / 净减 ≈1.5KB",实测表格 8 行数据 + 表头分隔 = 923B,soft-trigger 段 278B;保留三条非 skill 路由信息后净减约 700B | `awk` 实测 `~/.claude/CLAUDE.md` §2.1 |
| 新增第 12 节执行包:范围 / 完成度分母 / 预授权 / 发版策略 / 停止条件 / 必读 / 顺序 | 使用者要求以长任务会话施工并达 ≥95% 完成度;核实:无命令回放工具、`package.json` 无 `smoke` 脚本、G4 表 1,894B、extended 余量 3,530B、`tests/integration/` 有 4 个生命周期测试可作冒烟 |
| 12.2 / 12.3 / 项 4 范围由"待确认"改为已裁定;新增 12.7 `/goal` 条件文本 | 使用者 2026-09-21 四项裁定;`/goal` 为 Claude Code 内置命令(`code.claude.com/docs/en/goal`,2026-09 核实:评估器只看对话、条件 ≤4,000 字符、后台工作延迟判定、resume 恢复) |

### 第二版 → 第三版(按使用者重述目标重组)

| 变更 | 依据 |
|---|---|
| 新增第 0 节目标/判据/全局约束、第 1 节两假设裁决、第 6 节依赖图、第 8 节执行顺序 | 使用者 2026-09-21 目标重述 |
| G1b 从"冒烟提醒"改为"证据存在性门"(对 transcript 结构,不对 prose) | 3.4:prose 指纹检测器已全部标注失败;3.2g:tool_result 结构可用;`transcript-structure-scan.sh` 为 prose 口径且默认关闭 |
| 新增 3.5 与 4.4"陈述往返" | mem-lite #108、三条 feedback 记忆 |
| 新增 G7 长任务账本 | 4.5;`.converge/` 五件套;H4 assent 0/42 |
| G4 改为复用 extended §12 Fallback 表 + 补 Matt 行 | 核实 §12 表存在且 `matt` 0 命中;extended 余量 3,530B |
| §2 H4 行改写:ask 携带真实方向 | `sampling-audit-2026-09-07` answered 42 / assent 0 |

### 第一版 → 第二版

| 第一版表述 | 核实结果 | 处置 |
|---|---|---|
| A4 标定逾期约 6 周,列为 G0 最高优先 | A4 已于 2026-07-24 完成,precision 上界 ≤0.17,6 个检测器 closed | G0 改为行为指标并入 |
| §iron-law-2 = 0.267 是"待标定的信号",G1/G5 核心论据 | 该检测器已 closed(1/1 FP) | 从论据删除 |
| G3:6/7 未收录是"确定性缺陷" | CHECK 5 有意只比对 §10;6 项因实测 FP 有意不机械化 | G3 撤回 |
| "Grep 工具全语料仅 1 次,§8 指引未被采纳" | §8 的 Grep 指引仅针对 `~/.claude/` | 句子删除 |
| 安装时间依据目录 mtime | `installed_plugins.json` `installedAt` 证实 | 来源改写 |

### 口头讨论 → 第一版

| 口头表述 | 修正后 |
|---|---|
| 核心规范中 `smoke` 零命中 | 命中 1 处(§8.V3),语义为破坏性路径沙箱 |
| 测试编辑 1,635 次 / 弱化 3.4% | 1,618 次 / 3.2% |
| 返工 74/125 = 59.2% | 74/126 = 58.7%;代码口径 46.8% |
