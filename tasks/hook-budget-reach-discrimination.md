# hook-budget 的 reach proof 不区分它要证明的那条路径

来源：0.68.3 pre-tag review, MEDIUM-2。~~**未修，随 0.68.3 发布时明确留下。**~~

## Status: RESOLVED 2026-08-24（收敛复核同批，未发版）

按下面「要做什么」一节的方案实现：`tests/hooks/hook-budget.test.sh` 新增
**differential reach discrimination** 段。每个 DATA_RE 对象比较两个签名——
populated fixture 与空 fixture——两者必须在某个可观测维度上不同。

**M5/M6 对照组实测（`CONTROL-RED` = 门变红 = 抓到）**：

| mutation | 旧 REACHED | 新差分段 |
|---|---|---|
| M5 version-sync `-mmin +1440 -delete` → `-print >/dev/null` | PASS（放过） | **CONTROL-RED**：`version-sync produced an IDENTICAL signature … (…\|267\|1\|1)` |
| M6 residue-audit `CURRENT=$(find …)` → `CURRENT=6000` | PASS（放过） | **CONTROL-RED**：`residue-audit produced an IDENTICAL signature … (…\|978358909\|294\|0\|0)` |

实现要点，逐条对应下面记的三个「未做的原因」：

1. **差分维度按 hook 分别选** → 不按 hook 分叉，改为一个五元组签名，任一维度不同即算区分：
   归一化 stdout、归一化 stderr、rule-hits 字节 Δ、state 条目 Δ、`$TMPDIR` 条目 Δ。
   最后一维专为 version-sync 而加——它的 sweep 只作用于文件系统，stdout/stderr/log 三维在
   populated 与 empty 下完全相同（实测 `4294967295|4294967295|289`），tmpΔ 是 `-49` vs `+1`。
   归一化是必需的而非美化：两次跑用不同 HOME，原始字节必然不同，不归一化则断言恒真。
2. **空 fixture 对照组要先证明自己是空的** → 空 fixture 与 populated **同种子**
   （同 manifest、同 per-session state、同 branch），唯一差别是数据量；且 vacuity floor
   要求「compared + exempted == 全体对象数 且 compared ≥ 10」，探针崩溃或被跳过都记 FAIL
   （M6 早期一次语法坏掉的 mutation 就是被这条 floor 报出来的，不是静默通过）。
3. **11 次额外探针的成本先量再定** → 实测套件 **1.4s → 2.87s**（+1.5s）。全量 `run-all.sh`
   以分钟计，增量可忽略。

**过程中发现并修掉的一个 fixture 缺陷**（比本条目本身更实质）：`SYNC_TMP` 里原本只填
5,950 个 `probe-file-*`，而 version-sync 的 GC 匹配的是 `claudemd-sync-*` + `-mmin +1440`——
**那条 `-delete` 分支自 fixture 落地起就从未匹配到任何东西**，扫描按全宽度驱动而删除臂空转。
差分探针要测的正是这条臂的效果，所以补了 50 个正确命名并做旧的条目。

**一个副产品结论**：`banned-vocab-check` 具名豁免 + 书面理由，而不是收窄 `DATA_RE`（后者会连计时
覆盖一起丢掉）。理由本身在 pre-tag review 被驳回过一次，值得记：初稿写「只是因为它**写**
`claudemd.jsonl`」，**两半都是错的**——该 hook 确实读 transcript（`:242,:243,:266`），而
`claudemd.jsonl` 在全文件里只出现在 `:346` 的一条注释里（它经 `hook_record` 记日志，从不写那个
文件名）。正确理由是：transcript 读被 `tail -n 200` 限界（不随大小缩放），且探针在 commit-message
路径就 deny 了，Path 2 根本不进签名。**假的豁免理由比没有理由更坏**——它会告诉下一个维护者这个
hook 压根不碰 transcript。

## 仍未闭合的部分（v0.69.1 pre-tag review 发现，明确留下）

差分段证明的是「hook **读了**那个被变动的数据源」，**不是**「读遍了它」。两个 mutation 能过：

