# 历史 spec 备份的命名空间迁移 —— 写过、撤回、未做

来源：0.68.3 delta review HIGH-2。**代码写完并通过 18 个测试，在 tag 前撤回。** 撤回的理由比迁移本身值钱，记在这里免得未来重新推导一遍再发出去。

## 问题是真的

P1-1（0.68.3）给 `update.js` 分了 `spec-backup-` 命名空间，但只对**新**备份生效。0.68.3 之前跑过 `/claudemd-update` 的机器上，personal 命名空间里仍然躺着 spec-only 的 `backup-<stamp>` 目录：

- `uninstall.js:36` 的 `CLAUDEMD_SPEC_ACTION=restore` 读 `listBackups()[0]`，返回的是那些目录里最新的一个 —— 一份旧 spec，不是用户自己的 `CLAUDE.md`。
- `install.js` 的 `pruneBackups(5)` 把它们算进 personal 的保留窗口。

0.68.3 的做法：`/claudemd-doctor` 的 `backup-namespace-legacy` 检查会**报告**这些目录（连同同目录里的其他文件名），用户自己决定。不自动搬。

## 撤回的原因：判据不是不变量

被撤回的 `migrateLegacyUpdateBackups()` 的判据是：

> `install.js` 只在文件**不像** spec 时才建 personal backup，所以一个装着 spec 形状 `CLAUDE.md` 的 `backup-` 目录不可能是 `install.js` 写的 —— 只能是 `update.js`。

这句话对**今天的** `install.js` 成立，对**写下那些目录的那个** `install.js` 不成立：

- 第一版 `install.js`（`cc36e2b`）根本没有 `looksLikeSpec` 判断，`existing.length` 非零就无条件 `createBackup`。
- 本仓 `CHANGELOG.md:1155` 自己记着：pre-v0.23.11 窗口「each re-install/upgrade backed up the spec itself」。

所以 install.js 写的、spec 形状的 `backup-` 目录**确实存在**于任何足够老的安装上。迁移会把它们当成 update.js 的。

## 搬动会造成什么（评审逐条复现过）

| 场景 | 后果 |
|---|---|
| 目录里 spec 形状 `CLAUDE.md` + 用户手写的 `CLAUDE-extended.md` + `hooks/` 子目录 | 同目录文件被一起搬走；`uninstall.js` 只读 personal 标签，restore 再也够不到它们 |
| 用户在 spec 下面追加了自己的章节 | `looksLikeSpec` 只看前 256 字节的 H1，看不见下面的内容，照搬 |
| 搬到 `spec-backup-` 之后 | `update.js:60` 每次 update 都 `pruneBackups(5, {label: spec})`，5 次后删除。在 personal 里它本来受 install.js 的设计不变量保护 |
| 源目录名带 `-N` 碰撞后缀且目标已占用 | 生成 `spec-backup-<stamp>-1-1`，`STAMP_GRAMMAR` 只允许一个后缀 → 永远不被列出/prune/restore，永久泄漏 |

净效果：把一个**受保护、可恢复**的备份变成**够不到、会被删**的备份。这是在修数据丢失的过程中造一条新的数据丢失路径 —— [[feedback_fix_creates_same_class_instance]]。

## 真要做，必须满足的条件

1. **判据换成能立住的**：整文件 `looksLikeSpec`，或者对已知发布过的各版本 spec 做字节比对 —— 而不是前 256 字节的 H1。
2. **只搬无歧义的**：目录里除 `CLAUDE.md` 外没有别的文件。有同目录文件就不动，那正是 pre-v0.23.11 install.js 的形状。
3. **可逆**：留 `migrated-from` 标记，并把迁移过来的目录排除在 `pruneBackups` 的驱逐集之外，否则「搬」等于「延迟删除」。
4. **碰撞后缀**要么复用 `createBackup` 的那套，要么扩 `STAMP_GRAMMAR`，别自己拼第三种。
5. 只读 `~/.claude` 时静默 no-op 要有信号，否则每次 install 重复一遍没人知道（评审 LOW-4）。

## 已经落地的部分（0.68.3 保留）

- `looksLikeSpec` 抽成单源，`install.js` 与 `findLegacySpecBackups` 共用，两处不会再各写一份。
- `findLegacySpecBackups()` —— 只读，报告，带同目录文件名。
- `dirSize` / `listBackups` 的容错（delta review HIGH-1）：一个悬空 symlink 曾经能让 `install` / `doctor` / `uninstall` / `update` 全部抛异常。
