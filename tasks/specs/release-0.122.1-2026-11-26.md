# 0.122.1：hook 提示文字改指 v9 的小节

状态：已完成

## 背景与目标

- 0.122.0（规范 v9.0.0）发版时，评审把一批仍引用 v8 小节的 hook 文字留到了 `next-release`（`tasks/specs/release-0.122.0-2026-11-25.md`）。2026-11-26 使用者先说"按你的建议执行"，修复落在 796e07b；随后说"把剩下的工作一起做完，然后推送发版"。
- 本批内容（v0.122.0 之后）：796e07b（9 个 hook 加 status.js 的文字、README 一行注释、测试），62f7573 和 503c595（记录）。
- 发版节奏：本周第二次发版，使用者明确要求。

## 范围

- 做：五处版本号；CHANGELOG 条目；按发版手册发布。
- 不做：任何判定、事件名、开关或日志里 `spec_section` ID 的改动；规范不变（v9.0.0）。

## 计划

- [x] S1：从 `next-release` 切出 `release/v0.122.1`；五处版本号；CHANGELOG 条目单独扫描
- [x] S2：`npm run check`、`npm run smoke`
- [x] S3：提交、推送、开 draft PR；PR CI 全绿（含真实 bash 3.2 运行检查）
- [x] S4：合入 `main`、带注释的 tag、GitHub Release
- [x] S5：main 的 ci、npm-publish、registry、`_npmUser`

## 决策与进展

- 2026-11-26：版本号用补丁 0.122.1：只改提示文字，判定和默认行为不变。
- 2026-11-26：不做发版前评审：改动不在 ship.md 的必审类别里（删除路径、认证与密钥、安装与发布脚本、闸门判定、数据格式、已发布的默认行为）。tmp-sweep 和 sandbox-disposal 的文字讲的是该由谁清理，没有改任何删除代码；tmp-sweep 从"本会话"收窄到"本任务"，只会让 agent 多问一次。
- 2026-11-26：bash 3.2 运行检查用 PR CI 的那一条（ubuntu-latest / node 20 的 "Run the hooks under a real bash 3.2"，与 `tests/lib/bash32-runtime.sh` 同一脚本）。本机编译 3.2.57 没成：本机没有 yacc，源码包自带的 `y.tab.c` 和打过补丁的 `parse.y` 对不上（`expand_prompt_string` 参数个数报错）；docker ubuntu:24.04 里装 bison 时 apt 太慢（update 约 10 分钟），CI 结果出来后停掉了。
- 2026-11-26：claude-mem-lite 标签、npx 钉版本、banned-vocab 三项的决定见 `tasks/specs/release-0.122.0-2026-11-25.md` 的 11-26 段和 `docs/S8-RESIDUALS.md` F17；本次发版不带任何相关改动。
- 未做、有日期的事：12-01T16:07Z 之后的闸门精确率复测（多了 banned-vocab 下线条件和 npx 被拒后是否钉版本重跑两项）。

## 验证记录

- 新断言先在旧文字上失败（8 个 hook 套件和 `tests/scripts/status.test.js`，后者在旧文字下 29/30），改后通过
- `npm run check`（f8dcf8e 的树）→ 通过：node 1,759 项，1,756 通过、0 失败、3 跳过；全部 shell 套件；shellcheck 96 个文件
- `npm run smoke`（f8dcf8e）→ 通过（2/2）
- `node scripts/version-cascade-check.js` → plugin semver 0.122.1 consistent across 5 site(s)
- CHANGELOG 条目 1,841 字节；`node bin/claudemd-lint.js lint --file <条目>` → OK: no §10-V hits
- PR #39 CI 运行 45734355368（f8dcf8e）→ completed success，7 个任务全绿；其中真实 bash 3.2.57 运行检查："OK: all 45 suite(s) pass with the hooks EXECUTED under GNU bash, version 3.2.57"
- `main` 推到 f8dcf8e；tag `v0.122.1`（带注释，`-F` 文件）；GitHub Release https://github.com/sdsrss/claudemd/releases/tag/v0.122.1
- main 的 ci 运行 45736214142 → completed success
- npm-publish 运行 45736232766 → completed success，日志有 `+ claudemd-cli@0.122.1`；registry `dist-tags.latest` 第 6 次轮询变为 0.122.1；`npm view claudemd-cli@0.122.1 _npmUser` → `GitHub Actions <npm-oidc-no-reply@github.com>`
- 本地 `release/v0.122.1` 已用 `git branch -d` 删除；`next-release` 移到 `main`（f8dcf8e）后加本记录
