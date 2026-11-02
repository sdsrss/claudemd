# 规范 §EXT §11-O "Worktree spawn"：补上命令复杂度这个原因

状态：草稿

## 背景与目标

- 2026-10-06 → 11-02 的转录分析（`docs/claude-session-analysis-2026-11-02.md` 第 3.1 节，本地文档）：`isolation: "worktree"` 的子代理被 Claude Code 拒绝 877 次，分布在 6 个项目。拒绝原文按类：`names git in a form too complex to verify that it stays inside the worktree` 219、`is too complex to verify …` 173、`runs <X> inside a construct too complex to verify` 77、`runs <X> in a plain command; what it reads or is handed as shell text cannot be verified` 73、运行时计算出的值 84、改 `HOME` 38。
- 现行规则只讲一个原因："an `isolation: "worktree"` agent's prompt gives paths relative to its worktree, never the main checkout's absolute path"（09-26 那期的 75 次）。本期的拒绝来自命令形状，规则没覆盖。
- 本仓库的 `release-reviewer` 占 415 次（53/53 个实例），已在本地改成自建临时克隆（main 上的 1c9e781，不随插件发布）。剩下的 462 次在其他项目：`executor` 24/24 个实例（本项目 114、claude-mem-lite 44、daagu 17）、带 worktree 派出的 `general-purpose`（daagu 143、claude-mem-lite 91、code-graph-mcp 40）。这些项目读的是安装的规范，所以只能靠规范这一条改。
- 目标：派发方知道 worktree 里哪些命令会被拒，并且把需要沙箱 `HOME`、新旧版本对比或仓库外路径的工作派成不隔离、自建克隆的代理。

## 范围

- 做：`spec/CLAUDE-extended.md` §11-O 的 Worktree spawn 一条；重建 `spec/spec-modules/orchestrate.md`；规范版本级联、`spec/CLAUDE-changelog.md`、extended 的 Recent changes 与 Sizing、`tests/scripts/spec-structure.test.js` 的锁定块。随下一个批次发版。
- 不做：core §11 的回合让出规则（后台命令完成时让出）。CI 等待改成前台 `timeout 570 gh run watch` 后，现行规则内就能做，不需要改规范（见决策）。其他项目的派发模板。

## 验收标准

- [ ] AC1：`spec/spec-modules/orchestrate.md` 的 Worktree spawn 一条写明四类会被拒的命令形状，以及"需要沙箱 HOME / 新旧对比 / 仓库外路径的工作不用 worktree 隔离、自建临时克隆、不写主检出"。验证：`grep -n 'Worktree spawn' spec/spec-modules/orchestrate.md` 读整行。
- [ ] AC2：`npm run check` 退出 0（spec-structure、spec-modules 构建一致、版本级联、coherence `--strict` 无漂移）。验证：`npm run check; echo exit=$?`。
- [ ] AC3（发版后 27 天）：除 `release-reviewer` 以外的 worktree 拒绝数，基线 462 / 27 天。验证：`tasks/transcript-analysis-2026-11-02/` 的 `an.py` + `extra.py` 第 1 节，只数该版本暴露之后的子代理。

## 方案

现行（`spec/CLAUDE-extended.md:253`）：

```
- **Worktree spawn**: an `isolation: "worktree"` agent's prompt gives paths relative to its worktree, never the main checkout's absolute path — the harness rejects those.
```

改为：

```
- **Worktree spawn**: inside an `isolation: "worktree"` agent the harness refuses every command it cannot prove stays in the worktree: the main checkout's absolute path, compound or piped git, a path computed at runtime, a `HOME` change. Such an agent's prompt gives paths relative to its worktree and one plain command per step. Work that needs a sandbox `HOME`, an old version extracted beside the new, or paths outside the repo (reviews, experiments) is spawned without worktree isolation; it clones the repo into its own temp dir and never writes the main checkout.
```

- 为什么不只是"提示词里写简单命令"：评审、实验类工作的核心动作就是被拒的那几类，改写命令做不了这些工作（0.113.1 的评审因为 `HOME` 被拒，没能独立核对回滚步骤）。
- 为什么是"自建克隆"而不是主检出：不隔离的代理如果在主检出里跑测试或写文件，会和作者的修改互相干扰；克隆删掉 `origin` 后，git 也写不回作者的仓库。本地 `release-reviewer` 已按这个做法改写并实跑过克隆、取旧版本、沙箱 HOME 跑 hook、清理。

## 计划

- [ ] S1：改 extended §11-O 一条，`node scripts/build-spec-modules.js` — 覆盖 AC1 — 依赖：使用者批准进入实现 — 执行：主会话
- [ ] S2：版本级联、两份 changelog、Sizing 定点、spec-structure 锁定块，`npm run check` — 覆盖 AC2 — 依赖：S1 — 执行：主会话
- [ ] S3：随下一个批次按发版手册发布（含发版前评审） — 依赖：S2 — 执行：主会话 + release-reviewer
- [ ] S4：暴露 27 天后复测 — 覆盖 AC3 — 依赖：S3

## 决策与进展

- 2026-11-02：写成草稿。规范自改是 L3，进入实现前要使用者批准（本次汇报里的 `[AUTH REQUIRED]`）。按分析的建议，不单独为它发版，跟下一个批次走。
- 2026-11-02：考虑过同时改 core §11 的回合让出规则，让"等待后台命令"也能结束回合。没采纳：前台 `timeout 570 gh run watch` 加一次 `gh run view` 就能在一个回合里等完 CI，不用 sleep，也不用改规范；后台方式每次等待只省 1–2 次请求，却要动所有使用者的核心规则。

## 验证记录

- （未开始实现）
