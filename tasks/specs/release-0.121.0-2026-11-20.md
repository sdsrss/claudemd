# 0.121.0：规范 v8.6.0（提示词审计两轮修复）

状态：进行中

## 背景与目标

- 使用者 2026-11-20："把剩下的做完了，一起推送 合并 发版 清理"。
- 本批内容（`next-release` 上 v0.120.1 之后的提交，`main` 是它的祖先，不需要 rebase）：
  - 规范 v8.6.0 第一轮（dc4b34d）与第二轮（审计剩余项），设计记录 `tasks/specs/prompt-audit-fixes-2026-11-20.md`。
  - 模块构建：同一模块回到已开过的 `##` 段时不再重复标题。
  - 只影响仓库自身的：a0445a6（tag 推送不再跑 ci 矩阵）、2414208（run-all 并行跑 shell 套件），以及几份记录。
- 发版节奏：规范改动不属于必须立即发的 (a)–(c) 类；使用者明确要求发版。上一次发版 11-09，本周额度未用。
- 版本号 0.121.0：规范次版本更新时插件发次版本（CHANGELOG 版本策略）。

## 范围

- 做：五处版本号；CHANGELOG 条目（≤3,000 字节）；按发版手册发布；发版后 `next-release` 快进到 `main`。
- 不做：code-graph-mcp 与 mattpocock 两项（不在本仓库，见设计记录 R7、R8）。

## 计划

- [x] S1：从 `next-release` 切出 `release/v0.121.0`；五处版本号；CHANGELOG 条目单独扫描
- [x] S2：`npm run check`、`npm run smoke`
- [ ] S3：提交、推送、开 draft PR；PR CI 全绿
- [ ] S4：发版前评审（新开的评审代理）
- [ ] S5：合入 `main`、带注释的 tag、GitHub Release；main 的 ci、npm-publish、`npm view`、`_npmUser`
- [ ] S6：`next-release` 快进到 `main` 并推送；删除已合并的本地分支

## 决策与进展

- 2026-11-20：`main` 的 CI（c7b3603，ci run 42768838781）为绿；`main` 与 `origin/main` 一致。
- 2026-11-20：`next-release` 上本批新增两个提交：1a27e61（模块构建不重复 `##` 标题）、85d3a50（v8.6.0 第二轮）。
- 2026-11-20：CHANGELOG 条目 2,161 字节，单独扫描通过。
- 2026-11-20：切分支后、评审前自查发现 85d3a50 的 Report shape 理由句写"every report"，与"微改一句话汇报"矛盾；在 `next-release` 上修（ec5dfb8），发版分支快进。

## 验证记录
- `npm run check`（发版分支，版本号已改）→ 通过（exit=0；node 1815 条，1812 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）
- `npm run smoke` → 通过（SMOKE: 2/2 suite(s) passed）
- `node scripts/version-cascade-check.js` → 通过（v8.6 consistent across 3 file(s); plugin semver 0.121.0 consistent across 5 site(s)）
