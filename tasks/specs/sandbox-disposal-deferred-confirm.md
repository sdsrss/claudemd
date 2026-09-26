---
status: approved
revision: 1
---

# sandbox-disposal:延迟一轮确认再提醒

## goal

`sandbox-disposal-check.sh` 的提醒不再把「Stop 时还在用的临时目录」当成残留。2026-09-26 的标注:开机以来 77 次提醒共列出 149 个路径,之后一个都不存在;其中 127 个是本仓库 `tests/run-all.sh` 自己建、带 trap 清理的 `claudemd-test-*` / `claudemd-suitelog-*`,在 Stop 时后台测试还没结束。默认改为:本轮只把候选记下来,下一次 Stop 时仍存在才提醒。

## non-goals

- 不改变「什么算候选」:扫描位置、过滤规则、一层深度、本会话转录目录排除,全部不动。
- 不把 opt-in Stop block 改成默认开启。
- 不判断目录归属(仍按 mtime,提示语照旧声明可能属于其他会话)。

## constraints

- 默认开启的 hook 的已发布行为变更 → core §2 L3,§2-EXT 发版清单:minor 版本、CHANGELOG 迁移说明、关闭开关、发布说明提示。
- 关闭开关:`SANDBOX_DISPOSAL_IMMEDIATE=1` 恢复「首次出现即提醒」。
- 新状态文件 `sandbox-pending-<sid>.list` 必须纳入 `clean-residue` 的 STATE_EPHEMERAL(否则成为新的无人回收残留)。
- 用户授权:2026-09-26 AskUserQuestion「P1-6 延迟一轮确认」。

## success-criteria

1. 默认模式:新目录在出现的那次 Stop 不提醒;下一次 Stop 仍存在 → 提醒一次,列出它。
2. 默认模式:新目录在下一次 Stop 前被删除 → 从不提醒(后台测试的情形)。
3. 已提醒过、之后未再改动的目录不重复提醒。
4. `SANDBOX_DISPOSAL_BLOCK=1`:拦截发生在确认那一轮;拦截后的 follow-up Stop(`stop_hook_active`)对仍存在的目录只提醒、不再拦截。
5. `SANDBOX_DISPOSAL_IMMEDIATE=1`:行为与 0.97.0 相同,原有 21 个用例在该开关下全部通过。
6. 遥测 `extra` 带 `mode: deferred|immediate`,便于前后对比。

## open-questions

- 会话最后一轮留下的残留不再被提醒(没有下一次 Stop)。接受:SessionEnd 不在本次范围;`clean-residue` 按保留窗口兜底。

# Change log

- r1 (2026-09-26): initial, approved with the P1-6 AUTH.
