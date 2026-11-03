# 闸门准确率修复：banned-vocab 提交信息路径对齐、倍数按完整数字匹配、doctor 按实际拦截排序

状态：进行中

## 背景与目标

- 2026-10-04 → 11-03 的转录与遥测（`docs/claudemd-effect-assessment-2026-11-03.md`，本地文档）：banned-vocab 30 天 13 次非探针拦截，0 次真阳性；13 条在 0.119.0 上仍然拒绝。其中 2 条的禁用词只出现在反引号里：hook 的提交信息路径（Path 1）不剥反引号和路径，而文字路径（Path 2）和 `claudemd-cli lint` 都剥，同一条说明，CLI 放行、hook 拒绝。
- 倍数正则 `\b[0-9]+(x|×)` 从小数尾巴开始匹配：原文 `1.8x slower`，遥测和拒绝提示里写成 `8x slower`（3 行）。
- 记忆闸门 46 次拦截里 21 次误报，13 次来自一个标签（daagu 的 `origin`，11-03 已删）。doctor 的 `memory-tag-specificity` 列出 128 个静态候选，不按实际拦截排序；拦截行只记文件，不记是哪个标签命中的。
- 目标：Path 1 和另外两条路径用同一个剥离；倍数记录完整数字；doctor 先列出实际造成过拦截的记忆文件和命中标签。

## 范围

- 做：
  - `hooks/banned-vocab-check.sh`：剥离抽成一个函数，Path 1 和 Path 2 共用。Path 1 只对模式扫描用剥离后的文字，基线豁免仍看原文。文件头注释写明 `-F <文件>` 不读文件内容（使用者 11-03 选 B：只写明，不补覆盖）。
  - `hooks/banned-vocab.patterns`：英文倍数行改成 `\b[0-9]+(\.[0-9]+)?(x|×)…`。
  - `hooks/memory-read-check.sh`：拦截行的 `extra` 增加 `tags`（每个未读文件命中的标签），只加字段，判定不变；`docs/RULE-HITS-SCHEMA.md` 同步。
  - `scripts/doctor.js`：`memory-tag-specificity` 读最近 30 天 `memory-read-check` 拦截行，按（项目, 文件）计数，≥3 次的排在详情最前面，带上命中标签（旧行没有标签时写明未记录）。
  - 对应测试；随下一个批次发版（本周非紧急额度已满）。
- 不做：
  - 引号（`"…"`）里的词不剥：引号里也可能是模型自己的话，放宽范围说不清。
  - `-F <文件>` 读文件内容（使用者选 B）。
  - 改 §8 闸门。
  - 改 memory-tags 匹配器本身。

## 验收标准

- [ ] AC1：Path 1 对只出现在反引号片段、代码块、路径里的禁用词放行；同样的词去掉反引号仍然拒绝；反引号里的基线箭头仍然豁免倍数。验证：`bash tests/hooks/banned-vocab.test.sh`，新增用例 58–62 中 58、60、61 在改动前失败。
- [ ] AC2：真实命令回放（转录里 4,758 条含 git/commit 的命令，改动前后两版 hook），allow→deny = 0；deny→allow 只出现在 AC1 描述的条件里，逐条列出。验证：`tasks/transcript-analysis-2026-11-03/bvreplay.py`（gitignored）。
- [ ] AC3：`perf: 1.8x faster` 拒绝，提示和遥测里是 `1.8x faster`；hook 与 `scripts/lib/lint.js` 一致。验证：用例 63（改前失败）、`node --test tests/scripts/lint.test.js`，以及引擎 parity 测试。
- [ ] AC4：memory-read-check 拦截行带 `tags`，判定不变。验证：`bash tests/hooks/memory-read-check.test.sh` 新增用例（改前失败）。
- [ ] AC5：doctor 在有 ≥3 次拦截的文件时，详情第一段列出它、次数和标签；没有时输出不变。验证：`node --test tests/scripts/doctor.test.js` 新增用例（改前失败）；在本机跑 doctor，读 `memory-tag-specificity` 一行。
- [ ] AC6：`npm run check` 退出 0，`npm run smoke` 为 SMOKE 2/2。

## 方案

- **剥离函数**：`bv_sanitize` 只包一份现有的 Path 2 管道（共享的 fence awk 加同一个 `sed -E` 程序）。`sanitize-stage-parity.test.js` 要求文件里只有一条 sanitize `sed -E` 行，抽成函数正好满足。
- **判定可能变化的条件**：Path 1 的命中只出现在被剥掉的区域里。剥离用空格替换片段，所以对用单个空格连接的多词模式（如 `should work`）不会拼出新命中；只有两条带 `[[:space:]]+` 的倍数模式理论上可能拼出新命中（`3x \`y\` faster`）。这种情况由回放计数，记为残留。基线豁免用原文判断，所以不会因为剥离丢掉豁免。
- **倍数正则**：新增的可选分组 `(\.[0-9]+)?` 不改变匹配集合（带小数的串，原式在小数点后已能匹配）；POSIX 和 JS 都取最左匹配，所以报出的是完整数字。模式文件只用于匹配，没有反向引用。
- **doctor**：复用 doctor 已经读入的遥测行；计数按 `project` + `extra.missing[]`；阈值 3。

## 计划

1. 写失败用例（banned-vocab 58–63，lint、memory-read-check、doctor 各一组），跑一次确认失败。
2. 改 hook、patterns、memory-read-check、doctor。
3. 回放、全量测试、smoke。
4. 分三个提交：Path 1 剥离加 `-F` 说明；倍数完整匹配；拦截行标签加 doctor 排序。

## 决策与进展

- 2026-11-03：使用者对评估文档 §9 的回复是"1.删掉 2.要做 3.按你建议做 4.不做"。daagu 的 `origin` 标签已删（回放：Sentry 那条记忆的命中 67 条命令 / 20 个会话 → 0）。

## 验证记录

- （待填）
