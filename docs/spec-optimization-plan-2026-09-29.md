# 全局规范提示词优化方案（2026-09-29）

对象：`~/.claude/CLAUDE.md`（AI-CODING-SPEC v7.1.0 核心，24,740 B，226 行）及其按需模块，以及本插件放进每个会话的其他常驻文字。
目标：在不改变规范行为的前提下，减少模型每轮要看的常驻文字，去掉互相冲突的指令，让注意力留给编程任务本身。
依据：网络研究（官方文档 + 论文）、本机 224 个交互会话的使用数据、核心与 Claude Code 系统提示词（2.1.285）的逐条对照、一轮离线 A/B。
底稿（本地、不入库）：`tasks/v7.2-core/`（研究笔记、使用数据报告与脚本、逐条编辑脚本 `edits.py`、草稿补丁），A/B 原始结果 `tasks/offline-eval/v72-cand/`。

---

## 0. 结论

1. **核心已接近下限。** 草稿估计不改含义的删减约 7.6%（24,740 → 22,869 B）；评审发现其中 8 处"重复"其实是别处没有的规则或指针，恢复后实施版为 5.7%（→ 23,320 B）。核心里高频规则都在被使用：等级声明出现在 67% 的会话，四段报告出现在 87.5%，`[AUTH REQUIRED]` 出现在 21%。几乎不触发的条款合计不到 2 KB。
2. **冲突比长度更要紧。** 研究显示，指令叠加后遵循率的下降主要来自两两冲突，不是条数本身。本次找到一处核心与 harness 的直接冲突（"上下文压力"算作可中途停下的理由），予以删除。
3. **不做符号压缩。** 符号只占核心 4.1% 字节，替换最多省几百 token。没有研究表明符号化的规则更容易被遵守；官方文档反而说提示词风格会渗进输出。
4. **核心之外有更大的一项，而且本插件能直接改：** claudemd 自己 16 个命令的描述每个会话占 3,955 B；去掉其中 15 条省 3,591 B，约为实施版核心精简量（1,420 B）的 2.5 倍。模型在 248 个会话里只主动调用过它们 8 次。
5. 离线 A/B：候选方案 50/50 通过，v7.1.0 为 49/50，费用持平（$10.28 vs $10.27）。

---

## 1. 判据：什么叫"不影响功能"

- **行为不退化**：离线任务集（Opus 5.5，high，每任务 5 次）每个任务通过数 ≥ 基线 − 1。AUTH（T4）、§8 rm 闸门（T8）、多步骤一轮完成（T9）必须 5/5。
- **结构不退化**：`npm run check` 全绿；`spec-coherence-audit --strict` 无新发现；每个 HARD 锚点在核心 + 模块中仍恰好出现一次（`hard-rules-drift`）。
- **只删三类文字**：
  - 删掉后模型行为不变的文字：重复内容、harness 已说过的内容、只给维护者看的说明；
  - 与 harness 冲突的文字；
  - 罕用且另有去处的细则。

  高频或高风险规则不因体积而移动。
- **大小按"模型可见字节"计**：Claude Code 注入前会剥掉块级 HTML 注释，所以注释里的文字不占上下文。

**这些判据测不出的东西**：
- 每格 5 次，只能看出大幅退化，例如从 5/5 掉到 3/5；
- 任务集不覆盖被下沉条款的触发场景；
- 基线 A 是 0–2 天前的历史结果，不是同时配对。

§7 的发版后测量用来补这些缺口。

---

## 2. 证据

### 2.1 外部证据（强度从高到低）

