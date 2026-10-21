# `-d` 被拒但已落地的分支：判定后用带校验的 `-D` 删除
状态：已完成

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

- [x] AC1：判定正确，`node --test tests/scripts/housekeeping.test.js` 新用例在改动前失败：
  - rebase 式落地、cherry-pick 落地、squash 落地 → landed；
  - 只差空白、内容改过、分支上有合并提交、匹配的 main 提交在分叉点之前 → 不判为 landed；
  - 落地后在 main 上被撤销 → 仍判为 landed（用户 2026-10-21 决定）；
  - 祖先但 `-d` 因上游或 HEAD 被拒 → landed（on-main）。
- [x] AC2：hook 行为，`bash tests/hooks/branch-prune.test.sh` 新用例在改动前失败：
  - `-d` 被拒（PostToolUseFailure）→ 列出 landed 并给出带校验的 `-D` 命令；未落地的列出缺失提交；
  - 执行给出的命令能删掉 landed 分支；分支在判定后又加了提交 → 命令不删；
  - 已检出的分支不列；
  - pull/merge 后的列表包含 landed 的 `[gone]` 分支，不包含没有上游的分支；
  - 关闭开关有效。
- [x] AC3：核心句子整行钉住；版本级联、Sizing、`spec-coherence-audit --strict` 一致 — 验证：`npm run check`
- [x] AC4：离线对比，`claude -p` 沙箱，每组 5 次：
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
    - 每个独有提交的 `git patch-id --verbatim` 都出现在 `base..D` 的提交里，并且一个 main 提交只能对应一个分支提交（按时间从旧到新配对，评审第 2 轮 H1）→ `per-commit`；
    - 否则分支总改动（`git diff base B`）的 patch-id 出现在 `base..D` 里 → `squash`；但如果分支末端的 tree 和它更早某个提交的 tree 相同（删了又加回），不按 squash 判（第 2 轮 H1）。
  - diff 选项固定：`--no-color --no-ext-diff --no-textconv --full-index --no-renames`，在仓库顶层运行（避开 `diff.relative`）；`--format='commit %H'`。
  - 二进制按 blob id 比；权限变化计入 patch-id（沙箱已验证）；子模块指针始终显示（`--ignore-submodules=none --submodule=short`）。
  - 位置确认（评审第 1 轮 H1 之后）：patch-id 不看行号，所以每个匹配都要再做一次三方合并：`git merge-tree --write-tree --merge-base=<改动的基础> <main 上对应的提交> <分支提交>`，要求无冲突，并且结果 tree 等于那个对应提交的 tree。最初用的 `git apply` 会把补丁挪到上下文能对上的别处，已弃用。合并在临时裸仓库 `claudemd-landed.XXXXXX/repo.git` 里运行：通过 alternates 借用原仓库的对象，去掉所有 `GIT_*` 环境变量，不读全局、系统和仓库配置，`-c core.attributesFile=/dev/null`，所以不读任何属性文件、不运行 merge driver（第 2 轮 M1、M2）。merge-tree 退出码大于 1 时判为 `compare-failed`，而不是“缺提交”（第 2 轮 M3）。临时目录运行后删除；超时被杀留下的，下次运行清理 10 分钟以前的，`clean-residue` 也会清理。
  - git < 2.39 没有 `--verbatim`，< 2.40 没有 `merge-tree --merge-base` → 不判。部分克隆不判（会从远端拉对象）；`remote.*.promisor` 按布尔值读，`yes`/`1` 也算（git 2.53 的部分克隆只写这一项）。
  - 历史视图（第 3 轮之后）：遍历历史、读 patch-id 都加 `--no-replace-objects`；位置确认用 `rev-list --parents` 给出的父提交（含 grafts），不用临时仓库里解析出的 `${c}^`。grafts 不能关掉：默认分支一侧的 graft 把分支提交接成 main 的祖先时，这个提交按 git 的看法就在 main 的历史里（`git log`、`git branch -d` 都这么算），即使 main 的哪棵 tree 里都没有它的改动（第 4 轮 F1，留作已知情况，写进 CHANGELOG "Not changed"）。
  - 保留时只给理由、不列提交的情况：`merge-commits`、`too-far`、`partial-clone`、`unrelated`、`shallow`（浅克隆里找不到和默认分支共同的提交：分叉点在边界外，或本来就无关）、`no-default-branch`（origin/HEAD 指向本地不存在的分支，什么都不判）、`compare-failed`（merge-tree 失败，或临时仓库建不起来；其余照常）、`patch-id-failed`。
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
- 核心 §7 Git 句子（最终）：
  - 旧："…; if `-d` refuses, keep the branch and name it under open items, never `-D`."
  - 新："…; if `-d` refuses, run the `-D` the branch-prune hook printed for that branch (its work is on the main line byte for byte) exactly as printed; with none, keep the branch and name it under open items, never a `-D` of your own."
