# Core net-delete candidates — pre-staged for v6.14.x

**Status**: 候选清单，**不预先动**。等下一次有规则要加进 core 时，从此处挑一项执行 §0.1 HARD 的 "net-delete > addition" 要求。

**触发依据**:
- v6.13.0 ship 后 `spec/CLAUDE.md` = 24417 / 25000 字节 = 97.67% utilization
- Headroom = 583 字节
- §0.1 HARD: "over ceiling → next version MUST net-delete (removal > addition) or refuse the addition"
- 即便没到 25K 上限，下次 minor 加任何内容都要带净删

**操作员行动**: 真要加规则时再回到此清单，选取一个 candidate 落地。**不要现在动 spec**。这条清单的存在是为了让"被迫"决策变成"已准备好"决策。

---

## Candidate 1 — §7 Evidence beyond green tests 表抽象示例

**位置**: `spec/CLAUDE.md` §7 第二个表 (`### Evidence beyond green tests (L2+)`).

**当前内容**（节选）:
```
| Edit touches metric-coupled code — bench / oracle / compile-time budget
  (e.g. `routing_bench.rs` P@1, `semantic_search` vs `MAX_SEARCH_CODE_LEN`,
  MCP `instructions` ≤ harness cutoff, token / latency SLOs,
  `const _: () = assert!()` guards) | SHOULD | ...
```

**问题**: 圆括号里的 6 个 example 是项目特定（`routing_bench.rs` / `semantic_search` / Rust `const _` assert）。跨项目 spec 不该 hardcode 这些。

**改动**: 删除括号内 6 个 examples，留触发器类别名（"bench / oracle / compile-time budget"）+ 段末已有的"Metric-coupling typical triggers: ..."。

**估算**: −280 ~ −340 字节。

**风险**: examples 是规则可识别度的辅助锚。但段末"Metric-coupling typical triggers"已经给了通用关键词（tool descriptions / adoption-memory / field compression / prompt templates），新人通过它一样能 identify trigger。

**Verify gate**:
- 跑 `node scripts/spec-coherence-audit.js` — 0 unresolved (examples 删除不影响 §EXT cross-ref)
- 跑 `npm test` — 412 + N tests 全绿 (无 hardcoded example string assert)
- Read shipped spec post-edit，回答"我能识别 metric-coupled 触发吗？" — 主观判断不降级

---

## Candidate 2 — §7 Trigger 1 (Push fires CI/Release) 搬到 §EXT §12 ship-hardening

**❌ CLOSED 2026-07-11（audit gate 判负，勿再评估）**: 四路审计遥测显示 ship-baseline 30d 内在 **15 个不同日期**开火（254 评估事件）vs 仅 20 个 release——ad-hoc `git push`（不走 ship skill、extended 未加载）真实依赖 core §7 这行 HARD。Verify gate 第二分支（"若也 fire 在 ad-hoc git push 之后 → 不要 move"）命中。详见 `tasks/spec-audit-2026-07-11.md` 遥测节。

**位置**: `spec/CLAUDE.md` §7 第二个表第 1 行 "Push fires CI/Release (pre-action) | HARD | gh run list ..."

**当前**: 这行是 ship-pipeline 专属（gh CLI / known-red baseline 等），但放在 core 让每个 L1/L2 turn 都看到。实际只在 push/release 时 actionable。

**改动**: 整行搬到 `spec/CLAUDE-extended.md` 现有的 §12 (`Ship-pipeline hardening`)。Core 段表头改 "Three orthogonal triggers" → "Two orthogonal triggers" + 一行简短指针 `Push fires CI/Release → §EXT §12`.

**估算**: −250 ~ −300 字节 (extended 端 +250 ~ +300，整体核心 turn loaded bytes 同 §13.1 模式收益)。

**风险**（高于 Candidate 1）:
1. L2 feat 触发 push 但不走 ship skill 的路径会看不到这条 HARD 触发。
2. 当前 30d audit 显示 ship-baseline 452 fires，需先验证：这 452 中是否全部走 ship skill / 是否有"非 ship 路径下 push"事件被 ship-baseline-check.sh 拦截。