| 结论 | 来源 | 强度 |
|---|---|---|
| CLAUDE.md 目标 < 200 行；更长会降低遵循；`@import` 与无 `paths` 的 rules 不省上下文 | code.claude.com/docs/en/memory | 官方文档 |
| 逐行问"删掉它会不会让 Claude 犯错"，不会就删；过长的文件会让规则被忽略 | code.claude.com/docs/en/best-practices | 官方文档 |
| 两条规则矛盾时 Claude 可能任取其一；块级 HTML 注释在注入前被剥掉 | code.claude.com/docs/en/memory | 官方文档 |
| 强调要稀缺（只加在那一行）；Claude 4.5 起激进措辞会过度触发 | best-practices；claude-prompting-best-practices | 官方文档 |
| 提示词的格式风格会影响输出风格 | claude-prompting-best-practices | 官方文档 |
| Opus 5 上显式"再验证一遍"类指令会导致过度验证 | platform.claude.com/.../prompting-claude-opus-5 | 官方文档 |
| `disable-model-invocation: true` 的技能描述不进上下文；插件技能不受 `skillOverrides` 影响 | code.claude.com/docs/en/skills | 官方文档 |
| 必须每次成立的规则用 hook，CLAUDE.md 只是请求不是保证 | code.claude.com/docs/en/features-overview | 官方文档 |
| 条件类约束的错误里 >30% 是条件判断错；"选哪条规则适用"最差 | AgentIF，arXiv 2505.16944（NeurIPS 2025 D&B） | 同行评审 |
| Claude Opus 4：100 条简单规则 94.6%，250 条 67.9%；失败以遗漏为主 | IFScale，arXiv 2507.11538 | 预印本 |
| 遵循率随指令叠加从 ~96% 跌到 20%，主因是两两冲突；强模型上改写措辞几乎无收益 | arXiv 2608.02639 | 预印本 |
| 上下文文件不普遍提高成功率，成本 +20% 以上；其中指令大体会被遵守 | Gloaguen 等，arXiv 2602.11988 | 预印本 |
| 激进压缩在成本和效果上都被中等压缩支配 | arXiv 2603.23525（Claude Sonnet 4.5，358 次） | 预印本 |

论文里的模型都早于 Claude 5，结论按"方向"使用，不按数值外推。

### 2.2 本机使用数据

语料：2026-09-05 起 224 个交互会话（其中 v7 为 28 个）、799 条人类提示、1,942 条最终回复。脚本在 `tasks/v7.2-core/usage-scripts/`。

| 条款 | 提示触发（人工核对的真实命中 / 224） | 输出中可见的使用 |
|---|---|---|
| HACK / EMERGENCY / AUTONOMOUS | 0 | 4 会话，v7 为 0 |
| AUTONOMY_LEVEL | 0 | 5 会话，v7 为 0 |
| "更严"质量滑杆 | 0 | 0 |
| 取消 / 切换 | 0 | — |
| NPX | 0 | — |
| auth / payment / crypto | ≈1 | — |
| schema / DB | ≈2 | — |
| User relaxation | — | 1 |
| 8.V2 编辑器诊断 | — | 1 |
| 等级声明 L0–L3 | — | 150（67%） |
| 四段报告 | — | 196（87.5%）；顺序错 6/446 |
| `[AUTH REQUIRED]` | — | 47（21%） |
| `${VAR:?}` rm 守卫 | — | 111；v7 26/28 |

其他：
- § 标签泄漏进最终回复：全期 31.3%（608/1,942），v7 期间 5.1%（11/217）。
- extended 整篇读取：v7 之前 99/189（52.4%），之后 2/35（5.7%）。
- 子代理：182/187 个携带核心，每次约 24.8 KB。
- claudemd 命令被模型主动调用：248 个会话共 8 次（refresh 2、install 2、update / analyze / status / doctor 各 1）；用户手敲 15 次。

### 2.3 每会话常驻上下文实测（本会话开场注入）

| 来源 | 字节 |
|---|---|
| instructions（核心 24,740 B 文件、本项目 MEMORY.md 15,125 B、项目 CLAUDE.md、rules） | 42,847（JSON） |
| 技能清单 | 24,985，其中 claudemd 3,955（15.8%） |
| SessionStart hook 注入（superpowers 引导约 4 KB + mem 仪表盘） | 7,002 |

