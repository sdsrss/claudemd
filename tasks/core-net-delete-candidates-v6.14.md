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
