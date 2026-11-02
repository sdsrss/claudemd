# 0.117.7：D#652 发版，与剩余工作的分拣

状态：进行中

## 背景与目标

- 2026-11-02 盘点（0.117.6 发版、D#652 提交在本地 `next-release` 之后）列出了剩余工作。使用者回复"剩下的工作你先深入思考，给出科学准确的建议，然后按你的建议执行，剩下的工作做完了一起发版"。
- 本文件记每一项的判断和依据，以及 0.117.7 的发版记录。D#652 本身的设计与验证见 `tasks/specs/d652-2026-11-02.md`。

## 范围

- 做：0.117.7 只带 D#652（4941a98、ebac656、75b5c12）、五处版本号和 CHANGELOG；本机记账（两份 PREREG 记 0.117.6 的 T0，删掉误报的检查点）；本机 `~/.claude/settings.json` 的三个开关（使用者授权，见决策 4）。
- 不做：决策 5 到 8 列出的四项，各有依据；`hooks/`、`spec/` 不动（spec 仍是 v8.3.1）。

## 计划

- [x] S1：本机记账（两份 PREREG 的 T0、检查点、三个开关）— 决策 2 到 4
- [x] S2：五处版本号、CHANGELOG 条目（单独扫描通过）
- [x] S3：release 分支上 `npm run check`、`npm run smoke` 通过（48af4d5）
- [ ] S4：草稿 PR 的 CI 全绿
- [ ] S5：发版前评审（新开的评审代理），修复轮
- [ ] S6：合入 `main`、带注释的 tag、GitHub Release；两条 tag 工作流、`npm view`、`_npmUser`

## 决策与进展

1. **D#652 随本批发版。** 改动、测试与变异检验在设计记录里；发版前在 release 分支上重跑 `npm run check` 与 `npm run smoke`。
2. **两份 PREREG 记 0.117.6 的 T0。** 安装于 2026-11-02T12:41:06Z（`installed_plugins.json`，gitCommitSha 57fd12a），安装之后第一条 `hook_version=0.117.6` 的行在 2026-11-02T12:42:26Z（`session-start` `bootstrap`，本项目，会话 e013a185）；0.117.5 的行 0 条（三份轮转日志合计），本机未暴露，PREREG 里已写。
3. **检查点不是误报；`session-end-check.sh` 不改。** 检查点列的唯一一项是 `tasks/specs/d652-2026-11-02.md`：上一会话跑完 `npm run check` 之后，12:56:27Z 把状态行改成 `状态：已完成（提交在本地 next-release，未推送）`，12:56:38Z 提交进 75b5c12，12:57:03Z 切回 `main`。盘点时按"提交之后切分支"把它判成误报并删掉了检查点；本批在 release 分支上跑 `npm run check`，`spec-status-drift` 的 "every tracked spec carries a known status" 失败（状态值后面带了括号文字，判定只认单独的值），正是这次未验证的改动。改成 `状态：已完成` 后通过。D#433 把结束时不在工作树里的文件留作未验证（`hooks/session-end-check.sh` 第 288–290 行），这一次留对了。频率：带 D#433 的版本（v0.113.1 起）全机 6 次告警（三份轮转日志的 `session-end-check` `warn` 行）；按各会话转录核对，只有这一次在提交后切了分支，另外 5 次最后都没有切分支。不放宽这条判定。
4. **本机开关：保留 `REPLY_LANGUAGE_CHECK`，删去 `EVIDENCE_GATE`、`REWORK_BREAKER`、`CROSS_REPO_WRITE`。** 2026-11-02T13:16:18Z 执行，只删这三个 `env` 键（diff 3 行），备份 `~/.claude/settings.json.claudemd-backup-20261102T131618Z`（install 的设置备份命名，随保留 5 份的规则轮换）。依据：
   - reply-language：`tasks/lang-drift/RESULT-2026-10-16.md` 误报 0/83、服从 83/83，两条门槛都达到。
   - evidence-gate：`tasks/specs/wtree-evidence.md` r2 盲标，可判定的 29 次触发里"声称代码完成而未验证"0 次；`EVIDENCE_GATE_DELIVER` 未开，提示只到 stderr（使用者看得到、模型看不到）。0.109.0 暴露之后 53 次 `evidence-advisory`。
   - rework-breaker：`tasks/g1b-g2-eval/RESULT-2026-10-16.md` G2-M2 22/49 对基线 35/77（p = 0.48），未检测到下降；R6(b) 夹具 30 次里触发 1 次。0.109.0 暴露之后向模型注入 245 次 `rework-advisory`，没有测到的收益。
   - cross-repo-write：`tasks/specs/cross-repo-write.md` r9，37 天 4 次命中，全是授权的子代理工作，0 次未授权写入，评估已结束。
   - 后果：`tasks/g1b-g2-eval/PREREG.md` 从此在本机没有新数据，已写明"以后的版本不再在本文件追加附记"；`tasks/lang-drift/PREREG.md` 照旧追加。已在运行的会话读的是启动时的环境，会继续写这些行直到退出。恢复：把三个键加回 `env`，或从备份拷回。