- 取舍：
  - 判定放在 hook 而不是规则里，因为 gsd-lite 那次会话自己判断时用的是 `git cherry`（claudemd 那次只凭 cherry-pick 记录）；
  - hook 被关掉时没有命令，就回到保留的做法。

## 计划

- [x] S1：housekeeping 判定 + `refused` 子命令，先写失败的测试 — 覆盖 AC1 — 依赖：无 — 执行：主会话
- [x] S2：branch-prune.sh + hooks.json + hook 测试 — 覆盖 AC2 — 依赖：S1 — 执行：主会话
- [x] S3：核心句子、钉、规范版本、changelog、Sizing、文档 — 覆盖 AC3 — 依赖：S2 — 执行：主会话
- [x] S4：离线对比 — 覆盖 AC4 — 依赖：S3 — 执行：主会话
- [x] S5：按发版手册发布 0.116.0（2026-10-21，tag v0.116.0 → be71eb6） — 覆盖 AC5 — 依赖：S1–S4 — 执行：主会话 + release-reviewer

## 决策与进展

- 2026-10-21：用户授权按建议实现：两个触发点加规则改句全部做；"落地后被撤销"算已落地。
- 在 `release/v0.116.0` 分支上做；`next-release` 与 `main` 相同。
- 注册表原来一个 hook 只写一个事件；branch-prune 要挂在 PostToolUse 和 PostToolUseFailure 两处，所以加了可选字段 `alsoOn`，一致性测试改为核对每一处注册。
- `refused` 从 stdin 读命令（命令可能是很长的 here-doc，argv 有长度上限）。
- 成本上限定为：列表路径每次最多判定 20 个，分叉点之后最多 500 个提交（数据里最大 208）。
- 离线对比第一轮发现缺陷：squash 的情况 hook 写成"每个提交在 main 上都有副本"，这对 squash 不成立；5 次里有 4 次模型自己核对 patch-id，发现说法不对，就没执行命令。修复（11282bf，重写提交信息前为 bf8d41a）：按依据分别说明——逐提交（N 个提交各有副本）、squash（整体改动等于 main 上的哪个提交）、末端已在 main 上。修复后冻结新快照 B2，两个任务都重跑。
- 变异检验发现 `-C` 后面跟变量目录的情况没有用例覆盖，已补（6af64e0）。
- 2026-10-21 打 tag 前评审第 2 轮（28638fc..9008c6d）→ 0 Critical / 1 High / 3 Medium / 5 Low，结论"不要打 tag"。全部复现后修复（3ecbd0e）：
  - H1：分支删掉一行又加回，前两个提交落地后，第三个提交被配到第一个提交在 main 上的副本，打印出的 `-D` 会删掉它。改为一个 main 提交只对应一个分支提交；squash 路径加上"末端 tree 不等于更早提交的 tree"。代价：squash 合并的分支如果最后几个提交正好抵消前面的（加调试行再删掉），会被保留并问用户。
  - M1/M2：merge-tree 在原仓库里运行，用户和仓库的属性、merge driver 会左右合并结果，driver 还会被执行。改为在临时裸仓库里运行（见方案）。
  - M3：git 2.39 下 merge-tree 失败被当成"没有副本"。改为 `compare-failed`。
  - 评审"没查"清单里的 `promisor = yes`：实测会从远端拉对象（pack 从 4 个变成 12 个），一并修复。
  - L2（CHANGELOG 漏列 git 选项）、L3（`command cd`/`builtin cd`）、L5（三个修复没有能失败的测试）已修；L1 测试数在 CHANGELOG 里更新。
  - L4 的钩子文字部分没改：`on-main` 判定的那一行仍带"(`git patch-id --verbatim`)"，结论"字节一致"成立，只是方法说明不精确；这段文字是 B3 实测过的，改动要重新做离线对比。
  - `GIT_CONFIG_GLOBAL=/dev/null` 没有能失败的测试：`core.attributesFile=/dev/null` 已经挡住了用户属性这条路；试过 `merge.renormalize` 加 `core.autocrlf`，判定不变。
  - 评审深度已到 2 轮（发版手册：到 2 轮后问用户）。是否再派第 3 轮，由用户决定。
