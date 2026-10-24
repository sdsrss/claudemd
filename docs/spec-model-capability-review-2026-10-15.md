# 全局规范与模型能力对齐分析：技能路由，以及"模型已经会的"规则（2026-10-15）

- **对象**：`~/.claude/CLAUDE.md`（AI-CODING-SPEC v7.2.0 核心，23,522 B，219 行）、按需模块 `~/.claude/spec-modules/*.md`，以及每个会话里和技能有关的其他常驻文字：harness 的技能清单、superpowers 的 SessionStart 注入。
- **问题**：
  - 模型能力提升后，规范里哪些内容模型或 harness 自己已经会做，可以删掉？
  - 技能调用这一块，还需不需要在全局规范里写细？
- **依据**：
  - 官方一手资料 39 个来源，2026-10-15 抓取；本文引用的原文都在下载的原件里逐句核对过；
  - 社区与研究资料约 40 个来源，见 §2.2；标了"已核对"的数字是本次重新取原文核对过的，未标的取自研究代理的笔记；
  - 本机转录扫描：2026-09-05 起 184 个交互会话、850 个子代理转录；
  - 此前做过的无规范对照实验 R4(c)。
- **前序工作**：`docs/spec-optimization-plan-2026-09-29.md`（v7.2.0 核心精简）。那一轮已经确认的结论本文不重做：200 行目标、HTML 注释剥离、核心已接近下限、不做符号压缩。本文补那一轮没有覆盖的三块：技能路由、"模型已会"的规则、社区经验。
- **底稿**（本地、不入库）：`tasks/model-capability-2026-10-15/`。其中有两份研究笔记（`research-official.md`、`research-community.md`）、扫描脚本 `skill_scan.py` 和 `analyze.py`，以及逐会话结果 `skill_sessions.jsonl`。

---

## 0. 结论

**简短回答**：规范需要跟进，但方向不是"模型变强了，把规则成批删掉"。要删的是三类文字：没人读、也没人照做的；指向本机不存在的技能的；和插件互相冲突的。技能路由的细节确实不需要再写在全局规范里。先复现、先写失败的测试、发版前评审、"只做被要求的事"这类约束，在新模型上依然承重，甚至更值钱，要保留。

1. **技能路由的细节可以从全局规范里删掉，但要按顺序做，不能整块一删了之。**
   - 依据有三条：
     - 技能的自动触发只看技能清单里的 description 文字（可选的 `when_to_use` 字段也算在内）。这是官方文档里唯一的自动触发机制，另一种触发方式是用户自己敲 `/name`。
     - Anthropic 自己的提示词审计规则把"影射真实工具列表的散文清单"归为应删的重复。`skills.md` 自己写明它的判据"取自技能自己的 description"。
     - 本机数据：v7.2.0 以来，`skills.md` 在 42 个交互会话和 143 个子代理里被读取 0 次。核心要求"任务开始时说明用不用技能"，可 42 个会话里只有 1 个会话照做过（188 个回合的开头回复里只有 1 次提到技能）。
   - 要保留的只有 description 表达不了的那一句：L0/L1 不调用技能，插件"有 1% 可能就必须调用"的措辞不能覆盖它。这一句只在 superpowers 还装着时有用。
   - 删之前，先把 7 处只写在 `skills.md` 里的规则搬到别的模块（§5 K1）。
2. **规范点名的技能，有一部分在本机根本不存在。这是技能部分现在最实际的害处。**
   - 规范引用了 19 个 gstack 子技能（15 个写成 `gs:/…`，4 个写成 `/careful` 一类的简写），技能清单里只有 `gstack` 路由器一项。
   - 发版触发要求调用 `ship` 技能。本机 44 次模型调用技能里，有 9 次返回 `Unknown skill`（20%），全部来自这条路由。
   - 改法：规范只写要做的行为，例如先读 runbook、打 tag 前独立评审，不写技能名。
3. **"模型已经会的"规则，不能按通用建议成批删。**
   - 官方确实说过度约束是问题：Anthropic 说为 Claude 5 代模型删掉了 Claude Code 系统提示词的 80% 以上。但有两点限制：
     - 删法本身：同一份官方审计规则写明，删除是一个待验证的假设，而且"短"本身不是目标；Boris Cherny 描述的内部做法也是逐行加回、用评测看每一行的影响。
     - 适用范围：第三方实际数词，降幅是 69–81%，而且只给前沿档模型用了精简版，Sonnet 5 和 Haiku 4.5 仍然拿到带着全部 "don't" 规则的 2,094 词旧版。本规范是一个文件，也加载进可能跑在较小模型上的子代理。
   - 本机无规范对照已经把规则分成了两类：
     - **承重**：先复现再修、先写失败的测试、发版前独立评审。没有规范时是 0/5，有规范时是 5/5。这些不删。
     - **与模型先验一致的候选**：L0 不走流程、一个回合做完、查证并引用、提交前跑测试、如实报告坏掉的功能。没有规范时也是 4–5/5。但每臂只有 5 次，检验力很低；要用长会话任务、每臂约 20 次、加一个安慰剂臂的逐条消融才能定。
   - 社区里有对照的测量指向同一方向。约束型短规则在 Claude 5 代上反而更划算：Opus 5 比 Opus 4.8 多用 67% 的轮数；一条"只做被要求的事"的规则在 Opus 5 上让成本降了 22.8%。这是单个作者的小样本测量，但有安慰剂臂和置信区间。删掉的应当是示例、重复和不起作用的规则，不是约束。
4. **superpowers 的开场注入是技能方面唯一的强推力，也是和核心冲突的来源。**
   - 它在每次 startup / clear / compact 时注入约 3.3 KB。措辞（"even a 1% chance … ABSOLUTELY MUST invoke"）正是官方说会造成过度触发的写法。
   - 40 天里，它的 15 个技能被模型主动调用 6 次。
   - 这个插件留不留，由使用者决定。Claude Code 没有单独关掉某个插件 hook 的开关，只有全局的 `disableAllHooks`。
5. **本机技能用得少，原因还没有分清；而且多调用不等于结果更好。**
   - 社区在 Opus 5.5 上的测量（不带 CLAUDE.md，用的是专为触发设计的测试提示）显示，description 写好以后，25 个技能有 23 个能被稳定选中。本机只有 12% 的会话用过技能，规范里"插件的强制措辞不覆盖本规范"这一句可能压低了一部分。
   - 但两项较大的研究显示：49 个公开技能里有 39 个对通过率零提升；场景越接近真实（模型要自己从大量技能里挑），技能的收益越接近零。
   - 所以目标不应该是"调用率"。§7.2 的 A/B 加一个不带规范的对照臂，同时测调用和结果，再决定要不要放松。
6. **这次不是为了缩小核心。**
   - 核心里和技能有关的文字约 800 B（3.4%），改完净减约 600 B（−2.5%）。
   - 真正的收益有三项：删掉不起作用的文字和互相冲突的文字；去掉指向不存在技能的引用；去掉约 300 行只为维护路由表而存在的解析器和测试。

---

## 1. 判据：什么样的规则可以删

官方审计规则（[S35]）把"过时文字"定义为"不再合适的具体指令"，不是"长"，并明确了几条反向约束：

- "Cruft != length … Never justify a deletion by character count alone."
- "Working redundancy is not cruft."
- "Step 7: Verify - removal is a hypothesis, not a conclusion."
- "Asking the model whether it needs an instruction is not a measurement."

本仓库在 v7.2.0 也有同样的教训：草稿认作"重复"的 25 处里，有 8 处其实是别处没有的规则（`feedback_spec_dedupe_is_not_restatement`）。

据此，本文给每一类文字一个判定方法：

| 类别 | 判定方法 | 处理 |
|---|---|---|
| **死文字**：不加载，或者加载了不被遵循 | 转录里数读取次数和可见的遵循率 | 删。删前确认它没有承载别处没有的规则；删后行为按构造不变 |
| **影射清单**：复述 description 或工具列表 | 和 harness 实际的清单逐项对照 | 删。只留 description 表达不了的约束 |
| **悬空引用**：指向不存在的技能或工具 | 和本机技能清单对照 | 改成行为描述 |
| **与模型先验一致** | 无规范对照，再加逐条消融（长会话，每臂约 20 次） | 列为候选，消融前不删 |
| **反先验（承重）** | 无规范对照显示有差异 | 保留 |
| **与 harness 或插件冲突** | 文字逐句对照 | 在源头解决；源头动不了时，保留一行裁决 |

