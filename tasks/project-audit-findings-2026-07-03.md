# 项目审计发现 — 2026-07-03

**性质**: 只读审计（架构/功能/代码/规范），无 ship。遵守 internal-freeze（`project_internal_freeze_v02312`）：下列条目是候选决策与到期事项，不是执行队列。
**基线证据**（本次全部现跑）: `npm test` OVERALL all suites passed（含 upgrade-lifecycle v0.2.3→0.23.22）；doctor 25/26 ok（唯一 fail = hook-drift）；spec-coherence 3/4 clean（LOW = core headroom 447B/98.2%）；telemetry 4627/4627 parsed、0 skipped、byFailOpen={}；memory-index 40/40。

## F1 — doctor rule-usage 未过滤 test-session/probe 行（新发现，待合批修复）

- **证据**: 同一 30d 窗口，doctor `rule-usage:§7-ship-baseline` deny=17 vs `audit.js`（走 `excludeTestSessions`，audit.js:42）deny=9（+8 = v0.23.20 记载的 8 条 `session_id='s'` 合成行）；`§8-rm-rf-var` 121 vs 100（+21）；`§8-npx` 7 vs 6。grep 证实 `scripts/doctor.js` 全文无 `excludeTestSessions` 引用（doctor.js:405 直接 `groupBySection(recentHits)`）。
- **影响**: doctor 的 "§0.1 demotion candidate" 判定（doctor.js:446）输入含探针噪声。本窗口全部 ratio 仍落 healthy 带，未产生错误 verdict —— 潜伏测量偏差，非活跃误判。与 v0.23.20/21/22 同类（telemetry 消费侧视图漏同步的第 4 例）。
- **修复方向**（二选一，随下次合批 release 出，不单独 ship）:
  1. doctor.js 取数处加一行 `excludeTestSessions`（最小 diff）。
  2. 根治类问题：`rule-hits-parse.js` 的 API 改为默认返回过滤后数据（`readHits` → raw/real 双轨或新增 `readRealHits`），让"忘记过滤"成为不可能。改 API 面更大，需同步 4 个 caller。
- **回归测试形状**: fixture 含 ≤7-char sentinel 行 + 真实行，断言 doctor rule-usage 计数 = 过滤后值（当前无此覆盖——doctor 的 rule-usage 分支测试全部用干净 fixture，同 `feedback_test_coverage_shape_fp_class` 教训）。

## F2 — 运行期漂移复发（立即可做，零代码）

- installed 0.23.20 vs repo 0.23.22；doctor hook-drift check 已亮红（`hooks/lib/rule-hits.sh` differs，注释级）。行为级差异在安装侧 `scripts/lib/rule-hits-parse.js`：安装副本仍带 v0.23.21 修掉的 phantom `duplicate_rows_real` bug —— 从插件入口跑 `/claudemd-audit` 会复现已修的误报。
- **动作**: `/plugin marketplace update claudemd` → uninstall → install → `/reload-plugins`（`reference_plugin_update_manual_refresh`）。
- **根治（process，冻结兼容）**: 把"发版后刷新安装"写进 atomic-ship 约定（更新 `feedback_claudemd_ship_from_main_atomic.md` 一行）。06-03 审计原话"下次仍会重现"已应验，这是第二次。

## F3 — 发版粒度 vs OPERATOR §13.1 batching（process）

- 冻结后 27d / 10 patches ≈ 0.37/day（vs 冻结前 2.7/day，−86%）——冻结大体有效。但 2026-06-10 单日 6 个 release（0.23.13–0.23.18），重演 OPERATOR.md:18 点名的 `0.23.1→0.23.7` 反模式；0.23.22 是 0.23.21 tag 后 code-review 才发现的补丁。
- **动作（零代码）**: ship 约定追加 "run `superpowers:requesting-code-review` BEFORE tag"（0.23.21+22 本可归并为一个 release）；同 F2 一并写入 ship memory。

## F4 — main 上 3 个未提交文件（27 天）（立即可做）

- `CLAUDE.md`（+37 行：code-graph-mcp v2 + claude-mem-lite v1 两个 sentinel adoption 块）+ 本目录两个审计 task 文件（untracked）。
- tasks/ 惯例是 tracked（现有 7 个 tracked 同类）；`feedback_deferred_items_to_task_file` 的全部意义在持久化，untracked 不算持久。`.npmignore` 是白名单，CLAUDE.md 不进 npm tarball，提交无分发副作用。
- **动作**: docs-only commit（先例 a6e437b/d14b07a，不 bump 版本）。

## F5 — 两个带日期的到期项

1. **R5（§10-V 压缩评估）到期 2026-07-10**，预检（07-03）已满足压缩判据：30d banned-vocab deny token 全集 = `robust`×8 / `Comprehensive`×4 / `should work`×2，全部 ⊆ top-5 quick-check，长尾 0 命中 → 按 R5 判据 §EXT §10-V 全表无增量拦截价值，压缩 ~700B（extended 91.2%→~89.8%）。走 spec L3 流程，与 R2/R3 攒批合并与否到时定。
2. **§13.1 self-audit cadence 过期 ~12 天**: 22/22 规则 `last_demote_review=2026-05-24`，cadence = 4 周（OPERATOR.md:15），06-21 已到期。`demoteCandidates=[]`（第三次空，勿推 demote——`feedback_demote_needs_data_not_intuition`），实质动作 ≈ 复盘 lessons + 刷新 review stamp；本次审计已覆盖大部分内容。顺带观察：`cadenceWarning=null` 与 staleCount=22 并存，hard-rules-audit 的 warning 判据可能没接 staleReviews——低优先，随 F1 合批时看一眼。

## F6 — 外部验证信号（冻结判据复核）

- GitHub（repo 创建 2026-04-20，~10 周）: 2 stars / 0 forks / 0 open issues / 0 watchers。npm `claudemd-cli` 3611 downloads（2026-05-30→06-28），无互动佐证，无法区分真实用户 vs mirror/bot/CI。
- **结论**: 冻结逻辑继续成立。建议设一个复核点（~2026-09，repo 半岁）：仍零互动 → 按冻结 memo "the right move is to stop" 分支，接受完成态，停止周期性内部审计。

## 遗留项复核（06-13 findings，全部维持原状）

- R1（§8 deny→advisory 通道）: 触发条件未满足——30d 内 §8 FP-fix patch = 1（0.23.19）< 3；§8 军备竞赛 06-13 后静默 19 天。维持观察。
- R2/R4（core 不可达口袋 / 积压批处理）: spec 未动（hash 全 match），维持 parked。
- R3（audit cross-project 归一化）: 维持 parked。
- R6（路由表 vs harness 原生 Agent）: 本窗口无真实冲突。
- memory-read-check bypass 9/19=47%: reason 分布 ≥4/9 为手测探针（"sandbox test" 类）→ 真实比率 ~26%，带内，维持现状。