- 2026-10-21 用户："把剩下的做完了一起发版"。读法：做完遗留项后发版；打 tag 前按推荐再派第 3 轮评审（新代码在会执行 `-D` 的路径上，没人独立看过；多一轮的代价约 20 分钟，少一轮的风险在删除路径上）。做完的遗留项：
  - L4 钩子文字：两处"byte for byte (`git patch-id --verbatim`)"去掉括注，依据由每个分支的说明给出（7c51d7e）；用例 11、12 改为整句匹配，旧文字下 36/38。离线对比 B4（7c51d7e）通过。
  - 补查发现 `refs/replace` 漏洞：替换引用把分支末端换成 main 上那个副本的内容、父提交换成分叉点，前一个提交就从 `rev-list main..topic` 里消失，判为 per-commit 已落地（`git branch -d` 拒绝）。修复：判定的 git 调用一律加 `--no-replace-objects`（1da7aa0，先写失败用例）。当时 patch-id 仍按替换后的内容算（第 3 轮 L1 证明这会让"identical copy"不成立，d04c3b2 一并关掉）。当时对 `.git/info/grafts` 的结论"实测判为保留"以偏概全：那次的例子里两处改动上下文不同；第 3 轮 H1 用两个相同的块做出了误判（见下）。
  - 真实 git 2.39.5（Debian bookworm 容器）：与模拟一致；macOS 自带 git 只能在 CI 上查，加了只在 macOS 运行的用例（1c369da），按版本断言结果并打印版本。
  - 浅克隆：深度 1、2、4 和已落地分支的 1、2、3、5，分叉点在浅克隆边界之外时判为 unrelated 保留，深度 5 判为 landed。
  - 耗时：本仓库克隆、20 个分支各 10 个提交全部 cherry-pick，push 一次 1.29–1.69 s（10 次），0.115.0 为 0.16–0.20 s；另一批 5 次 1.52–5.06 s。超过预算（8 s，同时有 `-d` 时各 4 s）会被中止、不输出。
  - 新发现、未改（遗留）：`origin/HEAD` 指向一个本地不存在的分支时，所有候选都判为 `unrelated`，保留理由写成"it shares no history with it"，理由不对，方向安全。
  - squash 取舍保持不变（CHANGELOG "Not changed"）。