5. **evidence-gate 的声明检测不重做。** 误报主要来自声明检测（r2），但 R4(a) 测得本机真实代码回合里 Iron Law #2 违规 0/50（95% 上限约 6%），重做后能拦到的真阳性很少；本机开关也已关闭，没有新数据可标。出现真实违规样本时再开。
6. **restore 被空目录或只有 `hooks/` 的目录挡住：不改。** 当前代码不再写只有 `hooks/` 的 `backup-` 目录（手装 hook 的迁移用自己的 `handhook-backup-` 命名空间，audit-2026-08-22 P1-1）；没有现存文件时 install 走 `fresh`，不建备份（`scripts/install.js` `existing.length === 0`）。空目录只在一种情况下留下：install 先 `reserveBackupDir` 建目录、再把文件移进去（`scripts/install.js` 第 621、636 行），中途被停（bootstrap 4s/10s 的 SIGKILL）或文件在这之间消失，目录就是空的（发版前评审 L5 指出原稿写成"不再产生"）。失败是可见的：uninstall 报 `warning: "restore-empty"`、退出码 3（`scripts/uninstall.js`），个人备份仍在原处。本机没有任何 `backup-*` 目录。
7. **prune 按 `.orphaned_at` 的内容计时、Claude Code 按 mtime：不改。** Claude Code 写入时内容就是 `Date.now()`，两者一致；只有第三方程序改写该文件时才会分开，没有观察到。
8. **D#656（技能复扫）：不在本批。** 42/62，下一份快照 2026-11-30 前存；它自己的记录写明没有决策在等它。

- 2026-11-02T13:40Z 进度：分支已推送、草稿 PR #30 已开，PR CI run 41454835050 与发版前评审（新开的评审代理，范围 57fd12a..48af4d5）在跑；下一步是读评审报告、修复，然后 S6。

9. **发版前评审（新开的评审代理，57fd12a..48af4d5）：Critical 0、High 0、Medium 1、Low 8。** 逐条对照代码核实后：
   - M1（把 `some` 换成 `every` 的变异体能通过全部用例；本机就有空的 `.in_use/` 和同一目录里死活记录混杂的情况）：补 D#652.6，在该变异体下它是唯一失败的用例。
   - L2（文字把"按 procStart 判定"写窄了）、L3（注释声称与 Claude Code 一致：2.1.316 把 kill 的任何错误都算死，读不出的条目、10 分钟内的 `.tmp.` 条目算活，只读一定大小以内的普通文件；二进制里能找到 `who=600000`、"treating it as live"、`isFile()&&size<=` 这几处）、L4（版本目录是符号链接时，记录写在 `~/.claude/plugins/.in_use-links/`）、L5（install 被停在建目录和移入文件之间时，会留下空的 `backup-` 目录）、L6（"从不删除记录"：删目录时记录跟着一起删了）、L7（"2.1.309–2.1.316"读起来像一个版本区间）：改 CHANGELOG、`cache-prune.js` 的注释（diff 只动注释）、决策 6 和 legacy 笔记。已推送的提交信息（4941a98）不改，以 CHANGELOG 为准。
   - L1（`.in_use/` 里放一个 FIFO 会让 prune 卡住）：不修，在 CHANGELOG 的 Not changed 里写明。Claude Code 只写普通文件，评审说明这是它自己构造的输入；核心规范 §1 写了"不为不可能发生的情况加防御"。
   - L8（comm 里 `)` 的解析没有测试）、L9（"EPERM 算死"的变异体只有非 root 运行时才会被抓到）：不修。真实的 comm 是 `claude`，不含空格；GitHub runner 不以 root 运行。
   - 修复只有测试和文字，按 runbook 第 7 步跑 claim-drift，不再开第二轮评审。

## 验证记录

- `jq` 查 `installed_plugins.json` 与三份轮转日志 → 0.117.6 安装 12:41:06Z，第一条行 12:42:26Z；0.117.5 0 行。
- `diff` 新旧 `settings.json` → 只少三个键；写入后 `jq -e .env` 通过，`env` 只剩 `CLAUDE_MEM_METRICS`、`REPLY_LANGUAGE_CHECK`。
- `git diff v0.117.6..HEAD -- hooks spec` → 0 行。
- `node scripts/version-cascade-check.js` → `plugin semver 0.117.7 consistent across 5 site(s)`。
- 48af4d5 上 `npm run check` → 通过（退出码 0；node 1759 条：1756 通过、3 跳过；shell 套件全部通过）。第一次在 8e37b54 之前的树上跑 → 失败 1 条（`every tracked spec carries a known status`，D#652 设计记录的状态行），第二次 → 失败 1 条（本文件缺 `- [ ]` 清单）；两处修好后通过。
- 48af4d5 上 `npm run smoke` → 通过（2/2）。
