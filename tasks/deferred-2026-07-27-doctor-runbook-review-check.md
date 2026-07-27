# ~~Deferred~~ DONE (v0.61.0, 2026-07-27 同日): /claudemd-doctor 增加 runbook review-step 检测(advisory)

**闭环记录**:用户"提交代码发版"点名不留尾巴 → 当日实现。`scripts/lib/runbook-review-check.js` + `tests/scripts/runbook-review-check.test.js`(RED-first ×2:模块缺失、flow 级抑制)+ doctor 接线(ADVISORY 名单)。首次实地运行即抓到手工排查漏掉的第 7 个文件(gsd `feedback_release_process.md`,文件名不含 runbook/ship),已补;上线态 9/9 runbook 全带 review 步骤。下文原方案照旧保留(lib/doctor 注释引用本文件)。

**来源**:2026-07-27 v0.60.0 发版事故的跨项目排查。spec v6.24.0 已加 `§EXT §12 Gated = missing` 条款,但同日扫描发现 6/6 项目的 ship runbook / release 流程文件**全部缺 review-before-tag 步骤**(claudemd 的是 `self-review /` 二选一,其余五个是整步缺席)。本次已手工补齐 6 个文件;本任务是让 doctor 把这个缺口变成可持续检测。

**用户问过"能不能插件更新时自动覆盖 runbook"——结论:检测,不覆盖**,理由(已向用户说明,记录在此防重议):
1. runbook 是各项目会话作者的 durable memory,自由文本、流程各异(sgc 有 bundle-parity 段,ubuntu-sec 是 ①-⑤ prose,loop-eng 是编号清单)——脚本模式改写 = 在不理解语义的 prose 上做 sed(前科:`feedback_sed_line_based_misses_multiline`、`feedback_self_referential_marker_regex`)。
2. 本次扫描实证 keyword 定位双向失效:预期的 `self-review` 反模式在 runbook 里 0 命中(真缺陷是**缺席**,无处可替换);而修好的 claudemd runbook 反而**含有** "self-review"(作为被点名的降级)——覆盖脚本会漏掉全部 5 个真缺口、误击 1 个已修文件。
3. §3 层级:memory 文件排 user-instruction 级,插件静默改写它是权限倒挂;§5 也是 user-global 批量写。

**要做的**(patch 级,随下一次正常发版搭车,不单独发——OPERATOR.md patch-batching):
- doctor 新增 check `runbook-review-step`(advisory):对每个项目 memory 目录,找 ship-tagged runbook 文件(§11-EXT-MEM ship-runbook consolidation:每项目恰一个;fallback:文件名/描述含 runbook|ship|release 且正文含 tag 流程),检测**是否存在** review-step 指纹(`[Rr]eview.*(BEFORE|之前).*tag` 或引用 `Author ≠ reviewer`)。缺席 → advisory 提示 + 指向 §EXT §12。
- **检测方向必须是"缺席检测"而非"关键词命中"**——见上面第 2 条,`self-review` 字面量会 FP 已修文件。
- 扫描路径守 §8:显式 `~/.claude/projects/*/memory/` + maxdepth,或 Grep 工具。
- 沿用 doctor 现有 cross-layer memory maintenance check 家族的输出格式。

**不做的**:自动改写 runbook;hook 层 deny(prose 匹配 FP 风险,且 doctor 已够——这不是每 turn 都要拦的事)。
