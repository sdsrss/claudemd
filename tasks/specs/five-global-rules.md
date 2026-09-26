---
status: implemented
revision: 4
---

# 五条全局规则并入 spec v6.34.0

## goal

把用户 2026-09-26 提出的五条全局规则落进规范，缺哪条补哪条，已有的只补缺口：

1. 测试 / 探针在 `/tmp`、`/var/tmp`、`~/.claude/projects/` 留下的垃圾，由产生它的任务在结束前删除，并有机械检查。
2. 每个通过 VALIDATE 的改动落一个本地 git commit，便于追踪和回滚。
3. 每个改动都新增或更新覆盖它的测试；交付前测试和验证全部通过。
4. 不熟悉或可能过时的知识，先查（context7 / 官方文档 / 联网搜索）并注明来源，不猜。
5. 评审中问题过多、改动过大或技术不成熟时，搜索成熟的开源方案，给出「采用还是自研」的推荐。

## non-goals

- 不做默认拦截：残留检查默认只提醒，拦截由开关打开（§EXT §13.3 规定先观察 30 天）。
- 不自动 push：commit 规则只要求本地提交。
- 不新增 HARD 规则（§13.2 棘轮）。第 1 条是扩大已有 HARD 规则 §8.V4 的范围，其余几条都是默认规则。

## constraints

- core ≤25000B（开工前 24821B，余量 179B），extended ≤50000B（余量 810B）。core 净增部分必须靠删除 core 里的重复内容来抵。
- 用户选择（2026-09-26，AskUserQuestion）：commit 只在本地、不推送，默认分支按项目约定，项目可用 `AUTO_COMMIT: off` 关闭；测试分级，L1 要求新增或更新测试并让受影响的测试通过，L2+ 要求全量测试加 smoke 入口；第 2、3、4 条放 core 并压缩别处；残留检查扩展钩子，默认提醒，另设开关可拦截。
- 钩子只扫描一层（§8 禁止递归遍历 `~/.claude/`）。

## success-criteria

- `spec/CLAUDE.md` 包含第 1–4 条，`spec/CLAUDE-extended.md` §12 包含第 5 条；`spec-coherence-audit --strict` 结果为 `coreDelta=0, extendedDelta=0`，两个文件都在上限内。
- `sandbox-disposal-check.sh` 默认扫描 `/var/tmp`（`tmp.*`、`claudemd-*`），以及 `~/.claude/projects/` 里目录名编码了临时目录、且其中每一项都在本会话上次 Stop 之后改动过的项目目录（按 mtime 判断，不判断归属）（排除本会话自己的 transcript 所在目录）；设置 `SANDBOX_DISPOSAL_BLOCK=1` 时返回 `{"decision":"block"}`，每轮最多一次（`stop_hook_active`）。
- `tests/hooks/sandbox-disposal.test.sh` 为每个新分支写一条用例，并做变异验证：去掉该分支后用例变红。
- `npm run check` 退出码 0；`npm run smoke` 最后一行给出通过数。

## open-questions

- 无。

# Change log

- r1 2026-09-26：初稿，按用户选定的四项推荐方案。
- r2 2026-09-26：实现完成，钩子部分在 cf31b70。
- r3 2026-09-26：按打 tag 前评审修复（H1 归属误判、M1–M4 及部分 Low）；core 24979B，extended 49810B。
- r4 2026-09-26：按第二轮复审修正：判定说法改为「每一项都在窗口内改动过」，补真实形态的 probe 目录和深度上限用例（21 条，17 个变异全红）。