核心约占可配置常驻上下文的三成。缓存命中价只有标准输入价的 5%，所以精简的理由是注意力和遵循率，不是费用。

### 2.4 核心与 harness 的重叠和冲突

- **重叠**（harness 已说过，核心又说一遍）：
  - "给出推荐而不是罗列"；
  - Agent 工具的 fork / general-purpose 语义；
  - 子代理完成后会通知；
  - 不重读刚编辑的文件；
  - 召回的记忆要核对、错的删掉。
- **冲突**：
  - 核心 §11 把"上下文压力"列为可中途停下的理由。harness 写的是 "context is summarized … you don't need to wrap up early or hand off mid-task"。
  - 核心 §7 要求每个验证过的改动都本地提交，harness 写的是 "Commit or push only when the user asks"。核心按优先级明确覆盖 harness，维持不动。

---

## 3. 诊断

核心的问题不在总长度，而在四类文字：

1. **重复**：同一含义写了两遍（`[AUTH REQUIRED …]` 完整格式、子代理指针、禁用措辞、"HARD 不因模式放宽"写了三遍）。重复会抬高一条规则的显著性，也会变成彼此的干扰项。
2. **与 harness 重复或冲突**：重复是空操作（no-op），冲突会让模型任取其一。
3. **维护者说明**：解释规范为什么这样写，对执行任务没有作用（如 "the Stop scan is advisory and opt-in"）。
4. **罕用细则占常驻位**：0–1 次触发的细则整段常驻。但 B6 的教训是：规则移进不触发的模块就看不见，所以只移细节，核心保留可执行的一行。

另外，本插件自己往每个会话塞了 3,955 B 的命令描述，换来的是 248 个会话里 8 次模型调用。

---

## 4. 建议与实施项

每项都写明依据、效果和验证方式。R1–R6 在本次（规范 v7.2.0，插件 0.107.0）实施。

### R1 核心去重（19 处，含义不变）

- 做什么：`edits.py` 的 E01–E19。重复的信号格式、子代理指针、Task 定义并入 §0；删 harness 已说过的内容；Tool escalation 压成一行；Auto-memory 三级触发压成一句；删维护者从句（保留有动机作用的 "under bypassPermissions nothing else stands there"）。
- 依据：官方"逐行问会不会犯错"、单一事实来源、上下文干扰项研究。
- 效果：−1,188 B（草稿）。实施版撤回或部分撤回其中 7 处：E01、E02、E04、E09、E10、E12、E16。原因见 §9。
- 验证：A/B 行为判据；`hard-rules-drift`。

### R2 删除与 harness 冲突的"上下文压力"停止条件（B03，含义改变）

- 做什么：§11 "Yield only on" 列表删去 `context pressure (→ tasks/<slug>-paused.md)`。
- 依据：
  - harness 自动压缩上下文，并明确说不必提前收尾；
  - 冲突会被任取其一；
  - 本机 224 个会话里写 paused.md 的只有 4 个。

  `session.md` 保留"压力大时可以写一个 paused 检查点"，但写完不停下。
- 效果：−49 B。行为上少一种合法的中途停法，规则变严。
- 风险：长会话里原本会停下交接的回合，改为继续执行。压缩后的续接由已有的 post-compaction 规则保障（重读计划）。
- 验证：T9 5/5；发版后测"继续 / next"类催促率（§7）。
- 版本：minor（规则收紧）。

### R3 罕用细则下沉（B01、B02、B04）

- B01：§0.2 中途反馈四条压成一段。"更严 / scope-expansion"的合并阈值移入 `modes.md`（§0.2-EXT）。依据：更严 / 取消 / 切换真实触发都是 0/224。
- B02：§3 User relaxation 保留可执行的一句（用户可放宽规范默认值、回述一行；HARD 规则与 AUTH 闸门不这样放宽，§8 永不）。命名通道和"两类之外怎么办"移入 `auth.md` 新增的 §3-EXT；core 索引行加上 user relaxation。依据：1/224 会话。
- B04：8.V2 删示例，规则不变。
- 效果：−532 B（B01 −171、B02 −278、B04 −83）。移入模块的文字写得更短，extended 净增控制在 +500 B 以内。