| mutation | 为什么能过 |
|---|---|
| `sandbox-disposal-check:81` 的 `platform_find_newer` 换成两元素常量列表 | 那两个路径在 populated fixture 下存在、empty 下不存在，于是**存在性检查**在区分，而 6,000 条的 walk 已经没了（计时 0.103s → 0.036s，仍绿） |
| `memory-prompt-hint:108` 的 MEMORY.md 扫描加 `head -n 20` | 命中 tag 是第 7 条，hook 照常 emit，两边照常不同 |

要闭合需要第三个 fixture 尺寸 + 断言签名**随尺寸缩放**而非仅仅不同。没做：这两个 mutation 都是
「把全量扫描换成看似合理的部分扫描」，而上方的计时断言对这类改动是反向可见的（时间会掉）。
记在这里，而不是留给下一轮审计当新发现。`hook-budget.test.sh` 的段头注释与
`docs/ADDING-NEW-HOOK.md` 的表格行都已按这个限度改写——0.68.3 正是栽在「门的宣称大于实际」，
同一处措辞错误不重犯第二次。

**另一处诊断质量问题（未修，记下）**：`session-summary` 的差分维度是 state 条目 Δ（2 vs 1），
而第 2 个条目只在 rule-hits 日志有窗口内行时出现——在 empty HOME 里这取决于**同一轮循环中更早的
subject 写了什么**。任何让更早 subject 在 empty 侧写行的改动，都会让 `session-summary` 变红并
**点错名**。它是响的（不是静默漏），所以不是覆盖缺口，是误归因。彻底修法是每个 subject 一个独立
empty HOME。

以下为原始记录，保留。

---

## 事实

`tests/hooks/hook-budget.test.sh` 的 `REACHED` 是对四类证据的 OR：stdout 非空、stderr 非空（配 exit 0）、rule-hits 日志增长、state 目录写入。任意下游分支产生其中一项就算「到达」。

P1-2 把 `DATA_RE` 派生的对象集从 8 个扩到 11 个，每个配 6,000 条 fixture。评审的两个 mutation 证明其中两个新对象的 reach proof 是空的：

| mutation | 改动 | 结果 |
|---|---|---|
| M5 | `hooks/version-sync.sh:37` 的 `find "$TMP_BASE" -maxdepth 1 -name 'claudemd-sync-*' -mmin +1440 -delete` 换成 no-op | 门仍 PASS（rule-hits 行来自 stale-manifest 分支） |
| M6 | `hooks/residue-audit.sh:48` 的 `find … \| wc -l` 换成 `CURRENT=6000` | 门仍 PASS |
| M7 | `hooks/sandbox-disposal-check.sh:81` 移除 `platform_find_newer` | 门 FAIL（这一个是被区分的） |

另外 M5 里 `DATA_RE` 的 `\$\{TMPDIR` 匹配的是 `TMP_BASE=` 赋值行，不是那次扫描 —— 所以对象集下限 11 也照样成立。三个 hook 顶部注入 `exit 0` 都会被抓到，所以门不是完全空的，它只是宣称的粒度比实际细。

0.68.3 把门的 PASS 文案改成它真正证明的东西（"ran to completion and did observable work"），并在注释里点名这两个未被区分的对象。**文案改了，能力没改。**

## 要做什么

差分探针：每个 `DATA_RE` 对象跑两次 —— 空 fixture 与 6,000 条 fixture —— 断言两次的可观测输出存在差异。删掉扫描会让两次输出相同，门就红。

未做的原因（记下来免得重估）：
- `version-sync` 的扫描效果在文件系统上（`-delete`），不在 stdout；`STATE_BEFORE/AFTER` 量的是 state 目录不是 `$TMPDIR`，所以差分维度得按 hook 分别选，不是一把尺子。
- 空 fixture 的对照组本身要先证明它确实是空的（`feedback_probe_harness_controls_first`）。
- 每个对象多跑一次 = 11 次额外探针，要先量对套件总时长的增量再定，不要拍。

## 相关

- `feedback_gate_scope_must_cover_its_subject` —— 同一根因族。
- 0.68.3 另一条同族（HIGH-2，remote 命令拼写）已修：门改成从源码反查调用拼写。
