# 发版 CI 去重与 shell 套件并行

状态：已完成

## 背景与目标

- `docs/claudemd-optimization-review-2026-11-10.md`（本地文档）第 2、3 节。
- 发版时 main 推送和 tag 推送的 `ci` 跑在同一个提交上（v0.117.7–v0.120.1 共 5 个版本，SHA 5/5 相同），矩阵相同。tag 那一轮加上 npm-publish，同时要 7 个 macOS 任务，并发上限 5；5 个版本每次都有 macOS 任务排队，最长 13.0–17.1 min。其中 4 次 npm 包在 tag 后 29.6–33.3 min 才发出；没排队的 v0.120.0 是 13.5 min。
- `tests/run-all.sh` 在 HEAD `0790ff6` 上 314.5 s，其中 40 个 shell hook 套件串行 266.3 s（本机 12 核）。`tests/lib/bash32-runtime.sh` 同样串行。
- 目标：去掉重复的 tag 运行；shell 套件按核数并行，结果和失败汇总与串行一致。

## 范围

- `.github/workflows/ci.yml`：删 `on.push.tags` 与相应注释。用户 2026-11-10 授权（"按你的建议执行"，针对"去掉 ci.yml 的 tag 触发"一项）。
- `tests/scripts/workflow-step-exec.test.js`：新增一条断言 ci.yml 不在 tag 推送上运行。
- `tests/run-all.sh`、`tests/lib/run-suite.sh`、`tests/lib/bash32-runtime.sh`：shell 套件并行。
- 不改：`npm-publish.yml`（它自己的测试门保留）、hooks/、spec/。

## 验收标准

- AC1：新测试在改 ci.yml 前失败、改后通过。
- AC2：并行版 `run-all.sh` 连跑 5 次全部通过，各套件 PASS 计数与串行版一致。
- AC3：人为改坏一个 hook，并行版报红，失败汇总指向对应套件。
- AC4：完整套件耗时，与基线 314.5 s 对比，写出数字。
- AC5：runbook 第 10 步改为看 main 的 ci 运行和 npm-publish。

## 计划

- [x] S1：ci.yml 删 tag 触发，先写失败的测试（a0445a6）
- [x] S2：`run_suites_bg` 与 run-all.sh / bash32-runtime.sh 并行化，`timeout-guard.test.sh` 加用例
- [x] S3：AC2–AC4 试跑与计时
- [x] S4：runbook 第 10 步（记忆文件，不在仓库里）

## 决策与进展

- 2026-11-10：不减 macOS 腿。09-22 以来 21 次失败的 ci 运行每次只红一条腿，10 次在 macOS 腿上。
- 2026-11-10：第一轮并行试跑（5 次 run-all + 1 次 bash 3.2 运行时）暴露两个问题。① 本规范文件没有 `- [ ]` 清单，`spec-status-drift.test.js` 5/5 次报红（a0445a6 带进来的，补了"计划"一节）。② bash 3.2 运行时下 `sandbox-disposal.test.sh` 的 12b 红 1 次：该用例扫描真实 `/tmp`，hook 最多列 5 条，其他套件同时建的 mktemp 目录把探针挤出了列表。改为由 `suite_runs_alone` 让它和 `hook-budget.test.sh`（按安静机器上的比例计时）在并行批次之前单独跑。
- 2026-11-10：语言漂移的预防（UserPromptSubmit 注入）不在本规范内：hook 文字会进模型上下文，属于 L3，等用户另行决定。

## 验证记录

- AC1：新测试 `ci.yml runs on main pushes and pull requests, not on tag pushes` 在改 ci.yml 前 0/1，改后 `workflow-step-exec.test.js` 7/7。
- `timeout-guard.test.sh`：旧 `run-suite.sh` 上 10/15（新增 5 条失败），新库 15/15，bash 3.2 下 15/15。变异：把 `-P "$(suite_jobs)"` 改成 `-P 1`，"suites ran at the same time" 一条变红（4 s），14/15。
- AC2（第二轮，`suite_runs_alone` 之后）：`bash tests/run-all.sh` 连跑 5 次，全部 `OVERALL: all suites passed`，shell PASS 行 1,790 条（串行基线 1,784 + 新增 6），node `fail 0`。在 bash 3.2 下跑 run-all 一次：通过，178 s。
- AC3：在 `hooks/ship-baseline-check.sh` 开头插 `exit 0` 后跑并行版：rc=1，`FAILED:` 列出 `fail-open.test.sh`、`preToolUse-jq-spawn-budget.test.sh`、`ship-baseline.test.sh`，并打印各自日志末尾；hook 已用 `git checkout` 还原。
- AC4：run-all 串行 314.5 s（HEAD 0790ff6）→ 并行 161 / 163 / 163 / 166 / 200 s（中位 163 s）。`bash32-runtime.sh` 串行 305 s（`git archive` a0445a6）→ 并行 128 s。本机 12 核。
- `npm run smoke` → `SMOKE: 2/2 suite(s) passed`；`npm run lint` exit 0；`shellcheck --severity=warning`（4 个改动的 shell 文件）exit 0；`bash32-constructs.sh` exit 0。
- PR CI 上的效果（2026-11-10，draft PR #35 只为跑 CI 而开，读完后未合并关闭）：运行 42836192198 在 2414208 上 7/7 通过，无排队。对照最近 5 次成功的 PR CI（42766725085、42705744828、42697781748、41657087398、41647419898）：最慢任务 11.9 min（基线 17.2–20.6）；ubuntu node-20 8.1 min（12.7–18.6）；macOS 三条 10.2–11.9 min（14.4–20.6）；ubuntu node-22/24 6.4 / 4.8 min（6.7–10.3）。只有 1 次运行，托管机器速度有波动。
- tag 推送后的效果（只跑 npm-publish、macOS 排队 0、总时长 < 20 min）要等下一次发版才能读到（D#767）。
