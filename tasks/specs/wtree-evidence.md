---
status: implemented
revision: 1
---

# 把"已验证"绑定到工作树内容指纹，只记日志（R3）

来源：docs/oss-benchmark-2026-09-28.md §4 R3（本地对标文档），做法来自 gstack 的 `gstack-wtree` 和 `gstack-evidence`（MIT）。使用者 2026-09-29 按 L3 授权：放在新开关后面，只记日志。

## goal

记下足够的信息，以便离线回答：声明完成时的那份内容，有没有被一次通过的运行验证过？回答与编辑走哪个通道无关，也不需要解析 shell。

## non-goals

- 不改任何判定。evidence-gate 继续用基于转录的判定，这里只在旁边收集第二种读法。
- 不送达模型（那是 R5；指纹判定要在标注数据上胜过现有判定，才可能接进去）。
- 暂不做发版簿记文件的豁免（gstack 的 `--allow-paths`）：只有判定依赖指纹时才需要。

## constraints

1. 指纹 = 把整个工作树暂存进一个临时索引后 `git write-tree` 的结果；临时索引从真实索引的副本起步（`hooks/lib/wtree.sh`，移植自 gstack，附 MIT 许可全文）。真实索引始终不动。
2. 记录点有两个：一次通过的验证命令（`verify-log.sh`，PostToolUse(Bash)，PostToolUse 只在成功时触发），用的是 evidence-gate 自己的 T1/T2 模式，原样移进 `hooks/lib/verify-cmd.sh`；以及每一次完成声明（`evidence-gate.sh`，`claim-wtree` 行，带它自己的判定，静默的判定也记）。
3. opt-in `EVIDENCE_WTREE=1`（声明一侧还需要 `EVIDENCE_GATE=1`）。kill switch 为 `DISABLE_VERIFY_LOG_HOOK=1`。
4. 每次算指纹最多 2 秒（`platform_timeout`）；失败或不在仓库里就不写行，不会有超出这个上限的延迟。
5. 已披露的副作用：未跟踪、未被忽略的文件内容，会以不可达对象的形式进入 `.git/objects`，直到 `git gc`。

## success-criteria

1. `tests/hooks/verify-log.test.sh`：干净的树上指纹等于 `HEAD^{tree}`；被忽略的文件不改变指纹；未跟踪文件和 heredoc 改写会改变它，还原文件后指纹复原；调用前后真实索引逐字节相同（把 `git add` 写进真实索引的变异会让这一条变红）；不留临时索引；非仓库、没有提交的仓库都不给指纹；verify-log 按 T1 / T2 / T2-output 记下正确的树，忽略 `ls`、非仓库和 kill switch；evidence-gate 只在开关打开时写 `claim-wtree`。
2. `scripts/offline-eval/wtree-verdicts.mjs` 交叉比对两种判定（`tests/scripts/wtree-verdicts.test.js`）。
3. 计时：2026-09-29 在本仓库（干净，490 个跟踪文件）上算一次指纹用了 27 ms；对标文档在本仓库测得 18–45 ms，在 229–3,594 个文件的仓库上是 27–224 ms。
4. 对比的判据（沿用对标文档的预注册）：在 R4(a) 人工标注过的回合上，比较两种判定的精度与召回；指纹判定精度 ≥ 0.8 才进入 R5 的送达。hook 的 p99 < 500 ms。尚未测量：要等开了开关的真实会话攒下日志。

## open-questions

1. 跨会话认可：另一个会话在完全相同的内容上跑过验证，单独记为 `wtree-verified-other-session`。它该不该算，由对比结果决定。
2. monorepo：指纹取的是事件 `cwd` 所在的仓库，不是命令 `cd` 进去的那个包。

# Change log

- r1 (2026-09-29)：按上文实现。
