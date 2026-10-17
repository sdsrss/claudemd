# 0.111.0 发版后的遗留项
状态：已完成

代码部分已在 `next-release` 完成；发版等 2026-10-26 之后与延后批次一起。

## 背景与目标

- 0.111.0（2026-10-17 发布）的汇报留下三类遗留：延后项 D#390 / D#391 / D#392；评审后决定不改的四处；积压清单里需要设计取舍的 P2（`.converge/BACKLOG.md` 第 18/19 轮一节）。
- 使用者 2026-10-17：能做的做掉；需要拍板的由我判断、给出建议并照建议执行。
- 目标：每一项要么修掉（先写失败的测试），要么写明不改的理由和依据，不留"待定"。

## 范围与决定

### 已修（`next-release`，各一个提交）

| 项 | 提交 | 改前的失败 |
|---|---|---|
| D#392 卸载无清单时的归属判断收窄 | 76e8e95 | `#\nAI-CODING-SPEC …` 等三种首行、引用的模块标题被当成 claudemd 的文件删掉 |
| D#391 记忆闸门按 Claude Code 的 git 根找 MEMORY.md | ace4f66 | 从子目录或 linked worktree 启动的会话放行 / 无提示 |
| 事件分类闸门看得见 `&&` 之后的 `hook_record` | f8f8e92 | 新增对照项 `ledger-inject` 在旧正则下找不到 |
| session-summary 用 jq 算窗口起点 | 26561d0 | busybox `date` 没有"24 小时前"的写法，24 h 回退从 1970 起算，整份日志按"last 24 h"计数 |
| sparkline 趋势箭头加精确检验 | 3c06102 | 3 对 1 判 ↗；37 天日志里 4 次安装日事件判 ↘ |
| toggle 读项目级 settings | 9409ca7 | 项目 `EVIDENCE_GATE=1` 压在用户级 "0" 上时提示"未启用"；项目级 kill switch、`DISABLE_CLAUDEMD_HOOKS=1` 不提示 |

### 决定（各项的理由）

- **D#391 用"镜像 Claude Code"，不用"起始目录找不到再回退"。** 依据：文档（memory 页："all worktrees and subdirectories within the same repo share one auto memory directory"）与 2.1.302 二进制（`defaultKey` → 向上找最近的 `.git`，worktree 经 `commondir` 到主仓库，并核对 admin 目录的 `gitdir` 回指）。两种做法只在子目录自带一份旧 `memory/` 时不同，那份不是 Claude Code 加载的。本机 8 个会话起始目录全部解析回自身，0 个判定改变。
- **sparkline 用双侧 5% 的两 Poisson 率精确条件检验，并保留 ±20% 与覆盖下限。** 依据：箭头原先只看比率，与样本量无关；检验在给定总数 n 时把近期桶计数视为 Binomial(n, t_近/(t_近+t_基))。事件按会话聚集，违反 Poisson 独立性，检验仍偏乐观，所以只会去掉旧规则画的箭头，不会新增。本机日志：30/60/90 窗口 14 行中 4 行、7/14/28 窗口 14 行中 5 行由箭头变 ≈。
- **toggle 只读项目的两个 settings 文件，不改 `/claudemd-status`。** status 的 `persisted` 列定义就是 `~/.claude/settings.json` 的内容，按其定义不算错；它的"下个会话生效"说法与文档（保存后运行中的会话即应用新值，删除要到下次启动）不完全一致，列为遗留。——第二轮改判：status 也改读分层后的值（0efe721，D#402），见下文第二轮。
- **不改：`install` 在 CLAUDE.md 是规范时覆盖用户手写的 OPERATOR.md。** 需要用户在装好之后，在 claudemd 自己的文件名上写一份自己的文件；副本进 `spec-backup-`。三种修法（个人备份、保留原文件、只换名）都会与 restore 取最新备份、清单路径删除四个规范文件的规则相互影响，风险高于收益。
- **不改：24 h 摘要可能是几天前写的，仍标"last 24 h"。** "since last turn" 同样指上一个会话的最后一轮，可能也是几天前；R11-33 定这个标签时已接受。加日期等于改模型可见的横幅文案，收益小。busybox 下 24 h 回退的起点回落 1970 的部分已修（26561d0；busybox `date` 接受 `-d @N`，没有"24 小时前"的写法，所以只有回退那一支坏了，发版前评审指出）。
- **不改：0.110.0 写的摘要没有 `window` 时标"since last turn"。** 每台升级的机器出现一次，下一次 Stop 覆盖；旧字段（`ts − since`）区分不出两种窗口（`date` 与 jq 的 `now` 之间可差 1 秒，轮窗口也可能长于 24 h）。
- **不改：session-end-check 在 `$HOME` 下建 `~/tasks/`。** 规范 §11 把检查点放在项目的 `tasks/<slug>-paused.md`，项目是 `$HOME` 时就是 `~/tasks/`。本机两代日志 60 个检查点：60 个在项目根，0 个在 `$HOME`。
- **不改：检查点写在事件 cwd 下、SessionStart 从起始目录读。** 改成 `CLAUDE_PROJECT_DIR` 试过（已撤回）：项目根不可写而 cwd 可写时会在 `mkdir` 处静默退出（case 28a 用 `CLAUDE_PROJECT_DIR=/` 暴露了这一点）；同一份 60 个检查点里 0 个两者不同。
- **不改（维持 0.111.0 评审的决定，理由已在 CHANGELOG）：** 规范文件尾部追加笔记时删除或还原仍当作规范；状态文件名的数字后缀也匹配带日期的副本；卸载命令描述仍列环境变量（描述是 LLM 可见元数据，改它按 L3，且内容属实）。
- **延后到下一次规范发版：** `spec/OPERATOR.md:18` 的 "0 hits in 30d" 应为按 `hits.fired` 计的发声次数（0.111.0 起降级名单读它）。只改规范文本，跟下一次规范改动一起走版本级联。
- **延后到 2026-10-26 之后：** D#390（`verify-cmd.sh` 两处口径）与 `evidence-gate` `DONE_RE` 行中 "Migration Done" 不再算完成声明。`tasks/g1b-g2-eval/PREREG.md` 与 lang-drift 的窗口要求 `verify-cmd.sh` 0 字节变化。

