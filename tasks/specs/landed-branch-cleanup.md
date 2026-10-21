# `-d` 被拒但已落地的分支：判定后用带校验的 `-D` 删除
状态：进行中

## 背景与目标

- 用户 2026-10-21："每个项目都留一堆分支没有删除"。两次会话把被 `git branch -d` 拒绝的分支写进遗留项，并建议用 `-D`。
- 根因链：
  1. 合并方式不保留提交身份：claudemd、daagu 把代理分支 cherry-pick 进来；gsd-lite 在 GitHub 上用 rebase 方式合并 PR。新提交的 SHA 不同。
  2. `git branch -d` 只认祖先关系，全部拒绝。
  3. 核心 §7 Git 写的是"`-d` 被拒就保留，写进遗留项，不准 `-D`"（v8.1.0，0.110.0 评审 M1）。
  4. branch-prune 只列祖先分支，这类分支一个也不列。
- 实测（`tasks/landed-branch-cleanup/`，2026-10-21）：过去一周 29 个被拒后经用户批准 `-D` 删掉的分支：
  - 逐提交 `git patch-id --verbatim --full-index` 认出 27 个；`git cherry` 也是 27 个，同一批；
  - `git merge-tree` 无变化只有 10 个；PR head 一致 11 个（只有 gsd-lite）；`-x` 记录 0 个；
  - 剩下 2 个各有 1 个提交在 cherry-pick 时内容改过；
  - 现存 4 个分支都有 main 上没有的提交，新判定一个也不列。
- `git cherry` 不看空白：沙箱里分支把 Python 的 `return` 移进 `if`，main 上只多了行尾空格，cherry 判为相同，`--verbatim` 能区分（0.93.0 评审 H3 的同一类问题）。
- 目标：
  - 已落地的分支由会话直接删除，不再问用户；
  - 没落地的照旧保留，问用户时附上证据：哪些提交在 main 上没有一致的副本。

## 范围

- 做：
  - `scripts/housekeeping.js`：
    - 新增"已落地"判定；
    - `branches` 输出新增 `landed`；
    - 新子命令 `refused`：判定一条 `git branch -d` 命令点名、删完后仍存在的分支。
  - `hooks/branch-prune.sh`：
    - 列表里加上已落地的 `[gone]` / `worktree-agent-*` 分支，配带 SHA 校验的 `-D` 命令；
    - `git branch -d` 之后（PostToolUse 和 PostToolUseFailure 都触发）报告被留下的分支各自的结论。
  - `hooks/hooks.json`：在 PostToolUseFailure(Bash) 上注册 branch-prune。
  - 核心 §7 Git 那一句改为：`-d` 被拒时，只用 hook 给出的命令删已落地的分支，其余保留。
  - 发布：规范 v8.3.0、插件 0.116.0。
  - 文档：README、ARCHITECTURE、HOOK-PROTOCOL、RULE-HITS-SCHEMA。
- 不做：
  - hook 自己不删除（0.93.0 定下的只报告不变）。
  - 不用 GitHub PR 记录（要联网和登录；数据里 patch-id 已覆盖）。
  - 不用 `git merge-tree`（10/29）。
  - 不改合并工作流（cherry-pick 加 `-x`、改用 merge）。
  - 没有上游的普通分支仍不进入列表（0.93.0 M3：rebase 前的备份分支）；它们只在本任务自己 `-d` 被拒时由 `refused` 判定。
  - 不处理远端分支。

## 验收标准

- [ ] AC1：判定正确，`node --test tests/scripts/housekeeping.test.js` 新用例在改动前失败：
  - rebase 式落地、cherry-pick 落地、squash 落地 → landed；
  - 只差空白、内容改过、分支上有合并提交、匹配的 main 提交在分叉点之前 → 不判为 landed；
  - 落地后在 main 上被撤销 → 仍判为 landed（用户 2026-10-21 决定）；
  - 祖先但 `-d` 因上游或 HEAD 被拒 → landed（on-main）。
