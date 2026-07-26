# 2026-07-26 深度审计 — 延后项

来源：`docs/comprehensive-audit-2026-07-25-v0.57.0-deep.md`（5-agent 全扫）+ 发版前两轮独立评审（pre-ship / js-diff）。
已在 v0.58.0 / v0.58.1 / v0.59.0 处理的不在此列。

**处置结果**：A+B 两档已于 v0.59.0 全部执行（见下）。C 档是有意保留的残余，D 档是给下一次全审的方法论约束。

---

## A + B — 已全部清空（v0.59.0，2026-07-26）

原列 17 项（A 档 5 MEDIUM + B 档 12 LOW）在 v0.59.0 一次处置完毕：15 项修复，2 项（B6/B10）经发版前评审实测证伪后撤回并留档。逐项落点见该版 CHANGELOG；本节保留标题以免 CHANGELOG 与报告的引用断链。

一句话汇总：A1 review cadence 与审计窗口解耦（新 `REVIEW_CADENCE_DAYS=90`，无法解析的日期计入 stale）；A2 `status.js` 改用 `settingsPath()`；A3 `EMIT_CAP` 改从 hook 源码解析；A4 version-cascade 加"零 token 也算 offender"的存在性下限；A5 无 `ts` 的日志行不再算作窗口内。B1 `projectsRoot()`/`projectDir()` 进 `paths.js` 并接管 5 处调用；B2 `--help` 任意位置可用；B3 install-drift 补 `missing-in-source` 反向；B4 session-summary 横幅在升级/全新安装路径可达（四态实测单 JSON 对象契约成立）；B5 非字符串 `session_id` 不再静默丢弃；B6 **撤回**（前提不成立：`lint` 扫调用者直接给的文本，`audit` 扫助手 transcript，token 在后者是无心提及；hook 自身也只从命令读、不从散文读）；B7 通用 catch 退出 1 而非 argv 的 2；B8 SKIP 不再渲染成绿；B9 `which()` 每个二进制只 spawn 一次；B10 **撤回**（前提不成立：`12/12` 改前改后都被抹平，且无任何 ratio pattern 匹配 N/M 形）；B11 parity 测试钉住 LC_CTYPE 并加 C-locale 退化下限；B12 hard-rules-4 的 id↔section 命名空间前提改为显式断言。

---

## C. 已接受残余（有新证据再开，勿重复上报）

- §8 sink 侧 option-with-arg wrapper：`curl … | sudo -u root bash` / `| env -i bash` / `| nice -n 10 bash` 仍放行。fetch 侧走 `s8_strip_wrappers` 已在 F24 闭合，sink 侧是纯正则 `CURLSH_WRAP`、不消费选项。HEAD 之前即如此，非回归。修它要么给正则加 optarg 模型、要么把 sink 也走词循环，都不是局部改动。
- §8 其他：`"bash" -c '…'` 引号 runner + 间接组合、`xargs bash`、herestring `sh <<< "$(curl)"`（sanitize 先剥引号体，属结构限制）。
- 非 BMP cwd 编码跨语言分叉。
- §10-V 中文 path FP 类（双引擎一致，故非接缝）。
- **§8-rm-rf-var 对沙箱自清理的误拦**：方向已两次判负（文本位置 ≠ 命令位置），28 条 F21 corpus 钉死。唯一安全出路是 harness 侧产出 mktemp 形状的 scratch 路径。**勿再从文本扫描放松门。**

---

## D. 方法论（下次全审必读）

2026-07-26 这轮打破了连续五轮「生产级、同一结论」的记录，根因是**探针同质化**：前几轮都在既有 corpus 形状分类学的邻域采样。下次全审必须换出发点——bash 文法的 simple-command 前缀文法、枚举完备性论证——而不是在既有 corpus 邻域加行。详见 `project_audit_2026-07-25_v0570_deep.md`。
