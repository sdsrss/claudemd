# 0.117.5：评审遗留攒批（doctor 关闭开关下的建议、三个命令页五处文字、两项评估收尾）

状态：已完成

## 背景与目标

- 2026-11-01 盘点（0.117.4 发版后）列出了剩余的有价值工作。使用者回复"剩下的工作按你的建议实施，做完了发版"。
- 盘点建议：R3 指纹与 evidence-gate 判定的对比（先快照日志，再盲标分歧样本）；cross-repo-write 按现有 4 条提示读结果、结束评估、默认保持关闭；四处命令页文字缺口攒成一次纯文字发版；复核 0.117.1 那条未核实的遗留；`git fetch --prune`；以后把评审遗留攒在 `next-release` 上再发版，不每条单独打补丁版本。

## 范围

- 做：`scripts/doctor.js`（`CLAUDEMD_NO_STATUSLINE=1` 下 statusline 行的修复建议）；`commands/claudemd-install.md` 两处、`commands/claudemd-uninstall.md` 两处、`commands/claudemd-doctor.md` 一处（模型可见文本，只把与代码不符或缺失的事实写对）；对应测试；`tasks/specs/cross-repo-write.md`、`tasks/specs/wtree-evidence.md` 记下评估结果；CHANGELOG；发 0.117.5。
- 不做：`DISABLE_RULE_HITS_LOG=1` 下无标记旧目录仍会被删（0.117.4 遗留，需要另一种存活信号）；restore 是否跳过 0.68.3 以前的 spec-only 备份（0.116.5 留给使用者的选择，本次只把页面写对）；改 `~/.claude/settings.json` 里的本机开关（§5 hard，使用者的设置）；重做 evidence-gate 的声明检测；D#598；`hooks/`、`spec/` 不动。

## 验收标准

- [x] AC1：`CLAUDEMD_NO_STATUSLINE=1` 下，renderer 过期或缺失时（自己的槽位、注册的 guest、宿主用 `_previous` 运行），statusline 行建议 `/claudemd-statusline`，不再写 "run /claudemd-install"；照旧建议跑 install.js 后行仍是红的，照 `/claudemd-statusline` 页面在该状态下给的命令（自己的槽位和 guest 是 `adopt`，宿主运行是 `adopt --empty-only`）跑后变绿，且设置文件逐字节不变；开关取 `0`、`true`、空值时建议不变。验证：`node --test tests/scripts/doctor.test.js`（7 条新用例；4 条 opt-out 用例在 v0.117.4 的 doctor.js 上全部失败；评审给出的 5 个变异体各至少 2 条失败）。
- [x] AC2：三个命令页五处新句子与代码一致：`cachePruned.held` 及其两种 `reason`；restore 跳过较新的、含 `CLAUDE.md` 且只有 spec 文件的备份并列入 `skippedSpecOnly`，没有 `CLAUDE.md` 的 spec 备份不跳过；doctor 的 `advisory: true` 不计入退出码。验证：`node --test tests/scripts/command-page-behaviour.test.js`（4 条新用例；含整行锁定的 3 条在旧页面上失败）。
- [x] AC3：两项评估的结论写进已跟踪的设计记录，数字可由本地材料复算。验证：`node tasks/r3-wtree-eval/analyze.mjs` 的输出与 `tasks/specs/wtree-evidence.md` 记的数一致。
- [x] AC4：`npm run check`、`npm run smoke` 通过；PR CI 绿；打 tag 前评审通过；tag、GitHub Release、npm（`_npmUser` 为 GitHub Actions）。

## 方案

