# 0.122.0：规范 v9.0.0（核心 24 KB → 2.8 KB，模块 9 → 2）

状态：已完成

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

- [x] S1：从 `next-release` 切出 `release/v0.122.0`；五处版本号；CHANGELOG 条目单独扫描
- [x] S2：`npm run check`、`npm run smoke`、bash 3.2 运行检查
- [x] S3：提交、推送、开 draft PR；PR CI 全绿
- [x] S4：发版前评审（新开的评审代理；本次改了已发布包的默认行为，按新 ship 模块也属必审）
- [x] S5：合入 `main`、带注释的 tag、GitHub Release；main 的 ci、npm-publish、`npm view`、`_npmUser`
- [x] S6：`next-release` 快进到 `main` 并推送；删除已合并的本地分支

## 决策与进展

- 2026-11-25：CHANGELOG 里"提交和汇报出现率"写成 41–72/72、按送达方式不同，不写 72/72：仓库内 CLAUDE.md 送达时是 41/72，系统提示送达时是 72/72，真实使用介于两者之间（评估 §8.2）。
- 2026-11-25：精简核心比 A/B 跑的草稿多 218 字节：§8 保留 v8 的"hook 拦截给出的绕过口令和开关是用户的"（每条 hook 拒绝信息都引用它），以及 `curl` / `wget` 管道进 shell 一句（`§8-curl-sh` 的锚点）。规范变更记录里写明。

- 2026-11-25：评审第 1 轮（47e903b..57b70dd）：High 0、Medium 2、Low 16。M1（tmp-sweep 指向已删除的 auth.md）、M2（npx 拒绝文字建议钉版本，与 v9 §8 矛盾）和用户会读到的 Low 在 4d4e1e4 修复；可选开启 hook 的文字（L5）、session-end / session-start 的暂停文字（L4）、批量评审提醒里的 §13.2 留到 `next-release`；L1（压缩后提醒的建议仍成立）、L12（用户自己建的符号链接不是安装器写的文件）不改。
- 2026-11-25：使用者转来 daagu 的实测（`/home/ai/dev/daagu/docs/memory-cleanup-2026-11-25/report.md`），并入本次发版：
  - 带空格的标签匹配不上：复现属实。awk 匹配器 `gsub(/ /, "", t)` 删掉标签里所有空格，doctor 的 JS 解析器照搬，标签 `npm run lint` 只能命中 `npmrunlint`。本机 1,269 个标签里 131 个带空格。选方案 (a)：两处都只去首尾空白，中间的一段空白在正则里匹配一段行内空白；`memory-read-check` 因此会对这类标签多出拒绝，这是闸门按说明本该做的事。不做 (b)（doctor 对带空格标签告警）：(a) 之后短语标签已能命中；用空格分隔多个标签的写法（claude-mem-lite 122 个）现在整串当一个短语，只有整串原样出现才命中，要由作者改成逗号，这条写进了 CHANGELOG。
  - 中文短标签：v9 已删除 Tag specificity 规则，规范没有地方可加；在本项目 26 个会话、88 条真实提示词上回放（daagu 的 `tag_fire.py`，「有用」= 命中后同一会话里读了该记忆），≤2 字中文标签有用率 21/43，3 字以上中文 10/26，其他 49/177，不支持加中文指引，不改。
  - 索引行 ≤150 字符：本次的 `memory-index-lines` 就是 daagu 支持的方案 (a)（规则不变，写入时检查），不再改。

