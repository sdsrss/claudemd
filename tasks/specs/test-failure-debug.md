---
status: implemented
revision: 1
---

# 测试失败那一刻注入 debug.md（R6(a)）

来源：docs/oss-benchmark-2026-09-28.md §4 R6(a)（本地对标文档）。使用者 2026-09-29 按 L3 授权，条件是先测触达缺口，缺口小就不做。

## goal

测试一失败，模型上下文里就有针对这一刻的规则：同一失败签名出现三次就停止打补丁、转去诊断（`debug.md`，§6）。不管用户的提示里有没有调试类的词。

## non-goals

- 不改 `debug.md` 的文字、第 2 层的触发词，也不改 `rework-breaker.sh`。它的 G2 评估窗口到 2026-10-26，改判定会截断窗口；R6(b)（"换拓扑"文案）等窗口结束再说。
- 不新增 HARD 规则，什么都不拦。
- 不宣称这个模块能改变结果。这里只测、只修"触达"。

## constraints

1. 事件是 `PostToolUseFailure`，matcher 为 `Bash`。2026-09-29 在 Claude Code 2.1.284 上探测：Bash 以非零退出码结束时触发 `PostToolUseFailure`，不触发 `PostToolUse`；`error` 字段是 `Exit code N` 加上 stderr；模型能复述 hook 在 `additionalContext` 里给的 token。
2. opt-in `DEBUG_ON_TEST_FAILURE=1`，默认关闭（行为层 hook，§EXT §13.3）。kill switch 为 `DISABLE_TEST_FAILURE_DEBUG_HOOK=1`。
3. 每个会话只注入一次，并且与第 2 层共用：同一个 `modinj-<sid>.list`，两个方向都生效。
4. 两个注入 hook 共用一份包装逻辑：`hooks/lib/spec-module.sh`（去掉 frontmatter 和构建注释的正文，加上带理由的 `[claudemd] system-injected` 说明）。
5. 只认测试运行器（不含 lint、typecheck），并且要在命令位置上；与测触达时用的是同一组。
6. 中断（`is_interrupt: true`）不算失败。

## success-criteria

1. 动手前先测触达，判据先写好（`tasks/r6-debug-reach/PREREG.md`，本地）：2026-09-05 以来有 70 个会话出现过测试失败，其中 44 个（0.629）在第一次失败之前，没有任何提示匹配 debug 触发词。判据是 n ≥ 30 且缺口 ≥ 0.50 就做。已满足。
2. `tests/hooks/test-failure-debug.test.sh` 覆盖：opt-in；在正确的事件上注入；每会话一次；与第 2 层双向共用列表；测试运行器与非测试命令的区分（包括 `grep pytest src` 和 `echo "run npm test later"`）；中断；kill switch；遥测行；模块缺失。
3. `npm run check` 全绿；hook 已登记到 `hooks/hooks.json`、注册表、toggle 列表、README、ARCHITECTURE、HOOK-PROTOCOL 和 RULE-HITS-SCHEMA。

## open-questions

1. 结果层面：失败后注入这个模块，会不会改变接下来的做法，比如同一文件的重复编辑变少、更早找到根因？需要一个 offline-eval 夹具，让显而易见的补丁连续失败。与 R6(b) 共用，尚未测量。
2. 刻意的 RED 运行（TDD）也算失败，每个会话会因此拿到一次模块。每会话一次可以接受；如果它读起来像唠叨，再议。

# Change log

- r1 (2026-09-29)：按上文实现。
