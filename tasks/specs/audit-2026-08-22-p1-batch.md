---
status: implemented
revision: 2
---

# audit-2026-08-22 P1 batch

来源：`docs/audit/audit-2026-08-22-01.md`（第 9 轮全面审核 @ v0.68.2，评分 83/100，0 P0 / 5 P1）。
用户指令：本轮只处理 P0+P1；不改外部行为与接口除非报告明确要求；不加功能、不加依赖；核心逻辑无测试先补最小测试；删死代码前全局查引用；每类完成即跑测试。

## goal

关掉报告列出的 5 条 P1，且每条带 RED-first 证据；套件与 CI 维持全绿（baseline: node 780 pass / 0 fail，bash 1170/1170，exit 0）。

## non-goals

- P2/P3（条目 6-25）全部留待后续轮次，包括同族的 HOT-1/HOT-2、clean-residue 文档派生、eviction 名单单源化。
- 不引入 eslint / 静态分析（条目 20，P2）。
- 不做 npm-publish 矩阵改动（条目 10，P2；报告把它列在收敛路径里但它是 P2）。
- 不 ship / 不发版：本轮只落代码 + 报告标注。

## constraints

- 外部接口不变：`createBackup/listBackups/pruneBackups/restoreBackup` 的既有默认调用形状必须行为不变（默认 label 仍是 `backup`）。
- spec 文本改动必须走 `spec/`（单源）+ 版本号级联（`feedback_claudemd_spec_single_source_of_truth`、`feedback_spec_version_bump_cascade_grep`），并重测 Sizing 行（`feedback_spec_sizing_recursive_rewrite`）。
- 新增的门必须从源码反查推导，不得手抄名单（`feedback_extraction_needs_consumer_gate`、`feedback_gate_scope_must_cover_its_subject`）。
- hook 探针一律跑在 mktemp fixture + `DISABLE_RULE_HITS_LOG=1`，零 live-FS 执行（§8.V3 / `feedback_manual_hook_probe_pollutes_telemetry`）。
- 新增的计时/网络门必须是 hermetic 的：不得让 CI 真的打网络。

## success-criteria

1. **P1-1**：`/claudemd-update` 之后 `CLAUDEMD_SPEC_ACTION=restore` 仍返回用户个人 `CLAUDE.md`；≥5 次 update 不再轮出个人备份；hand-hook 迁移不再铸出遮蔽个人备份的空最新备份。RED 测试先失败。
2. **P1-2**：`hook-budget.test.sh` 的受试集从源码推导出文件系统缩放类（residue-audit / sandbox-disposal-check / version-sync）；`REACHED` 不再把裸 stderr 当到达；网络类 hook 由一条静态上界门覆盖；`perf-baseline.sh` 的覆盖宣称如实枚举。
3. **P1-3**：`git commit -F` 正文结尾 3 行 `#` 注释里的 §10-V 违例不再静默放行（`exit 1`），且 `REAL_EDITMSG` 模板剥离行为不变。
4. **P1-4**：`spec/CLAUDE-extended.md:484` 幽灵引用消除；core §2.1 与 ext §4 对 L2-additive 的指令口径一致，并有反向 join 测试钉死。
5. **P1-5**：`memtags_match` 的 spill 分支两条失败路径写 `hook_record_failopen`；临时文件有 trap 清理；文件名被 `scripts/clean-residue.js` 回收器覆盖。

## open-questions

无。报告对每条都给了修法；P1-4② 的裁决取「RED-first 证据必需、完整 sp:TDD 仪式可选」这一读法（两表本就可调和，按 §13 META 属 patch 级澄清而非规则变更）。

# Change log

- r1 (2026-08-22) — 初稿，随 P1 批执行创建。
- r2 (2026-08-22) — 5 条 success-criteria 全部满足，status → implemented。两处执行期偏离（均已在报告的修复记录里写明，非静默改写）：
  1. P1-1 的修法迫使 `scripts/doctor.js` 一起改——label 分流后 doctor 的清点与 `--prune-backups` 只看默认 label，会当场造出一个新的「门窄于对象」实例。属同一修复的完整面，不是范围扩张。
  2. P1-2 的「session-start-check 零计时覆盖」按静态上界门收口（`platform_timeout N < hooks.json timeout`）而非计时探针：网络耗时不随用户数据缩放，计时探针要么真打网络（非 hermetic）要么测到离线早退分支——后者正是该门存在的理由所指的缺陷。`perf-baseline.sh` 的宣称文本同步改为逐类枚举，明说哪一类两个仪器都不覆盖。
- 未做（留后续轮次）：P2/P3 全部；repo `CHANGELOG.md` 条目与插件 semver bump 属发版动作，本轮未 ship 故未动。
