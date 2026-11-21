# 0.121.1：clean-residue 不删含挂载点的目录；tmp-sweep 提示不再抄条件清单

状态：进行中

## 背景与目标

- 使用者 2026-11-20："继续完成剩下的工作，有建议的按你的建议执行，没建议的给出建议再按建议执行，该我授权的我授权。"剩下的是 0.121.0 汇报里的遗留项。
- 本批内容（`next-release` 上 0.121.0 之后的提交，`main` 是它的祖先）：
  - 4d1b1e3（D#921，0.121.0 评审 L12）：`/claudemd-clean-residue --apply` 的三个递归删除都经过 `partitionProtected`，现在顶层与父目录 st.dev 不同、或其下有别的 st.dev 的条目都保留，列在 `protected` 里并带原因。
  - d678712（D#922，0.121.0 第二轮评审 L5）：`tmp-sweep` 占满提示不再抄 Agent temp residue 的条件清单（抄的少了两条），改为让模型先读 `auth.md` 里的清单。
  - fbc32e3（只改测试，已在 `main`）与 336a27a（记录）。
- 发版节奏：D#921 是删除路径的缺陷（手册 (b) 类，可以立即发）；本周第二次发版，未超每周两次。
- 版本号 0.121.1：只有修复，规范不变（v8.6.0）。

## 范围

- 做：五处版本号；CHANGELOG 条目（≤3,000 字节）；按发版手册发布；发版后 `next-release` 快进到 `main`。
- 不做：全局停用 mattpocock 插件（上一轮建议只停本项目，使用者让按建议执行）。

## 计划

- [x] S1：从 `next-release` 切出 `release/v0.121.1`；五处版本号；CHANGELOG 条目单独扫描
- [x] S2：`npm run check`、`npm run smoke`、bash 3.2 运行检查
- [ ] S3：提交、推送、开 draft PR；PR CI 全绿
- [ ] S4：发版前评审（新开的评审代理）
- [ ] S5：合入 `main`、带注释的 tag、GitHub Release；main 的 ci、npm-publish、`npm view`、`_npmUser`
- [ ] S6：`next-release` 快进到 `main` 并推送；删除已合并的本地分支；本机 `/claudemd-refresh`

## 决策与进展

- 2026-11-20：D#922 的修法选"删掉抄的清单、指向 auth.md"，不选"补齐两条"：清单已经漂移过一次（0.121.0 给规范和提示各加了一遍挂载点条件），核心 §2.2 已规定删除前读 `auth.md`；也符合使用者"做减法"的方向。
- 2026-11-20：D#921 的检测与 `tmp-sweep`（housekeeping.js `agentResidue`）用同一办法（lstat 比 st.dev，顶层再和父目录比）；没有共用一个函数，因为 `agentResidue` 的遍历同时算年龄、socket 和大小。同文件系统的 bind mount 检测不到，CHANGELOG 写明。遍历不设条目上限：`rmSync` 本身也要走完整棵树。

## 验证记录

- D#921：`node --test tests/scripts/clean-residue.test.js`，新用例两条与 CLI 用例的原因断言在旧代码上 → 失败（挂载的夹具被删掉；reason 为 undefined），修后 → 通过（66/66）
- D#922：`bash tests/hooks/tmp-sweep.test.sh`，用例 13 先改 → 旧 hook 失败（19/20），改后 → 通过（20/20）
- `node scripts/version-cascade-check.js` → 通过（plugin semver 0.121.1 consistent across 5 site(s)）
- CHANGELOG 条目 2,046 字节，`claudemd-lint lint --file` 单独扫描 → 通过
- `npm run check`（发版分支，版本号已改）→ 通过（exit=0；node 1822 条，1819 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）
- `npm run smoke` → 通过（SMOKE: 2/2 suite(s) passed）
- `BASH32_BIN=<ubuntu:24.04 容器里编的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过（44/44 套件）
