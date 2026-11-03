# 0.119.0：spec v8.5.0（代理临时残留）与 agent-tmp-* 自动回收的发版

状态：进行中

## 背景与目标

- 使用者 2026-11-03 说"把剩下能做的工作做了，然后发版"。
- 本批内容：
  - spec v8.5.0（Agent temp residue，设计记录 `tasks/specs/agent-temp-residue-2026-11-03.md`，使用者 11-03 已批准）；
  - `housekeeping.js tmp` 的 `agent-tmp-*` 回收，以及 tmp-sweep 的提示文字（07737a3，评审修复轮改了前缀）；
  - 五处版本号与 CHANGELOG。
- `release-reviewer` 的临时目录前缀（5e2695f，评审修复轮改为 `agent-tmp-rrev-`）在 `.claude/agents/`，不随插件发布，只是落在这段提交范围里。
- 发版节奏：按 11-02 定的规则，这批不属于必须立即发的类别；使用者明确要求现在发。

## 范围

- 做：版本号；CHANGELOG 条目（≤3,000 字节）；设计记录里 rebase 之后的提交号；按发版手册发布。
- 不做：
  - D#665（bash 3.2 watchdog）；
  - D#656（技能复扫）；
  - `~/.cache/tmp` 下 `d546`、`d558`、`d577-a5`、`d591` 的去留（归 claude-mem-lite 的会话）。

## 计划

- [x] S1：`next-release` rebase 到 main（5e2695f），切出 `release/v0.119.0`；五处版本号；CHANGELOG 条目单独扫描（2101 字节，OK）
- [x] S2：`git add` 后 `npm run check`，`npm run smoke`
- [x] S3：提交、推送、开 draft PR（#32）；f03fda9 的 PR CI 全绿（run 41647419898）
- [ ] S4：发版前评审（新开的评审代理），修复轮
- [ ] S5：合入 `main`、带注释的 tag、GitHub Release；两条 tag 工作流、`npm view`、`_npmUser`

## 决策与进展

- 2026-11-03：rebase 之后，`next-release` 上的提交号从 1a34726 / f1ddc21 / 747b7c1 变为 07737a3 / 1613b31 / 46945e8；设计记录里的提交号已按新号改正。

- 2026-11-03：第一轮评审（新开的评审代理，e85aea0..f03fda9）：Critical 0、High 1、Medium 4、Low 8。逐条处理见设计记录。修复改了代码（H1、M1、M3），所以要新开一个评审，只审修复提交（深度 2/2）。已推送的 07737a3、1613b31 的提交说明里有旧前缀和旧数字，不改，以 CHANGELOG 为准。
- 遗留（不在本版修）：
  - L7：几个 sweep 并发时会把别人删掉的条目算成自己的失败（ENOENT，exit 3），删除数也会重复计算。vitest 那一类原来就是这样。
  - L8：属主只检查顶层目录；`rmSync` 会进入目录里的挂载点。这台机器上没有 root，没法写测试。

## 验证记录

- `node scripts/version-cascade-check.js` → 通过（v8.5 三个文件一致；插件版本 0.119.0 五处一致）
- `node bin/claudemd-lint.js lint --file <单独取出的条目>` → 通过（OK: no §10-V hits，2101 字节）
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1786/1789（3 个跳过）；shell 1771 条 PASS、0 条 FAIL
- `npm run smoke` → 通过：SMOKE 2/2
- 修复轮 `npm run check`（`git add` 之后）→ 通过：exit 0；node 1796/1799（3 个跳过）；shell 1772 条 PASS、0 条 FAIL
- 修复轮 `npm run smoke` → 通过：SMOKE 2/2
- 修复轮变异检验：前缀改回包含 `cc-`、去掉顶层 ctime、去掉内部 ctime、去掉 socket 判断、去掉 FIFO 判断、时钟接口不设门禁、`--min-age-minutes` 传到 agent 扫描，每个都至少让 1 个用例失败
- 修复前后：`tmp-sweep.test.sh` 在修复前的 hook 和脚本上 17/20（8c、12、13 失败），修复后 20/20；`sandbox-disposal.test.sh` 用例 30 修复前失败，修复后 30/30；`housekeeping.test.js` 新用例在修复前的脚本上失败 10 个，修复后 113 通过、1 跳过
