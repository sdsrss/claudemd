# D#444：无 timeout 时的看门狗在 bash 3.2 下等满上限
状态：已完成（0.113.2，2026-10-19）

## 背景与目标
0.113.1 发版前评审第 2 轮发现：机器上没有 `timeout`/`gtimeout`（典型是没装 coreutils 的 macOS）时，`platform_timeout` 用纯 bash 看门狗兜底。在 bash 3.2 下，如果被包装的命令在看门狗进入 `wait` 之前就结束，父进程对看门狗的 `wait` 会等满整个上限。目标：调用随命令一起返回，不新增任何 stderr 输出，其他行为不变。

## 范围
- `hooks/lib/platform.sh` 的 `platform_timeout` 看门狗分支（`timeout`/`gtimeout` 分支不动）。
- `tests/hooks/platform.test.sh` 新增用例 15。
- 顺带补上 0.113.1 评审记下的测试缺口：`tests/hooks/session-end-check.test.sh` 新增 33i（另外五个进行中操作的标记）和 33j（2 秒保护）。

## 方案
把父进程对看门狗的 `wait` 换成先 `disown` 再 `kill`。

- 原因链：TERM 落在看门狗的 trap 已装好、但 `wait` 还不能被打断的窗口里时，bash 3.2 会把 trap 压到 sleep 结束才执行，于是父进程的 `wait` 等满上限。实测（bash 3.2.57）`/bin/true` 500 次中 17 次；bash 5.3 下 0 次。
- 只删掉 `wait`、不做 `disown` 不行：bash 3.2 会给被信号杀死、又没人 `wait` 的作业补打一行 "Terminated"。实测包装一个不存在的命令，1000 次里出现 1 次。hook 以退出码 0 结束时，stderr 会被人看到。被 `disown` 的作业 bash 不再报告，而且 `disown` 必须放在 `kill` 前面。
- 竞态窗口里，看门狗和它的 sleep 仍会在后台跑到上限，并且一直占着调用方 2 号以上的 fd。父进程不再被卡住。

## 计划
- [x] 失败用例 15，修复（acc4cd1），评审修复（2caaab0）
- [x] session-end 用例 33i、33j（072c434、51ebe85）
- [x] 随 0.113.2 发布：CHANGELOG 按"发版说明须知"写了更正（0.113.1 第 20 行那两句在竞态窗口里不成立），D#444 标为已修。macOS CI 上用例 15 起初因 /bin/true 不存在而失败，改用 `type -P true` 后 macOS 三条腿都通过（run 39309522043 起）。

## 决策与进展
- 2026-10-19：先在 `next-release` 上写失败用例：bash 3.2 下 3 次运行都失败（第 11、13、29 次调用耗时 2.003 秒），然后修复（acc4cd1）。
- 2026-10-19：评审第 1 轮（不带名的新评审，fd2ed91..17386e1）：0C/0H/2M/3L，C1–C5 成立。M1：用例 15 在逗号小数点的 locale 下必失败，已加 `LC_ALL=C`。M2：注释里"误判概率约 1e-4"只在空闲机器上成立，已改为实测数字。L1：注释与代码不符，已改。L2：33j 的名字说得比断言多，已改，并改正提交说明（17386e1 改写为 072c434）。L3（竞态窗口里 fd 仍被占）属已知残留，见下一条。
- 2026-10-19：评审第 2 轮（不带名的新评审，只看修复增量）：0C/0H/1M/4L，全是文字。M1：两次负载测量差得很远（7/22 和 13/22 次漏检），已去掉"连跑三次很少会漏"的推断，两组数字都写上。L1/L3：提交说明的措辞已改（并入 2caaab0）。L2：注释把"命令活得比 sleep 久才杀它"写反了，已改。L4：33j 没有证明慢 jq 包装真的跑过，已改为真 jq 回答后才写标记（51ebe85），3 个变异都被抓到。已到深度上限 2，按 claim-drift 自查收尾，不派第 3 轮。
- **发版说明须知**：已发布的 0.113.1 CHANGELOG 第 20 行说 sleep "is now killed with the watchdog"、"a reader of an inherited descriptor no longer waits out the limit"。在 bash 3.2 的竞态窗口里这两句不成立，下次的条目不要照抄。第 31 行的延后项（等满上限）在下个版本里标为已修。
- 未验证：macOS（BSD、Darwin 上的 bash 3.2）的竞态频率，因而也不知道用例 15 在 macOS CI 上的检出率；bash 4.0–5.2 没有测过。

## 验证记录
- 用例 15 改前：bash 3.2.57 下 3/3 次运行失败；改后：3/3 通过，bash 5.3 下 15/15。
- 实测（主 shell 里直接调用，上限 1 秒）：
  - 旧代码，bash 3.2：慢调用 `/bin/true` 17/500、内建 `true` 13/500、不存在的命令 12/1000，"Terminated" 0。
  - 新代码：上述三种命令各 0/1000 慢调用、0 行 "Terminated"，bash 3.2 和 5.3 都一样。
  - 只删 `wait` 的变体，bash 3.2：不存在的命令 1/1000 次出现 "Terminated"。
  - 旧代码，bash 5.3：`/bin/true` 0/500。
- 33i/33j 的变异：五个标记和 2 秒保护各删一处，6/6 只让对应那一行失败；33j 再加 3 个包装变异，3/3 都被抓到。
- 51ebe85（`next-release` 头）：`( trap '' PIPE; npm run check )` → 通过（node 1546/1547，1 个跳过；所有 shell 套件通过），`BASH32_BIN=… CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过（44/44），`npm run smoke` → 通过（2/2）。此前在 acc4cd1、17386e1、5078167 上也各跑过一遍，都通过（后两个提交后来被改写）。
- 未运行：GitHub CI（没有推送，也没有 PR）。macOS 那条 CI 要等发版分支开 PR 后才会跑。
