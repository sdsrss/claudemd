# 发版 CI 去重与 shell 套件并行

状态：进行中

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

## 决策与进展

- 2026-11-10：不减 macOS 腿。09-22 以来 21 次失败的 ci 运行每次只红一条腿，10 次在 macOS 腿上。

## 验证记录

（实施后填写）