---

## 2. 外部证据

### 2.1 官方一手资料

所有条目的抓取日期都是 2026-10-15；引文都在下载的原件里核对过。来源编号对应附录 A。

**技能怎样被触发**

| 结论 | 原文 | 来源 |
|---|---|---|
| description 是主要的触发机制 | "The description field in SKILL.md frontmatter is the primary mechanism that determines whether Claude invokes a skill." | [S34] skill-creator（本机插件里的副本逐字相同） |
| 技能只有两种触发方式 | "You typing `/<name>`, or Claude matching the description to your task" | [S4] features-overview |
| description 重叠会选错 | "If descriptions are vague or overlap, Claude may load the wrong skill or miss one that would help." | [S4] |
| 简单任务本来就不触发技能 | "Claude only consults skills for tasks it can't easily handle on its own — simple, one-step queries like "read this PDF" may not trigger a skill even if the description matches perfectly" | [S34] |
| 目前的倾向是欠触发 | "currently Claude has a tendency to "undertrigger" skills"；2026-10-09 版审计规则也写 "skills currently under-trigger" | [S34]，[S35] |
| 欠触发的修法在 description 和评测上，不在提示词里 | 触发文字 "may legitimately carry calibrated urgency … ideally it's tuned against a trigger eval rather than vibes. Text whose job is behavior should explain rather than shout." | [S35] |
| 影射清单应删 | "Tool names in the system prompt; prose lists that shadow the real tool list \| Duplicated - delete \| … then enabling or disabling one never leaves a dangling reference." | [S35] |
| 在 CLAUDE.md 里放一行指针是被认可的做法 | "create a verification skill and reference it from your CLAUDE.md" | [S23]（2026-07-24） |
| 技能清单在压缩后不会重新注入 | "Unlike the rest of the startup content, this listing is not re-injected after `/compact`. Only skills you actually invoked get preserved." | [S6]；CHANGELOG v2.1.299 的 `/reload-skills` 条目 [S12] |
| 清单超出预算时，先丢最少调用的技能的描述 | "drops descriptions starting with the skills you invoke least" | [S1] |
| "只许用户调用"有现成机制 | `disable-model-invocation: true` 会把描述移出上下文；"Plugin skills are not affected by `skillOverrides`." | [S1] |

**删除旧指令**

| 结论 | 原文 | 来源 |
|---|---|---|
| Anthropic 自己删掉了 80% 以上 | "We removed over 80% of Claude Code's system prompt for models like Claude Opus 5 and Claude Fable 5 with no measurable loss on our coding evaluations." | [S23] |
| CLAUDE.md 和技能同样过度约束 | "Overall, we found that we were overconstraining Claude Code, both through our system prompt and in our CLAUDE.md files and skills." | [S23] |
| 为旧模型写的技能会拉低质量 | "Skills developed for prior models are often too prescriptive for Claude Fable 5 and can degrade output quality." | [S16] |
| 判定规则 | "If Claude already does something correctly without the instruction, delete it or convert it to a hook." | [S3] |
| CLAUDE.md 该放什么 | "spend most of the tokens on gotchas inside of the codebase … Avoid stating 'the obvious' things Claude should know" | [S23] |
| 官方工具 | `/doctor prompt-audit`（v2.1.283，2026-09-25）找"为旧模型写的指令、指向不存在文件或命令的引用、互相矛盾的文件" | [S2]，[S12] |

**强调语气、验证、委派**

| 结论 | 原文 | 来源 |
|---|---|---|
| 激进措辞导致过度触发 | "Instructions like "If in doubt, use [tool]" will cause overtriggering." | [S13] |
| Opus 5 会自己验证 | Opus 5 "verifies its own work without being told to"；显式的验证指令 "remove them" | [S14] |
| Sonnet / Haiku 5.5 低 effort 时会跳过检查 | "At `low` effort, though, it sometimes reports a change as done without running a check that exercises it." | [S18]，[S19] |
| Fable 5 的长任务需要显式写出"按工具结果核对" | "Before reporting progress, audit each claim against a tool result from this session." | [S16] |
| 调深度用 effort 比用文字可靠 | "Lowering effort reduces thinking, and with it cost and latency, more reliably than prompt instructions do." | [S15] |
| 全局 CLAUDE.md 会进入每个非 fork 子代理 | 子代理加载 "every level of the CLAUDE.md hierarchy the main conversation loads, including `~/.claude/CLAUDE.md`"；v2.1.271 新增 `omitClaudeMd` 可以关掉 | [S5]，[S12] |

### 2.2 社区与研究

标注：【5 代】表示证据取自 Opus 5 / 5.5、Fable 5、Sonnet 5 上的结果；【4.x】表示 Claude 4.5–4.8；"已核对"表示本次重新取了原文核对数字。

**Anthropic Claude Code 团队的做法**

- **Boris Cherny 的三次说法**：
  - 2026-01："Try deleting your CLAUDE.md every 3 months. Then add back an instruction at a time when you see the model struggling with it"【4.x】
  - 2026-07-27 的 YC 访谈：建议 Opus 5 用户 "every 6 months delete your CLAUDE.md, delete your skills, delete your hooks"。
  - 同一访谈里，他描述的内部做法是 "you delete the entire system prompt and then you bring it back line by line to figure out what is the impact of each individual line"，也就是逐行消融，不是一删了之。【5 代，两份转录一致】
- **删减幅度和分档**（Huryn 抓取 2026-04 和 2026-07 的真实系统提示词计数，已核对）：
  - 2,686 → 514 词。计不计记忆块会影响口径，降幅在 69–81% 之间。原文："The defensible headline is ~70%."
  - 同一天对比各模型：Sonnet 5 和 Haiku 4.5 仍是 2,094 词的旧版，"every 'don't' rule intact"。
  - Anthropic 的 Cat Wu 也公开说过（Simon Willison 的访谈记录，已核对）："It's only our most frontier models that have this 80% token decrease — the older models still have the full system prompt."

**最受欢迎的 CLAUDE.md 有多大**

| 文件 | 热度 | 大小 |
|---|---|---|
| `multica-ai/andrej-karpathy-skills/CLAUDE.md`（已核对） | 22 万星 | 65 行 / 358 词 / 2,357 B |
| HumanLayer 根文件 | HN 748 分 | 作者自述不到 60 行 |
| 本规范核心 | — | 219 行 / 3,370 词 / 23,522 B |

本规范的行数在官方的 200 行附近，但每行平均 107 B，所以词数是 karpathy 文件的 9.4 倍。没有任何研究在 Claude 5 代上测过 3K 词的全局文件。

**约束型规则的对照测量**（sjh9714，obra/superpowers #2017，已核对；n 小，但有安慰剂臂和 bootstrap 置信区间）

- "先复现"在 Opus 4.8 上，4 个任务各跑 5 次：

  | 臂 | 有测试支撑的复现 |
  |---|---|
  | 无指令 | 2/20 |
  | 长度相近的纯风格安慰剂 | 0/20 |
  | superpowers 的 systematic-debugging（291 行） | 8/20 |
  | 作者自写的 31 行版本 | 10/20 |

  【4.x】
- 同一套任务，只把模型从 Opus 4.8 换成 Opus 5：轮数 +67%，成本 +49%，产出的代码 −5%。
- 一条 31 行的"只做被要求的事"规则：在 4.8 上让成本 +5.2%，在 Opus 5 上 −22.8%（CI −38.1% 到 −3.5%）。【5 代】
- superpowers 作者在同一 issue 里说："We're absolutely seeing Opus 5 burning a lot more tokens, doing a lot more repeated work."

**技能调用率与效果**

