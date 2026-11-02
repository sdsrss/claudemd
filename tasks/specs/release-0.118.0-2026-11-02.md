# 0.118.0：spec v8.4.0 与刷新文字修正的批次发版

状态：进行中

## 背景与目标

- 0.117.7 安装、重启之后，使用者说"我重启了，把剩下能做的做了发版"。上一会话遗留三项：记 0.117.7 的 T0 并复测 B1；修正刷新脚本、`/claudemd-refresh` 命令页"已删除旧缓存目录、其他窗口每次 hook 都报错"的说法；发 0.118.0。
- 本批带：spec v8.4.0（§EXT §11-O Worktree spawn，设计记录 `tasks/specs/worktree-spawn-rule-2026-11-02.md`，使用者 2026-11-02 已批准）；刷新文字修正（5bbf032）；五处版本号与 CHANGELOG。`release-reviewer` 改为自建克隆（1c9e781）在 `.claude/agents/`，不随插件生效，只是同在这段提交范围里。

## 范围

- 做：`scripts/refresh-plugin.sh`、`commands/claudemd-refresh.md`、README §Update 三处文字与锁行测试；版本号；CHANGELOG 条目（≤3,000 字节）；按发版手册发布。
- 不做：`hooks/`；cache prune 的保留规则（`scripts/lib/cache-prune.js` 不变）；D#665（bash 3.2 watchdog，hook 库改动）；D#656（技能复扫，11-30 前快照）。

## 计划

- [x] S1：0.117.7 的 T0 与 B1 复测，写进已安装版本台账（决策 1、2）
- [x] S2：刷新文字修正，先红后绿、变异检验（5bbf032，决策 3）
- [x] S3：五处版本号、CHANGELOG 条目单独扫描、`npm run check`、`npm run smoke`
- [ ] S4：草稿 PR 的 CI 全绿
- [ ] S5：发版前评审（新开的评审代理），修复轮
- [ ] S6：合入 `main`、带注释的 tag、GitHub Release；两条 tag 工作流、`npm view`、`_npmUser`

## 决策与进展

1. **0.117.7 的 T0 = 2026-11-02T19:41:36Z。** 安装于 19:39:26Z（`installed_plugins.json`，gitCommitSha 459d1a4 = tag）；安装之后第一条 `hook_version=0.117.7` 的行是本项目本会话（8a6a72e6）的 `session-start` `bootstrap`，bootstrap.log 同一秒写 `auto-upgrade: manifest 0.117.6 → plugin 0.117.7`。gsd-lite 一个刷新前开的窗口 19:40:24Z 写了一条 0.117.6 的 `ship-baseline` `pass` 行。只记台账，不写 PREREG（发版手册第 11 步）。
2. **B1 复测。** 这次 install.js 的 prune 一个目录也没删：保留 0.117.7、0.117.6、0.117.3（最新 3 个；0.117.6 的 7 条 `.in_use` 记录里 5 个进程活着），0.117.1、0.117.0 以 `orphaned-recently` 留下（0.117.1 唯一的记录 pid 331763 已退出，所以没有报 `in-use`，判对了）。`in-use` 这条判据这次在实机上没有走到：唯一有活记录的目录本来就在最新 3 个里。19:39:26Z 之后写过的 4 个主会话转录里，没有 harness 报的 `Plugin directory does not exist`；搜到的 6 处都是引用这句话的文字。
3. **刷新文字。** 依据：19:39:26Z 的刷新之后 0.117.6 目录还在，`.orphaned_at` = 2026-11-02T19:39:26.416Z，58 秒后还有窗口在用它写日志；官方文档 code.claude.com/docs/en/plugins/loading "Cleanup of previous versions" 写的是标记后 14 天再删；`scripts/lib/cache-prune.js` 对标记不满 14 天的目录报 `orphaned-recently` 并保留。所以三处改成"其他窗口在重载前继续跑旧版本的 hook，这些 hook 照常工作；旧目录至少留 14 天"，建议不变（每个窗口跑 `/reload-plugins`）。
   - 不确定的地方：只在当前 Claude Code（2.1.3xx）上观察过卸载只打标记、不删目录；更早的版本是否如此，没有核对。
   - 测试：`tests/scripts/command-page-behaviour.test.js` 新用例按整行锁命令页、README 和脚本输出，并检查沙箱缓存里的旧目录在脚本跑完后还在。旧文字上失败；只把 README 或只把脚本退回旧文字，各失败 1 条。

