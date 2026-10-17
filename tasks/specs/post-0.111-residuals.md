# 0.111.0 发版后的遗留项
状态：进行中

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
| session-summary 用 jq 算窗口起点 | 26561d0 | `date` 不可用（busybox）时整份日志按"last 24 h"计数 |
| sparkline 趋势箭头加精确检验 | 3c06102 | 3 对 1 判 ↗；37 天日志里 4 次安装日事件判 ↘ |
| toggle 读项目级 settings | 9409ca7 | 项目 `EVIDENCE_GATE=1` 压在用户级 "0" 上时提示"未启用"；项目级 kill switch、`DISABLE_CLAUDEMD_HOOKS=1` 不提示 |

### 决定（各项的理由）

- **D#391 用"镜像 Claude Code"，不用"起始目录找不到再回退"。** 依据：文档（memory 页："all worktrees and subdirectories within the same repo share one auto memory directory"）与 2.1.302 二进制（`defaultKey` → 向上找最近的 `.git`，worktree 经 `commondir` 到主仓库，并核对 admin 目录的 `gitdir` 回指）。两种做法只在子目录自带一份旧 `memory/` 时不同，那份不是 Claude Code 加载的。本机 8 个会话起始目录全部解析回自身，0 个判定改变。
- **sparkline 用双侧 5% 的两 Poisson 率精确条件检验，并保留 ±20% 与覆盖下限。** 依据：箭头原先只看比率，与样本量无关；检验在给定总数 n 时把近期桶计数视为 Binomial(n, t_近/(t_近+t_基))。事件按会话聚集，违反 Poisson 独立性，检验仍偏乐观，所以只会去掉旧规则画的箭头，不会新增。本机日志：30/60/90 窗口 14 行中 4 行、7/14/28 窗口 14 行中 5 行由箭头变 ≈。
- **toggle 只读项目的两个 settings 文件，不改 `/claudemd-status`。** status 的 `persisted` 列定义就是 `~/.claude/settings.json` 的内容，按其定义不算错；它的"下个会话生效"说法与文档（保存后运行中的会话即应用新值，删除要到下次启动）不完全一致，列为遗留。
- **不改：`install` 在 CLAUDE.md 是规范时覆盖用户手写的 OPERATOR.md。** 需要用户在装好之后，在 claudemd 自己的文件名上写一份自己的文件；副本进 `spec-backup-`。三种修法（个人备份、保留原文件、只换名）都会与 restore 取最新备份、清单路径删除四个规范文件的规则相互影响，风险高于收益。
- **不改：24 h 摘要可能是几天前写的，仍标"last 24 h"。** "since last turn" 同样指上一个会话的最后一轮，可能也是几天前；R11-33 定这个标签时已接受。加日期等于改模型可见的横幅文案，收益小。busybox 下窗口起点回落 1970 的部分已修（26561d0）。
- **不改：0.110.0 写的摘要没有 `window` 时标"since last turn"。** 每台升级的机器出现一次，下一次 Stop 覆盖；旧字段（`ts − since`）区分不出两种窗口（`date` 与 jq 的 `now` 之间可差 1 秒，轮窗口也可能长于 24 h）。
- **不改：session-end-check 在 `$HOME` 下建 `~/tasks/`。** 规范 §11 把检查点放在项目的 `tasks/<slug>-paused.md`，项目是 `$HOME` 时就是 `~/tasks/`。本机两代日志 60 个检查点：60 个在项目根，0 个在 `$HOME`。
- **不改：检查点写在事件 cwd 下、SessionStart 从起始目录读。** 改成 `CLAUDE_PROJECT_DIR` 试过（已撤回）：项目根不可写而 cwd 可写时会在 `mkdir` 处静默退出（case 28a 用 `CLAUDE_PROJECT_DIR=/` 暴露了这一点）；同一份 60 个检查点里 0 个两者不同。
- **不改（维持 0.111.0 评审的决定，理由已在 CHANGELOG）：** 规范文件尾部追加笔记时删除或还原仍当作规范；状态文件名的数字后缀也匹配带日期的副本；卸载命令描述仍列环境变量（描述是 LLM 可见元数据，改它按 L3，且内容属实）。
- **延后到下一次规范发版：** `spec/OPERATOR.md:18` 的 "0 hits in 30d" 应为按 `hits.fired` 计的发声次数（0.111.0 起降级名单读它）。只改规范文本，跟下一次规范改动一起走版本级联。
- **延后到 2026-10-26 之后：** D#390（`verify-cmd.sh` 两处口径）与 `evidence-gate` `DONE_RE` 行中 "Migration Done" 不再算完成声明。`tasks/g1b-g2-eval/PREREG.md` 与 lang-drift 的窗口要求 `verify-cmd.sh` 0 字节变化。