- doctor：install.js 在 `CLAUDEMD_NO_STATUSLINE=1` 时整段跳过 status line（`scripts/install.js:815`），所以 `/claudemd-install` 在这种状态下不会重新拷贝 renderer。`/claudemd-statusline` 被要求刷新时会重新拷贝：它的页面对自己的槽位和已注册 guest 写的是重跑 `adopt`，对宿主用别的 id 运行的状态写的是 `adopt --empty-only`（评审 L1 指出原稿把 `--empty-only` 说成三种状态通用）。`adopt` 对命令与本版本不同的 guest 条目会重新注册（改写 registry，2026-11-01 复现）。只在开关为 `1` 时换建议文字（与 install.js 的判定相同），其余文字逐字不变（已有测试锁着）。
- 命令页：每句都先读代码再写（`scripts/lib/cache-prune.js` 的 hold 规则、`scripts/uninstall.js` 的 restore 选择、`scripts/doctor.js` 的 `countsTowardExit`）。新句子独立成行，测试锁整行，并跑一遍它描述的行为。
- 两项评估（材料在本地 `tasks/r3-wtree-eval/`、`tasks/cross-repo-write/`）：R3 盲标 108 条（88 条分歧全部，加两个一致格子各 10 条对照），三个 Opus 盲评员，多数票；cross-repo-write 逐条读 4 次命中的 transcript。

## 计划

- [x] S1：`git fetch --prune`；三份日志快照到 `tasks/r3-wtree-eval/`
- [x] S2：R3 打包、盲标、汇总、写 RESULT — 覆盖 AC3
- [x] S3：cross-repo-write 读 4 次命中、写 RESULT — 覆盖 AC3
- [x] S4：doctor 修复（先红后绿、变异检验）— 覆盖 AC1 — e5dec8d
- [x] S5：命令页五处（先红后绿）— 覆盖 AC2 — 7a6cc1a
- [x] S6：两份设计记录写结果（e31937b）；runbook 记"评审遗留攒批"
- [x] S7：发 0.117.5（版本号五处、CHANGELOG、`npm run check`、release 分支与草稿 PR、PR CI、打 tag 前评审、tag、GitHub Release、npm）— 覆盖 AC4 — tag v0.117.5（32c4e28）

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
- 发版前评审第 1 轮（17eac21..4bd7e25，新开的 release-reviewer）：0 Critical、0 High、1 Medium、6 Low。逐条对照代码核实后修复：M1（restore 只跳过含 `CLAUDE.md` 的 spec 备份，`scripts/lib/backup.js:360`）、L2（用户内容扫描连带三个 spec 文件，`scripts/install.js:569-573`）、L3（keep 3 = 当前版本加最新的其他版本）、L4（读不成数字的标记每次都保留）、L1（各状态的命令不同）、L5（4 个变异体存活，测试改为锁整句并锁 `=== '1'`）、L6（第 4 条用例在 v0.117.4 上也失败，已复现）。修复只有文字、测试和一处 `doctor.js` 注释，按 runbook 走 claim-drift 自查，不再派第二轮评审。e5dec8d、7a6cc1a 已推送，提交信息保留原措辞，CHANGELOG 的评审段写明。
- `node --test --test-name-pattern=CLAUDEMD_NO_STATUSLINE tests/scripts/doctor.test.js`（修复轮后）→ 通过（7/7）；评审的 5 个变异体 → 失败（4、2、2、4、2 条）
- `node --test tests/scripts/doctor.test.js tests/scripts/command-page-behaviour.test.js`（修复轮后）→ 通过（144/144）
- 5c4d6b6 的树：`npm run check` → 通过（退出码 0，node 1749/1751，2 条跳过，shell 套件全部通过）；`npm run smoke` → 通过（2/2）
- PR CI，4bd7e25（run 41346208317）→ 通过（7/7）
- PR CI，32c4e28（run 41348306429）→ 通过（7/7）；tag v0.117.5 的 `ci`（41349854206）与 `npm-publish`（41349854144，`publish` job）→ 通过；`main` 推送的 ci（41349834974）→ 通过
- `npm view claudemd-cli dist-tags` → `latest: 0.117.5`；`npm view claudemd-cli@0.117.5 _npmUser` → `GitHub Actions <npm-oidc-no-reply@github.com>`