4. **发版前评审（新开的评审代理，459d1a4..ae913f4）：Critical 0、High 0、Medium 1、Low 4。** 评审没有改主检出（前后 `git status --porcelain` 都是 0 行，HEAD 都是 ae913f4），也没有留下 `rrev-*` 目录。逐条核实后：
   - M1（`commands/claudemd-uninstall.md` 第 32、34、36 行和 README §Uninstall 第 419、422 行仍说 `/plugin uninstall` 删除插件缓存）：成立。读 Claude Code 2.1.316 的程序代码：移除安装记录时调用的是写 `.orphaned_at` 的函数（没有别的安装记录用同一路径时才写），删除版本目录的只有清扫（标记满 14 天、且没有活会话在用，否则记 "Skipping orphan cleanup, in use by live session"）和同版本覆盖、重链。2.1.309、2.1.310 也有这三段。改五行文字，新用例先红后绿。
   - L1（"运行时计算的值 84" 只是两行 42 的和；877 里有 1 次是 `Write`）：成立，按快照 `rows.json` 重算，以该句开头的是 129，`HOME` 38（23 + 15）成立。`spec/CLAUDE-changelog.md`、extended 的 Recent changes（"877 tool calls"，Sizing 37361 → 37363，Recent changes 块哈希更新）、CHANGELOG 条目、spec-structure 锁定的 `why` 一并改；7c0926f 的提交信息已推送，不改，以 CHANGELOG 为准。
   - L2（"脚本什么都不删"只覆盖按 `$HOME` 找目录的删除）：成立。用例加上 `CLAUDE_PLUGIN_ROOT` 指向沙箱缓存里的当前版本、旁边放旧版本；评审给的"按 `CLAUDE_PLUGIN_ROOT` 删同级目录"变异体现在失败 1 条（原来通过）。
   - L3（设计记录把本项目的 114 次也算成"其他项目"）：改措辞，基线 462 不变。
   - L4（"刷新不删旧目录"没有 Claude Code 版本限定）：CHANGELOG 条目加上"checked in Claude Code 2.1.309, 2.1.310 and 2.1.316"；命令页和脚本输出不加，它们给的建议不随版本变。
   - 修复只有文字和测试（M1 是文字），按 runbook 第 7 步走 claim-drift，不开第二轮评审。

## 验证记录

- `jq` 查 `installed_plugins.json` 与 `~/.claude/logs/claudemd.jsonl` → 0.117.7 安装 19:39:26Z，第一条行 19:41:36Z；19:39:26Z 之后 0.117.7 行 3 条、0.117.6 行 1 条。
- `kill -0` 逐个查各版本目录 `.in_use/` 里的 pid → 0.117.6 活 5 个（2033、2296592、3497、6649、8792），0.117.7 活 1 个（3927841），其余全部已退出。
- 新用例改动前 → 失败（1/1，"commands/claudemd-refresh.md lacks the line"）；改动后 `node --test tests/scripts/command-page-behaviour.test.js tests/scripts/refresh-plugin.test.js` → 通过（19/19）；README 退回旧文字 → 失败 1，脚本退回旧文字 → 失败 1。
- `node scripts/version-cascade-check.js` → `plugin semver 0.118.0 consistent across 5 site(s)`，v8.4 三个文件一致。
- CHANGELOG 条目 1,913 字节；`node bin/claudemd-lint.js lint --file <单独取出的条目>` → `OK: no §10-V hits`。
- `git diff --stat v0.117.7 HEAD -- hooks/` → 0 行；`scripts/` 只有 `refresh-plugin.sh`；`spec/CLAUDE.md` 只有标题行。
- release 分支（5bbf032 之上暂存了版本号、CHANGELOG 与本文件）上 `npm run check` → 通过（退出码 0；node 1762 条：1759 通过、3 跳过，基线 1761 条：1758 通过、3 跳过；shell 1774 条 PASS、0 FAIL；shellcheck 94 个文件无警告）；`npm run smoke` → 通过（2/2）。
