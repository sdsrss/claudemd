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

**位置**: `spec/CLAUDE.md` §2.1 Model tiering 块（550B 实测）。v6.15.0 刚加入，是 core 里"每 turn 注意力成本 vs 触发频率"比值最差的段（仅 spawn subagent 时 actionable）。

**改动**: core 保留安全不变量（default inherit / NEVER-downgrade 清单 / verifier ≥ generator / anomalous → 1 re-run inherited / tier 不降证据档），Sonnet/Opus 适用类别枚举移入 §EXT §2-EXT。

**估算**: core −230 ~ −280 字节；extended +300 ~ +350（当前 extended 余量 3347B，可容纳）。

**风险**: 中。L2 spawn agent 时 extended 未加载，类别枚举不可见 → agent 退化为 "不确定就 inherit"（这本身是该规则的声明默认，行为安全侧不降级，只可能少用 Sonnet 省钱路径）。刚 ship 两个版本就动它有折腾嫌疑——仅在需要 paired deletion 且 Candidate 1/3 字节不够时启用。

**Verify gate**: 同 Candidate 1 + §EXT §2-EXT 新增块与 core 指针互指核对。

---

## Sizing 更新（2026-07-10）

v6.15.0 ship 后 core = **24978/25000（headroom 22B）**——决策树里 "N ≤ headroom 可直加" 的分支实际已关闭：**任何新增都必须配对净删**。**C1 已于 v6.15.0 执行**（−169B 实测，见 extended Recent-changes）；**C3 已于 v6.15.1 执行**（−239B 实测 vs −350~400 估算，做成 move：core 删 + OPERATOR.md §13.1 增阈值条目，因 OPERATOR.md 原文不含阈值）。剩余候选池：C2 (−250~300，audit gate 前置) + C4 (−230~280，中风险)。连续三个候选实测低于估算（C1 −169/−280、Sizing-rewrite 同款、C3 −239/−350）——启用 C2/C4 前先重测。

---

## 决策树（真要 net-delete 那一刻）

```
要加的新规则字节数 N → 必须 删 ≥ N 字节

  N ≤ 280:  跑 Candidate 1（低风险）
  N ≤ 300:  优先 Candidate 1；若 Candidate 1 已用 → 评估 Candidate 2 audit gate
  N >  300: Candidate 1 + Candidate 2 都做（前提：Candidate 2 audit gate 过）
  N >  600: 重新审 — 新规则可能不该进 core（push 到 §EXT 或 MEMORY.md anchor）
```

## 不在清单的（已评估，排除）

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