| 来源 | 模型 | 结果 |
|---|---|---|
| claude-base 用 `claude plugin eval` 测，每例 3 次，会话不带 CLAUDE.md（已核对） | Opus 5.5 | 25 个可自动触发的技能里 23 个 3/3 单独命中。调试技能原本 0/3，原因是 "Opus read the code"；描述改成 "Use it first … before reading code" 后变成 3/3【5 代】 |
| Silva（已核对） | Opus 4.6 | 普通技能 1/15；CLAUDE.md 加提示 5/15；superpowers 的强制注入 10/15【4.x】 |
| Vercel（已核对） | 未写明 | 56% 的用例里技能从未被调用；常驻的 8 KB AGENTS.md 索引 100% |
| Coder Eval，1,001 条提示（已核对） | 未点名 | 每个描述加一句 "Always invoke for …"：召回率从 46.3% 升到 67.3%，精确率约 0.96 不变 |
| SWE-Skills-Bench（arXiv 2603.15401，摘要已核对） | Haiku 4.5 | 49 个公开技能中 39 个对通过率零提升，平均 +1.2%【4.x】 |
| "Skills in the wild"（arXiv 2604.04323，摘要已核对） | 含 Opus 4.6 | "the benefits of skills are fragile: performance gains degrade consistently as settings become more realistic, with pass rates approaching no-skill baselines in the most challenging scenarios"【4.x】 |
| "One Skill Too Many"（arXiv 2610.11647，摘要已核对） | 3 个模型 | 相似技能 "takes one in five runs from the installed skill"；先打开相似技能的运行 "lose over a third of the exclusive core functions"；任务完成率不受影响，所以只看完成率的基准测不出来 |

**"写了但被忽略"**

- anthropics/claude-code #65961（仍开着）：多名用户在 Opus 5 / 5.5 上报告，"不要写注释"写进 CLAUDE.md 和记忆都压不住。有人用 PostToolUse hook 演示过，把注释行从 15 降到 2（Haiku 4.5，单次演示）。
- Anthropic 的 Thariq 说过："try to give it more context and fewer 'do not do this' instructions"。
- 预印本 Chakrabarti（arXiv 2608.11095，摘要已核对）统计了 1,867 个仓库：CLAUDE.md 一生平均增长 +226%，越老的指令越不容易被删；给规则写上理由（"prompt comments"）能让遵循率最多提升 23.1%。

**superpowers 的强制调用**

- 作者拒绝提供关闭自动触发的选项（#645）："At this point, I actively don't want configuration options that change the triggering behavior."（已核对）。评论里有企业用户说，他们只能维护一份去掉 hook 的私有副本。
- #743 报告用了它之后响应变慢；#2017 有多人要求出精简版。
- 它自己的引导技能也写了 "User instructions (CLAUDE.md …) take precedence over skills"。所以核心里的裁决句和插件自己的优先级规则一致。

**社区里的分歧**

- 主张删的：Boris、HN 上几位"删掉风格规则后反而不再违反"的用户。
- 主张补回的：Huryn 在 Opus 5 上补回了 8–9 段（没有测量）。reporails："Cut the prose the model has outgrown, and keep the gate."
- 说长文件也能用的：只有轶事。

完整的条目、标签和无法核实的项目见底稿 `research-community.md`。

### 2.3 外部证据之间的分歧

| # | 一方 | 另一方 | 对本规范的含义 |
|---|---|---|---|
| D1 | 技能 description 要写得 "pushy" [S34] | 激进措辞要降下来 [S13] | [S35] 的调和：触发文字可以带校准过的紧迫感，行为文字不可以。superpowers 的开场注入是**行为文字**，却用了触发文字的语气，而且没有经过校准 |
| D2 | Opus 5 删验证指令 [S14] | Sonnet / Haiku 5.5 低 effort 要加；Fable 5 长任务要显式写 [S16、S18、S19] | 全局规范跨模型加载（子代理可能跑 Sonnet 或 Haiku），不能只按一个模型的指南删。"按工具结果报告"有数据支持，和"多验证几遍"不是一类 |
| D3 | 越长遵循越差 [S2、S3] | "Cruft != length" [S35] | 两者不矛盾：体积有代价，但删除的理由必须是具体的"这条不再合适"，不能只是字数 |
| D4 | 2025-11："在 CLAUDE.md 里定义标准工作流，例如 TDD" [S30] | 2026："Procedures belong in skills." [S24] | 按日期以新的为准 |
| D5 | Boris：Opus 5 上把 CLAUDE.md、技能、hook 全删，再按需加回 | reporails：hook 是确定性关卡，不该跟着删；Huryn：Opus 5 要补回 8–9 段 | 两边都没有公开删除前后的测量。本规范的 hook 承担的是必须成立的规则，不在删除范围内 |
| D6 | 精简提示词适合强模型 [S23] | Anthropic 自己只给前沿档精简，Sonnet 5 和 Haiku 4.5 仍拿完整规则（Huryn 计数） | 全局规范也会加载进跑较小模型的子代理，约束类规则不能只按最强模型的表现来删 |
| D7 | 技能调用率可以通过 description 提到接近 100% | 调用了不等于更好（SWE-Skills-Bench、"Skills in the wild"） | 要测的是结果，不是调用率 |

---

## 3. 本机证据

### 3.1 语料

- **范围**：`~/.claude/projects/*/*.jsonl`（主会话）和 `~/.claude/projects/*/*/subagents/*.jsonl`，用显式通配，不递归；只取文件修改时间在 2026-09-05 之后的；排除本次测量会话。
- **分期**（按会话第一条时间戳）：
  - **P1**：09-05 至 09-29，规范 v6.30 到 v7.1；
  - **P2**：09-30 至 10-15，42 个交互会话全部是 v7.2.0。
- **交互会话的定义**：entrypoint 全为 `cli`，并且至少有一条人类提示。
- **跨项目**：P2 的 42 个会话分布在 claude-mem-lite 15、daagu 12、code-graph-mcp 9、claudemd 6。其中只有 claudemd 设了 `AUTONOMY_LEVEL: aggressive`。

### 3.2 技能调用实况

| 指标 | P1（142 个交互会话） | P2（42 个交互会话） |
|---|---|---|
| 至少调用过一次技能的会话 | 27（19%） | 5（12%） |
| 主会话里模型调用技能的次数 | 39 | 5 |
| 子代理里调用技能的次数（707 / 143 个子代理） | 1 | 0 |
| 读取 `skills.md` 的上下文 | 1 个主会话 + 2 个子代理（那个主会话没有调用技能） | **0**（子代理也是 0） |
| 回合开头的回复提到技能（"说明用不用技能"的可见遵循） | 72 / 967 个回合，49 / 142 个会话 | **1 / 188 个回合，1 / 42 个会话** |
| 技能清单字节数（中位数） | 26,009 | 22,020 |

P2 那 1 次提及，是 code-graph-mcp 会话里"技能列表里没有 `ship` 技能，所以按 runbook 手动发"。P2 的 42 个会话里有 36 个在默认自主级别的项目里，那里这条宣告是必须的。回合数的分母里有"继续"这类不算任务开头的回合，所以按会话看更干净：每个会话至少有一次任务开头，照做的只有 1/42。P1 的 49 个会话这个数字，正则也会算进"把技能当话题讨论"的回复，例如 claudemd 项目本身就在讨论技能，所以 P1 不能直接当遵循率读。

**44 次技能调用的来由**（P1 + P2，看紧挨着的那条人类提示）：

| 来由 | 次数 | 明细 |
|---|---|---|
| 规范的发版触发 | 25 | `gstack` 16（每次加载路由器；它的 SKILL.md 现为 13,578 B），`ship` 6，`gstack:ship` 3。后两项 9 次全部返回 `Unknown skill` |
| 用户点名或手敲 | 3 | `/claude-api prompt-audit`，`claudemd-refresh` 2 |
| 模型按 description 自行选择 | 16 | `converge` 5、`superpowers:systematic-debugging` 3、`mattpocock-skills:writing-for-agents` 2、`claude-api` 1、`mattpocock-skills:research` 1、`superpowers:test-driven-development` 1、`superpowers:writing-plans` 1、`superpowers:requesting-code-review` 1、`polish` 1 |

这 16 次按 description 选的调用都落在实质性任务上：排查根因、端到端测试、写规划、改提示词。没有一次落在 L0/L1 的小改动上。读过路由表的只有 1 个主会话（P1，而且它没有调用技能）和 2 个子代理，所以这 16 次选择全部来自技能清单里的 description，不来自路由表。

### 3.3 模块使用（P2）

| 模块 | 模型读取次数 | hook 注入的会话数 |
|---|---|---|
| review | 28 | 12 |
| ship | 17 | 20 |
| verify | 12 | — |
| plan | 11 | 3 |
| auth | 10 | — |
| debug | 5 | 18 |
| orchestrate | 4 | — |
| **skills** | **0** | —（没有触发词） |
| memory / modes / session | 0 | — |