**Verify gate** (Candidate 1 之外还要):
- 跑 `bin/claudemd-cli.js audit --days=30 --json | jq '.bySection["§7-ship-baseline"]'` — 看 trigger 分布
- 若 ship-baseline 仅 fire 在 ship skill 启动时 → 安全 move
- 若也 fire 在 ad-hoc `git push` 之后 → **不要 move**，转用 Candidate 1
- 跑 upgrade-lifecycle integration test，确认 ship 流程仍正常

---

## Candidate 3 — §0.1 操作员细节收缩为 OPERATOR.md 指针（2026-07-10 追加）

**位置**: `spec/CLAUDE.md` §0.1 Three-tier default 段（全段 788B，实测 `awk '/^### §0.1/,/^### §0.2/'`）。

**问题**: Tier 1/Tier 0 的 promotion 阈值（"≥3 sessions in 30d" / "≥5 sessions … elaboration wasn't consulted"）和 `/claudemd-rules` demotion 推荐是**操作员治理内容**（§13 META enforcement=external），agent 逐 turn 执行时只消费三件事：新规则默认落 Tier 2、hard cap 数字、over-ceiling → net-delete。阈值细节已在 `OPERATOR.md §13.1` 有完整版。

**改动**: 段落收缩为 "Tier 2 default + hard cap + net-delete + Sizing 行跟踪 + 阈值细节 → OPERATOR.md §13.1"。

**估算**: −350 ~ −400 字节。

**风险**: 低。与 2026-06-03 被否的 #4 bulk demote 不同类——不是 "0 telemetry = 搬走"，而是受众判定（operator-facing 阈值 vs agent-facing 默认值）；agent 需要的三个事实全部保留在 core。

**Verify gate**: `spec-coherence-audit.js` 0 unresolved；`OPERATOR.md §13.1` 确含被删阈值原文（先 Read 核对再删）；npm test 全绿。

---

## Candidate 4 — §2.1 Model tiering 压缩为 invariants + §EXT 指针（2026-07-10 追加）

**❌ VOID 2026-07-24**: 目标段落已不存在——v6.20.0 把 §2.1 Model tiering（core + §2.1-EXT）整段删除（操作员决策：model 自分配 tier），本候选无可压缩对象。池内由 C7/C8 接替。

**位置**: `spec/CLAUDE.md` §2.1 Model tiering 块（550B 实测）。v6.15.0 刚加入，是 core 里"每 turn 注意力成本 vs 触发频率"比值最差的段（仅 spawn subagent 时 actionable）。

**改动**: core 保留安全不变量（default inherit / NEVER-downgrade 清单 / verifier ≥ generator / anomalous → 1 re-run inherited / tier 不降证据档），Sonnet/Opus 适用类别枚举移入 §EXT §2-EXT。

**估算**: core −230 ~ −280 字节；extended +300 ~ +350（当前 extended 余量 3347B，可容纳）。

**风险**: 中。L2 spawn agent 时 extended 未加载，类别枚举不可见 → agent 退化为 "不确定就 inherit"（这本身是该规则的声明默认，行为安全侧不降级，只可能少用 Sonnet 省钱路径）。刚 ship 两个版本就动它有折腾嫌疑——仅在需要 paired deletion 且 Candidate 1/3 字节不够时启用。

**Verify gate**: 同 Candidate 1 + §EXT §2-EXT 新增块与 core 指针互指核对。

---

## Candidate 5 — §0.1 剩余主体外移 OPERATOR.md（2026-07-11 审计追加）

**✅ CONSUMED v6.17.0**（≈ −185B derived；估算 −250~300，again 低于估算——连续第四例）。core §0.1 收缩为 "Tier-2 default landing + hard cap + net-delete + `OPERATOR.md §13.1` 指针"；tier 定义（Tier 0/1/2 加载时机 + anchor 文件名模式）并入 OPERATOR.md §13.1 阈值条目与 Rationale 表。风险评估同 C3（受众判定，非 telemetry-demote）；agent 每 turn 消费的三件事全保留。

## Candidate 6 — §9 Parallel-first 压缩（2026-07-11 审计追加）

**✅ CONSUMED v6.17.0**（**−116B 实测**，两次 `wc -c` 快照 24764→24648；估算 −145）。依据：harness 原生并行独立 tool calls（S12 探针 + 主会话独立复核一致）；保留段首引子一行 "independent tool calls → single message; dependent → serial"。§9 Parallel-path completeness（HARD，另一条 bullet）未动，hard-rules.json 锚完好。

