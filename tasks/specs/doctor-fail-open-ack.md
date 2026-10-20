# doctor：fail-open 修好后可以确认清零（`--ack-fail-open`）
状态：进行中

## 背景与目标
`/claudemd-doctor` 的 `hook-fail-open` 行：30 天窗口里只要有一条"先决条件缺失"类的 fail-open 记录（jq 不在、patterns 文件读不了、状态目录写不进等），这一行就红、doctor 退出 3。使用者按提示修好之后，这一行仍然红满 30 天，doctor 的退出码在这段时间里不再反映现状（0.113.3、0.113.4 的 CHANGELOG "Not changed"；backlog 第 75 行）。

使用者 2026-10-20："遗漏的工作按你的建议执行"。我上一轮的建议是：加一个"使用者确认已处理"的标记让这一行转绿，不为十几种原因各定义一个"已恢复"判据。

目标：修好之后有一条明确的命令让这一行转绿；问题没修好时它自己会重新变红；默认行为（不加新参数时的判定、退出码）不变。

## 范围
- 做：`scripts/doctor.js` 新参数 `--ack-fail-open` 与判定；`commands/claudemd-doctor.md`、README、`docs/ARCHITECTURE.md` 的用法；测试；CHANGELOG；发 0.114.0。
- 不做：按原因自动判断是否恢复；改 fail-open 的分类（bad-event / 无从判定 / 先决条件缺失三类不变）；改别的检查。

## 验收标准
- [ ] AC1：有未确认的红类记录时，`--ack-fail-open` 写下确认文件，同一次输出里这一行为绿，并写明确认了几条、确认时间 — 验证：`node --test tests/scripts/doctor-fail-open-ack.test.js`
- [ ] AC2：确认之后再出现一条红类记录，这一行重新变红，并同时报出已确认的条数 — 验证：同上
- [ ] AC3：没有可确认的记录（没有红类，或都已确认）时不写文件，输出说明原因 — 验证：同上
- [ ] AC4：确认文件损坏或读不了时视为没有确认（红的照红） — 验证：同上
- [ ] AC5：确认文件写不进时 doctor 退出 1 并说明原因；不加参数时的判定与退出码与 0.113.4 相同 — 验证：同上 + 现有 `doctor.test.js` 的 fail-open 用例不改仍通过
- [ ] AC6：命令页、USAGE、README、ARCHITECTURE 说的与代码一致；命令页写明只在使用者确认原因已修好后才用 — 验证：`npm run check`（含 exit-code-doc-drift 等闸门）+ 发版前评审

## 方案
- 确认文件：`<stateDir>/fail-open-ack.json`（`stateDir` 即 `~/.claude/.claudemd-state/`，可被 `CLAUDEMD_STATE_DIR` 改），内容 `{"ackedAt":"<ISO>","acknowledged":<n>}`。只有一个时间点，不记具体哪几行：判定只需要"确认时间之前/之后"。
- 判定：先决条件缺失类的行按 `ts` 分成确认时刻之前（含）与之后。之后有行 → 红（与现在一样），说明里加上已确认的条数；之后没有、之前有 → 绿，说明"N 条都在确认时刻之前，此后没有新的；再出现一条会重新变红"。没有确认文件或读不了 → 全部算未确认。
- 为什么安全：先决条件没修好时，下一次 hook 运行就会写新的 fail-open 行，这一行立刻重新变红；确认只能藏住确认时刻之前的行。代价：确认之后、下一次触发那个 hook 之前，doctor 是绿的。
- `--ack-fail-open`：在判定之前，若有未确认的红类行，写确认文件（时刻 = 现在），然后照常出结果。输出加顶层字段 `failOpenAck`：写了是 `{written:true, ackedAt, acknowledged}`，没写是 `{written:false, reason}`。写不进时抛错，CLI 退出 1（与 doctor 其他运行时错误一致）。
- USAGE 的"只读，只有一个例外"改为两个例外；Exit codes 的 1 写明包括确认文件写不进。
- 红行的说明加一句：修好后用 `/claudemd-doctor --ack-fail-open` 清零，之后再出现会重新变红。命令页写明：只在使用者说原因已修好之后运行，不要为了让检查变绿自己去跑。
- 版本：新增 CLI 参数（向后兼容的契约变化），不加参数时判定不变 → 0.114.0（minor）。规范不变（v8.2.0）。

## 计划
- [ ] S1：测试（红）：ack 写入与转绿、确认后新行转红、无可确认不写、坏文件按未确认、写不进退出 1、不加参数行为不变
- [ ] S2：实现 + USAGE + 红行说明（绿）
- [ ] S3：命令页、README、ARCHITECTURE
- [ ] S4：CHANGELOG、版本号、`npm run check`、PR CI、发版前评审、tag、release

## 决策与进展
- 2026-10-20：`/tmp/claudemd-sync-*` 先查过：是 `hooks/version-sync.sh:50` 每个会话一个的 0 字节哨兵，`:57` 删除 24 小时前的，按设计如此，不是残留。

- 2026-10-20：实现 25d80cc（先写 5 个用例，4 个改前失败；坏文件那条是对照，改前改后都过）。`npm run check` 随后在四个闸门上失败，都是"新的状态文件要登记"：ARCHITECTURE 的 State locations、uninstall 的 `CLAUDEMD_STATE_FILE_RE`（及其变异对照）、jsonl-null-row 的 JSON.parse 声明、USAGE 里路径后的句号被当成第二个文件名。f1a89e6 补齐；沙箱里 `CLAUDEMD_PURGE=1` 卸载时，标准状态目录整个删掉，非标准目录只删 fail-open-ack.json、保留无关文件。
- 2026-10-20：backlog 复核（子代理）：131c、141b、160（两项）、163、167、169、174（两项）、177 仍是缺陷并有复现；171、172、173、175 剩下的不是缺陷。这些不并进 0.114.0（避免扩大这一版的评审面），列入汇报作为下一批。

## 验证记录
