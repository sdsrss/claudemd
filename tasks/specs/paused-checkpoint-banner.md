---
status: implemented
revision: 2
---

# SessionStart 提示未处理的 paused 检查点

## goal

上一会话没做完、没验证的工作,下一会话不再靠人工粘贴 Not done 才能接上。2026-09-26 的分析:本项目 5 个会话以粘贴上一会话的 "Not done" 开头;`session-end-check.sh` 写的 `tasks/session-end-<sid>-paused.md` 没有任何东西读,分析时 4 个项目里有 10 个,最旧的 13 天。SessionStart(非 compact)时,如果 `<cwd>/tasks/` 下有 `*-paused.md`,注入一段列表:文件名 + 天数,最多 5 个,新的在前。

## non-goals

- 不注入文件内容(可能很长,也可能过时);只列名字,由会话自己决定读哪个。
- 不判断检查点是否仍然有效,不自动删除。
- 不改 `session-end-check.sh` 写检查点的条件。
- 不接 `mem_defer`(属于另一个插件的接口)。

## constraints

- 默认开启 hook 的已发布行为变更 → core §2 L3;关闭开关 `DISABLE_PAUSED_BANNER=1`;CHANGELOG 迁移说明。
- 必须经 `merge_banners` 输出:SessionStart stdout 只能有一个 JSON 对象,否则 CC 会把所有横幅一起丢弃。
- compact 路径不注入(那里注入的是 ledger 与重读提醒;检查点是给新会话的)。
- 用户授权:2026-09-26 AskUserQuestion「P2-4 交接注入」。

## success-criteria

1. 有 `tasks/*-paused.md` 的 cwd,startup / resume 时 additionalContext 含每个文件名与天数,并写一条 `paused-banner` 遥测(`extra.count`)。
2. 超过 5 个时只列 5 个最新的,并写明总数。
3. 没有检查点、`DISABLE_PAUSED_BANNER=1`、compact 三种情况都不输出该段。
4. 与 ledger 横幅同时出现时,stdout 仍是单个合法 JSON 对象,两段都在。

## open-questions

- 旧检查点会每次开会话都被列出,直到被删除。接受:这正是要解决的「没人处理」问题;需要安静可以用关闭开关。

# Change log

- r2 (2026-09-26): implemented.
- r1 (2026-09-26): initial, approved with the P2-4 AUTH.
