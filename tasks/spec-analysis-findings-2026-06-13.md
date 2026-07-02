# 全局规范（spec v6.14.1）深度分析发现 — 2026-06-13

**性质**: 只读评审，无 ship。遵守 internal-freeze（`project_internal_freeze_v02312`）：以下全部为记录在案的候选项，不是执行队列。
**数据**: 30d 遥测 1336 hits（parsed 3577/3577, skipped 0, testSessionsFiltered 213）；2026-06-05 质量评审（`tasks/spec-v6.14.2-quality-review-2026-06-05.md`）结论复核仍成立。

## 真问题（按影响排序）

### 1. 维护成本中心在 hook 层，不在 spec 文本
v0.23.16→v0.23.20 五个 patch（约 8 天）全部是 hook FP 修复/widening。§8 pre-bash 30d deny 合计 117（§8 generic 78 + rm-rf 36 + npx 3），allow-validated 299 + npx-allow-local 159 —— 即 hook 大部分工作量在"识别后放行"。用 regex 解析 bash 是与 shell 语法的军备竞赛（dash/ksh unwrap、heredoc、`--no-install`…），每个 FP 消耗一个 release。
**候选方向**（冻结解除后才考虑）: 低置信分支从 deny 降级为 advisory（fail-advisory），或收窄 deny 面、把灰区交还 CC 自身 permission 层。与 §13.3 的 advisory→deny 单向促进通道相反，目前缺"deny→advisory 降级"判据。

### 2. 不可达规则口袋：L2 绑定的规则文本只存在于 extended
§2.2 明令 L0–L2 不加载 extended，但下列规则在 L2 生效、文本却只在 extended：
- **§2.S "L2: Agent proposes spec when cross-module ≥2 / >50 LOC / new dep"**（extended:107）— L2 任务永远看不到该触发条件，规则事实死亡（self-enforced，遥测不可见）。
- **§11-O batch-review / orchestration 规则** — core §11 末行指针 "Multi-task → §EXT §11-O" 与 §2.2 "L2 不加载" 自相矛盾；extended line 3 自述 scope 含 "orchestration"，但 §2.2 触发列表无 orchestration 项。L2 并行派发（§2.1 "2+ disjoint tasks" 路由）时 §11-O 的 batch-review（≥3 tasks 或 ≥2 含 L2+）不可达。
**修复方向**: 要么 §2.2 增加 orchestration 触发，要么把这两条的操作内核上提 core（需配对 net-delete），要么显式声明它们 L3-only。06-05 review finding #2 只对比了两边 line-3 摘要，没发现这个口袋。

### 3. §13.3 promotion gates 与冻结现实死锁
Gate 1/2 要求 cross-project coverage ≥2/≥3 + `feedback_*` 引用。外部采用为零、内部冻结的情况下，default-OFF 的 advisory hooks 可能永久停在收集态——gate 假设的数据流永远不会到达。判据本身没错，但没有"超时退出"分支（如 ≥90d 无法满足 gate → 评估下架而非继续挂着）。

### 4. core 实际已冻结，parked 修复在积压
headroom 447B（98.21%）+ net-zero/net-delete 永久姿态 = 任何 core 修复都需配对删除。已知积压：06-05 finding #3（§13 META L2 carve-out vs core §2 L3 over-classify）+ 本次 #2 的口袋类。积压只增不减；下次确需动 core 时应一次性批量处理（一次 net-delete 配多项 clarify），而非逐项。

### 5. banned-vocab 三处同源 vs 自家 "one home per fact"
core §10 quick-check / §EXT §10-V 全表 / `reference_banned_vocab_examples.md` 三个家。changelog v6.14.1 Operator carry-forward 已声明候选压缩 §10-V（~700B），条件 "reference memory 确认 canonical ≥30d hit 数据"——v6.14.0 发布于 2026-05-24，**2026-06-23 起该条件可评估**（跑 `/claudemd-rules` 看 §10-V hit 来源）。这是唯一带日期的 actionable。

### 6. 路由表相对 harness 演进开始老化
§2.1 / §4 FLOW 只认 sp/gs 两插件；CC harness 原生 Agent（Explore/Plan subagent_type）、Workflow、teams 与 `sp:dispatching-parallel-agents` 的优先关系未定义。系统提示要求广搜索委派 Explore agent，spec 路由到 sp 技能——当前靠 §3 "MCP-injected per-tool instructions are authoritative" 兜底，但 Agent/Workflow 不是 MCP 工具，处于规则空白。低频痛点，记录待真实冲突出现再定。