读取次数的统计口径包括 claudemd 仓库自己的 `spec/spec-modules/` 路径，所以 claudemd 项目里编辑模块的操作也会被算进去。即便按这个宽口径，`skills` 仍然是 0。

### 3.4 本机的技能清单和插件构成

- **技能清单**：每会话 22,101 B（取本项目最近一个会话），共 67 项。各插件占用：

  | 插件 | 字节 | 技能数 |
  |---|---|---|
  | anthropic-skills | 4,395 | 5 |
  | superpowers | 2,861 | 15 |
  | mattpocock-skills | 2,567 | 11 |
  | gstack | 53 | 1（只有路由器） |

- **gstack**：`~/.claude/skills/gstack/` 下有 browse、ship、review 等子目录（2026-10-17 卸载 gstack 后这个目录已不存在），但它们是嵌套的，没有注册进清单。规范里点名的 19 个 gstack 子技能（15 个写成 `gs:/…`，4 个写成 `/careful` 一类的简写）都无法直接调用。
- **mattpocock-skills**：规范里写的四个"只许用户调用"的技能（to-spec、to-tickets、implement、wayfinder），在插件自己的 frontmatter 里已经是 `disable-model-invocation: true`，模型本来就看不到它们。
- **superpowers 6.4.1**：`hooks/session-start` 在 `startup|clear|compact` 时注入 `using-superpowers/SKILL.md`（3,192 B）加一层外壳。脚本里没有关闭它的环境变量。
- **功能重叠**：
  - 测试先行：`sp:test-driven-development`、`matt:tdd`；
  - 调试：`sp:systematic-debugging`、`matt:diagnosing-bugs`；
  - 评审：`sp:requesting-code-review`、`matt:code-review`、内置的 `code-review`、`gs:/review`。

  [S4] 说过，description 重叠会让模型选错或漏选。路由表最初就是为了在这些重叠之间做裁决才写出来的。

### 3.5 维护成本

路由表需要一套代码来保持同步：

- `scripts/lib/spec-routing.js`，90 行，解析表格；
- `tests/scripts/spec-routing-consumers.test.js`，200 行；
- `scripts/doctor.js` 里的三项检查：`routing:skills-enabled`、`routing:ship-skill`、`routing:gstack-reachable`；
- `spec-structure` 测试里"每个 §4 主路由都在 §12 有对应行"的检查。

2026-06 以来 724 个提交中，有 46 个的提交信息提到 routing 或 skill。

### 3.6 无规范对照：哪些行为模型本来就会（R4(c)，2026-09-29）

条件：Opus 5.5，effort high，单回合短任务，`-p` 模式，每臂 5 次。原始结果在 `tasks/r4c-screen/RESULT.md`。

| 行为 | 有规范 | 无规范 | 归类 |
|---|---|---|---|
| L1 bugfix 先复现再改 | 5/5 | **0/5** | 承重 |
| L2 新增功能先写失败的测试 | 5/5 | **0/5** | 承重 |
| 发版前派独立评审（T5 中可比较的那一半） | 5/5 | **0/5** | 承重 |
| 改错别字，不做多余的事（L0） | 5/5 | 5/5 | 候选 |
| 多文件改动一个回合做完 | 5/5 | 5/5 | 候选 |
| 查证并引用 | 5/5 | 4/5 | 候选 |
| 提交前跑测试（用户没提） | 5/5 | 5/5 | 候选 |
| 单测全绿但入口坏了，如实报告 | 5/5 | 5/5 | 候选 |
| rm 被 hook 拒绝后加守卫 | 5/5 | 5/5 | 由 hook 的拒绝消息承担，规范文字不承重 |

承重的三项正好是官方所说 CLAUDE.md 该放的东西：模型自己不会做的、与默认行为不同的约定。"候选"那几行每臂只有 5 次。要检出 95% 掉到 60% 这样的下降，n=5 时检验力只有 0.07；每臂约 20 次时才到 0.81。所以这些都还不是删除的证据。

### 3.7 与 harness 系统提示词的逐字重叠

下表左列的句子，在本会话（Claude Code 2.1.300）主会话的系统提示词里逐字出现。研究代理在它的子代理提示词里也看到了同样的句子。

| harness 原文 | 核心中的对应条款 |
|---|---|
| "When you have enough information to act, act. … If you are weighing a choice, give a recommendation, not an exhaustive survey" | §1 **Recommend-first** 和 **Single obvious option** |
| "Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging." | §10 Honesty 中"不用 may/could 含糊"那部分。注意 Honesty 整块是 HARD，而且"yes/no 在前"、"不加评价性措辞"、Specificity 都不在 harness 里 |
| "For actions that are hard to reverse or outward-facing, confirm first …" | §5 AUTH 的一般原则。§5 的具体清单比它细，不算重复 |

---

## 4. 诊断：技能部分为什么长成了现在的样子

1. **起因是功能重叠。** 三个插件装在一起，测试先行、调试、评审各有 2–4 个技能。为了在它们之间做裁决，规范写出了任务类别 → 技能的路由表。
2. **表格只能复述 description。** 为了不另造一套词汇，§12 表格的判据直接取自各技能的 description。这样它就成了 [S35] 说的"影射清单"：模型做选择时看的本来就是 description，表格不提供新信息。
3. **表格没人读，维护成本却一直在。** 解析器、doctor 检查、结构测试都在保证一张模型不读的表格和自己保持一致。
4. **点名的技能不存在。** gstack 只注册了路由器，所以表格和 plan / review / ship 模块里的 `gs:/…` 都是悬空引用。规范里的发版触发是唯一被执行的路由，它产生了 9 次错误调用和 16 次 13.6 KB 的路由器加载。
5. **推力方向。** 官方说模型默认偏向欠触发，而且简单任务不触发技能。核心的"L0/L1 不调用技能"和模型的默认方向一致；与之相反的推力只有一个来源，就是 superpowers 的开场注入。核心保留的那句裁决，本质上是在抵消一个第三方插件。

根因在于装了哪些插件，以及规范里写了工具名，而不是模型不会选技能。按"根因优先"，修法有两条：一是把插件之间的重叠交给使用者做取舍；二是规范里只写行为，选哪个技能交给 description。

---

## 5. 建议（按优先级）

每一项都写了依据、效果、风险和验证方法。所有对 `spec/` 的修改都是 L3（LLM 可见的元数据，规范自编辑），要走本仓库的发版流程：在 `release/vX.Y.Z` 分支上完成，打 tag 前由独立评审过一遍。

### K1（P0）删掉 `skills.md` 的路由内容，先搬走只存在于其中的规则

- **删的内容**：
  - §4 FLOW 的 Routing 表、Composite requests 和 Skill invocation；
  - §12 的 Skill routing table、"user-only"那一行，以及 Detection、Absent-from-listing、Gated、Batch confirmation 四段；
  - `skills` 模块本身，以及核心 §2.2 指向它的索引行。
- **先搬走的规则**（`grep` 确认只在 `skills.md` 里出现；搬法可以再议）：

  | 规则 | 去处 |
  |---|---|
  | L3 没有任何子代理可用 → 不可执行，上报（HARD） | `plan.md` |
  | 网页可见的行为无法验证 → `[PARTIAL: no-browser]` | `verify.md` |
  | 评审能力被拦截（gated）→ 询问一次；被拒 → L2 `[PARTIAL: no independent review]` | `review.md`。该文件第 15 行 "Detection in `skills.md`" 的指针也要一起改 |
  | 没有评审技能时：派一个全新子代理，附评审要点 | `review.md` |
  | 收到评审意见：每条先核实再改 | `review.md` |
  | 手动部署 → `[AUTH REQUIRED op:manual-deploy]` | `ship.md` |
  | 发版说明从 CHANGELOG 顶部条目手写，并说明替代了什么 | `ship.md` |

- **依据**：
  - [S35] 把影射清单列为应删；
  - P2 的 185 个上下文里读取 0 次；
  - 表格自己声明判据来自 description；
  - user-only 的四个技能已由插件 frontmatter 处理；
  - 压缩后技能清单不再注入 [S6]，所以"清单里没有就算缺失"这条在长会话里可能把装着的技能判成缺失（这是推论，没有实测）。
- **效果**：
  - 按需文字少 8,339 B；
  - 删掉解析器和测试共约 290 行，外加 doctor 的两三项检查；
  - 会话行为预期不变：表格本来就没被读过。