## 发版

- ~~不现在发，等 10-26 之后。~~ 2026-10-17 第二轮改判：这条的前提已经不成立。两份 PREREG 在 2026-10-16T09:04Z 的修订里已把分析段截止在 0.109.0 暴露时刻并读完（`tasks/g1b-g2-eval/RESULT-2026-10-16.md`、`tasks/lang-drift/RESULT-2026-10-16.md`），0.109.1、0.111.0 的附记也写明之后的版本不进入已截止的分析段；D#57 的窗口同样已结束（`RESULT.md`）；其余 PREREG（r4a/r4c/r5/r6a/r6b）都是离线回放，没有在跑的窗口。所以原定"10-26 之后"的批次（D#213、D#288、D#301、D#390，加同一闸门的 D#342）现在就做，和本文件上表的六项一起发 0.112.0。
- ~~下一版 PREREG 修订要写：hook-common.sh 只新增三个函数（+72 行），evidence-gate 与 verify-cmd.sh 未变。~~ 第一轮时如此；第二轮又改了 evidence-gate（D#288、D#342）、verify-cmd（D#390）和 hook-common（D#213、D#301 及评审修复）。两份 PREREG 的附记按发版头的实际 diff 写（打 tag 后在标签上复核）。
- CHANGELOG 要写的用户可见变化：卸载无清单时归属判断更窄（只会多保留文件）；子目录 / worktree 启动的会话开始受记忆闸门约束（放行 → 拦截方向）；sparkline 箭头更少；toggle 多两种提示；busybox 上摘要计数正确。

## 第二轮（2026-10-17，`release/v0.112.0`）

| 项 | 提交 | 改前的失败 |
|---|---|---|
| D#288 evidence-gate 两处 DONE 检查、verify-log 失败检查改为进程替换 | d9d9e7c | 用例 32：Done 标签后跟 175,690 字节，默认与忽略 SIGPIPE 下都静默 |
| D#342 "not run" 豁免与 locale 无关 | 17f35a8 | 用例 33：UTF-8 locale 下 `→ not run原因` 触发 |
| D#390 verify-cmd 认 `bash tests/`、`OVERALL:`、"N suite(s) failed" | 5c82c90 | verify-log 11：两条失败行记成通过；evidence-gate 34/34b 触发 |
| D#213 源码加载时的四段程序改为单引号字面量 | 529325b | bash 3.2 + 不可写临时文件：banned-vocab 26n 放行 |
| ~~D#301 `cat > F` / `cat >> F` 不算读~~ 已退回（655f1f1），重开为 D#420 | 7a85cfa | 两个新用例读成 YES |
| D#401 doctor / analyze 按 git 根找 MEMORY.md | 569aa08 | 子目录下 no-index |
| D#402 toggle 重新启用时提示需重启；status 读项目层 | 0efe721 | 两个新用例 |

决定：
- ~~**D#301 只修写入目标一类。**~~ 发版前评审两轮在这一组件上共 5 条发现（第 2 轮 M1：构造的 81 KB 命令、3 个记忆文件，bash 3.2 下 3.4–4.2 s，超过 3 s 时限即放行；0.111.0 为 1.9 s），整组退回到 0.111.0 的字节（655f1f1），写入目标两行改为断言今天行为的 RESIDUAL，D#420 跟进。原记录： 714 条点名记忆文件的 Bash 命令里，D#301 点名的两种（heredoc 正文、`>/dev/null`）0 次，读后重定向到别处 0 次，写入目标 43 段。回看窗口限 64 个字符：整段前缀去尾空白是 O(n·k)，60 KB 一行 1.5 s → 18.9 s。
- **D#342 只修 locale 一半。** 1,967 个轮末里 9 处英文 "not run" 都是讨论本钩子或诚实的部分说明，不要求判定形状。
- **D#403 并入 D#349。** E4 行 300 次：298 次拒，2 次 rc=134、stderr `*** stack smashing detected ***`，是 bash 5.3.9 自身中止，不是该行要测的管道竞态。
- **D#213 的 §8 闸门部分**：`REVSH_HEREDOC_AWK` 取值 sha256 不变；另对 15,518 条带 `<<` 的真实命令做了 main 对发布分支的回放：两版都是 13,963 放行、1,555 拒绝，判定翻转 0，输出字节差异 0。
- 新增延后 D#404：分支切换的 `git checkout` 被 session-end-check 当成 17 处未验证的修改（本任务上一会话的检查点就是这样来的）。
- 仍延后：D#399（规范文本，随下一次规范发版）。

