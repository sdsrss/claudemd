# 0.117.4：缓存清理不删正在用的版本、statusline 两个旧问题、§7 发版前检查的文字

状态：进行中

## 背景与目标

- D#635：2026-11-01T17:27:50Z，0.117.3 的 `install.js` 调 `pruneCache(keep:3)` 删掉了 `cache/claudemd/claudemd/0.116.6`。claude-mem-lite（pid 20926）和 code-graph-mcp（pid 23243）两个会话从 07:47Z 起一直从这个目录跑 hook，最后一条 0.116.6 行在 17:27:49Z。目录没了以后，`bash "${CLAUDE_PLUGIN_ROOT}/hooks/pre-bash-safety-check.sh"` 报 `No such file or directory`，退出码 127，不拦截，所以那两个会话的 claudemd hook（含 §8 闸门）全都不运行，直到 `/reload-plugins`。Claude Code 自己的做法（code.claude.com/docs/en/plugins/loading，"Cleanup of previous versions"）：更新时在旧目录写 `.orphaned_at`，14 天后才删，"so a session that already loaded the old version keeps running"。`scripts/lib/cache-prune.js` 不看这个标记，也不看目录是不是还有人在用。
- D#628（0.117.2 评审 L1、L7，0.117.1 就有）：
  - L1：`adopt` 之后再 `adopt({supersede:'claudemd'})`，claudemd 自己的条目被存进 `statusline-prev.json`；`remove()` 再把它注册回去（`restored:'claudemd'`），渲染文件却删了，留下一个指向不存在文件的条目；doctor 那一行一直是红的。CLI 不拒绝 `--supersede=claudemd`。
  - L7：注册表 `[claudemd, _previous→渲染文件]`，存档 `[_previous→别的脚本]`。`detect` 把 `_previous` 列进 `rendererRunBy`，`remove()` 却用存档的 `_previous` 按 id 覆盖了正在跑渲染文件的那个，然后 `rendererKept` 为空、文件被删。0.117.1 写的"remove() 为它们保留文件"在这个状态下不成立。
- D#613（0.117.1 评审 L8）：core §7 让 agent 看 `gh run list --branch "$(git branch --show-current)" --limit 1` 的颜色。2026-11-01 在 sdsrss/claudemd 的 main 上，这条命令第一行是 GitHub 自己的 `Dependabot Updates`（`event: dynamic`，failure），而 `hooks/ship-baseline-check.sh`（cdfdb56 起）跳过这一对。规范文字和闸门说的不是一回事。

## 范围

- 做：
  - `scripts/lib/cache-prune.js`：超出保留数的旧目录，满足任一条件就留下（hold）不删：(b) 有 `.orphaned_at` 且距今不到 14 天（读不出数字也留下）；(a) `claudemd.jsonl`（含 `.1`、`.2`）里最近 14 天有这个版本的 hook 行。结果里加 `held`。`scripts/install.js` 的注释、`commands/claudemd-install.md` 的 `cachePruned` 说明。
  - `scripts/lib/statusline.js`：`adopt` 拒绝 `supersede === 'claudemd'`（抛错，不写任何东西）；`readSupersededList` 丢掉 id 为 `claudemd` 的存档条目（旧版本已经写在盘上的状态也按此处理）；`remove()` 不用存档覆盖注册表里已有同 id 的条目，这些条目留在存档里，结果里列为 `notRestored`；CLI 人类可读输出列出 `not-restored`。
  - D#613（要先经使用者同意 diff）：`spec/CLAUDE.md` core §7 那一句改成和闸门一致；规范版本 v8.3.0 → v8.3.1 及其级联。
  - CHANGELOG 0.117.4、版本五处、发版。
- 不做：改 Claude Code 自己的 14 天清理；给没有 `.orphaned_at` 的目录补写标记；改 doctor 的 statusline 判定（修完后它的判定在这两个状态下就对了，测试覆盖）；D#598（样本 38/62，时间未到）。

## 验收标准

- [x] AC1：缓存里 5 个版本、当前是最新：第 4、5 新的目录里，`.orphaned_at` 不到 14 天的留下、`held` 里写原因；超过 14 天且日志里 14 天内没有该版本行的删掉；没有标记、日志里 14 天内有该版本行的留下；没有标记、没有日志行的照旧删掉；标记内容读不出数字的留下。现有 10 个用例不改仍通过。— 验证：`node --test tests/scripts/cache-prune.test.js`
- [x] AC2：`adopt({supersede:'claudemd'})` 抛错，注册表和 `statusline-prev.json` 不变；CLI `--supersede=claudemd` 退出码 1。存档里已有 claudemd 自己的条目时，`remove()` 不把它注册回去，claudemd 被摘掉、没人用的渲染文件被删。— 验证：`node --test tests/scripts/statusline.test.js tests/scripts/statusline-cli.test.js`
- [x] AC3：注册表 `[claudemd, _previous→渲染文件]`、存档 `[_previous→别的脚本]` 时，`remove()` 后注册表里的 `_previous` 仍是渲染文件那条，渲染文件还在，`rendererKept` 含 `_previous`，`notRestored` 含 `_previous`，存档里留着那条别的脚本。— 验证：同上
- [x] AC4（D#613，经同意后）：core §7 的命令和闸门跳过的是同一对；`version-cascade-check`、`spec-coherence-audit --strict`、`spec-structure` 通过。— 验证：`npm run check`
- [ ] AC5：`npm run check` 退出 0，`npm run smoke` 2/2，PR CI 7/7，发版前评审无未修的 Critical/High。

