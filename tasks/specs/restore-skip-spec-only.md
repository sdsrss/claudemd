# restore 跳过只装着规范的备份

状态：进行中

## 背景与目标

- `CLAUDEMD_SPEC_ACTION=restore` 取个人命名空间里最新的 `backup-<stamp>/`（`scripts/uninstall.js`，`listBackups()[0]`）。0.68.3 之前，`/claudemd-update` 也往这个命名空间写备份，内容是即将被覆盖的规范。在这样的机器上，最新的备份可能只装着一份旧规范，restore 把它放回 `~/.claude/`，使用者自己的 `CLAUDE.md` 留在更早的备份里（`tasks/legacy-spec-backup-migration.md` 的分拣段在沙箱里复现过）。
- restore 的用途写在命令页和 README 里：把安装 claudemd 之前的 `CLAUDE*.md` 放回去。只装着规范的备份不是那份文件。
- 使用者 2026-10-24 选了方案 B："只跳过'目录里只有一个规范形状的 CLAUDE.md'的备份"。

## 范围

- 做：`scripts/uninstall.js` 选 restore 来源的那一处；结果里加 `skippedSpecOnly`（有跳过时才出现）和一行 stderr；`--help` 的说明；README 的 restore 一行；测试；CHANGELOG。
- 不做：搬动或删除任何备份；改 `findLegacySpecBackups`、`pruneBackups`、doctor；改 `commands/claudemd-uninstall.md`（模型可见文本，写进 CHANGELOG 的 Not changed）；所有备份都只装着规范时改成中止（照旧取最新的一份）。

## 验收标准

- AC1：最新的备份目录里只有一个规范形状的普通文件 `CLAUDE.md`、更早的备份里是使用者的文件时，restore 放回更早那份，结果的 `skippedSpecOnly` 列出被跳过的目录，被跳过的目录原样留在磁盘上。有 manifest 和没有 manifest 两条路径都如此。
- AC2：不跳过的情形（各一个对照用例）：目录里除 `CLAUDE.md` 外还有任何条目（文件或子目录）；`CLAUDE.md` 是符号链接；`CLAUDE.md` 不是规范形状；所有备份都只装着规范（照旧取最新的，不出现 `skippedSpecOnly`）。
- AC3：现有 restore 用例不改仍通过；`npm run check`、`npm run smoke` 通过。

## 方案

- 判据复用 `findLegacySpecBackups()`：它对个人命名空间里每个 `CLAUDE.md` 规范形状的目录给出 `siblings`。只装着规范 = `siblings` 为空，且 `CLAUDE.md` 用 `lstat` 看是普通文件（符号链接是 dotfiles 使用者自己的安排，不跳过）。
- 选择：按时间从新到旧，取第一个不是"只装着规范"的备份；一个都没有时取最新的一份（与 0.116.5 相同）。被跳过的是比选中那份更新的目录。

## 计划

- [x] S1：测试（红）：两条路径各一个跳过用例、CLI 用例；对照用例；doctor 文案用例
- [x] S2：实现 `scripts/uninstall.js` 的选择、两条路径的 `skippedSpecOnly`、stderr 行；doctor 文案与注释；README、`--help`
- [ ] S3：发 0.116.6（`npm run check`、PR CI、打 tag 前评审、tag、GitHub Release、npm）

## 决策与进展

- 2026-10-24：使用者授权按建议执行（方案 B）。L2：修的是背离已写明用途的缺陷，不是默认行为的改变；只改一个模块。

## 验证记录

（实现后填写）