### R4 维护者专用行放进 HTML 注释（H01、H02）

- 做什么：首部 "Canonical | Modules | History" 行、§1.5 "Extended-only terms" 指针改为 `<!-- … -->`。
- 依据：官方文档说块级注释在注入前剥掉。本机验证：本项目 CLAUDE.md 盘上有 4 行 `<!--`，送进子代理的副本里是 0 行。
- 效果：模型可见 −203 B；文件里文字仍在，安装、路径类测试不受影响。
- 约束：只用于维护者专用文字。注释里的文字测试仍能钉住，但模型看不到，所以规则性文字不能放进注释。

### R5 claudemd 命令描述移出上下文（插件行为改变）

- 做什么：16 个命令中，15 个加 `disable-model-invocation: true`。保留 `claudemd-design-adopt` 可由模型调用，因为它靠用户的自然语言（"配置设计规范"）经描述匹配触发。
- 依据：
  - 官方文档："Description not in context, full skill loads when you invoke"；
  - 本机 248 个会话中模型主动调用 8 次，用户手敲 15 次；
  - 有副作用的命令（install / uninstall / refresh / update / toggle / statusline / clean-residue）按官方建议本就该由用户触发。
- 效果：技能清单每会话 −3,591 B（3,955 B → design-adopt 一条 364 B），约为实施版核心精简量的 2.5 倍。
- 用户可见变化：模型不再自行调用这些命令，用户照常可以键入 `/claudemd-…`。
- 回退路径：没有逐命令的开关（插件技能不受 `skillOverrides` 影响）。要回退整个版本，按 `docs/ROLLBACK.md`「Local machine needs the previous version back」：先让 Claude Code 加载 0.106.0 插件，再在 `v0.106.0` 的检出里运行 `CLAUDEMD_ALLOW_DOWNGRADE=1 node scripts/install.js`，然后重启。只换插件版本，v7.2.0 规范仍留在本机，SessionStart 还会提示去 `/claudemd-refresh`。
- 发版要求：按"已发布产物默认行为改变"清单，写 CHANGELOG 迁移说明和 release note 提示。
- 验证：发版前用 `claude -p --plugin-dir` 在临时目录跑一次，读转录里的 `skill_listing` 附件，确认只剩 design-adopt。

### R6 登记同期改动（分析纪律）

- lang-drift 与 g1b-g2 两个 PREREG 各追加一条 0.107.0 的"同期改动"，写明：
  - 改了哪些模型可见文字；
  - core §1 语言条款没动；
  - 相关 hook 没动；
  - 按暴露版本分段报告。
- 同时补记 0.106.0 的暴露时间（D#190）。
- 登记时不看任何结果。

---

## 5. 考虑过、不建议或暂缓

| 项 | 结论 | 理由 |
|---|---|---|
| 把 §、→、Δ 全文改成文字 | 不做 | 只占 4.1% 字节；无研究支持；§ 泄漏已从 31.3% 降到 5.1%。改写要改大量测试钉，收益最多几百 token |
| 减少 HARD 标签（14 处） | 暂缓 | 研究支持"强调要稀缺"，但这里的 HARD 同时是 `hard-rules.json` 清单与遥测的键；也没有测到因稀释而漏遵的规则（四段顺序错 6/446）。要动需先测 |
| 按 Opus 5 指南删验证类规则 | 不做 | 本机无规范对照已证明复现优先、先红后绿、发版前评审是承重的（`project_oss_benchmark_2026-09-28`）。本机因果证据优先于通用建议 |
| 把 extended 改成桩文件 | 不做 | v7 后整读率 5.7%，问题已消失 |
| 把更多规则下沉到模块 | 不做 | 剩下的高频规则是任务开始时就要用的（B6 教训）；罕用条款已在 R3 处理 |
| superpowers 引导词与核心 §2.1 的冲突 | 暂缓 | 冲突源在第三方插件；插件 hook 不能单独关。核心已有一句显式裁决，维持 |
| 压缩本项目 MEMORY.md（15 KB） | 先测再做 | 描述是"读不读这个文件"的判断依据，缩短可能降低召回；需要先定义召回指标（例如 memory-read-check 命中后的读取率）再动 |
| 在核心末尾加简短提醒（利用近因效应） | 不做 | 会加字；没有测到核心前部规则在长会话里失效 |
| 用 hook 在工具调用时注入规则 | 已有，不扩 | `test-failure-debug`、`ship-baseline` 等已在用；再扩需要单独立项和预注册 |
| extended 的 50 KB 上限改为只看模块 | 记为开放问题 | v7 后 extended 只是构建源；本次不改工具链 |

