# hook-budget 的 reach proof 不区分它要证明的那条路径

来源：0.68.3 pre-tag review, MEDIUM-2。**未修，随 0.68.3 发布时明确留下。**

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
