---
status: draft
revision: 2
---

# spec-lean-restructure — v6.25.0 压缩+搬迁

## goal

一次 minor 发布把 core 从 24793B 压至 ≤21K、extended 从 49964B 压至 ≤43K，恢复两个预算的可用余量并降低每回合注意力成本（core ≈6.0k → ~4.9k token），**零规则语义变更**。手段限三类：删版本考古/簿记、压重复表述、operator 侧内容搬 `OPERATOR.md`。逐条款依据：`tasks/spec-lean-cut-candidates-2026-08-09.md`。

## non-goals

- 不改任何 HARD 规则语义、执法分区、AUTH 面（`demoteCandidates=[]`，无降级依据）。
- 不改 cap（保持 25K/50K；lean 稿的 12K/30K 新 cap 不采纳）。
- 不重命名/重编号任何章节锚点。
- 不做 Phase B 深裁（IL2 例句全外化、quick-check 删表等 DATA-NEEDED 项）。
- 不动 changelog（v7 重启方案驳回）。
- 不产出 CLAUDE-solo.md（另案）。

## constraints

- L3（released-artifact + LLM-visible metadata）：走 §EXT §4 流程 + released-artifact checklist（minor bump、CHANGELOG 迁移说明、回滚路径 = 上一版 plugin pin）。
- `spec/hard-rules.json` 25 个 `section_anchor` 逐字保留，或同 commit 更新 manifest（drift test 是门）。
- 单源纪律：spec 改动只经 `spec/` + version bump + ship（feedback_claudemd_spec_single_source_of_truth）。
- Sizing 行按递归重写协议处理；escape 字面形（`known-red baseline:` 等）不动。
- OPERATOR.md 吸收内容成为治理唯一源时，须删 extended 中对应正文防双源漂移（feedback_extraction_needs_consumer_gate 精神：留指针不留副本）。

## success-criteria（即 VALIDATE 清单）

1. `wc -c spec/CLAUDE.md` ≤ 21000；`wc -c spec/CLAUDE-extended.md` ≤ 43000。
2. `tests/scripts/hard-rules-drift.test.js` 绿（25 anchors 完好）。
3. 全套 test suite 绿；`node scripts/version-cascade-check.js` 绿；`node scripts/spec-coherence-audit.js` 无新增 CRITICAL/HIGH。
4. 实施前枚举的 contract-gate spec 文本断言点（`grep -rn` 清单）实施后逐点复验。
5. diff 审查：每处删改能归入 判定文件 的 CUT/COMPRESS/MOVE-OP 行；无判定表外的语义改动。
6. Sizing 行含 OLD→NEW 双数字且复测通过（±20B 包络）。
7. ship 后 `~/.claude/` 安装版与 `spec/` 逐字节一致（installed==repo）。

## open-questions

- Phase B 深裁的人工复核由 operator 何时排期（≥30d / ≥20 L2+ 任务后）。
- 是否把 CLAUDE-solo.md 思路转化为面向第三方 adoption 的 lite profile 产品（与 internal-freeze 的"推针=采用"方向一致，另开任务）。
- extended 若压后仍 >43K，压缩残余项从判定表 COMPRESS 行内加深，不新开 CUT 类别。

# Change log

- r1 (2026-08-09): 初稿，基于 cut-candidates 判定文件。
- r2 (2026-08-09): 实施后修订 success-criteria #1 —— core 目标 ≤21000 实测不可达：保住全部 25 条 HARD 语义 + 18 个 core anchor 逐字 + self 执法条款正文（判定文件 KEEP 行）后，可删体量只有 1751B（judgment 表的 4.3K 估省中约 2.5K 高估在"措辞压缩残余"与已然紧凑的条款上）。实测落点 core 23042（余量 1958B/7.8%，此前 207B/0.8%）；extended 42999 ≤43000 达标（余量 7001B/14%，此前 36B/0.07%）。评审 6 项语义丢失已全部恢复（+104B 计入实测）。待 user 确认按实测数字收口。
