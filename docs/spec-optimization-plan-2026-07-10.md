# Spec 优化方案 — 2026-07-10

针对对象:AI-CODING-SPEC v6.14.1(core 24553/25000B,98.21% 触顶)+ claudemd plugin v0.26.2。
输入:2026-07-10 使用者视角审读发现的 6 个问题 + 本方案撰写时补充核查的事实。
性质:操作者决策文档(local-only,按 `docs/*` gitignore 惯例不随包分发)。所有涉及 spec 文本 / hook 行为的改动,执行时各自走 §13 META(spec)/ §13.3(enforcement)流程,本文档不是执行授权。

## 补充核查事实(2026-07-10)

- `tasks/sampling-audit-2026-07-06.md`:Window 30d、**Transcripts scanned: 0**,Source 指向 sandbox 路径 `/home/sds/.claude/tmp/tmp.uihdy1sG8F/...`。即 4 条自执行 HARD 规则的采样度量**至今没有产出过真实数据**——问题 1 的严重度上调。
- `hooks/hooks.json` SessionStart matcher 已为 `*`:compaction 场景分支可在现有脚本内实现,无需新 hook 注册。
- HARD 规则执法分布(§13 META,v6.13):6 hook / 14 self / 1 both / 1 external。

---

## P1 自执行 HARD 规则遵从率不可观测(最高优先)

**问题**:14/22 HARD 规则靠 Agent 自觉,仅 Stop 时 advisory 扫描;hook 侧计数已被证明失真(2026-06-03 审计:banned-vocab 198 deny 中 187 条为单词 `significantly` 自仓库 dogfood)。能测的一半噪声大,占多数的一半测不到。

**方案 A(按依赖顺序)**:

- **A1 — 修复采样基线(前置,阻塞其余全部)**:对真实 transcript 目录(`~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/`)重跑 `/claudemd-sampling-audit`;若默认路径解析确有缺陷则先修。验收:产出一份 scanned > 0 的 30d 基线报告。在此之前,任何"自执行规则遵从良好"的说法都是无据断言。
  **✅ 完成 2026-07-10**:07-06 空跑确诊为 HOME 重定向 sandbox 的运行环境问题(已在该文件标注 VOID),脚本路径解析无缺陷、零代码改动;真实基线 = `tasks/sampling-audit-2026-07-10.md`(项目 12 transcripts/669 turns + 全局 1110/20827,含分层率表与 4 条解读 caveat)。
- **A2 — 指标学约束(HARD,写进审计脚本注释与报告头)**:
  - 遵从率必须带分母:`compliance = 1 − violations / opportunities`,opportunities = 检测到的触发上下文数(如"含 fix 声明的 Done 行数"),不是 turn 总数,更不是裸命中计数。
  - 按 project-class 分层(self-repo vs external),复用 `denyByProjectClass` 的拆分思路——2026-06-03 教训:不分层的 raw 计数不可作为质量证据。