---

## 6. 实施步骤与授权

用户于 2026-09-29 书面授权："需要我授权的，授权同意"。本方案涉及的授权项逐条列出：

| 授权项 | 类别 |
|---|---|
| 修改核心与模块（LLM 可见规范，L3 进入实施） | §5 hard |
| 修改已发布插件的默认行为（R5） | L3 已发布产物 |
| push main、打 tag（触发 npm 发布）、`gh release create` | 发版 |

步骤（发版为手动流程，因本会话没有注册 `ship` 技能）：

1. 应用 R1–R4 编辑：核心；extended（§0.2-EXT、§3-EXT、Recent changes）；重建模块。
2. R5：15 个命令加 frontmatter 字段；用 `--plugin-dir` 探针验证技能清单。
3. 更新测试：neighbourhood 哈希、6 条整行钉、extended 段落登记。
4. 版本级联：规范 v7.2.0、插件 0.107.0；写 CHANGELOG、spec changelog、Sizing 行。
5. 跑 `npm run check` 与 `npm run smoke`；提交。
6. 确认 base CI 为绿；push main；等 CI 变绿。
7. 发版前评审：派一个全新的子代理（release-reviewer），给提交范围、合同和待证伪的主张；按评审发现修复。
8. 打 tag，push tag，`gh release create`，核对 ci 与 npm-publish 两个工作流和 registry 上的版本。
9. R6 PREREG 登记。
10. 暴露时间在用户 `/claudemd-refresh` 并重启后记录。

---

## 7. 发版后测量（时钟从暴露开始，即第一条 `hook_version=0.107.0` 日志行）

| 指标 | 基线 | 预期 | 脚本 |
|---|---|---|---|
| 每会话常驻字节：核心可见字节 + claudemd 技能描述 | 24,740 + 3,955 | 23,320 + 364（实施版） | 读转录 `instructions` / `skill_listing` 附件 |
| 工具回合后"继续 / next"类催促率（R2 守护） | Opus 5.5 1/153（v7.1 记录口径） | 不高于基线 | v7.1 口径的转录扫描 |
| paused.md 写入会话数 | 4/224 | 下降，而且没有"停下交接"的回合 | `usage-scripts/q2b_extra.py` |
| 等级声明率、四段报告率、`[AUTH REQUIRED]` 率 | 67% / 87.5% / 21% | 各自不低于基线 −5 个百分点 | `q2_engagement.py` |
| claudemd 命令的用户手敲次数 | 15 / 24 天 | 可上升（模型不再代劳） | 同 §2.2 扫描 |

- 读取规则：满 30 天或 60 个交互会话，先到者为准；只在结束时看一次。
- 若等级声明或四段报告下降超过 5 个百分点，先离线复现再决定是否回退。

---

## 8. 风险与回滚

- **R2**：若长会话出现"压缩后丢失计划"的失败，恢复这一条即可（单行）。
- **R5**：若用户反馈"模型不会帮我装、刷新插件"，对具体命令去掉该字段即可（逐个命令可逆）。
- **整体**：按 `docs/ROLLBACK.md`「Local machine needs the previous version back」回退到 0.106.0（顺序：先换插件版本，再降级安装规范，最后重启），或 `git revert` 本次提交后重新发版。

