# 0.120.0：11-03 两批遗留修复的合批发版（闸门准确率、tmp 回收并发与挂载点、遥测字段、doctor 指纹）

状态：进行中

## 背景与目标

- 使用者 2026-11-09 说"发版"。
- 本批内容（`next-release` 上 11-03 的提交，`main` 是它的祖先，不需要 rebase）：
  - 闸门准确率（设计记录 `tasks/specs/gate-precision-fixes-2026-11-03.md`）：ed3d39f（banned-vocab Path 1 剥离）、23c8800（小数倍数完整引用）、0680b63（memory-read-check 拦截行 `tags`，doctor 先列实际拦截）。
  - 遗留小修（设计记录 `tasks/specs/batch-residuals-2026-11-03.md`）：b16adfc（tmp 回收 ENOENT 与挂载点）、a35765b（sandbox-disposal `names`，askRate 的 `precision` / `status`）、44fc93c（doctor `runbook-review-step` 指纹）、a567a1e（F37 只登记，闸门不改）。
- 发版节奏：两批都不属于必须立即发的类别；记录里定的是 11-09 起随下一个非紧急批次发。11-09 是周一，本周额度未用。
- 版本号 0.120.0：两个 `feat` 提交；0.119.0 带一个 `feat` 也是次版本号。spec 没有改动（仍是 v8.5.0）。

## 范围

- 做：
  - 五处版本号；CHANGELOG 条目（≤3,000 字节）。
  - tmp 回收新加的"有条目在另一个文件系统上就保留"这一条，补进 README、`docs/ARCHITECTURE.md`、`hooks/tmp-sweep.sh` 头注释和 `housekeeping.js` 的 `--help`（b16adfc 只改了代码和测试，这四处还是 0.119.0 的条件列表）。
  - 按发版手册发布；发版后在 `next-release` 上关闭两份设计记录的 AC6 / AC7、S4。
- 不做：
  - `spec/CLAUDE-extended.md` §5-EXT 那句"tmp-sweep 在……时删除"同样没写挂载点。改它要 spec 补丁版本和整套 spec 版本同步，并且是给模型读的规范文字；它漏写的方向是"实际比写的少删"。记为遗留，随下一次 spec 改动修。
  - D#665、D#656、D#674、D#719、D#737（各自的延期项）。

## 计划

- [x] S1：从 `next-release` 切出 `release/v0.120.0`；五处版本号；CHANGELOG 条目单独扫描；四处 tmp 回收说明
- [x] S2：`git add` 后 `npm run check`、`npm run smoke`；bash 3.2.57 运行时套件
- [ ] S3：提交、推送、开 draft PR；PR CI 全绿
- [ ] S4：发版前评审（新开的评审代理）
- [ ] S5：合入 `main`、带注释的 tag、GitHub Release；两条 tag 工作流、`npm view`、`_npmUser`
- [ ] S6：`next-release` 快进到 `main` 并推送；在 `next-release` 上关闭两份设计记录

## 决策与进展

- 2026-11-09：`main` 的 CI（288057d，run 41660765490）为绿。
- 2026-11-09：CHANGELOG 条目 2,641 字节，单独扫描通过。

## 验证记录

- `node scripts/version-cascade-check.js` → 通过（v8.5 三个文件一致；插件版本 0.120.0 五处一致）
- `node bin/claudemd-lint.js lint --file <单独取出的条目>` → 通过（OK: no §10-V hits，2,641 字节）
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1804/1807（3 个跳过）；shell 1784 条 PASS、0 条 FAIL
- `npm run smoke` → 通过：SMOKE 2/2
- `BASH32_BIN=<scratchpad 里编译的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过：44/44 个套件（3.2.57 在 `ubuntu:24.04` 里编译，源码包 sha256 与 ci.yml 一致）