## Candidate 7 — §5.1 aggressive skip-list 段降级到 §5.1-EXT（2026-07-24 审计追加）

**位置**: `spec/CLAUDE.md` §5.1 末段 `**\`aggressive\` skip-list**`（实测 359B，`grep -o` 全行）。

**问题**: 内容是 aggressive 模式的 per-level 行为细则，与 §5.1-EXT 的效果表同族——AUTONOMY_LEVEL 非 aggressive 的用户每 turn 白付这 359B。core 真正载重的是末句安全兜底（§8 + Iron Law #2 + Hard-AUTH still bind），而它只是 §5.1 Never-downgrade 的复述。

**改动**: 整段移入 `spec/CLAUDE-extended.md` §5.1-EXT（追加到效果表之后）；core 留一行 `**\`aggressive\` skip-list** (ceremony reductions; Never-downgrade set unaffected) → §EXT §5.1-EXT.`（~45B）。

**估算**: core −310 ~ −314B；extended +330 ~ +360B（2026-07-24 后 extended 余量 2311B，可容纳）。

**风险**: 低-中。aggressive 项目的 L0-L2 turn 不再直接看到 skip-list 细则（extended 未加载）→ agent 退化为 §5.1 一行摘要 + 记忆/项目 CLAUDE.md 提示。行为安全侧零降级（Never-downgrade 全在 core）；损失的只是"少 ASK 一次"的 ceremony 减免可能偶尔没被行使。claudemd 仓自己的 CLAUDE.md 已内联复述关键点，实际最大用户不受影响。

**Verify gate**: `spec-coherence-audit.js --strict` 0 unresolved（新指针 §5.1-EXT 已存在）；`npm test` 全绿；`wc -c` 双端复核 + Sizing 行同 commit 更新。

## Candidate 8 — §2 Depth-triggers 尾句降级（2026-07-24 审计追加）

**位置**: `spec/CLAUDE.md` §2 `**Depth triggers**` 行（全行实测 280B；尾句 "— a deep analysis of an L1 typo stays L1. Level = what proof you owe; depth = how hard you think before writing it." 实测 118B）。

**问题**: 规则本体是前半句（depth 词 = 本 turn 推理预算信号，NOT task-level upgrade）；尾句是例子 + 格言式复述，属 elaboration。

**改动**: 删尾句，保留 `**Depth triggers** (…): reasoning-budget signal for the current turn, **NOT** task-level upgrade.`。elaboration 不需要新家（§2 LEVEL 定义本身就是 "what proof you owe" 的正式表述）。

**估算**: core −110 ~ −118B；extended 0。

**风险**: 低。丢的是助记格言；规则语义（深度词不升级 Level）一字未动。

**Verify gate**: 同 C1（coherence + npm test + 主观可识别性自查）。

## Candidate 9 — §9 QUALITY 三条与 §1 Principles 的逐字级双写（2026-07-24 二轮扫描追加）

**位置**: `spec/CLAUDE.md` §9 前三条 bullet（实测 47+47+44 = 138B）:
`Simplicity: smallest diff, fewest files.` / `Root cause: no temporary patches at L2+.` / `YAGNI: grep usage before adding code.`

**问题**: §1 Principles 已有同义条目（`Smallest diff wins` 66B / `Root cause over patch` 64B / `Reuse-first`）。同一规则两种措辞 = spec 自禁的 "double-writing creates drift"（§11-EXT-MEM）——这不只是省字节，是漂移隐患。

**改动**: 删 §9 前三条，以 §1 为唯一家。§9 保留 `Parallel-first` 一行 + `**Parallel-path completeness** (HARD, L2+)`（hard-rules 锚点 `§9-parallel-path`，逐字不动）。

**估算**: −138B（实测）。

**风险**: 低。语义零损失（§1 每 turn 在场）。交叉引用预检（2026-07-24 实测）：core:73 `→ §7 L2 + §9` 与 extended:132 `sp:TDD→§9→§7` 均指 §9 整节（存活，不用改）；**`hooks/session-summary.sh:13` 注释引用 "§9 Simplicity" —— 落地时同步改为 "§1 Smallest diff wins"**（纯注释，无行为影响）。

**优先级注记**: 双写漂移隐患使 C9 成为**下次任意 minor 级 spec 变更的首选配对**——即使新增字节 ≤ headroom 也建议搭车执行。