- 2026-11-25：评审第 2 轮（57b70dd..78cba9c，到达深度上限）：High 0、Medium 1、Low 7，本轮只做文字修复，按手册不再派评审，改做 claim-drift：
  - M1（npx 的逐条命中行仍写 "unpinned"，钉了版本仍放行，与 v9 §8「先问」不一致）：收回 CHANGELOG 和规范变更记录里「不再建议钉版本」的说法，"Not changed" 写明钉版本仍放行，`docs/S8-RESIDUALS.md` F17 记下现状；不改判（§8 闸门的放行→拒绝要单独评估）。
  - L1/L2（标签修复的说法）：CHANGELOG 改为「命中短语、不再命中连写」「空格会连成一个短语」。
  - L3（matcher 注释）：改注释。
  - L4（默认开启的 hook 也有引用 v8 小节的）：CHANGELOG 和规范变更记录改成「其他 hook」，并点名四个。
  - L5（Sizing 行基线）：改为 v8.6.0 的 24,218 / 38,807 / 15,423。
  - L6（41/72 也没过预注册的 ≥ 46/72）：规范变更记录和 extended 写明。
  - L7（tmp-sweep 写 session、v9 写 task）：留到 `next-release`，属 hook 文字。
- 2026-11-25：标签修复的真实命令回放（评审第 2 轮建议补的一项）：本机 10 个项目转录里 3,376 条 ship 类 Bash 命令，按工作目录各放一个空会话记录，分别过 57b70dd 和修复后的 `memory-read-check`：两版都是 127 拒绝、3,249 放行，判定不同的 0 条。带空格的标签在这些命令里都没出现，所以这次修复不会在历史命令上多拒或少拒。
- 留到 `next-release` 的项：可选开启和其余默认开启 hook 里引用 v8 小节的文字（spec-module-gate、sandbox-disposal-check、residue-audit、mem-audit 等）；session-end / session-start 的暂停文字；批量评审提醒的 §13.2；tmp-sweep 的 session/task；npx 逐条命中行的 "unpinned" 与钉版本放行（要不要改判另行决定）。

## 验证记录

- `npm run check`（版本号与 CHANGELOG 拆出前的同一棵树）→ 通过：node 1,758 项，1,755 通过、0 失败、3 跳过；全部 shell 套件通过；shellcheck 96 个文件无告警
- `npm run smoke` → 通过（2/2）
- `BASH32_BIN=<3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过（45/45 个套件）
- 沙箱 HOME 装在 v8 之上（预置 9 个旧模块）→ 通过：装完只剩 `review.md`、`ship.md`，核心 v9.0.0、2,792 字节
- PR #38 CI：57b70dd 运行 45715985993、78cba9c 运行 45722438237、95318d4 运行 45725137137 → 都是 completed success
- 评审修复后的树（95318d4）`npm run check` → 通过：node 1,758 项，1,755 通过、0 失败、3 跳过；全部 shell 套件；shellcheck 96 个文件
- bash 3.2.57 运行检查（78cba9c 的树）→ 通过（45/45）；`npm run smoke` → 通过（2/2）
- 标签修复的红灯先行：新断言在 4d4e1e4 的匹配器上失败（parity 直接断言 phrase=[] joined=[npmrunlint]；memory-read-check case 75 无拒绝；engine-parity 失败），修复后通过；第 1 轮的 hook 文字断言在 57b70dd 的 hook 上失败
- 真实命令回放（3,376 条）→ 两版 127 拒绝 / 3,249 放行，0 条判定变化
- `main` 推到 95318d4（本地 `main` 上有一个从未推送的 657d19e，补丁与 ce66c39 相同、父提交就是 origin/main，`main` 直接指向发版分支头，远端是快进）；tag `v0.122.0`（带注释，`-F` 文件）；GitHub Release https://github.com/sdsrss/claudemd/releases/tag/v0.122.0 ；PR #38 显示 MERGED
- main 的 ci 运行 45726978687 → completed success
- npm-publish 运行 45726995068 → completed success，日志有 `+ claudemd-cli@0.122.0`；registry `dist-tags.latest` 第 5 次轮询变为 0.122.0；`npm view claudemd-cli@0.122.0 _npmUser` → `GitHub Actions <npm-oidc-no-reply@github.com>`
- `next-release` 快进到 95318d4 并推送；本地 `release/v0.122.0` 已用 `git branch -d` 删除