## 遗留

- ~~JS 侧同一类路径（D#401）~~、~~`/claudemd-status` 不读项目级 settings（D#402）~~：第二轮已修，见上表。
- `autoMemoryDirectory` 设置会改 Claude Code 的记忆目录，两个记忆闸门不读它（与改动前相同）。

## 验收

- [x] AC1：六项修复各有改前失败的测试，改后通过（提交说明里写明失败现象）
- [x] AC2：`npm run check` exit 0，`BASH32_BIN` 指向构建的 bash 3.2.57
- [x] AC3：`( trap '' PIPE; npm run check )` exit 0
- [x] AC4：`npm run smoke` 通过
- [x] AC5：0.112.0 发版：PREREG 附记（两份，标签上复核）、CHANGELOG 条目、预发评审两轮、附注 tag v0.112.0（161ad76）、GitHub 发布、npm `claudemd-cli@0.112.0`（15:11:54Z）；tag 的 ci 7/7、npm-publish 含 publish 全绿

## 验证记录

- 各提交的定向测试与改前失败写在提交说明里。
- 第一轮全量，在 2b48bfe 的代码树上（9027ef8 是本文件的一个已被改写的旧提交，代码与 2b48bfe 相同）：
  - `BASH32_BIN=<构建的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 npm run check` → exit 0：node 1,532 条中 1,531 通过、1 条跳过（`SHFMT` 未设）；44 个 hook 套件也在 bash 3.2 下执行 hook，全部通过；shellcheck 94 个文件无告警。第一次运行失败 1 条（本文件状态行不在允许值里，已改）。
  - `( trap '' PIPE; npm run check )` → 第一次 exit 1：`pre-bash-safety` 的 E4 行（150 KB 命令首行的逃生令牌，断言为已知误报 deny）这次读成 allow。单独复现：本分支 70 次里 69 次 deny、1 次空输出（默认 SIGPIPE），`v0.111.0` 70/70 deny，单侧 Fisher p = 0.5；本批没改 `pre-bash-safety`，`hook-common.sh` 新增的函数它不调用。该套件单独在忽略 SIGPIPE 下重跑 1153/1153；全量重跑 → exit 0（1,531 通过、1 跳过）。偶发记为 D#403。
  - `npm run smoke` → exit 0，2/2。
- 第二轮与发版（`release/v0.112.0`）：
  - 555480f 加版本号与 CHANGELOG：`BASH32_BIN=<3.2.57> CLAUDEMD_BASH32_REQUIRED=1 npm run check` → exit 0（node 1,546 条中 1,545 通过、1 跳过；bash 2,374/2,374；44 个 shell 套件，40 个 hook、4 个集成，在 bash 3.2 下全部通过；shellcheck 94 个文件无告警）；忽略 SIGPIPE 同样 exit 0；`npm run smoke` 2/2。第一次全量失败 3 条 node 用例，都由新的 memory-root.test.js 引起，555480f 已修。
  - PR CI 第一次（run 39029952035）macOS 两处红：banned-vocab 26n（内建命令写文件失败后字节漏到 stdout；e0f5c5a 曾修，后退回，见下）、memory-read-check 66（夹具逻辑路径对 git 的物理路径，eeb3cc5）。f4fb752：本地全量 exit 0，CI run 39031306082 七个任务全绿。
  - 打 tag 前评审第 1 轮（两位，范围 1a2ab6c..f26a672）：0 Critical、0 High、2 Medium、24 Low；修复与说明见各提交与 CHANGELOG。
  - 第 1 轮修复后（e0f5c5a 起）：e0f5c5a 的子 shell 写入只改了约 21 处中的 5 处，源码检查漏掉带 `2>/dev/null` 的行（第 2 轮 High）；整组退回（1c73a64），泄漏记为 D#421，26n 改为不写日志。
  - 打 tag 前评审第 2 轮（一位，范围 f26a672..c047dcb）：0 Critical、1 High、1 Medium、7 Low。High 与 Medium 所在的两个组件退回到 0.111.0 的字节；其余为文字。
  - 150 KB 行上 bash 5.3.9 的 "stack smashing" 中止（D#349）：0.111.0 树 2/600，c047dcb 21/1200；c047dcb 换回旧 rule-hits.sh 6/600 对原样 7/600，子 shell 不是原因。其余对照见 CHANGELOG。