- **风险**：
  - 漏搬规则。缓解办法是按 `feedback_spec_dedupe_is_not_restatement` 的四步做：逐个 `grep` 原句，列出两边的成员做对照，检查是否有引用方，并预期评审后会恢复一部分。
  - 其他安装者的读取率未知。本文只测了本机。

### K2（P0）核心里的技能文字收成一行

- **删的内容**：
  - 第 5 行的插件缩写图例和 "Missing skill" 降级；
  - §2.1 的 "Skill routing = …" 和 "composite / specialized-clarify matrix → `skills.md`"；
  - **Skill soft-triggers** 整条，包括"任务开始时说明用不用技能"的宣告仪式；
  - §5.1 aggressive 豁免清单里的 "skill soft-trigger announcement optional"。
- **建议的替代文字**（英文，放在 §2.1）：

  > **Skills**: the harness lists them with descriptions; invoke one when its description fits the task, and none for L0/L1 work. A plugin's "invoke on any chance" wording does not override this judgment (§3).

  这句话和现行条款含义相同：L2 及以上按 description 判断，L0/L1 不调用，插件的强制措辞在各等级都不覆盖这个判断。是否要在 L2 放松，交给 §7.2 的无规范对照臂去回答，这次不改。

- **依据**：
  - 宣告仪式的可见遵循是 1/42 个会话，也找不到任何官方依据。它是输出仪式，不是触发机制；
  - 图例和降级说明是 harness 的原生行为：清单里没有的技能调用不了，调用失败模型会自己改道；
  - 保留下来的那一句，是对 superpowers 注入的冲突裁决。
- **效果**：核心约 −600 B（−2.5%）。
- **风险**：如果 L0/L1 的过度触发真实存在、而且是那几句压住的，删掉会让它冒出来。缓解办法是那一句保留下来；用 §7.2 的 A/B 测 L0/L1 任务上的技能调用是否仍为 0。
- **联动**：
  - §1 Language contract 里的 "skill+command bodies" 是语言规则，不动；
  - §3 的信任顺序 "harness + MCP + skill instructions" 不动；
  - §2.1 的 browse 偏好改写成不依赖 `gs:` 图例的形式，例如 "UI/visual verify → gstack's browse via the `gstack` skill; not …"。这是使用者的偏好（2026-09-26 的 D1 决定），保留。

### K3（P0 / P1）发版和 L3 流程只写行为，不写技能名

- **P0：发版**
  - **现状**：
    - 核心 §2.2 的 Ship triggers 行写的是 "`ship` skill if listed (else manual)"；
    - `ship.md` 的 Ship-pipeline hardening（HARD，登记在 `hard-rules.json`，id `§12-ship-pipeline-hardening`）写的是 "invoke the `ship` skill if listed. Manual ship allowed ONLY if stated in REPORT"。
  - **本机实况**：`ship` 没有注册。模型即使看到 "if listed" 仍然去调用，6 次报错；`gstack:ship` 又报错 3 次。没有这个技能时，发版回合还要多写一行 override 声明 `manual ship because …`。
  - **建议**：硬化规则的本意（发版的机械清单必须照做：版本号各处、CHANGELOG、Release 产物）保留，载体改成"项目的发版 runbook"。清单里**有**发版技能时可以用它，runbook 的关卡照样适用；没有时直接按 runbook 做，不需要 override 声明。
  - **注意**：这条是 HARD，改写要过发版前评审。`hard-rules.json` 的 `section_anchor` 和 neighbourhood 哈希都要同步更新。
- **P1：L3 流程和评审**
  - **现状**：`plan.md` §4.FULL 的 11 步流水线有 22 处技能名（sp:brainstorming、gs:/autoplan、gs:/ship、gs:/land-and-deploy、gs:/cso …）；`review.md` 有 8 处（"Ship pipeline owned by gs"、"re-run gs:/review"）。
  - **建议**：改写成行为要求，例如"打 tag 前，在全新上下文里由独立评审过一遍 diff"；评审用哪个技能交给 description。
  - **依据**：
    - [S35] 说工具名会留下悬空引用，还说逐步脚本是为规划能力差的旧模型写的；
    - [S16] 说过细的流程会拉低 Fable 5 的质量；
    - 这些 `gs:/` 名字在本机都不存在。
  - **风险**：发版前评审在 R4(c) 中是承重的（5/5 对 0/5）。改写时这条行为要求一个字都不能弱化；改写后用 R4(c) 的 T5 复测，必须保持 5/5。

### K4（使用者决定）superpowers 的去留

| 选项 | 内容 | 依据 / 代价 |
|---|---|---|
| a. 保留（现状） | 核心保留 K2 的那一句裁决 | 每次 startup / clear / compact 多 3.3 KB，冲突依旧在。P2 没有观察到 L0/L1 的过度触发 |
| b. 停用插件，把用到的技能复制成用户级技能 | 把 `systematic-debugging` 等实际用过的技能拷到 `~/.claude/skills/` 下，然后在 `/plugin` 里停用 superpowers | 40 天里模型主动调用 6 次：systematic-debugging 3、TDD 1、writing-plans 1、requesting-code-review 1。停用后注入和冲突都消失，K2 那一句也可以删。代价是插件更新要自己跟进；复制过来的技能 description 可以按本机习惯调 |

推荐 b，理由四条：
- 使用量很低；
- 注入的写法正是官方明说会造成过度触发的那类；
- 裁决句本身也只是为了抵消它；
- 插件作者明确拒绝提供关闭自动触发的选项（#645），社区里的规避办法正是维护一份去掉 hook 的副本。

另外，sjh9714 的测量里，systematic-debugging 的"先复现"效果是 8/20，作者自写的 31 行版本是 10/20。所以复制过来的技能可以只留承重的那部分。但这是改用户全局配置的操作（`~/.claude/settings.json`，硬授权），也关系到使用者自己的习惯，所以列为使用者决定。不管选哪个，都不要再加任何"鼓励调用技能"的规范文字。

### K5（使用者决定）消除三个插件之间的功能重叠

- **做法**：测试先行、调试、评审这三类，每类只留一个技能，不必整插件卸载。插件技能不受 `skillOverrides` 影响 [S1]，所以只能在 `/plugin` 层面整插件启停，或者把要用的技能复制成用户级技能。
- **依据**：[S4] 说 description 重叠会让模型选错。本机 P1+P2 中，和 sp 重叠的三个 matt 技能（`tdd`、`diagnosing-bugs`、`code-review`）被模型调用 0 次；sp 对应的三个（`test-driven-development`、`systematic-debugging`、`requesting-code-review`）共调用 5 次。
- **另一项依据**："One Skill Too Many"（arXiv 2610.11647）测到，约 1/5 的运行被相似技能替代，替代运行丢掉了 1/3 以上的独有核心功能。
- **效果**：路由表想解决的问题从根上消失；技能清单也会变小。清单预算超限时，最少调用的技能的描述会先被丢掉 [S1]。

### K6（P1）"模型已会"的规则：先交叉检查，再消融，承重项不动

1. **交叉检查**：先跑一次官方的 `/doctor prompt-audit`。需要 Claude Code ≥ 2.1.283，本机是 2.1.300；审计规则 2026-10-09 有更新。把它的发现和本文 §3.6、§3.7 对照，只有两边一致的才进入下一步。上一次审计是 2026-09-26 用 `/claude-api prompt-audit` 跑的，规则版本已经变了。
2. **与 harness 逐字重叠的**（§3.7）：§1 Recommend-first 和 Single obvious option 可以列入删除候选，收益约 350 B。但 §5.1 的 aggressive 豁免清单引用了 "single obvious option"，而且 harness 文字随版本和入口变化（SDK、`--system-prompt` 用户看不到这些句子）。所以只在消融显示无差异时才删。
3. **R4(c) 的候选项**：L0 不走流程、§11 一回合做完、§2.1 查证引用、提交前跑测试、如实报告。
   - 设计长会话任务（这些规则本来就是为长会话和上下文压力写的），每臂约 20 次，逐条消融。
   - 加一个长度相近的安慰剂臂。sjh9714 的安慰剂臂是 0/20，这样才能区分"任何像流程的文字都有效"和"这条规则的机制有效"。本仓库现有的配对回放设计里还没有安慰剂臂。
   - 没有结果之前不删。
4. **承重项**：先复现、先红、发版前评审、§5 AUTH、§8 SAFETY 都不动。§8 由 hook 承担的部分（rm 守卫），规范文字保持现状，2026-09-27 已定。