- 2026-10-21 打 tag 前评审第 3 轮（9008c6d..d453478）→ 0 Critical / 1 High / 1 Medium / 5 Low，结论"不要打 tag"。逐条核对后：
  - H1：grafts 让一个提交挂到分叉点上，它带着被藏起来的提交的改动；这个改动按 patch-id 对上了 main 上另一个相同块里的改动，而临时仓库没有 grafts，`${c}^` 解析成真实父提交，只核对了它自己那一小部分改动 → 判为 per-commit 已落地。这是第 2 轮把 merge-tree 挪进临时仓库时带进来的（9008c6d 上判为保留）。根因：遍历历史用的视图和核对改动用的视图不一致。修复：核对时用 `rev-list --parents` 给出的父提交（d04c3b2，先写失败用例，info/grafts 和 GIT_GRAFT_FILE 两种都测）。
  - L1：patch-id 按替换后的内容算，"identical copy"可能不成立 → verbatimPatchIds 也加 `--no-replace-objects`（d04c3b2，先写失败用例）。
  - M1：代码不丢 tip 的内容；CHANGELOG "Not changed" 那句写得过宽（`+A`、`+B`、`-A` 这种，最后的提交撤销了更早的提交，但 tip 没回到更早的 tree，会按 squash 判为已落地）→ 改为准确描述。hook 里的"a squash"字样不改（改 hook 文字要重做离线对比；依据"its whole change equals commit X"本身属实）。
  - L2（1da7aa0 提交说明写"Every git call"，当时 patch-id 那处没加）：d04c3b2 之后成立；不改写已推送的提交。
  - L5：README 的 clean-residue 行补上 `claudemd-landed.*`。
  - L3（剥掉 `GIT_*` 这一步没有测试）、L4（`TMPDIR` 不可用时 `refused` 崩溃、hook 不出声，方向安全，9008c6d 上也一样）：按评审修复规则 Low 默认不修，写进遗留项。
  - 评审深度：第 3 轮超过手册的 2 轮上限，又出了 High → 按规则交给用户决定（再评审一轮 / 直接发 / 暂缓）。
- 2026-10-21 用户："继续完成剩余的工作，按你的推荐执行，我授权发版……把剩下能做的工作做了一起发版"。读法：先把第 3 轮遗留项里值得做的做完，再派第 4 轮评审（范围 d453478..新 head），通过后发版。逐项：
  - L4（没有临时目录）：复现后比评审给的级别严重。`branches` 路径同样抛异常，hook 在 merge/pull/fetch/push 之后什么都不输出；0.115.0 在同样条件下仍列出已合并分支，所以这是相对 0.115.0 的回退。修复：临时仓库建不起来时不比较（`compare-failed`），其余照常（066b64b，先写失败用例）。
  - `origin/HEAD` 指向本地不存在的分支：改为 `no-default-branch`。同类的还有浅克隆：分叉点在浅克隆边界外时 merge-base 同样失败，理由同样写成"shares no history"，一并改为 `shallow`（066b64b）。三处只改变保留的理由，不会让分支变成 landed。
  - L3（剥掉 `GIT_*` 这一步没有测试）：补了 `GIT_ATTR_SOURCE` 用例（4569fc2）。去掉剥离后，一个改动不在 main 上的分支被判为 landed，用例失败。
  - 评审员留下的 worktree：干净，已用 `git worktree remove` 删除。
  - 计时伪影（gsd-lite docs/prompt-audit-shipped）：reflog 时间解析正确（毫秒和 Z 都对，与 TZ 无关，解析到 b52dadb）；两次会话的运行脚本相同；两次运行之间的代码只差一行注释；本会话之前保存的两次运行（7c51d7e、d04c3b2）都判为 landed per-commit。更早那次运行的逐行输出没有保存，原因无法再追。这一行不计入 29 个，不影响发版里的数字。
  - hook 文字只改了"没有比较"的几种理由；TC、TS 两个任务的结束状态（用脚本重建）上，7c51d7e、3fa16c8 和 066b64b 的 hook 输出逐字节相同，所以不重做离线对比。
  - 不在本次做：`session-summary` Case 15 在非 UTC 时区失败（0.115.0 就有，与本次改动无关），留作遗留项。
- 2026-10-21 打 tag 前评审第 4 轮（d453478..2cb1da2）→ 0 Critical / 0 High / 0 Medium / 5 Low，结论"没有阻塞"。逐条核对后：F1（默认分支一侧的 graft 把分支提交接成 main 的祖先，分支判为 landed）复现属实，代码不改，写进 CHANGELOG "Not changed"（理由见方案"历史视图"）；F2–F5 是文字，已修（3156bb9），claim-drift 又找到 ARCHITECTURE、RULE-HITS-SCHEMA 两处同样的说法（494852d）；占位符已填（be71eb6）。文字修复不再派新一轮评审（发版手册：文字类 Low 只做 claim-drift）。
- 2026-10-21 发版：main 快进到 be71eb6，annotated tag v0.116.0，GitHub Release 已建，PR #16 显示已合并；本地 `release/v0.116.0` 用 -d 删除，`next-release` 指到 main。第 4 轮评审员的 worktree（干净）用 `git worktree remove` 删除，分支 `worktree-agent-ae9ec2de2902c127c` 用 -d 删除。