---

## 9. 实施记录（2026-09-29，规范 v7.2.0 / 插件 0.107.0）

- **核心**：模型可见 24,740 → 23,320 B（−1,420，−5.7%），盘上 23,522 B；可见行数 226 → 217。比草稿多 451 B，原因有三：复核撤回（下两条）、发版前评审恢复五条规则并改写三行（见最后一条）、复审后恢复 Specificity 的 "Scope" 句：
  - 复核中撤回三处去重：§0 两处 `(subagent → §5)` 是 v6.29.0 的评审修复（告诉子代理不要发信号后干等），不是重复；§1 的 `(§8.V1 binds verification)` 是已跟踪 roadmap 引用 §8.V1 的唯一解析点。
  - §11 的 Correction 行按 `session.md` 原文写成 "≥2 auto-decisions in one task"，没有另起措辞。
- **extended**：48,629 → 49,046 B（+417，98.1%）。移入模块的文字和 Recent changes 条目都已缩短。
- **R5**：15 个命令加 `disable-model-invocation: true`。真实会话技能清单实测每会话少 3,591 B；无 hook 探针显示技能数 29 → 14。
- **测试**：`spec-structure` 更新 14 个段落哈希、2 个标题清单、5 条整行钉，新增 §3-EXT 段落登记和它的整行钉。新钉做了变异检验：在通道列表里加一项，钉和段落哈希都会失败。
- **顺带修正**：`OPERATOR.md` 的 paused 文件表改指 §11-EXT（原文说 core §11 的 context pressure 会产生 paused 文件，本次已删除该条）。
- **发版前评审（fresh-subagent，1 High / 3 Medium / 13 Low）后的修复**：
  - H1：§5.1 `aggressive` 的 "§8 SAFETY + Iron Law #2 + §5 Hard-AUTH still bind" 恢复。Never-downgrade 不含 delete、CI/deploy 配置、prod 依赖、跨模块重构、公共 API Δ-contract 这几类 §5 Hard，`auth.md` 引用这句话；新增整行钉。
  - M1：Specificity 的 "Ambiguous → strict" 恢复。§3 的 stricter reading 只管安全/AUTH；新增整行钉。
  - M2：回退路径改为 `docs/ROLLBACK.md` 的实际步骤。
  - M3：`session-start-check.sh` 两条只给模型看的提示（spec 缺失、spec 漂移）加上 `systemMessage`，并让模型"请用户运行"命令；先写失败用例（29b、39f）再改。
  - Low：
    - 恢复 §3 "Read vs memory conflict"、§2.1 "unfamiliar module → module overview"、§0.2 ASK-once；
    - §3 / §0.2 指针和 `modes` 的 `loadsOn` 补全；Correction pressure 标 SHOULD；
    - OPERATOR 的 `tasks/<slug>` 段落数改为 13；新增 `command-invocation` 测试守住 15/1 划分（两个方向的变异都会失败）；
    - 本文与设计记录中过期的数字已更正。
- **复审（新 fresh-subagent，只审修复范围）**：0 Critical / 0 High / 0 Medium / 10 Low，评审深度到上限（2 轮）。
  - 已修（纯文字）：Specificity 恢复 v7.1.0 的 "Scope: *agent's own work* (external-system framing allowed)." 一句，让 "Ambiguous → strict" 的对象和原来一致；OPERATOR 那句去掉段落计数；本文与 CHANGELOG、设计记录里的数字和措辞更正。
  - 未修，记为后续（改代码会需要第三轮评审）：另外三条 SessionStart 提示（refresh / install / uninstall）的模型侧文字仍写"运行"命令，但它们已带 `systemMessage`，用户看得到；`command-invocation` 测试对重复 YAML 键的判断（评审自造的形状，真实文件里没有）；缺失提示给用户的文字没写忽略 / 关闭开关。
