---
status: implemented
revision: 2
---

# evidence-gate 的观察随下一条提示送达模型（R5 方案 B）

来源：docs/oss-benchmark-2026-09-28.md §3.1 与 §4 R5（本地对标文档）。使用者 2026-09-29 按 L3 授权，只授权方案 B；方案 C 要等判定过了 0.8 精度闸门。

## goal

evidence-gate 触发时（改了代码、声称完成、之后没有验证输出），让模型知道这件事：不打断刚结束的回合，也不因每一次误报多花一个模型回合。

## non-goals

- 方案 C：Stop 的 `hookSpecificOutput.additionalContext`。它会让回合继续，每触发一次模型就多回复一轮，受与 block 相同的 `stop_hook_active` 保护。要等判定精度到 0.8（R3、R4(a)）；目前 21 次触发里至多 3 次是对的。
- 不改 evidence-gate 的判定、它的完成声明检测，也不改它的 opt-in（`EVIDENCE_GATE=1`，默认关闭）。
- ledger-staleness（G7）暂不接入新通道，它的提示文字是写给人看的。

## constraints

1. Stop 写 `~/.claude/.claudemd-state/notice-<sid>.evidence-gate`；新的 UserPromptSubmit hook `deferred-notice.sh` 在该会话的下一条提示时，把它作为 `additionalContext` 送达。只送一次：先改名再读，两条并发提示不会都送。上限 2,000 字符。
2. 无头运行不送：转录里最后一个 `entrypoint` 以 `sdk-` 开头时，不排队。
3. 文字写成观察，带来源标记，不写成指令（`docs/HOOK-PROTOCOL.md`：注入文字要自带来源说明），并写明使用者的 kill switch。
4. 没有待送内容时，对每个用户的代价是一次 glob，在加载任何库之前完成。
5. 没人取走的通知由 `/claudemd-clean-residue` 回收（`notice` 类，也包括投递者被杀后留下的 `.delivering.<pid>`）；`/claudemd-uninstall --purge` 也覆盖这个前缀。
6. 遥测：`evidence-advisory` 行新增 `extra.queued`；送达时写 `notice-delivered`，带 `extra.sources`。
7. 有自己的 opt-in：在 `EVIDENCE_GATE=1` 之外还要 `EVIDENCE_GATE_DELIVER=1`。G1b 预注册 2026-09-26 的修订（`tasks/g1b-g2-eval/PREREG.md`）规定：任何通往模型的通道，包括 UserPromptSubmit 注入，都要等同一回放上的判定精度达到 0.8。对标文档"先上 B"的建议，不能替已经选了"只给人看"的用户改变这条预注册规则。这个开关就是预注册 A/B（`tasks/r5-deferred/PREREG.md`）要用的。

## success-criteria

1. `tests/hooks/deferred-notice.test.sh`（9 个用例）：无待送内容时静默；只送一次、只送给自己的会话；kill switch；上限与来源名过滤；遥测；与 evidence-gate 端到端：交互会话（排队，下一条提示送达），无头会话和没有 `EVIDENCE_GATE_DELIVER=1` 的会话（都不排队）。
2. `tests/hooks/evidence-gate.test.sh` 不改动且全绿；`npm run check` 全绿。
3. 行为（预注册在 `tasks/r5-deferred/PREREG.md`，本地）：两回合配对回放中，有通知一臂的第二回合出现验证调用的比例，高于无通知一臂；已经验证过的回合不因通知多出工具调用。尚未运行。

## open-questions

1. 用户换了话题之后才送达的通知，读起来像噪音。通知带时间戳，并说明如果那条回复不是完成声明就忽略它。这够不够，由判据 3 来测。
2. G1b：它的第一个窗口 2026-09-26 作废，原因是模型从来收不到提醒。带这个通道的新 G1b 窗口要先过 0.8 闸门（约束 7）；在那之前，这个通道只供预注册 A/B 使用。

# Change log

- r2 (2026-09-29)：排队改为需要 `EVIDENCE_GATE_DELIVER=1`（约束 7）。r1 只要设了 `EVIDENCE_GATE=1` 就排队，这会让已经 opt-in 的用户（包括本机）违反 G1b 预注册、开始收到模型可见的通知。是在 r1 提交之后重读那份预注册时发现的。
- r1 (2026-09-29)：按上文实现。同一改动里改正了给人看的 stderr 那一行："a Stop hook has no channel into the model"。