## 张力但非缺陷（不建议动）
- §3 "this spec > current-turn user"：rule-as-written 与实际行为（听用户的）有分歧；对个人纪律 harness 是有意设计（防止把自己劝出纪律），动它是 major protocol shift。
- 遥测自指：大量 hits 来自维护本 repo 的会话本身（94% banned-vocab self-dogfood 已知）；外部采用前任何"规则有效性"结论都要打折。
- memory-read-check bypass 17/34 = 50%，在文档化噪声带 [20%,50%] 的**顶端**；按 `feedback_memory_read_check_bypass_noise_floor` 先查 `extra.bypass_reason` 分布再说，不构成 demote 提案。

## 复核无问题
- Sizing：core 24553 实测 = 声明精确；extended 45618 vs 声明 45620，Δ2 在 ±20B 包络内。
- §引用完整性、HARD-rule 计数（22 = 6 hook/14 self/1 both/1 external）：06-05 机械验证仍有效。
- 遥测完整性：3577/3577 parsed，0 skipped。

## 建议（R1–R6，2026-06-13 追加；全部为候选决策，冻结期内不执行）

### 修正声明（对发现 3）
原文 "gate 假设的数据流永远不会到达" **不成立**：rule-hits 新 schema 含 `project` 字段（2904/3583 ≈ 81% 覆盖），≥5 个真实项目（claudemd / mem / code-graph-mcp / daagu / gsd）在产生数据。gate 可测量，且当前正确挡住 94% self-dogfood 规则的促进——这是 gate 在工作。残余问题缩小为两点：(a) 缺超时/下架分支；(b) 数据质量——cwd-encoding 修复前后同一项目双键（`-mnt-data-ssd-*` vs `-mnt-data_ssd-*`），cross-project 计数前必须归一化 + 排除 `-tmp`/worktree 桶。

### R1 — §13.3 增加对称降级通道（deny→advisory）
- **判据用 FP-fix release 频率，不用 bypass 率**：pre-bash 30d deny 117 / bypass 13 ≈ 11%，bypass 率挡不住 FP（FP 走 release 修复，不走逃生舱）。建议 gate：同一 hook 分支 30d 内 ≥3 个 FP-fix patch → 该分支降 advisory，观察 90d。
- **证伪条件**：advisory 期内出现真阳性损害 → 恢复 deny 并记录。
- **替代投资**：regex → 真 bash parser（如 mvdan/sh）。一次性成本 vs 当前 8 天 5 个 FP release 的持续成本；若 6 个月累计 FP-fix release ≥10，重估优先级。

### R2 — 不可达口袋的最小修复（攒入 net-delete 批次）
- **§2.S L2 条款：直接删除**。规则死亡多版本无人察觉 = 约束力实测为零；删除是 zero-behavior-change，且 relax 按 §13.2 返还预算。
- **§11-O**：§2.2 加一行触发（路由命中 `sp:dispatching-parallel-agents` → load extended），core +~60B。与 06-05 finding #3 同批执行。
- **单独不 ship**：每次 spec patch 是 L3 released-artifact 全流程，固定成本应批处理摊薄。

### R3 — §13.3 补丁两件
- audit.js cross-project 计数加 encoding 归一化（`tr '_.' '-'` 同口径）+ 排除 `-tmp`/worktree 桶。
- META 文本加 sunset 分支：opt-in ≥90d 且 Gate 1 不满足 → operator 评审下架或标 dormant。Extended headroom 4380B 充足。

### R4 — core 积压批处理协议
- 维持 25K cap（commitment device；放松的真实成本可算：+1K chars ≈ +~250 tokens/turn）。
- 积压项（06-05 #3、R2 两条）登记进配对清单，触发条件 = 下一个非可选 core 修复出现时整批执行。注意 `feedback_spec_net_delete_paired_with_addition`：候选文件是 ready-decisions，不是执行 backlog。

### R5 — banned-vocab 压缩评估推迟到 ~2026-07-10
- v0.23.20（06-12 ship）的 bypass token recording 提供 per-token 数据；多等 ~4 周比按原日期 06-23 评估质量更高。
- **可证伪判据**：30d 内全部 deny/bypass 命中 token ⊆ top-5 quick-check 集合 → §EXT §10-V 全表无增量拦截价值 → 压缩 ~700B；长尾 token 有命中 → 保留全表。

### R6 — 路由表不为假想冲突立法
第一次真实冲突（harness 原生 Agent/Workflow vs sp:dispatching 产生实际摩擦）按 §13.2 流程记 `tasks/rule-candidates-*.md`，≥3 repro 才进 spec。

### 附：memory-read-check 50% bypass 的核查命令
`jq -r 'select(.hook=="memory-read-check" and .event=="bypass-escape-hatch") | .extra.bypass_reason // "(none)"' ~/.claude/logs/claudemd.jsonl | sort | uniq -c` — reason 集中在 CHANGELOG-self-quote 类（已知噪声）→ 维持现状；出现新类别才值得跟进。
