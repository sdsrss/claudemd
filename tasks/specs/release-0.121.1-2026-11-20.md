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
- 2026-11-20：第一轮发版前评审（新开的评审代理，170b201..6bc1f8b）：Critical 0、High 0、Medium 2、Low 8。逐条核实后处理：
  - M1（改代码，先写失败用例）：父目录用 lstat 取，`$TMPDIR` 或 projects 目录是指向别的文件系统的符号链接时，每个条目都被当成挂载点、永远保留。改为对父目录用 stat。
  - M2（改代码，先写失败用例）：遍历出错就跳过那棵子树，而 rmSync 仍会删进去。非 UTF-8 的名字：改为按 Buffer 遍历。超过 PATH_MAX 的路径、遍历中消失的条目：除 EACCES/EPERM（rmSync 在同一处也会失败、进 `unreapable`）以外的错误一律保留，原因 `mount-unchecked`。
  - L3：`--help` 补上 bind mount 检测不到这一句。L4：命令页把"保留"单列一段，写明覆盖三个递归删除的 pass；探针段的"reaped only when all five hold"改为"a candidate only when"。L6：`tests/lib/run-suite.sh` 注释改为 0.87–1.60 s、七个任务（fbc32e3 的提交信息已推送，不改）。L10：补了 dry run、stderr 文案和两个出错分支的用例。
  - L5（不改，D#923）：核心 §8.V4 的 "in short" 摘要少两条条件。标明是摘要；改它要动规范版本，放进下一批规范改动。
  - L7（不改）：pre-bash-safety 的 1,600 段用例对 3 s 上限取三次最好值，macOS 最差 2.243 s；三次都慢才会失败，留在并行批次里。
  - L8、L9（不改，D#924）：dry run 遍历每个目标整棵树、不设上限（20,000 个文件 103 ms），目标里挂着卡住的 FUSE 时 lstat 可能卡住（`--apply` 的 rmSync 也会卡在那里）；同一 pass 里先查完所有目标再逐个删。

## 验证记录

- D#921：`node --test tests/scripts/clean-residue.test.js`，新用例两条与 CLI 用例的原因断言在旧代码上 → 失败（挂载的夹具被删掉；reason 为 undefined），修后 → 通过（66/66）
- D#922：`bash tests/hooks/tmp-sweep.test.sh`，用例 13 先改 → 旧 hook 失败（19/20），改后 → 通过（20/20）
- `node scripts/version-cascade-check.js` → 通过（plugin semver 0.121.1 consistent across 5 site(s)）
- CHANGELOG 条目 2,046 字节，`claudemd-lint lint --file` 单独扫描 → 通过
- `npm run check`（发版分支，版本号已改）→ 通过（exit=0；node 1822 条，1819 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）
- `npm run smoke` → 通过（SMOKE: 2/2 suite(s) passed）
- `BASH32_BIN=<ubuntu:24.04 容器里编的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过（44/44 套件）
- PR CI run 44852374038（6bc1f8b）→ 通过（7/7）
- 第一轮修复：新用例四条（符号链接根、非 UTF-8 名字、ENAMETOOLONG、遍历中 ENOENT）在旧遍历上 → 失败（4 条，原因与评审所述一致），修后 `clean-residue.test.js` → 通过（72/72，0 跳过）
- 第一轮修复：`npm run check` → 通过（exit=0；node 1828 条，1825 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）；CHANGELOG 条目 2,201 字节，单独扫描通过