**Verify gate**: `grep -n '§9' spec/ commands/ hooks/` 交叉引用清点；hard-rules-1/5 绿（§9-parallel-path 锚句原样）；npm test 全绿。

## Candidate 10 — §0 ↔ §5 re-ASK 语义双写合并（2026-07-24 二轮扫描追加）

**位置**: `spec/CLAUDE.md` §0 Hard-AUTH override 段第二句 `Batch re-AUTH: in-scope → one re-ASK per hard-category; out-of-scope discoveries → individual re-ASK.`（实测 106B）。

**问题**: §5 "Obvious-follow-on not exempt"（自称 *clarifies §0 Hard-AUTH override*）描述同一机制的细化面。批量/逐项 re-ASK 判据在两处各说一半。

**改动**: 106B 句并入 §5 Obvious-follow-on 段；§0 收缩为 `within an existing AUTH, §5-hard sub-decisions re-ASK (batch rules → §5).`。

**估算**: core 净 −95 ~ −106B（§5 端 +0~10B 衔接词）。

**风险**: 中。两处均 HARD 相邻语义；`**Hard-AUTH override (HARD)**` 是 hard-rules 锚句（`§0-hard-auth-override`），必须逐字保留；合并措辞需过 hard-rules-5。仅在 C9/C11/C12 字节不够时启用。

**Verify gate**: hard-rules-drift 9/9 绿；合并后 Read §0+§5 连读自查语义无损；npm test 全绿。

## Candidate 11 — 页脚版本史指针重复（2026-07-24 二轮扫描追加）

**位置**: `spec/CLAUDE.md` 页脚 `Version history → \`~/.claude/CLAUDE-changelog.md\`. `（实测 54B）。

**问题**: 头部第 2 行已有 `| History: \`~/.claude/CLAUDE-changelog.md\``。同一指针双写。

**改动**: 删页脚这一句（页脚保留 EXT loading 指针 + Current entry + sizing 指针）。

**估算**: −54B。**风险**: 零（纯指针去重）。

**Verify gate**: coherence 0 unresolved；npm test 全绿。

## Candidate 12 — §2 Override modes 行触发细则去重（2026-07-24 二轮扫描追加）

**位置**: `spec/CLAUDE.md` §2 `**Override modes**` 行（全行实测 270B）中 `Strong trigger → silent enter; weak/ambiguous → ASK once. Announce mode shift inline` 部分。

**问题**: 与 §2-EXT Mode entry 重复；而进模式**必须** "load extended first"（同一行自己要求），细则加载后必然可见。

**改动**: 行收缩为 `**Override modes** (§EXT §2-EXT): **HACK** / **EMERGENCY** / **AUTONOMOUS**. All: Iron Law #2 + §8 bind; per-task scope; load extended first, announce inline.`。

**估算**: −75 ~ −85B。

**风险**: 低。留存部分覆盖安全面（Iron Law/§8/先加载）；触发强度判据在 extended 强制加载路径上。

**Verify gate**: coherence 0 unresolved（§2-EXT 指针不变）；npm test 全绿。

## Sizing 更新（2026-07-10）

v6.15.0 ship 后 core = **24978/25000（headroom 22B）**——决策树里 "N ≤ headroom 可直加" 的分支实际已关闭：**任何新增都必须配对净删**。**C1 已于 v6.15.0 执行**（−169B 实测，见 extended Recent-changes）；**C3 已于 v6.15.1 执行**（−239B 实测 vs −350~400 估算，做成 move：core 删 + OPERATOR.md §13.1 增阈值条目，因 OPERATOR.md 原文不含阈值）。剩余候选池：C2 (−250~300，audit gate 前置) + C4 (−230~280，中风险)。连续三个候选实测低于估算（C1 −169/−280、Sizing-rewrite 同款、C3 −239/−350）——启用 C2/C4 前先重测。

## Sizing 更新（2026-07-11，v6.17.0 审计批次后）

core = **24648/25000（headroom 352B，98.59%）**，批次净删 −91B（配对增 ≈+264 / 删 #8+#10 −54 / C5 ≈−185 / C6 −116 实测）。**池内状态：C2 CLOSED（audit gate 判负）；C5、C6 已消费；C4 为唯一存量候选**（−230~280，中风险，"仅在 C1/C3 字节不够时启用"的前提已消失——下次 core 加规则若 >352B headroom 需 C4 或新增候选）。实测低于估算已成惯例（C1/C3/C5/C6 四例），启用 C4 前先 `awk` 实测段落字节。