- [ ] AC2：hook 行为，`bash tests/hooks/branch-prune.test.sh` 新用例在改动前失败：
  - `-d` 被拒（PostToolUseFailure）→ 列出 landed 并给出带校验的 `-D` 命令；未落地的列出缺失提交；
  - 执行给出的命令能删掉 landed 分支；分支在判定后又加了提交 → 命令不删；
  - 已检出的分支不列；
  - pull/merge 后的列表包含 landed 的 `[gone]` 分支，不包含没有上游的分支；
  - 关闭开关有效。
- [ ] AC3：核心句子整行钉住；版本级联、Sizing、`spec-coherence-audit --strict` 一致 — 验证：`npm run check`
- [ ] AC4：离线对比，`claude -p` 沙箱，每组 5 次：
  - cherry-pick 场景下，新规范删除 landed 分支、保留内容改过的分支；
  - 旧规范两个都保留；
  - 两组都不对未落地分支用 `-D`。
- [ ] AC5：`npm run check`、bash 3.2、忽略 SIGPIPE 的一遍、`npm run smoke`、PR CI 全绿；打 tag 前评审通过 — 验证：发版手册第 4–10 步

## 方案

- 判定"已落地"（landed），对 main（本地默认分支 D）：
  - 是 D 的祖先 → `on-main`。
  - 否则需要同时满足：
    - 分支独有、不含合并提交的提交至少 1 个；`D..B` 里没有合并提交；
    - 分叉点 base = `merge-base B D`，`base..D` 不超过 500 个提交；
    - 每个独有提交的 `git patch-id --verbatim` 都出现在 `base..D` 的提交里 → `per-commit`；
    - 否则分支总改动（`git diff base B`）的 patch-id 出现在 `base..D` 里 → `squash`。
  - diff 选项固定：`--no-color --no-ext-diff --no-textconv --full-index --no-renames`，在仓库顶层运行（避开 `diff.relative`）；`--format='commit %H'`。
  - 二进制按 blob id 比；权限变化计入 patch-id（沙箱已验证）。
  - git < 2.39 没有 `--verbatim` → patch-id 失败 → 不判。
- 只认 `base..D`：分叉点之前的 main 提交不算（分支重新加回 main 早先删掉的内容，不是"已落地"）。
- 成本控制：
  - main 一侧一次 `git log -p` 覆盖所有候选的 base 中最早的那个（`merge-base --octopus`），最多 500 个提交；
  - 列表路径每次最多判定 20 个非祖先候选，超出的计入 `unjudged`。
- 带校验的删除命令（jq `@sh` 拼接）：`[ "$(git -C <dir> rev-parse -q --verify refs/heads/<b>)" = <sha> ] && git -C <dir> branch -D -- <b>`，多个用 `;` 连接。
  - 判定后分支有了新提交 → SHA 不等 → 不删。
  - `-D` 仍拒绝删除检出中、rebase 中的分支（git 2.53 沙箱已验证）。
- `refused` 的分支名来源：命令文本里 `git [-C dir] branch … -d|--delete …` 段的参数。
  - 不解析 git 的报错（可能被本地化）；
  - 带 `$`、反引号、通配符的参数跳过；带 `-D` / `--force` / `-r` 的段跳过；
  - 只保留删完后仍存在、不是默认分支、未检出、不是符号引用的分支。
- 核心 §7 Git 句子（草案）：
  - 旧："…; if `-d` refuses, keep the branch and name it under open items, never `-D`."
  - 新："…; if `-d` refuses, use `-D` only through the command a hook prints for a branch whose every commit it found on the main line, else keep the branch and name it under open items."
- 取舍：
  - 判定放在 hook 而不是规则里，因为 gsd-lite 那次会话自己判断时用的是 `git cherry`（claudemd 那次只凭 cherry-pick 记录）；
  - hook 被关掉时没有命令，就回到保留的做法。

