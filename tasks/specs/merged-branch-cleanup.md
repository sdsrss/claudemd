# 合并后删除本地分支
状态：草稿

## 背景与目标

- 用户 2026-10-16：规范里，本地已合并的分支要删；两个项目本地合并并发版后，本地分支都没删。
- 现场：
  - claudemd 留着 4 个已合并进 `main` 的本地分支：`ci/macos-system-bash32`（远端已删，`[gone]`），以及 `oss-benchmark-impl`、`test-env-hygiene-optins`、`v7.2-core`（三个都没有上游）。
  - code-graph-mcp 的会话把 `usage-audit` 快进合并进 `main` 后，在汇报里写"本地分支 usage-audit 已合并进 main，我没有删它"。
- 根因（三处，同时成立）：
  1. 核心 §7 **Git** 只讲提交、分支约定和推送，没有"合并后删分支"。
  2. `hooks/branch-prune.sh` 的提示原文是 "If the user wants them removed: `git branch -d …`"，把删除写成用户的决定；两个会话都照此把它放进遗留项。
  3. 这个 hook 的候选（`scripts/housekeeping.js`）只有"远端已删且已在主线上"和 `worktree-agent-*`，没有上游的分支一律不列。这是 0.93.0 评审 M3 的有意设计：rebase 前的备份分支、刚建或改名的空分支也"在主线上"。所以只在本地合并过的分支没有任何东西提醒。
- 目标：
  - 一个分支的工作合并进主线后，完成合并的会话用 `git branch -d` 删掉这个本地分支；
  - hook 列出的已合并分支，模型直接删，不再当成用户的决定。

## 范围

- 做：
  - 核心 §7 **Git** 加一句：本任务合并进主线的本地分支，用 `git branch -d` 删掉（它会拒绝未合并的工作）；项目约定常设的分支保留。
  - `hooks/branch-prune.sh` 的提示改成删除指令，命令和复核说明不变，关闭方式不变（`DISABLE_BRANCH_PRUNE_HOOK=1`）。
  - 测试：
    - hook 套件新增文字用例，改前失败；
    - 核心整行钉（golden pin）、Sizing、版本级联、`spec-coherence-audit --strict`。
  - 发布：
    - 规范 v8.1.0（新增一条规则），插件 0.110.0；
    - 会话会主动删分支，属于发布物默认行为变化，按 §2-EXT 带迁移说明、关闭方式和发布说明提示。
- 不做：
  - 不改 `housekeeping.js` 的候选规则：没有上游的分支仍不列，原因见上。
  - hook 自己不删除：0.93.0 定下的只报告不删不变。
  - 不删远端分支：推送只在用户要求时做；GitHub 合并 PR 后会自动删 head 分支。

## 验收标准

- [ ] AC1：核心 §7 **Git** 含新句子，整行被钉住；改动后核心字节数、Sizing、级联全部一致 — 验证：`npm run check` 中的 spec-structure 与 `node scripts/spec-coherence-audit.js --strict`
- [ ] AC2：branch-prune 的提示是删除指令，仍给出 `git branch -d` 命令、复核说明和关闭方式 — 验证：`bash tests/hooks/branch-prune.test.sh`，新用例在改前失败
- [ ] AC3：离线对比 — 在沙箱仓库里用 `claude -p` 跑"把 feature 分支合并进 main 并收尾"，新规范下每次都删掉本地分支，旧规范的结果作基线 — 验证：每组 5 次，记录删除次数
- [ ] AC4：`npm run check`（含 bash 3.2）、`npm run smoke`、PR CI 全绿；打 tag 前的独立评审通过 — 验证：发版手册第 4–10 步

## 方案

- 核心 §7 **Git** 句子草案（英文，接在 "Push, tag and release only when asked." 之后）：
  "A local branch whose work you merged into the main line is deleted with `git branch -d`, which refuses unmerged work; a branch the project keeps stays."
  预计核心增加约 170 B（现为 23,156 B）。
- branch-prune 提示草案：
  "[claudemd] branch-prune: N local branch(es) are on main (or origin/main) and their remote branch was deleted, or are worktree-agent-* on it: NAMES. They are merged: delete them with `CMD`, run with main checked out — -d re-checks that each is merged … and refuses otherwise. The user can turn this hint off with DISABLE_BRANCH_PRUNE_HOOK=1."
- 取舍：
  - 规则只管"本任务合并的分支"，模型确切知道是哪几个，不会误删别人的备份分支；
  - 历史遗留的已合并分支，靠 hook 在下次合并、拉取、推送时列出；没有上游的旧分支仍需人工或下次任务处理。

## 计划

- [ ] S1：核心句子 + 钉、Sizing、级联 — 覆盖 AC1 — 依赖：用户授权 — 执行：主会话
- [ ] S2：hook 提示 + 测试 — 覆盖 AC2 — 依赖：无 — 执行：主会话
- [ ] S3：离线对比 — 覆盖 AC3 — 依赖：S1 — 执行：主会话
- [ ] S4：按发版手册发布 0.110.0 — 覆盖 AC4 — 依赖：S1–S3 — 执行：主会话 + release-reviewer

## 决策与进展

- 2026-10-16：用户要求删除后，已用 `git branch -d` 删掉 claudemd 的 4 个已合并分支；`next-release` 按项目约定保留。code-graph-mcp 的 `usage-audit` 查看时已不存在。
- 等待用户授权进入实现（L3）。

## 验证记录

- `git branch -d ci/macos-system-bash32 oss-benchmark-impl test-env-hygiene-optins v7.2-core` → 通过（4 个都已删除；`git branch` 只剩 `main`、`next-release`）