## 验证记录

- `node --test tests/scripts/housekeeping.test.js` → 通过（63/63；新用例在实现前失败，因为导出不存在；7 个判定变异和 5 个解析变异各自被对应用例抓到）
- `bash tests/hooks/branch-prune.test.sh` → 通过（36/36；新增 16 个，实现前其中 8 个失败；5 个 hook 变异各自被抓到；bash 3.2.57 和忽略 SIGPIPE 两种条件下也是 36/36）
- `node --test tests/scripts/hook-registry.test.js` → 通过（9/9；新用例在注册前失败）
- `bash tests/hooks/contract.test.sh` → 通过（248/248；新增事件写进文档之前，C 项失败）
- `node --test tests/scripts/spec-structure.test.js` → 通过（89/89；§7 Git 整行钉、节哈希、标题清单、Recent changes 哈希都已在读过 diff 后更新）
- `node scripts/version-cascade-check.js` → 通过（v8.3 一致；Sizing 在 ±20B 内）；`node scripts/spec-coherence-audit.js --strict` → 通过（5/5，coreDelta=0，extendedDelta=0）
- 真实数据重跑（第一版实现 `refusedBranches`，按当时的 main）→ 通过：`-d` 会拒绝、后来用 `-D` 删掉的 29 个里，27 个判为已落地，2 个保留；loop-testing 现存 2 个保留（32 个、1 个提交没有副本）；gsd-lite 的 2 个在 13:24 main 快进后判为已落地（`git cherry` 全为 `-`）；每个分支 128–1215 ms
- 离线对比 A（0.115.0）→ TC 0/5 删除 fix/a、5/5 保留 fix/b、自拼 `-D` 0/10；TS 0/5 删除
- 离线对比 B（42a5214 快照，即 d4fbde7 的 tree）→ TC 5/5 通过；TS 1/5 删除（见决策：squash 文字有误）
- 离线对比 B2（11282bf 的 tree）→ TC 5/5，TS 5/5，自拼 `-D` 0/10；关闭开关 2 次：保留 2/2，注入 0 次
- 打 tag 前评审第 1 轮（4c7dc67..28638fc，两个独立评审员：代码、对外文字）→ 代码：0 Critical / 2 High / 4 Medium / 6 Low；文字：0 / 0 / 1 / 12。H1（`git apply` 挪位置）、H2（子模块被 diff 设置隐藏）、M1（注释/重定向/GIT_DIR 被当成分支名）、M2（超时留下临时目录）、M3（部分克隆会联网拉对象）、M4/文字 M1（squash 说成每个提交都有副本）和大部分 Low 已修（ef5b288、46f63c4、2d8faf8、069383b）；代码 L1（每次推送都要判定的耗时）和 L6（分支名里的反引号）写进 CHANGELOG 的"Not changed"
- 最终代码上 23 个变异：22 个各自让至少一个用例失败；不看空白的 patch-id 那个不会，因为位置确认本身会拒掉只差空白的匹配
- 真实数据（最终代码）→ 27 个已落地、2 个保留，单个分支 62–426 ms
- 离线对比 B3（2d8faf8，最终代码和文字）→ TC 5/5，TS 5/5，自拼 `-D` 0/10；A 对 B3 为 0/10 对 10/10
- 第 2 轮修复（3ecbd0e）：`node --test tests/scripts/housekeeping.test.js` → 通过（77/77；H1、M1、M2、M3、promisor、解析器的新用例在修复前失败 6 个）；`bash tests/hooks/branch-prune.test.sh` → 通过（38/38；11l 在修复前失败；对 0.115.0 的代码 12/18 失败）
- 第 2 轮变异 10 个：9 个各自让用例失败；去掉 `GIT_CONFIG_GLOBAL=/dev/null` 的那个不会（见决策）
- 评审员的复现脚本在 3ecbd0e 上：H1 → kept（1 个提交没有副本）；M1 ours/union → kept；M2 driver 没运行、仓库干净；promisor=yes → partial-clone，pack 数不变
- 真实数据（3ecbd0e）→ 29 个里 27 个已落地、2 个保留，每个分支 46–513 ms
- B3 两个任务的最终状态上，3ecbd0e 和 2d8faf8 的钩子输出逐字节相同（TC 874 字节、TS 756 字节）
- 替换引用修复（1da7aa0）：`node --test tests/scripts/housekeeping.test.js` → 修复前新用例失败（landed: topic, per-commit），修复后通过（78/78）；加上 macOS 用例后 79 个里 78 通过、1 跳过（Linux）
- macOS 用例去掉平台条件后：宿主 git 2.53 → 通过（landed）；node:20-slim 里的 git 2.39.5 → 通过（compare-failed）
- `bash tests/hooks/branch-prune.test.sh` → 通过（38/38）；换回旧钩子文字 → 36/38（11、12 失败）
- 离线对比 B4（7c51d7e）→ TC 5/5，TS 5/5，自拼 `-D` 0/10；流记录里新句子 10/10、旧括注 0/10；花费 $2.81
- 真实数据（7c51d7e）→ 29 个里 27 个已落地、2 个保留，每个分支 111–566 ms（负载 15）；两行 `-d` 计时伪影中 gsd-lite docs/prompt-audit-shipped 从保留变为 landed，0a7e8a5 的代码在同一输入上结论相同，是输入变了
- 2ae4944 上：`TZ=UTC npm run check` → 通过（node 1679/1681，2 个跳过；全部 shell 套件）；忽略 SIGPIPE → 通过（同上）；`TZ=UTC` bash 3.2.57 → 通过（44/44；不设 TZ 时 session-summary Case 15 失败，与 0.115.0 相同）；`npm run smoke` → 通过（2/2）
- 第 4 轮前的修复（4569fc2、066b64b）：`node --test tests/scripts/housekeeping.test.js` → 修复前新用例失败 2 个（mkdtemp `ENOENT`；`unrelated` 不等于 `shallow`），修复后通过（83/84，1 个跳过为 macOS 用例）；`bash tests/hooks/branch-prune.test.sh` → 修复前 37/41（11l、11m、11n、12b 失败），修复后 41/41；对 0.115.0 的代码 27/41（新增 21 项里 14 项失败，12b 通过）
- 变异：去掉默认分支检查、去掉浅克隆检查，各自让 housekeeping 用例失败；去掉 `GIT_*` 剥离，`GIT_ATTR_SOURCE` 用例失败（判为 landed）
- 真实数据（066b64b）→ 29 个里 27 个已落地、2 个保留，35 行判定都与 d04c3b2 相同，每个分支 85–642 ms（负载 4）
- TC、TS 结束状态（脚本重建）上的 hook 输出：3fa16c8 对 066b64b 逐字节相同（943、823 字节），7c51d7e 对 066b64b 逐字节相同（945、825 字节）。两次重建放在不同的目录（`abw`、`abw2`），输出里含两次仓库路径，所以第二次每个多 2 字节；每次比较的两边用的是同一个重建
- 066b64b 上：`TZ=UTC npm run check` → 通过（node 1684/1686，2 个跳过；全部 shell 套件）；忽略 SIGPIPE → 通过（同上）；`TZ=UTC` bash 3.2.57 → 通过（44/44）；`npm run smoke` → 通过（2/2）；跑完后工作树干净
- be71eb6 上：`TZ=UTC npm run check` → 通过（node 1684/1686，2 个跳过；全部 shell 套件）；PR CI run 39683406086 → 通过（7/7）
- 发版后：main 推送的 ci（run 39685622762）→ 通过；tag 的 ci（run 39685626225）→ 通过（7/7）；npm-publish（run 39685626307）→ 通过（publish 成功）；`npm view claudemd-cli dist-tags.latest` → 0.116.0（22:49:57Z），gitHead be71eb6