## 发版

- 不现在发。D#305 已定下一版 = `next-release` + 10-26 之后的批次（D#213、D#288、D#301，现加 D#390）；这批修复没有一条是紧急的（真实发生次数见上表各提交说明），现在发会在两个 PREREG 窗口内再切一段。
- 下一版 PREREG 修订要写：`git diff v0.111.0..<头> -- hooks/lib/hook-common.sh` 只新增 `hook_memory_root`、`_hook_worktree_main`、`_hook_trim_into` 三个函数（+72 行），调用方只有 `memory-read-check.sh`、`memory-prompt-hint.sh`；`evidence-gate`、`rework-breaker`、`reply-language-check`、`cross-repo-write-check`、`verify-cmd.sh`、`sampling-audit.js`、`spec/` 未变。
- CHANGELOG 要写的用户可见变化：卸载无清单时归属判断更窄（只会多保留文件）；子目录 / worktree 启动的会话开始受记忆闸门约束（放行 → 拦截方向）；sparkline 箭头更少；toggle 多两种提示；busybox 上摘要计数正确。

## 遗留

- JS 侧同一类路径：`doctor` 的记忆维护（`memoryMaintenance()` 用 `process.cwd()`）与 `/claudemd-analyze`（`spec-coherence-audit --project` 默认 cwd）从子目录运行时找不到 MEMORY.md，只会报 "no-index" 跳过。
- `/claudemd-status` 不读项目级 settings；"toggle 下个会话生效"的说法与文档不完全一致。
- `autoMemoryDirectory` 设置会改 Claude Code 的记忆目录，两个记忆闸门不读它（与改动前相同）。

## 验收

- [x] AC1：六项修复各有改前失败的测试，改后通过（提交说明里写明失败现象）
- [x] AC2：`npm run check` exit 0，`BASH32_BIN` 指向构建的 bash 3.2.57
- [x] AC3：`( trap '' PIPE; npm run check )` exit 0
- [x] AC4：`npm run smoke` 通过
- [ ] AC5：下一版（2026-10-26 之后）发版：PREREG 修订、CHANGELOG 条目、预发评审

## 验证记录

- 各提交的定向测试与改前失败写在提交说明里。
- 全量，在 9027ef8 之前的同一棵代码树上（之后只改本文件）：
  - `BASH32_BIN=<构建的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 npm run check` → exit 0：node 1,532 条中 1,531 通过、1 条跳过（`SHFMT` 未设）；44 个 hook 套件也在 bash 3.2 下执行 hook，全部通过；shellcheck 94 个文件无告警。第一次运行失败 1 条（本文件状态行不在允许值里，已改）。
  - `( trap '' PIPE; npm run check )` → 第一次 exit 1：`pre-bash-safety` 的 E4 行（150 KB 命令首行的逃生令牌，断言为已知误报 deny）这次读成 allow。单独复现：本分支 70 次里 69 次 deny、1 次空输出（默认 SIGPIPE），`v0.111.0` 70/70 deny，单侧 Fisher p = 0.5；本批没改 `pre-bash-safety`，`hook-common.sh` 新增的函数它不调用。该套件单独在忽略 SIGPIPE 下重跑 1153/1153；全量重跑 → exit 0（1,531 通过、1 跳过）。偶发记为 D#403。
  - `npm run smoke` → exit 0，2/2。