- **A3 — 检测器覆盖 4 → 8**(现有:§10-V / iron-law-2 / four-section-order / honesty;新增 4 条,均为 transcript 可机械检测):
  1. **§11 mid-SPINE turn-yield**:spec 自带判据("下一条用户消息为 `继续 / next / 怎么停了 / why did you stop`" = 确认性 tell),分母 = 含 ≥1 tool call 的 assistant 停轮数。
  2. **bugfix anchor**(§7 Iron Law #2 细分):Done/fixed 声明行不含 prior-failing token(error msg / failing test name / FAILED→PASSED)。分母 = bugfix 型完成声明数。
  3. **§11 post-compaction re-read**:transcript 中 compaction 事件后 N turns 内是否出现对 plan / spec 文件的 Read。分母 = L2+ 会话中的 compaction 事件数。
  4. **§5 hard-AUTH 前置**:hard 类操作(migration / settings.json 写 / prod deps 变更等)的 tool call 前,同会话是否有 `[AUTH REQUIRED]` 或用户确认。预期 FP 偏高(bypassPermissions 下 AUTH 常为 prose),仅 advisory 收集,不进 dashboard 直到 A4 达标。
- **A4 — 检测器准入门槛(与 §13.3 Gate 1 对齐,阈值预登记)**:每个新检测器 ≥30d 观察;人工标注 ~50 条 flagged + ~50 条 unflagged 样本估 precision / recall;precision ≥ 0.8 才允许其数字进入 `/claudemd-audit` 的 self-compliance 段落,否则维持"仅收集"。**阈值在收集数据前定死**(即本行),不做事后调整——防止 p-hacking 式的门槛漂移。
- **A5 — 呈现**:`/claudemd-audit` 增加 self-compliance 小节:每规则一行 `rule | opportunities | violations | rate | precision(标注样本)`。

**✅ A2–A5 完成 2026-07-10**(plugin v0.28.0,commit 58121ef):检测器 4→8(§11-turn-yield / §7-bugfix-anchor / §11-post-compaction / §5-hard-auth,sequence 检测排除 sidechain);全规则 violations/opportunities 分母 + §10-V violations(turn 级)与 hits(raw)分离保 A1 可比;`--global` 出 byClass self/external(复用 classifyProject);`PRECISION_GATE=0.8` 预登记,全检测器 precision:null/status:collecting 起步;audit.js `selfCompliance` 段落 rate 在标定前置 null。测试 sampling-audit 9→17 / audit 21→22,fixtures 逐字段核对真实 transcript 形状(compact_boundary+compactMetadata / string typed prompts / isSidechain)。首次实测(本仓库 12 transcripts/690 turns):turn-yield 4/112、post-compaction 0/3、hard-auth 6/6(FP-heavy 如预登记)、§10-V 24/690。**下一步动作**:30d 收集后按 A4 做人工标注(首个标注对象 = §iron-law-2 与 §7-bugfix-anchor)。

**风险**:检测器本身是启发式,会有 FP/FN——A4 的标注校准就是为此;报告永远带 precision 注脚,不呈现裸率。

---

## P2 core 触顶 + 密度对转向可靠性的侵蚀

**前提(不重议)**:core 段落 demote 已于 2026-06-03 审计判定为 category error(`demoteCandidates=[]`,"0 telemetry = read-and-follow foundational" 而非 unused);net-zero 是永久姿势。见 `project_impact_audit_followups_v0233.md`。

**方案 B**:

- **B1 — 遵从率加权的改写试验(依赖 A 系产出,最后启动)**:当 A5 数据显示某条 self 规则遵从率显著偏低时,第一假设是"文本没有被读懂/注意到"(密度问题),第二假设才是"规则本身错误"。处置:字节等量改写该条(展开缩写、给一个例子、或前移位置)→ 以 spec 版本号为断点做**中断时间序列(ITS)**比较改写前后各 30d 的遵从率。n=1 环境没有 RCT 条件,ITS 是可达的最强因果推断;已知混杂(任务组合漂移)用 project-class + level 分层缓解;结论一律标注"观察性,非实验"。单次试验只改一条规则,避免多处同改无法归因。
- **B2 — 演化纪律维持现状**:新规则一律 Tier 2 anchor 起步(§0.1 现行三层纪律已覆盖),不新增机制。
- **B3 — 明确不做的**:不做 token 成本优化(prompt cache 下边际成本低,真实约束是注意力竞争,其可观测代理就是 A5 遵从率);不做位置效应 / 措辞 A-B 并行实验(研究级成本,solo 环境不可行)。

---

## P3 superpowers SessionStart 注入与 §2.1 的每会话冲突

**原则:先测量,后动手。** §2.1(v6.14.1 已加粗 + 例子)是当前正确的对抗层;在没有冲突成本数据前,卸载或 fork 都是无据动作。

- **C1 — over-ceremony 检测器**(搭 A3 顺风车,同一套 transcript 扫描):检测 L0/L1 形态任务(按 report 形态 + diff 规模判)中出现 sp:brainstorming / sp:test-driven-development 等 ceremony skill 调用的比例,附带估算 token 开销。收集 30d。
- **C2 — 按数据分级处置**(阈值预登记):
  - over-ceremony 率 < 5%(L0/L1 任务中)→ 维持现状,冲突成本可承受,关闭本项。
  - ≥ 5% → 依次评估:(i) **卸载 superpowers**——§EXT §12 fallback 表对每个 sp/gs skill 都有降级路径,这是设计内的现成退路,成本最低;(ii) fork 插件、去掉 SessionStart 注入块、保留 skills;(iii) 若 CC 版本支持按 hook 粒度禁用插件 hook,配置层关闭(**能力未验证**,执行前先查当前 CC 文档)。
- **不做**:不在 core 追加对抗文本(触顶 + §2.1 已存在,重复表述违反 one-home-per-fact)。

**✅ C1 完成 2026-07-10**(plugin v0.29.0,commit 2e21937):`overCeremony` 段落挂进 sampling-audit 同一扫描;任务段按 typed 用户消息切分(裸继续词延续当前段),L0/L1 形态 = ≥1 edit / ≤2 files / <80 估算 LOC;ceremony 集合 = sp brainstorming/TDD/systematic-debugging/writing-plans/executing-plans 的模型侧 Skill 调用(用户 /command 不计;0-edit Q&A 段不算机会——§2.1 本就路由 brainstorming)。`OVER_CEREMONY_THRESHOLD=0.05` 预登记并测试锁死。**首次实测(本仓库 30d)**:281 段 / 11 个 L0/L1 段 / over-ceremony 0(brainstorming×2、writing-plans×2 全在大任务或 Q&A 段)。**C2 决策点**:30d 后(≈2026-08-09)重跑(建议 `--global` 覆盖外部项目)按 5% 阈值走分支;当前自仓库信号在阈值下方。

---

## P4 分级判据事前不可知(Provisional 仅限 bug)

**问题**:L1 判据 "LOC <80" 只有改完才知道;feature 中途长过线没有显式升级路径(§0.2 scope-expansion 只覆盖用户驱动扩围)。

**方案 D(推荐 D1' 先行)**:

- **D1' — anchor 先行(零 core 字节,立即可做)**:新建 `feedback_provisional_upgrade_tripwire.md`(Tier 2):任务中途越过 L1 边界(>2 files 或 ≥80 LOC 或触发 Δ-contract)→ 一行 prose 宣布升级 + **当前级别验证要求回溯适用**(L1→L2 需补 RED-first 证据或声明 additive exception)。升级是单向棘轮:只升不降,防"L1 起手逃 TDD"逃逸通道。
  **✅ 完成 2026-07-10**:anchor 已写入 durable memory + MEMORY.md 索引行(含 tags:provisional-upgrade / tripwire / 中途升级 / 单向棘轮 等);promote 条件(30d 内命中 ≥3 sessions → D1 core 正式化)写在 anchor 正文内,不需另行跟踪。
- **D1 — core 正式化(按 §0.1 promote 条件触发)**:D1' anchor 在 30d 内命中 ≥3 sessions 后,把 §2 Provisional 的 "(bugs only)" 放宽为全任务类型(minor bump,±150B,需 paired deletion,操作者按 §13 META 走)。命中不足则说明问题频率不值 core 字节,维持 anchor。

---

## P5 双记忆层路由税

**不做**:不合并两层(时间尺度不同,分层设计正确);不加新路由 prose(决策树已是最小:"6 个月后仍真?")。问题在**错投静默失败**,解法是让错投可观测:

- **E2 — 跨层维护报告**(挂 `/claudemd-doctor` 新检查项,或 mem-lite `update` skill 侧,取实现成本低者):
  - (a) plugin lesson 被 cite ≥3 次且存活 ≥30d → **promote-to-durable 候选**(高频回忆 = 事实上已是长期知识);
  - (b) durable 层 `recall_*.md`(plugin-absent fallback 产物)存在 >30d → 回迁/清理候选;
  - (c) durable 文件 90d 无 keyword 命中 → stale 候选(doctor 已有 tag-specificity 检查,同处扩一项)。
  - 报告只列候选,不自动迁移——迁移是 §5 范畴的写操作,人判。

**✅ E2 完成 2026-07-10**(plugin v0.30.0,commit f053f60):选了 doctor 侧实现(成本更低——mem-lite DB 可用 `node:sqlite` 只读直查 `~/.claude-mem-lite/claude-mem-lite.db`,无需动 mem 仓库)。三个检查项:(a) promote = cited≥3 且存活≥30d 的本项目 lesson(superseded/demoted 排除;DB 或 node:sqlite 缺失时优雅 skip);(b) recall_*.md >30d;(c) durable 文件 >90d 且遥测窗口内无 *.md 关键词提及(窗口内提及=存活)。**首次实测**:promote 1 个候选(#8264 jq -R JSONL 教训)、repatriation 0、stale 0/47。候选处置留给操作者(如需把 #8264 落成 MEMORY.md 条目,单独说)。

---

## P6 小漂移修复(patch 批,extended 有 ~4.4K headroom)

| # | 修复 | 层 | 说明 |
|---|---|---|---|
| F1 | EXT 文件头 "review" → "pre-ship review" | extended | 对齐 core §2.2 触发列表,消除 per-task review 是否载 EXT 的歧义(取严格读法:per-task review 不载) |
| F2 | 各触发词表统一标注非穷举(加 "e.g.") | core+extended | `更严`(§0.2)/ `又失败`(§EXT §6)/ `试试`(§EXT §2-EXT)等;core 侧改动控制在个位数字节 |
| F3 | context7 引用条件化 | core §2.1 或 §EXT §12 | 改为 "docs-lookup tool if available (e.g. context7 / WebFetch)",或在 §12 fallback 表加一行;消除对不一定存在的工具的硬引用 |
| F4 | **compaction 提醒 hook**(本方案唯一 enforcement 新增) | hook | SessionStart 脚本按 stdin `source` 字段分支,`source=="compact"` 时追加一行 additionalContext:"compaction detected — L2+ 任务先重读 plan + spec(§11)"。把 P1 里那条循环依赖(自执行规则守护注意力失效、却依赖注意力)转为 hook-assisted。走 §13.3 默认 advisory,不 deny。**实现前验证**:当前 CC 版本 SessionStart hook 输入确含 `source: "compact"` 值 |

F1–F3 为 patch 级 spec 修订(wording,行为不变,§13 META:patch);F4 为插件行为新增(hook advisory,§13.3 豁免 §13.2 HARD 配额)。

**✅ F1–F4 完成 2026-07-10**:随 plugin v0.27.0 + spec v6.14.2 一并 ship(commit 35d178f,tag v0.27.0,GitHub release 已建)。F4 的验证项已闭环——SessionStart `source:"compact"` 经官方 hooks 文档确认(startup/resume/clear/compact 四值);实现为 compact 早退分支:出 §11 提醒 banner(opt-out `DISABLE_COMPACT_REREAD_REMINDER=1`)且不再在 compaction 上跑 bootstrap/upgrade/summary。测试 session-start 14→17 全绿;遥测事件 `session-start/compact-reminder/§11-post-compaction` 已登记 RULE-HITS-SCHEMA.md + contract.test.sh(新事件需三处登记:schema 两表 + contract DOCUMENTED 数组)。

---

## 实施顺序与决策点

| 序 | 项 | 前置 | 产出/决策点 |
|---|---|---|---|
| 1 | A1 修采样基线 | 无 | 第一份真实 30d 基线;阻塞 A2-A5/B1/C1 |
| 2 | F1-F4 patch 批 + F4 hook | 无 | 一次 patch release 打包 |
| 3 | D1' anchor | 无 | 零成本,立即生效 |
| 4 | A2-A5 检测器扩展 | A1 | 30d 后首份 self-compliance 段落(带 precision 注脚) |
| 5 | C1 over-ceremony 检测 | A1(同扫描框架) | 30d 后按预登记阈值走 C2 分支 |
| 6 | E2 跨层维护报告 | 无(可与 4 并行) | doctor 新检查项 |
| 7 | B1 改写试验 | A5 有数据且出现低遵从规则 | 每次一条,ITS 评估 |

## 全局不做清单

- 不 demote core 任何段落(2026-06-03 已判 category error,勿重试)。
- 不新增任何 HARD 规则(§13.2 配额;本方案全部走 advisory / anchor / patch)。
- 不合并双记忆层。
- 无测量数据前不动 superpowers 插件。
- 不做研究级实验(RCT / 位置效应);因果推断上限为 ITS + 分层,结论标注观察性。

## 方法学附注(为什么这样设计度量)

1. **分母原则**:所有遵从率必须是 violations/opportunities,不是裸计数——已有实证教训(deny 计数 94% 单词 dogfood)。
2. **校准原则**:启发式检测器的数字在人工标注估出 precision ≥ 0.8 前不进 dashboard;报告永远带 precision 注脚。
3. **预登记原则**:promotion / 处置阈值(A4 的 0.8、C2 的 5%)在收集数据前写死于本文档,防事后挪门槛。
4. **n=1 因果推断**:单人环境无对照组,ITS(以 spec 版本为断点)+ project-class/level 分层是可达上界;单次只改一个变量。
5. **分层原则**:self-repo dogfood 与 external 项目信号分开呈现,ship-baseline 类外部信号权重高于自仓库信号。
