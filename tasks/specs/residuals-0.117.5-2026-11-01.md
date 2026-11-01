# 0.117.5：评审遗留攒批（doctor 关闭开关下的建议、四处命令页、两项评估收尾）

状态：进行中

## 背景与目标

- 2026-11-01 盘点（0.117.4 发版后）列出了剩余的有价值工作。使用者回复"剩下的工作按你的建议实施，做完了发版"。
- 盘点建议：R3 指纹与 evidence-gate 判定的对比（先快照日志，再盲标分歧样本）；cross-repo-write 按现有 4 条提示读结果、结束评估、默认保持关闭；四处命令页文字缺口攒成一次纯文字发版；复核 0.117.1 那条未核实的遗留；`git fetch --prune`；以后把评审遗留攒在 `next-release` 上再发版，不每条单独打补丁版本。

## 范围

- 做：`scripts/doctor.js`（`CLAUDEMD_NO_STATUSLINE=1` 下 statusline 行的修复建议）；`commands/claudemd-install.md` 两处、`commands/claudemd-uninstall.md` 两处、`commands/claudemd-doctor.md` 一处（模型可见文本，只把与代码不符或缺失的事实写对）；对应测试；`tasks/specs/cross-repo-write.md`、`tasks/specs/wtree-evidence.md` 记下评估结果；CHANGELOG；发 0.117.5。
- 不做：`DISABLE_RULE_HITS_LOG=1` 下无标记旧目录仍会被删（0.117.4 遗留，需要另一种存活信号）；restore 是否跳过 0.68.3 以前的 spec-only 备份（0.116.5 留给使用者的选择，本次只把页面写对）；改 `~/.claude/settings.json` 里的本机开关（§5 hard，使用者的设置）；重做 evidence-gate 的声明检测；D#598；`hooks/`、`spec/` 不动。

## 验收标准

- [ ] AC1：`CLAUDEMD_NO_STATUSLINE=1` 下，renderer 过期或缺失时（自己的槽位、注册的 guest、宿主用 `_previous` 运行），statusline 行建议 `/claudemd-statusline`，不再写 "run /claudemd-install"；照旧建议跑 install.js 后行仍是红的，照新建议跑 `adopt --empty-only` 后变绿。验证：`node --test tests/scripts/doctor.test.js`（4 条新用例；修复前 3 条失败，第 4 条是后补的状态；变异体 4/4 失败）。
- [ ] AC2：四处命令页的新句子与代码一致：`cachePruned.held` 及其两种 `reason`；restore 跳过较新的 spec-only 备份并列入 `skippedSpecOnly`；doctor 的 `advisory: true` 不计入退出码。验证：`node --test tests/scripts/command-page-behaviour.test.js`（3 条新用例在旧页面上失败）。
- [ ] AC3：两项评估的结论写进已跟踪的设计记录，数字可由本地材料复算。验证：`node tasks/r3-wtree-eval/analyze.mjs` 的输出与 `tasks/specs/wtree-evidence.md` 记的数一致。
- [ ] AC4：`npm run check`、`npm run smoke` 通过；PR CI 绿；打 tag 前评审通过；tag、GitHub Release、npm（`_npmUser` 为 GitHub Actions）。

## 方案

- doctor：install.js 在 `CLAUDEMD_NO_STATUSLINE=1` 时整段跳过 status line（`scripts/install.js:815`），所以 `/claudemd-install` 在这种状态下不会重新拷贝 renderer。`statusline-adopt.js adopt --empty-only` 在三种接线状态下都会拷贝（`scripts/lib/statusline.js` 的 `refreshed` / `guest-refreshed` / `renderer-refreshed` 三个分支），且不改任何设置，`/claudemd-statusline` 页面会提供它。只在开关为 `1` 时换建议文字，其余文字逐字不变（已有测试锁着）。
- 命令页：每句都先读代码再写（`scripts/lib/cache-prune.js` 的 hold 规则、`scripts/uninstall.js` 的 restore 选择、`scripts/doctor.js` 的 `countsTowardExit`）。新句子独立成行，测试锁整行，并跑一遍它描述的行为。
- 两项评估（材料在本地 `tasks/r3-wtree-eval/`、`tasks/cross-repo-write/`）：R3 盲标 108 条（88 条分歧全部，加两个一致格子各 10 条对照），三个 Opus 盲评员，多数票；cross-repo-write 逐条读 4 次命中的 transcript。

## 计划

- [x] S1：`git fetch --prune`；三份日志快照到 `tasks/r3-wtree-eval/`
- [x] S2：R3 打包、盲标、汇总、写 RESULT — 覆盖 AC3
- [x] S3：cross-repo-write 读 4 次命中、写 RESULT — 覆盖 AC3
- [ ] S4：doctor 修复（先红后绿、变异检验）— 覆盖 AC1
- [ ] S5：命令页四处（先红后绿）— 覆盖 AC2
- [ ] S6：两份设计记录写结果；runbook 记"评审遗留攒批"
- [ ] S7：发 0.117.5（版本号五处、CHANGELOG、`npm run check`、release 分支与草稿 PR、PR CI、打 tag 前评审、tag、GitHub Release、npm）— 覆盖 AC4

## 决策与进展

- 授权：使用者"剩下的工作按你的建议实施，做完了发版"覆盖 L3 进入实现（命令页是模型可见文本）以及 push、tag、release；范围就是上面"做"一栏。
- 把 0.117.1 那条 doctor 遗留并进本批：盘点时没核实，这次核实仍未修，和命令页缺口同属已登记遗留；若评审认为不该并，回退一个提交即可。
- 版本号取 0.117.5（补丁版本）：只有修复和文字，没有默认行为变化，`spec/` 不动，不走第二套版本号级联。
- R3：两种判定的"未验证"精度都远低于 0.8（gate 触发 0/29，指纹 1/62，只算可判定的样本）；`EVIDENCE_GATE_DELIVER` 不开，指纹判定不进入 R5 送达。误报主要来自声明检测，记为以后的方向，本次不改 hook。
- cross-repo-write：4 次命中全部是子代理在做授权的测试和评审，0 次未授权写入；决策规则的第一条不满足，不提议默认开启，评估结束。

## 验证记录

- `node --test --test-name-pattern=CLAUDEMD_NO_STATUSLINE tests/scripts/doctor.test.js`（修复前）→ 失败（3 条：建议仍是 "Fix: run /claudemd-install"）
- 同上（修复后）→ 通过（4/4）；`node --test tests/scripts/doctor.test.js` → 通过（127/127）
- 变异体（开关判定永远为假）→ 新用例 4/4 失败
- `node --test --test-name-pattern='cachePruned.held|spec-only backups|advisory: true' tests/scripts/command-page-behaviour.test.js`（改页面前）→ 失败（3 条：页面缺这些行）；改后 `node --test tests/scripts/command-page-behaviour.test.js` → 通过（13/13）
