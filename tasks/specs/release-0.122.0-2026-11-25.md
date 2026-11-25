# 0.122.0：规范 v9.0.0（核心 24 KB → 2.8 KB，模块 9 → 2）

状态：进行中

## 背景与目标

- 使用者 2026-11-25 问"这个项目到底有没有用"，结果对照（`docs/claudemd-value-assessment-2026-11-25.md`）发现 v8 规范在隐藏测试上不比不装好、成本高 1.8–2.4 倍。使用者选了方案 (a)：按精简草稿实施、删 7 个模块、不等 30 天宽限期、评审通过后直接发版（设计记录 `tasks/specs/spec-v9-lean-2026-11-25.md` D1–D4）。
- 本批内容（`next-release` 上 0.121.1 之后的提交）：
  - 2000461 规范 v8.6.1（从未发布，被 v9.0.0 整体取代）。
  - 2cf3e3c（D#925）：`/claudemd-clean-residue` 的年龄遍历按字节读文件名。
  - 55ea441：新 hook `memory-index-lines`（MEMORY.md 索引行超过 150 字符时提醒）。
  - 63c1678：规范 v9.0.0、六个 hook 的提示文字、测试。
  - 文档记录若干（ce66c39、9f3d133、1b718e7）。
- 发版节奏：规范大版本，用户明确要求做完就发；本周第一次发版。
- 版本号 0.122.0：已发布包的默认行为改变（规范内容），按手册用非补丁版本号。

## 范围

- 做：五处版本号；CHANGELOG 条目（≤3,000 字节）；按发版手册发布；发版后 `next-release` 快进到 `main`。
- 不做：下线任何 hook（使用者的建议 1 是冻结；banned-vocab 等是否下线另行决定）。

## 计划

- [ ] S1：从 `next-release` 切出 `release/v0.122.0`；五处版本号；CHANGELOG 条目单独扫描
- [ ] S2：`npm run check`、`npm run smoke`、bash 3.2 运行检查
- [ ] S3：提交、推送、开 draft PR；PR CI 全绿
- [ ] S4：发版前评审（新开的评审代理；本次改了已发布包的默认行为，按新 ship 模块也属必审）
- [ ] S5：合入 `main`、带注释的 tag、GitHub Release；main 的 ci、npm-publish、`npm view`、`_npmUser`
- [ ] S6：`next-release` 快进到 `main` 并推送；删除已合并的本地分支

## 决策与进展

- 2026-11-25：CHANGELOG 里"提交和汇报出现率"写成 41–72/72、按送达方式不同，不写 72/72：仓库内 CLAUDE.md 送达时是 41/72，系统提示送达时是 72/72，真实使用介于两者之间（评估 §8.2）。
- 2026-11-25：精简核心比 A/B 跑的草稿多 218 字节：§8 保留 v8 的"hook 拦截给出的绕过口令和开关是用户的"（每条 hook 拒绝信息都引用它），以及 `curl` / `wget` 管道进 shell 一句（`§8-curl-sh` 的锚点）。规范变更记录里写明。

## 验证记录

- `npm run check`（版本号与 CHANGELOG 拆出前的同一棵树）→ 通过：node 1,758 项，1,755 通过、0 失败、3 跳过；全部 shell 套件通过；shellcheck 96 个文件无告警
- `npm run smoke` → 通过（2/2）
- `BASH32_BIN=<3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过（45/45 个套件）
- 沙箱 HOME 装在 v8 之上（预置 9 个旧模块）→ 通过：装完只剩 `review.md`、`ship.md`，核心 v9.0.0、2,792 字节