## 计划

- [ ] S1：housekeeping 判定 + `refused` 子命令，先写失败的测试 — 覆盖 AC1 — 依赖：无 — 执行：主会话
- [ ] S2：branch-prune.sh + hooks.json + hook 测试 — 覆盖 AC2 — 依赖：S1 — 执行：主会话
- [ ] S3：核心句子、钉、规范版本、changelog、Sizing、文档 — 覆盖 AC3 — 依赖：S2 — 执行：主会话
- [ ] S4：离线对比 — 覆盖 AC4 — 依赖：S3 — 执行：主会话
- [ ] S5：按发版手册发布 0.116.0 — 覆盖 AC5 — 依赖：S1–S4 — 执行：主会话 + release-reviewer

## 决策与进展

- 2026-10-21：用户授权按建议实现：两个触发点加规则改句全部做；"落地后被撤销"算已落地。
- 在 `release/v0.116.0` 分支上做；`next-release` 与 `main` 相同。
- 注册表原来一个 hook 只写一个事件；branch-prune 要挂在 PostToolUse 和 PostToolUseFailure 两处，所以加了可选字段 `alsoOn`，一致性测试改为核对每一处注册。
- `refused` 从 stdin 读命令（命令可能是很长的 here-doc，argv 有长度上限）。
- 成本上限定为：列表路径每次最多判定 20 个，分叉点之后最多 500 个提交（数据里最大 208）。
- 离线对比第一轮发现缺陷：squash 的情况 hook 写成"每个提交在 main 上都有副本"，这对 squash 不成立；5 次里有 4 次模型自己核对 patch-id，发现说法不对，就没执行命令。修复（11282bf，重写提交信息前为 bf8d41a）：按依据分别说明——逐提交（N 个提交各有副本）、squash（整体改动等于 main 上的哪个提交）、末端已在 main 上。修复后冻结新快照 B2，两个任务都重跑。
- 变异检验发现 `-C` 后面跟变量目录的情况没有用例覆盖，已补（6af64e0）。

## 验证记录

- `node --test tests/scripts/housekeeping.test.js` → 通过（63/63；新用例在实现前失败，因为导出不存在；7 个判定变异和 5 个解析变异各自被对应用例抓到）
- `bash tests/hooks/branch-prune.test.sh` → 通过（36/36；新增 16 个，实现前其中 8 个失败；5 个 hook 变异各自被抓到；bash 3.2.57 和忽略 SIGPIPE 两种条件下也是 36/36）
- `node --test tests/scripts/hook-registry.test.js` → 通过（9/9；新用例在注册前失败）
- `bash tests/hooks/contract.test.sh` → 通过（248/248；新增事件写进文档之前，C 项失败）
- `node --test tests/scripts/spec-structure.test.js` → 通过（89/89；§7 Git 整行钉、节哈希、标题清单、Recent changes 哈希都已在读过 diff 后更新）
- `node scripts/version-cascade-check.js` → 通过（v8.3 一致；Sizing 在 ±20B 内）；`node scripts/spec-coherence-audit.js --strict` → 通过（5/5，coreDelta=0，extendedDelta=0）
- 真实数据重跑（实际实现 `refusedBranches`，按当时的 main）→ 通过：被拒后 `-D` 的 29 个里，27 个判为已落地，2 个保留；loop-testing 现存 2 个保留（32 个、1 个提交没有副本）；gsd-lite 的 2 个在 13:24 main 快进后判为已落地（`git cherry` 全为 `-`）；每个分支 128–1215 ms
- 离线对比 A（0.115.0）→ TC 0/5 删除 fix/a、5/5 保留 fix/b、自拼 `-D` 0/10；TS 0/5 删除
- 离线对比 B（42a5214 快照，即 d4fbde7 的 tree）→ TC 5/5 通过；TS 1/5 删除（见决策：squash 文字有误）
- 离线对比 B2（修复后）→ （待填）