---

## Sizing 更新（2026-07-24，v6.20.1 后；同日二轮扫描补 C9-C12）

core = **24467/25000（headroom 533B，97.87%）**（v6.20.0 −389 tiering 删除；v6.20.1 +33 指针后缀）。extended = 47719/50000（余量 ~2280B，95.44%——Recent-changes 外置回收，**core→extended 降级搬移的接收窗口打开**）。**池内状态：C2 CLOSED、C4 VOID（目标段 v6.20.0 已整删）、C1/C3/C5/C6 已消费；存量候选 = C7（−310）+ C8（−110）+ C9（−138，双写漂移隐患，首选配对）+ C10（−100，中风险备用）+ C11（−54，零风险）+ C12（−80），合计 ≈ −790B**。叠加 533B headroom，潜在容纳 ≈ 1.3KB core 新增。实测低于估算的惯例持续（C1/C3/C5/C6 四例）——启用前先 `grep -o | wc -c` 复测。二轮扫描的排除结论（Iron Law #2 示例 / §10 Specificity / §11 Tell 尾句 / §2.2 ship 行）见"不在清单的"节。

## 决策树（真要 net-delete 那一刻）

```
要加的新规则字节数 N → 必须 删 ≥ N 字节（current headroom 533B 可先抵扣）

  任意 minor 变更:  无论 N 大小，优先搭车 C9（双写漂移隐患，−138）
  N ≤ 533:  headroom 容纳（LOW 带内仍建议配对 C9 或 C11 保持净零）
  N ≤ 750:  C9 + C11 + C12（全低/零风险，≈ −272）
  N ≤ 1050: 上行 + C8（−110）+ C7（−310；落地前重测 + 过 gate）
  N > 1050: 先评 C10（中风险，−100）；仍不够 → 重新审：新规则可能不该进 core
```

## 不在清单的（已评估，排除）

- **§0 Initial-prompt ambiguity 的 (a)/(b) 判据句**（2026-07-24 评估）: 实测仅 71B，降级后净省 ~40B 且 extended 无干净归宿（§0.2-EXT 是 mid-task，不是 initial-prompt）；损失的是 L1/L2 每 turn 在场的真实决策规则（reversibility >10min → ASK）。收益/风险比不合格。
- **Iron Law #2 的 L1/L2 示例（~330B）**（2026-07-24 二轮）: 具体定义 Done: 证据格式，core 里单位字节 steering 价值最高的内容。不删。
- **§10 Specificity 段（~700B）**（2026-07-24 二轮）: 最高频引用 HARD，§10-V 钩子联动。不删。
- **§11 Mid-SPINE "Tell:" 尾句（~120B）**（2026-07-24 二轮）: 看似装饰，但 mid-spine 是 confidence=medium 自执行规则，2026-07-24 审计认定自执行面是最弱环节——不再削弱。
- **§2.2 Ship-pipeline hardening 行**（2026-07-24 二轮）: 与 C2 同构（ad-hoc push 不加载 extended 的路径依赖 core 可见性），C2 遥测判负的同一判据保护此行。不删。

- **§1.5 GLOSSARY 条目**: 看似可删，实际每条都被 §2 LEVEL / §5 AUTH 在 L1/L2 routing 决策里直接引用。删 = 路径破坏。
- **§9 Parallel-path completeness**: HARD 规则，high-volume trigger pattern，删除即降级行为质量。
- **§11 Mid-SPINE turn-yield**: 上次 ship 才加进 core 的"natural-feeling stop"修复，30d 内还没达 demote 评估窗口。
- **§3 TRUST**: 短小且每决策都引用。
- **§8 SAFETY**: immutable per spec 自定义，永不动。

## 下次回到此文件时检查

1. 真要加的规则字节数 N（在 §X 起草后用 `wc -c` 量）
2. Current core 字节数（`wc -c spec/CLAUDE.md`）
3. 25000 - current - N = 删除后 headroom，若 < 200 字节考虑额外删
4. 跑选定 candidate 的 Verify gate
5. 一并写进 `## Recent changes` Sizing 行 + CHANGELOG `[move]` 或 `[delete]` 条目