### K7（P2）子代理加载全局规范的成本

- **现状**：每个非 fork 子代理都会加载 `~/.claude/CLAUDE.md` [S5]。09-29 的测量是 187 个子代理中有 182 个带着核心；P2 期间有 143 个子代理转录，核心现为 23.5 KB。
- **建议**：可以给只读型的自定义子代理（研究、检索）设 `omitClaudeMd: true`。这是 v2.1.271 加入的 agent frontmatter 字段，作用于自定义子代理和插件子代理。会改文件的执行型子代理还需要 §8 和证据规则，保持加载。
- **为什么是 P2**：先要测出省下的量值不值，再确认只读子代理不需要语言契约这类规则。官方的说法是 "most rules don't need to reach the subagent itself" [S5]。

### K8（P2）用官方通道度量技能，替代规范里的宣告

- **通道**：OTel 事件 `claude_code.skill_activated`，带 `invocation_trigger`（user-slash / claude-proactive / nested-skill）；`/skill-doctor`，列出从未被调用的技能；`claude plugin eval` 的 `tool_used: Skill` 评分器 [S1、S7、S12]。
- **在那之前**：用本文的 `skill_scan.py` 每次发版后复测。

### K9（P2）强调词旁边补一句理由，而不是加更多强调

- **现状**：核心有 14 处 HARD、7 处 MUST。其中不少没有紧挨着的理由。
- **依据**：
  - [S35] 把"强调旁边没有 because"列为过度施压的可 grep 信号，并说 "Text whose job is behavior should explain rather than shout"。
  - Thariq："give it more context and fewer 'do not do this' instructions"。
  - Chakrabarti 的预印本：写上理由能让遵循率最多提升 23.1%。
- **注意**：v7.2.0 把一部分维护者说明移进了 HTML 注释，以节省上下文。HTML 注释在注入前会被剥掉，模型看不到。如果其中有对模型有用的理由，应当用一个短从句放回正文。
- **做法**：逐条检查 HARD / MUST 行，缺理由的补一个不超过 15 词的从句；HARD 标签作为 `hard-rules.json` 的键保留。这会增加字节（[S35]："Re-baselining adds text too"），而且要和 K6 的消融一起测。

---

## 6. 不建议删的，以及理由

| 项 | 理由 |
|---|---|
| 先复现、先写失败的测试、发版前独立评审 | 无规范对照显示它们承重（5/5 对 0/5）。它们是模型不会自发去做的事，正是 CLAUDE.md 该放的内容 |
| Smallest diff 一类的"只做被要求的事"约束 | 在 Opus 5 上，一条 31 行的同类规则让成本降了 22.8%；Opus 5 比 4.8 多用 67% 的轮数，superpowers 作者也确认它更容易"过度建造"。模型变强后，这类约束更值钱，不是更多余 |
| 小模型也要用的约束 | Anthropic 只给前沿档精简了提示词，Sonnet 5 和 Haiku 4.5 仍拿完整的 "don't" 规则；本规范同样加载进可能跑较小模型的子代理 |
| Iron Law #2（完成声明要附新鲜证据） | 这是"如何报告"，不是"多验证几遍"。[S16] 的数据显示，"按工具结果核对每条声明"几乎消除了虚构的状态报告；Sonnet / Haiku 5.5 低 effort 时会不跑检查就报完成 [S18、S19]。全局规范跨模型加载，子代理可能跑 Sonnet 或 Haiku |
| 按 Opus 5 指南删验证类规则 | 09-29 已决定不做，本次没有新的反证。[S14] 只针对 Opus 5，而本规范跨模型 |
| §8 SAFETY、§5 AUTH 清单 | 高风险、反先验，部分由 hook 兜底；官方也说对必须每次成立的规则用 hook |
| 语言契约、四段报告、Specificity 数字要求 | 这些是使用者自己的约定，与模型默认不同。官方说 CLAUDE.md 该写的正是这类 |
| HARD 标签数量（核心 14 处 HARD、7 处 MUST、1 处 NEVER） | 官方新证据进一步支持"强调要稀缺" [S35]，但 HARD 同时是 `hard-rules.json` 和遥测的键，本机也没有测到稀释造成的漏遵。维持 09-29 的"要动先测" |
| §2 的 Depth triggers 写法 | 已经和官方一致：把"深入/ultrathink"当作推理预算信号，不写"think carefully"这类指令 [S15] |

---

## 7. 实施与验证

### 7.1 顺序

1. **K1 搬规则**：把 §5 K1 表里的 7 条写进目标模块的源文件（`spec/CLAUDE-extended.md` 对应段落），重建模块。
2. **删除**：
   - 删 `skills` 模块和它在 extended 中的段落；
   - 删 `spec-modules.json` 的 `skills` 项和核心 §2.2 的索引行；
   - 删 `scripts/lib/spec-routing.js`、`tests/scripts/spec-routing-consumers.test.js`，以及 doctor 的 `routing:*` 检查；
   - 删 `spec-structure` 里的 §4↔§12 检查。
3. **K2**：改核心的技能文字。
4. **K3 发版部分**：改核心 §2.2 的 Ship triggers 行和 `ship.md` 的硬化条款，同步 `hard-rules.json`。L3 流程部分（`plan.md`、`review.md`）作为同一版本的第二个提交，或者下一个版本。
5. **收尾**：
   - 版本级联（规范小版本，插件小版本）、CHANGELOG、spec changelog、Sizing 行；
   - 更新 `spec-structure` 的哈希和整行钉，`hard-rules-drift`；
   - 跑 `npm run check` 和 `npm run smoke`。
6. **验证**：离线 A/B（§7.2），然后发版前评审，然后发版。

### 7.2 离线 A/B（实施前的关卡）

- **环境**：技能清单要和真实会话一致，所以必须启用插件。可以用临时 HOME 安装同样的插件，或者用 `claude plugin eval`。R4(c) 的 `-p` 无设置环境里没有技能，不能直接复用。
- **臂**：A 为 v7.2.0；B 为 K1 + K2 + K3（发版部分）。
- **任务**：

  | 任务 | 内容 | 测量 |
  |---|---|---|
  | a | L0 改错别字 | 技能调用必须为 0 |
  | b | L1 小改动 | 技能调用必须为 0 |
  | c | 难复现的 bug | 记录调用了哪个技能，不设硬性要求；先复现率必须保持 R4(c) 的 5/5 水平 |
  | d | 新增功能 | 先红率同上 |
  | e | 研究类提示 | 记录是否触发研究技能 |
  | f | fixture 仓库发版 | `Unknown skill` 调用为 0；读了 runbook；打 tag 前做了评审 |

- **C 臂**：插件照常启用，但不带 `~/.claude/CLAUDE.md`。只跑 c、d、e 三个任务，回答"本规范是不是压低了有用的技能调用"（社区研究提出的问题）。要同时测结果（先复现、先红），不只测调用：多调用不等于更好，见 §2.2。
- **规模**：A、B 各 6 个任务 × 10 次，C 臂 3 个任务 × 10 次，共 150 次。按 R4(c) 规范臂每次约 $0.22 估算，约 $33。
- **通过标准**：
  - a、b、f 为硬性要求；c、d 的承重行为不低于 A 臂减 1。
  - C 臂只用来做判断：如果 C 的技能调用多而结果不差，再考虑在 L2 放松裁决句；如果结果更差，现状就有依据。

### 7.3 发版后测量（时钟从第一条新版本的 `hook_version` 日志行开始）

| 指标 | 基线（P2） | 预期 |
|---|---|---|
| `Unknown skill` 错误调用 | P1+P2 共 9 次，P2 1 次 | 0 |
| L0/L1 任务上的技能调用 | 0（未观察到） | 0 |
| 按 description 自选的技能调用 / 会话 | P2 5/42 | 不要求变化，只记录 |
| 等级声明率、四段报告率 | 67% / 87.5%（09-29 口径） | 下降不超过 5 个百分点 |

---

## 8. 局限

