# restore 跳过只装着规范的备份

状态：进行中

## 背景与目标

- `CLAUDEMD_SPEC_ACTION=restore` 取个人命名空间里最新的 `backup-<stamp>/`（`scripts/uninstall.js`，`listBackups()[0]`）。0.68.3 之前，`/claudemd-update` 也往这个命名空间写备份，内容是即将被覆盖的规范。在这样的机器上，最新的备份可能只装着一份旧规范，restore 把它放回 `~/.claude/`，使用者自己的 `CLAUDE.md` 留在更早的备份里（`tasks/legacy-spec-backup-migration.md` 的分拣段在沙箱里复现过）。
- restore 的用途写在命令页和 README 里：把安装 claudemd 之前的 `CLAUDE*.md` 放回去。只装着规范的备份不是那份文件。
- 使用者 2026-10-24 选了方案 B："只跳过'目录里只有一个规范形状的 CLAUDE.md'的备份"。

## 范围

- 做：`scripts/uninstall.js` 选 restore 来源的那一处；`scripts/lib/backup.js` 新增判定 `holdsOnlySpecFiles` 与 `SPEC_FIRST_LINE_RE`（uninstall 与 doctor 共用）；结果里加 `skippedSpecOnly`（有跳过时才出现）和一行 stderr；doctor `backup-namespace-legacy` 的文案（标出 restore 会跳过的目录）；`--help`、README 的 restore 一行与手工恢复一步；`scripts/update.js`、`tests/scripts/update.test.js` 里说 restore 怎么选的注释；测试；CHANGELOG。
- 不做：搬动或删除任何备份；改 `findLegacySpecBackups`、`pruneBackups`；改 `commands/claudemd-uninstall.md`（模型可见文本，写进 CHANGELOG 的 Not changed）；所有备份都只装着规范时改成中止（照旧取最新的一份）。

## 验收标准

- AC1：最新的备份目录只装着规范文件（只有 `CLAUDE.md`，或 0.68.3 之前 update 写的四个规范文件）、更早的备份里是使用者的文件时，restore 放回更早那份，结果的 `skippedSpecOnly` 列出被跳过的目录，被跳过的目录原样留在磁盘上。有 manifest 和没有 manifest 两条路径都如此。
- AC2：不跳过的情形（各一个对照）：有规范文件名以外的条目（文件或子目录）；文件是符号链接；某个文件第一行不是规范标题（包括使用者自己写的同名文件、标题不在第一行）；没有 `CLAUDE.md`；目录读不了（照旧失败）；所有备份都只装着规范（照旧取最新的，不出现 `skippedSpecOnly`）。
- AC3：现有 restore 用例不改仍通过；`npm run check`、`npm run smoke` 通过。

## 方案

- 判据 `holdsOnlySpecFiles(dir)`（`backup.js`）：目录能列出、含 `CLAUDE.md`，每个条目都是四个规范文件名之一，`lstat` 看是普通文件，第一行匹配 `SPEC_FIRST_LINE_RE`（`/^\uFEFF?# AI-CODING-SPEC /`，比 `looksLikeSpec` 严）。v0.1.0–v0.68.2 共 210 个 tag 的 741 个规范文件第一行都匹配（2026-10-24 实测）。
- 选择：按时间从新到旧，取第一个不是"只装着规范"的备份；一个都没有时取最新的一份（与 0.116.5 相同）。被跳过的是比选中那份更新的目录。

## 计划

- [x] S1：测试（红）：两条路径各一个跳过用例、CLI 用例；对照用例；doctor 文案用例
- [x] S2：实现 `scripts/uninstall.js` 的选择、两条路径的 `skippedSpecOnly`、stderr 行；doctor 文案与注释；README、`--help`
- [ ] S3：发 0.116.6（`npm run check`、PR CI、打 tag 前评审、tag、GitHub Release、npm）

## 决策与进展

- 2026-10-24：使用者授权按建议执行（方案 B）。L2：修的是背离已写明用途的缺陷，不是默认行为的改变；只改一个模块。
- 2026-10-25：发版前评审第 1 轮（01950e0..990e578）：0C/1H/0M/8L。H1：0.68.3 之前的 update 备份每个与插件不同的规范文件，真实目录通常是四个文件，方案 B 原话"只有一个 CLAUDE.md"打不中它（评审回放 v0.68.2 的 `update.js` 复现，我复核 `git show v0.68.2:scripts/update.js`）。决定：放宽为"只装着规范文件"（上面的判据），同时换成更严的首行判据（L2）、目录读不了不判（L1）。理由：方案 B 的目的是"restore 不再放回 0.68.3 之前 update 留下的旧规范"，原话出自我对备份形状的错误假定；放宽仍只跳过全是规范文件的目录，带使用者文件的目录不受影响；判错的后果是放回更早的一份，被跳过的目录原样在盘上并打印出来，可以手工恢复。这是改代码的修复，按 runbook 派第 2 轮评审（新开，只看修复）。L3–L8 按文字修。

## 验证记录

- 9109e50（第 1 轮代码）：`node --test tests/scripts/uninstall.test.js` → 新用例改动前 3 个失败（两条路径的用例放回了 `# AI-CODING-SPEC v6.12.0`，CLI 用例缺 `skippedSpecOnly`），改后 42/42；六个变异各被一个用例拦下；`npm run check`（e7e3494、cb4e842）exit 0，node 1694/1696、2 跳过。
- 修复轮：新用例在 v0.116.5 上 5 个失败、在 9109e50 的代码上 5 个失败，修复后 uninstall 45/45、doctor 相关 3/3；十个变异各被一个具名用例拦下。整套检查见 CHANGELOG 0.116.6 的 Tests 一行。