## 方案

- 清理：只在有超出保留数的候选目录时才读日志（常见情形 ≤3 个目录，一次都不读）。日志用 `readLogRows`（三代都读）。宽限期一个常量 14 天，与 Claude Code 一致。`held` 形如 `[{ name, reason: 'orphaned-recently' | 'hook-rows-recently' }]`。`kept` 的含义不变（保留数内的版本）。
- statusline：拒绝自我取代放在 `adopt` 的 host 分支、`copyRenderer` 之前；`readSupersededList` 的过滤让 `detect`、`adopt` 的追加、`remove` 三处一致。`remove()` 的冲突处理是"注册表里现有的赢"：这是使用者现在看到的状态，覆盖它会改掉别人的条目并删掉它要的文件；被跳过的存档写回 `statusline-prev.json`，不丢。

## 计划

- [x] S1：D#635 测试（红）→ 实现 → 绿
- [x] S2：D#628 测试（红）→ 实现 → 绿
- [x] S3：D#613 diff 给使用者看，同意后改规范并跑级联
- [x] S4：CHANGELOG、版本五处、`npm run check`、`npm run smoke`
- [ ] S5：发版（release 分支、draft PR、PR CI、评审、ff main、tag、GitHub Release、npm 核对）

## 决策与进展

- 2026-11-01：使用者同意"a 和 b 一起做，下个小版本先写失败测试再修"，并要求把 D#628、D#613、D#598 一起做。查到 Claude Code 官方文档的 14 天宽限期后，宽限期取 14 天（与它一致），(a) 的窗口也取 14 天：会话可以开着很久不触发 hook，窗口太短挡不住。可撤回：只改一个常量。
- D#613 是规范正文改动，按 §13 META 和 `.claude/rules/spec-edit.md` 先给 diff 再改。2026-11-01 使用者看过 diff，选了“两处都改”：core §7 那一句（v8.3.1，补丁）和 `commands/claudemd-statusline.md` 第 28、30 行（`notRestored`）。
- 2026-11-01：`npm run check` 在 147acaf 上失败 2 例：`tests/scripts/command-page-behaviour.test.js` 逐字固定命令页整行，5efc96b 改了其中两行。期望值改成已同意的新文字（345702b）。之前只按文件名在 tests/ 里搜过命令页，没按句子搜。
- 发版进度：release/v0.117.4 已推送，draft PR #27，PR CI run 41335111751；打 tag 前评审已派出（第 1 轮，范围 5126416..345702b）。下一步：评审结果到达后按 §12 修复（Critical/High 先写失败测试），然后填 CHANGELOG 的 @@CHECKS@@ / @@REVIEW@@，PR CI 绿后 ff main、打 tag、GitHub Release、核对两个 tag 工作流和 `npm view claudemd-cli@0.117.4 _npmUser`。
- 2026-11-01：打 tag 前评审第 1 轮（5126416..345702b）：0C/0H/2M/6L。M1（自我取代的缺陷 0.117.0 就有，CHANGELOG 写成从 0.117.1 起）、M2（Not changed 里写 doctor 的 statusline 行不变，但同名存档且渲染文件缺失时它多了 remove 建议）、L1（标记文件读不了按没有标记处理，只有内容不是数字才留下，CHANGELOG 和注释写成“读不了也留下”）、L2（保留的 3 个里含当前版本）都按文字修，加一处代码注释。L3–L6 不修：L3、L4 都是 0.117.3 就有、只能手工改存档或走别的命令才出现；L5 只影响二分查找；L6 只在设了 `CLAUDEMD_STATE_DIR` 时路径不同，而且改命令页还要再征求同意。全是文字修复，按手册走 claim-drift，不派第 2 轮。
- 实现中加的一处：`detect()` 的 `rendererRestoredBy` 也按“注册表里已有同 id 就不恢复”来预测，否则它和 `remove()` 实际做的不一致（多了一个用例）。
- D#598：2026-11-01 重扫（脚本副本，结果在会话草稿区）：38/62。不到条件，不跑；今天已有快照，下一次最晚 11-28。

## 验证记录

- `node --test tests/scripts/cache-prune.test.js` → 通过（16/16）；6 个新用例在 0.117.3 的 `cache-prune.js` 上全部失败；去掉标记判断或日志判断的两个变异各让 2 个用例失败
- `node --test tests/scripts/statusline-adopt.test.js tests/scripts/statusline-cli.test.js` → 通过（57/57）；6 个新用例在 86c72b3 之前全部失败；4 个变异各让至少 1 个用例失败
- `npm run check`（86c72b3）→ 通过（exit 0；node 1738/1740，2 个跳过；shell 套件全部通过）
- `node scripts/spec-coherence-audit.js --strict` → 通过（coreDelta=0，extendedDelta=0）；`node scripts/version-cascade-check.js` → 通过
- `node --test tests/scripts/spec-structure.test.js tests/scripts/spec-modules.test.js` → 通过（99/99）
- `npm run check`（147acaf）→ 失败（2 例，command-page-behaviour 逐字固定的两行）
- `npm run check`（345702b）→ 通过（exit 0；node 1738/1740，2 个跳过；shell 套件全部通过）；`npm run smoke` → 通过（2/2）
