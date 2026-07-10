---
status: implemented
revision: 2
---

# Model tiering — spawned-agent 模型分层规则（spec v6.15.0）

## Goal

core §2.1 新增一段紧凑规则（~560B，置于 Tool escalation 段之后），规范 spawned agents（Agent tool `model` 参数 / Workflow `agent()` 的 `opts.model`+`opts.effort`）的模型选择：默认继承会话模型；机械 fan-out 白名单降级 sonnet；判定型环节（orchestrate / synthesize / verify / judge / root-cause）绝不降级。在不降质量的前提下降低批量子 agent 成本。

## Non-goals

- 不做 hook 强制——任务类型是语义级判断，hook 无法机械判定；纯 prose 规则
- 不引入 haiku 档——只有 trivially-checkable 机械活才安全，边际收益小、误用风险大
- 不改主循环模型选择——主循环 = 会话模型，agent 无控制面
- 不写 extended 详版——规则可压缩进 core，YAGNI
- 不标 HARD——SHOULD 级 routing guidance（同 Tool escalation 段级别），不进 `spec/hard-rules.json`，不占 §13.2 HARD budget

## Constraints

- **§0.1 HARD size cap**: core 当前 24596/25000B（headroom 404B）。加 ~560B 必须配对 net-delete —— 执行 `tasks/core-net-delete-candidates-v6.14.md` Candidate 1（§7 metric-coupled 表删 6 个项目特定 example，−280~340B）。净变化约 +220~280B，落点 ~24850B < 25000B。
- **§13 META**: rule added（backward-compatible）→ minor bump → **v6.14.2 → v6.15.0**。
- **§2 hard upgrade**: spec 是 LLM-visible metadata → L3，走 §4.FULL-lite。
- **版本级联** (`feedback_spec_version_bump_cascade_grep`): 改版本号前 grep `6.14.2` 覆盖 spec/ + hard-rules.json + tests/。
- **Sizing 行递归** (`feedback_spec_sizing_recursive_rewrite`): 占位 Sizing → 跑 check → 应用 OLD→NEW → 复跑。
- **发布路径** (`feedback_claudemd_spec_single_source_of_truth` + `feedback_claudemd_ship_from_main_atomic`): 改 `spec/` 源 → 插件版本 bump → 从 main 原子 ship（commit+push+tag+release 一轮完成）；用户侧经 `/claudemd-update` 同步。

## Success criteria

1. `spec/CLAUDE.md` §2.1 含 Model tiering 块；`wc -c` ≤ 25000
2. Candidate 1 net-delete 已应用；`node scripts/spec-coherence-audit.js` 0 unresolved
3. `npm test` 全绿（含删除 example 后无 hardcoded-string 断言残留）
4. `spec/CLAUDE-changelog.md` v6.15.0 entry + 修正后的 Sizing 行（±20B 内）
5. `spec/hard-rules.json` 不变（本规则非 HARD）
6. 插件版本 bump + CHANGELOG + 原子 ship + `/claudemd-update` 可同步

## Open questions

（无——放置层级与激进程度已在 brainstorming 阶段由用户拍板：core §2.1 紧凑块；quality-first 默认继承、白名单 opt-in 降级。）

## Rule text（最终稿，English，进 core §2.1）

```
**Model tiering (spawned agents; main loop = session model)**: default inherit
— omit `model` when unsure. Sonnet: mechanical fan-out (search / fetch /
extract / classify / enumerate) + lint-or-test-gated bulk edits (pair
`effort:'low'`). Opus: plan-step code execution with test gate. NEVER
downgrade: orchestrate / decompose / synthesize / verify / judge / root-cause
debug / L3 / §5-hard / §8 content. Invariants: verifier tier ≥ generator;
anomalous downgraded output (empty / malformed / contradictory) → one re-run at
inherited tier; tier never lowers the evidence bar (Iron Law #2).
```

### 设计依据（为什么这样分层不降质量）

分层依据是**错误的形状**，不是任务难度：

| 错误形状 | 降级安全性 | 对应白名单/黑名单 |
|---|---|---|
| Recall 型（漏找） | ✅ 冗余结构（loop-until-dry / multi-modal sweep）本就为覆盖单 agent 漏检设计 | search / fetch / extract / classify / enumerate → sonnet |
| 机械可验证型 | ✅ 下游 lint/tests/diff 确定性兜底 | test-gated bulk edits → sonnet；plan-step code + test gate → opus |
| 判定型（silent precision loss） | ❌ 错误无声传播，无下游机制可发现 | orchestrate / synthesize / verify / judge / root-cause → NEVER |

三条不变量：默认继承（降级是白名单 opt-in）；verifier tier ≥ generator tier（便宜 finder + 强 verifier 成立，反之不成立）；异常升级（降级 agent 输出空/畸形/矛盾 → 继承档重跑一次再采信）。

## Change log

- 2026-07-10 r2: implemented（spec v6.15.0 / plugin v0.32.0）。实测偏差 2 处：Candidate 1 实删 −169B（估 −280~340）；规则文本压缩到 552B（"spawned agents only" / 并 decompose 入 orchestrate / "test-gated plan-step code"），core 落点 24978B ≠ 预估 ~24850B，仍 < 25000。README 4 处 v6.14 级联由 version-cascade-check 测试抓出（手动 grep 漏了 README）。
- 2026-07-10 r1: initial draft；设计已在 brainstorming 中经用户认可（core §2.1 紧凑块 + Candidate 1 配对）