- **本机数据**：只有一台机器、一个使用者；P2 只有 16 天、42 个交互会话。其他安装者的 `skills.md` 读取率和技能使用方式未知。
- **宣告遵循率用的是正则**（"技能 / skill / sp: / matt: / gs:/ / superpowers / mattpocock"），可能漏掉不含这些词的说法。不过 P2 的 1/42 个会话和"模块读取 0 次"互相印证。
- **"压缩后清单丢失会让降级规则误判"是推论**：来自 [S6] 的事实，本机没有复现。
- **官方没有公布技能自动触发率的数值**（研究代理逐项查过，见底稿 `research-official.md` §8）。
- **R4(c) 是单回合短任务**，每臂 5 次，"候选"一栏只是没检出差异。
- **harness 系统提示词会随版本和入口变化**：§3.7 只在 2.1.300 的 CLI 主会话里核对过。
- **不同来源的调用率单位不同，不能直接比**：本仓库旧记忆里的 0.2% 按每次工具调用计；本文按会话计（P2 为 12%）；社区的评测按单条提示计（每例 3 次）。
- **社区测量多数样本小、单个作者**。Anthropic 删减提示词时用的评测数据没有公开。
- **未测的假设**：核心 §2.2 的模块索引行用括号概括了模块内容。按 superpowers 文档里的 "Description Trap"，模型可能照着括号里的概括去做，而不去读模块本身。本文没有测这一点。

---

## 9. 实施后的处置（2026-10-15）

### 9.1 已经完成的

- **K1–K3**：已发布为 claudemd 0.108.0（规范 v7.3.0，tag 在 243212d）。
- **K4/K5**：2026-10-15T20:17:57Z 起在用户级停用了 superpowers，没有复制它的技能。理由是不带规范的对照组里，先复现只有 4/10，带规范时是 10/10，这个行为由规范自己的规则保证。
- **A/B**：结果见 `tasks/skill-ab/RESULT.md`。

### 9.2 K6–K9：现在都不改规范

用户问这几项要不要接着做，结论是现在都不改规范，理由按项列在下面。

**K7 子代理加载全局规范：不做。** 字段确实存在，CLI 2.1.301 对它的说明是 "Run this agent without the user, project and local CLAUDE.md instruction files"。内置 Explore 已经带着这个字段：本机 P2 期间 Explore 0/3 加载了核心，其他子代理 152/158 加载了核心。下表是 09-30 到 10-15 主会话里 150 次 Agent 调用的分布：

| 类型 | 次数 | 能不能设 `omitClaudeMd` |
|---|---|---|
| general-purpose | 92 | 不能，内置类型 |
| reviewer（gsd，Read/Bash/Grep/Glob） | 25 | 能，但它是 gsd 插件的文件，插件更新会覆盖 |
| release-reviewer（本仓库） | 14 | 能 |
| researcher（gsd） | 4 | 能，同 reviewer |
| 其他（claude-code-guide、executor、Explore、fork 等） | 15 | 内置类型、会改文件的类型，或本来就不加载 |

- **能省的量**：可设的三类合计 43/150，即 29%。每次省掉约 27.6 KB 指令文件：核心 23,522 B，项目 CLAUDE.md 3,864 B，语言规则 267 B，约 7–8k token。16 天合计约 30 万 token，其中大部分按缓存读计价。
- **要付的代价**：
  - 这三类评审和研究代理都会跑 Bash。去掉规范后，它们就看不到 §8 里那些没有 hook 兜底的条文，例如不许递归遍历 `~/.claude/`、沙箱只清理自己的目录（`feedback_subagent_sandbox_cleanup_own_dir_only`）。
  - gsd 的文件会被插件更新覆盖。
- **结论**：收益小，风险落在评审代理的安全纪律上，不做。如果以后子代理用量大幅上升再重算。

**K8 用官方通道度量技能：不新开通道，到期复测。**
- OTel 要在 `settings.json` 里加 env，属于硬授权，还要另起采集端。`/skill-doctor` 只能由用户手动运行。
- 现有的 `skill_scan.py` 已经能回答同样的问题。
- 做法：v7.3.0 生效满两周后，大约 2026-10-29，用它复测一次，口径和 §7.3 的表相同。

**K6 消融"模型已会"的规则、K9 给强调词补理由：推迟，合成一次实验再定。**
- **时机**：lang-drift 和 G2 的评估窗口到 10-26 才结束，v7.3.0 的生效计时也要等重启后才开始。这时再改一次核心，三件事就混在同一个窗口里，哪一件都量不准。
- **性价比**：核心还有 1,818 B 余量，没有体积压力。K6 的候选合计只有几百字节到 1–2 KB。K9 反而会增加字节。
- **成本**：两者都要长会话任务的消融，外加一个安慰剂臂。按基线、安慰剂、5 个单项消融各 20 次估算，约 140 次运行；照 A/B 里多步任务每次约 $0.65 的价格往上估，总计约 $150–300。
- **先做的**：K6 第 1 步，官方 `/doctor prompt-audit` 的交叉检查，几乎不花钱，但只能由用户在交互会话里运行。
- **决定点**：放在 10-29 复测时，届时看复测结果和审计结果，再决定要不要花这笔钱。

### 9.3 10-17 中期数，以及 10-29 复测口径的修订

用 `skill_scan_p3.py` 量了一次（见附录 B）。语料是 10-01 以来的会话记录，按每个会话实际加载的规范版本分组。

| 指标 | v7.2.0（10-06 到 10-15，44 个交互会话） | v7.3.0 起（10-15 22:26Z 到 10-17 16:47Z，23 个：v7.3.0 5 个、v8.0.0 6 个、v8.1.0 12 个） |
|---|---|---|
| `Unknown skill` 错误（主会话加子代理） | 1（code-graph-mcp，10-06，`ship`） | 0 |
| 调用过技能的会话 | 6/44 | 3/23 |
| 技能调用 | 7 | 3：`claude-api`（问模型升级是否划算）、`converge`（使用者要求的端到端测试）、`gstack`（按核心 §2.1 经它调用 `browse` 做界面验证） |
| L0/L1 小改动上的技能调用 | 0 | 0 |

10-29 复测按下面三处修订执行：

- **`Unknown skill` 不再是有效指标。**
  - 从 10-17 16:20:51Z 起，gstack 的 `ship` 出现在技能清单里；10-01 以来另外 65 个带清单的交互会话里都没有它。现在调用 `Skill(ship)` 不会再报错。
  - 样本量也不够。v7.2 期间，提示里带发版词的会话中出现这个错误的是 1/21。要让 0/n 在 95% 水平上排除这个比率，需要 n ≥ ln(0.05)/ln(20/21) ≈ 62 个这样的会话。现在有 15 个；按 v7.2 期间约 2 个/天的速度，到 10-29 约 40 个，仍然不够。"发版词"是对提示的粗匹配，`next-release` 这类提及也会算进去，所以这些数只是上限。
- **新增一项：有 runbook 的项目里，发版时是否改用 `ship` 技能。** `ship.md` 的顺序是先用项目的 ship runbook，没有 runbook 才用清单里的 ship 技能。清单里有了 `ship` 以后，要看的是 claudemd 这类有 runbook 的项目，发版会话是否还按 runbook 走。这项没有基线，因为这个条件 10-17 才出现。
- **§7.3 第 4 行（等级声明率、四段报告率）不再可比。** 这一行用的是 09-29 的口径，量的是 v7 的汇报格式。v8.0.0 把汇报改成了 `## 汇报` 下的变更、验证、遗留三段（空的可省）。v8 汇报格式的计数见 `scanReportV8`，不放在这项复测里。

这次复测不挡任何决定：K8 已经定为不开 OTel 通道。D#328（K6+K9）的决定点仍是 10-29，依据是复测结果和 `/doctor prompt-audit` 的结果，后者只能由使用者在交互会话里运行。

**10-20 更正：`ship` 只在清单里待了几个小时。** gstack 之后被卸载了，`~/.claude/skills/` 下现在只有 `converge`。扫 10-17 以来所有带初始技能清单的会话记录（229 个，各项目合计）：清单里有 `ship` 的 6 个，最后一个在 10-17T19:27:47Z；从下一个会话 10-17T21:18:59Z 起，223 个都没有它。所以上面两条修订只对 10-17 16:20:51Z 到 21:18:59Z 之间成立：
- `Unknown skill` 在 10-17T21:19Z 之后的会话上仍是有效指标，样本量的限制照旧。
- "有 runbook 的项目发版时是否改用 `ship` 技能"没有可量的会话，不再测。
- 脚本：本会话 scratchpad 的 `ship_listing.py`，不持久。它读每个会话第一条 `isInitial` 的 `skill_listing` 附件里的 `names`。

### 9.4 10-23 中期数（10-29 复测的提前版）

10-29 的复测照旧。这里先用同一口径跑了一次：`skill_scan_p3.py` 和 `analyze_p3.py` 的副本，只改了 `SELF`；按每个会话实际加载的规范版本分组；扫描在 10-23 晚上，最后一个会话开始于 10-23T19:05Z。

| 指标 | v7.2.0（10-06 到 10-15，44 个交互会话） | v7.3.0 起（10-15 22:26Z 到 10-23 19:05Z，74 个：v7.3.0 5、v8.0.0 6、v8.1.0 17、v8.2.0 42、v8.3.0 4） |
|---|---|---|
| `Unknown skill` 错误（主会话加子代理） | 1 | 0 |
| 调用过技能的会话 | 6/44 | 3/74 |
| 技能调用（主会话） | 7 | 3，就是 §9.3 记过的 `claude-api`、`converge`、`gstack`；10-17 以后没有新的 |
| L0/L1 小改动上的技能调用 | 0 | 0 |

- **样本量**：提示带发版词的会话整个窗口 37 个。按 10-20 更正只算 10-17T21:19Z 之后的，是 17 个（10-19 到 10-23，约每天 2.8 个；这个分界数由扫描子代理数出，作者复跑只核对了上表各行）。离 62 个还差 45 个，照这个速度约 11-08 才够。发版词是粗匹配，这些数是上限。
- **L0/L1 怎么判的**：会话记录里没有等级声明，所以按回合实际做的事判断。三次主会话调用分别是改外部 API 请求体（L2）、使用者要求的端到端测试轮、依赖升级加 CI 配置（至少 L2）。
- **核心规范余量**：v8.3.0 的 `spec/CLAUDE.md` 23,422 B，上限 25,000 B，余 1,578 B（`spec-coherence-audit` 的 sizing-headroom，10-23）。§9.2 的 1,818 B 是 v8.2.0 之前的数。
- 这些数不替代 10-29 的复测。D#502（K6+K9 消融，约 $150–300）的决定点不变，花不花由使用者定。

### 9.5 D#502 与 D#327 的处置（2026-10-23）

使用者让作者给出建议并照着做，结论是两项都改。

**D#502（K6+K9 消融）：不花这笔钱，改成满足条件才重新估算。**

- **推迟它的理由已经不成立。** §9.2 推迟，是怕和 lang-drift、G2 的评估窗口以及 v7.3.0 的生效计时混在一起。两个窗口的分析段 10-16 已截止并读完，v7.3.0 也已生效。D#327 量的是技能调用，K6、K9 动的规则不在它的指标里，等它不会让消融更准。
- **每臂 20 次测不出 K6 要证明的事。** K6 的前提是"去掉这条，行为基本不变"，也就是效应小。基线 20/20 时，单侧 Fisher 精确检验要到消融臂 15/20 才 p < 0.05。遵循率从 100% 降到 90%，检出概率 4%；降到 80%，37%；降到 70%，76%。反过来，消融臂 20 次全对，也只能说失败率的 95% 置信上界是 13.9%。要在 0 失败时把上界压到 5%，每臂要 59 次。按 `docs/prompt-audit-2026-10-17.md` §6 缩成的 4 臂（约 80 次、$86–171）算，每臂改成 59 次约 236 次，费用约为那个估算的 3 倍。
- **收益有更便宜的来路。** K6 的收益是核心少几百字节到 1–2 KB。核心现在余 1,578 B（§9.4），待办里也没有要往核心加字的条目（10-23 共 3 条：D#327、D#502、D#566）。真要腾地方，把条文移进按需加载的模块不需要实验。K9 会加字节，而已测过的几项离上限很近：先复现带规范 10/10（§9.1），"一回合做完"有无规范都是 5/5（prompt-audit F9），留给理由从句的提升空间很小。
- **重新估算的条件**，满足一条即可：
  - 一条必须进核心、又不能放进模块的改动超出 25,000 B；
  - 某条 HARD / MUST 规则在真实会话里测到了违反。这时只对那一条做配对回放：同样的情境，带理由从句和不带各跑一组，样本量先按 n = ln(0.05)/ln(1−p) 算好。

**D#327（技能使用复测）：从定在 10-29 改成样本够了再测。**

- `Unknown skill` 是 0/n 型的结论。照 §9.4 的速度（10-17T21:19Z 之后约每天 2.8 个发版词会话），10-29 大约有 34 个。34 个里 0 次出错，只能在 95% 水平上排除 8.4% 以上的比率，而 v7.2 期间的基线是 1/21，即 4.8%，所以 10-29 复测分不出新旧。
- 到 62 个（约 11-08）时，0 次出错能排除 4.7% 以上的比率，这才和基线可比。
- 这个失败现在仍可能发生，所以指标还有效：`ship.md` 只指向"已登记的 ship 技能"，但核心 §2.1 写着 "none for L0/L1 work except a ship trigger"，而触发词 `ship` 正是当初报 `Unknown skill` 的那个名字（10-23 核对 `spec/CLAUDE.md` 与 `spec/spec-modules/ship.md`）。
- 其余几项（L0/L1 小改动上的技能调用、调用过技能的会话）§9.4 已经有数，10-29 只会多 6 天数据。

---

## 附录 A：官方来源（抓取日期均为 2026-10-15）

| ID | 来源 | 日期 |
|---|---|---|
| S1 | code.claude.com/docs/en/skills | 无日期 |
| S2 | code.claude.com/docs/en/memory | 无日期 |
| S3 | code.claude.com/docs/en/best-practices | 无日期 |
| S4 | code.claude.com/docs/en/features-overview | 无日期 |
| S5 | code.claude.com/docs/en/sub-agents | 无日期 |
| S6 | code.claude.com/docs/en/context-window | 无日期 |
| S7 | code.claude.com/docs/en/plugin-evals | 无日期 |
| S12 | github.com/anthropics/claude-code CHANGELOG.md（版本日期取自 npm registry，最新 2.1.300 = 2026-10-14） | 按版本 |
| S13 | platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | 无日期 |
| S14 | …/prompting-claude-opus-5 | 无日期 |
| S15 | …/prompting-claude-opus-5-5 | 无日期 |
| S16 | …/prompting-claude-fable-5 | 无日期 |
| S18 | …/prompting-claude-sonnet-5-5 | 无日期 |
| S19 | …/prompting-claude-haiku-5-5 | 无日期 |
| S23 | claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models（Thariq Shihipar） | 2026-07-24 |
| S24 | claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more | 2026-06-18 |
| S30 | claude.com/resources/articles/using-claude-md-files | 2025-11-25 |
| S34 | github.com/anthropics/skills skill-creator/SKILL.md（本机 `claude-plugins-official/skill-creator/fbe07fb6ce7d` 的副本逐字相同） | 2026-03-06 / 04-23 |
| S35 | github.com/anthropics/skills claude-api/shared/prompt-audit.md | 2026-10-09 |

完整的 39 个来源、引文和置信度见底稿 `research-official.md`。

## 附录 B：复现

```bash
D=tasks/model-capability-2026-10-15
python3 -I $D/skill_scan.py   # writes skill_sessions.jsonl next to the script (~5 s)
python3 -I $D/analyze.py      # P1/P2 tables in §3.2
```

`skill_scan.py` 里的 `SELF` 是本次测量会话的 id，复测时换成当次会话的 id；分期边界由 `P2_START` 决定。

复测（§9.3）不要再跑 `skill_scan.py`：它会覆盖 `skill_sessions.jsonl` 里的 P1/P2 数据。会话记录大约只保留 30 天（`settings.json` 没设 `cleanupPeriodDays`；10-17 本机最旧的会话记录是 09-19 的），所以 P1 的 09-05 到 09-18 已经量不回来了，P2 从 10-30 起也会开始被清理。改用：

```bash
python3 -I $D/skill_scan_p3.py   # set SELF first; writes skill_sessions_p3.jsonl
python3 -I $D/analyze_p3.py      # groups by the spec version each session loaded
```

## 附录 C：doc-check

`node scripts/doc-check.mjs docs/spec-model-capability-review-2026-10-15.md --allow-untracked-missing` 读下面这个块。§3.4 那一行引用的目录在 gstack 卸载后已不存在，那一行是当时状态的记录，所以不查它的路径。

```doc-check
skip-line: 卸载 gstack 后这个目录已不存在
```
