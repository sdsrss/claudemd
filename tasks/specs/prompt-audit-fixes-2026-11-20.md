# 提示词审计修复（2026-11-20）：规范 v8.6.0
状态：进行中

## 背景与目标

2026-11-20 按 `/doctor prompt-audit` 的方法审了本项目会话加载的配置，这次第一次把 9 个规范模块也纳入范围。报告：`docs/prompt-audit-2026-11-20.md`。
用户的决定（2026-11-20）：6 个补丁全部打上；N8（`orchestrate.md` 的 Cross-session reference）删掉；N11（`~/.claude/rules/context7.md`，每个会话与 context7 MCP 自带说明重复出现）删掉。

目标：把审计里依据充分的改动落进规范源文件，作为 v8.6.0（minor：规则有放宽），提交在 `next-release` 上，随下一批发版发出。

## 范围
- 做：
  - `spec/CLAUDE-extended.md`：N2–N7 六个补丁（`docs/prompt-audit-2026-11-20/all-repo.diff`，补丁目录只在本地）、删除 N8 一节；重建 `spec/spec-modules/`。
  - 版本级联 v8.5.0 → v8.6.0、`spec/CLAUDE-changelog.md`、extended 的 Recent changes 和 Sizing 行。
  - `tests/scripts/spec-structure.test.js` 的钉住项。
  - 删除用户级文件 `~/.claude/rules/context7.md`（不在仓库内，影响本机所有项目）。
- 不做：
  - 插件版本号和发版（随下一批，按发版手册）。
  - 核心 `spec/CLAUDE.md` 的规则文字（这次没有补丁，只随版本号变）。
  - N2b（代理自己的删除条件补挂载点）、F11、F14、B6、B7：审计里只标记，用户这次没有要求改。

## 验收标准
- [x] AC1：extended 里不再有这些文字：`2-5 min tasks`、`3-view`、`self-critique`、`independent sub-tasks in subagents`、`L3 two-tier review`、`L3 build:`、`module overview before changes`、`Investigate → Analyze`、`Cross-session reference`；tmp-sweep 那句带上挂载点条件 — 验证：`grep -c` 逐条计数
- [x] AC2：模块与 extended 一致 — 验证：`node scripts/build-spec-modules.js` 后 `git diff --stat spec/spec-modules` 只含本次改动，`tests/scripts/spec-modules.test.js` 通过
- [x] AC3：规范树一致 — 验证：`node scripts/version-cascade-check.js`、`node scripts/spec-coherence-audit.js --strict`（coreDelta=0, extendedDelta=0）
- [x] AC4：tmp-sweep 整行钉住先红后绿 — 验证：先改钉住值跑 `spec-structure.test.js` 看到失败，打补丁后通过
- [x] AC5：`npm run check` 退出码 0
- [x] AC6：`~/.claude/rules/context7.md` 已删除，`context7-mcp` 技能和 context7 MCP 不受影响 — 验证：`ls` 该文件报不存在；技能文件仍在

## 方案

- 补丁打在 `spec/CLAUDE-extended.md` 上，模块由 `scripts/build-spec-modules.js` 生成（`.claude/rules/spec-edit.md`）。
- 版本：§13 META 规定"rule added / relaxed"为 minor。N4、N5 去掉了 L3 流程里的两项要求（三视角自评、逐个子任务派子代理评审），是放宽，所以是 v8.6.0。没有增删 HARD 规则：被改各节的 HARD 条目（Iron Law #1/#2/#3、Subagent non-convergence、Author ≠ reviewer）标题和规则都保留，`hard-rules.json` 只改 `spec_version`。
- N7 只改 Iron Law #3 的正文，标题不动，因为 `hard-rules.json` 的 `§iron-law-3` 用它做 `section_anchor`。
- N5 保留发版前的那一次独立评审（FULL 第 8 步、lite 第 7 步、`review.md` 的 Author ≠ reviewer）；`orchestrate.md` 里指向第 6 步的 "L3 build" 一行随之删除。
- N8 整节删除：它和核心 §0 Ambiguity、§2.1 "Did we / why → memory first" 管同一件事，自身矛盾，而且放在只有子代理类提示才注入的模块里。
- N11：规则文件正文与 `~/.claude/skills/context7-mcp/SKILL.md` 从 "Use Context7" 起逐字相同。恢复方法：`sed -n '/^Use Context7/,$p' ~/.claude/skills/context7-mcp/SKILL.md > ~/.claude/rules/context7.md`。

## 计划
- [x] S1：先改 tmp-sweep 整行钉住，跑测试看到红 — 覆盖 AC4 — 依赖：无 — 执行：主会话
- [x] S2：打补丁、删 N8、重建模块 — 覆盖 AC1、AC2 — 依赖：S1 — 执行：主会话
- [x] S3：版本级联、changelog、Recent changes、Sizing 不动点 — 覆盖 AC3 — 依赖：S2 — 执行：主会话
- [x] S4：更新段落哈希和标题清单；在 core、OPERATOR、hard-rules、commands、README、tests 里查旧措辞 — 覆盖 AC5 — 依赖：S3 — 执行：主会话
- [x] S5：`npm run check`、提交到 `next-release` — 覆盖 AC5 — 依赖：S4 — 执行：主会话
- [x] S6：删除 `~/.claude/rules/context7.md` — 覆盖 AC6 — 依赖：无 — 执行：主会话

## 决策与进展
- 2026-11-20：用户批准 6 个补丁、删除 N8 和 N11。按 `next-release` 规则只提交不发版。

- 2026-11-20：S1–S6 完成。tmp-sweep 整行钉住先改成新文字，在旧规范上失败（97 通过 / 1 失败），打补丁后通过。README 第 100 行"(spec v8.5.0 §5-EXT)"被版本级联闸门判为现行旧版本号，改为"(spec §5-EXT)"。不发版、不推送；推送和发版随下一批。

## 第二轮（2026-11-20）：审计剩余各项

用户："把剩下的做完了，一起推送 合并 发版 清理"。剩下的指审计第 7 节"仍未处理"的各项。

本仓库（规范 v8.6.0 尚未发布，并入同一版本）：
- [x] R1 N2b：§5-EXT Agent temp residue 加一条"其下没有挂载点"，核心 §8.V4 的摘要同步加上 — 收紧规则 — 验证：整行钉住先红后绿
- [x] R2 F11：核心四行 HARD（§0 Hard-AUTH override、§10 Report shape、Honesty rules、Specificity）旁补理由，标题锚点不动（`hard-rules.json` 用它们） — 验证：整行钉住先红后绿
- [x] R3 N9：`review.md` 两个同名 `## §12 PLUGINS`：构建脚本对同一模块、同一 `##` 段内的后续片段不再重复补标题 — 验证：`spec-modules.test.js` 新用例先红后绿
- [x] R4 N10：核心第 48 行删掉"(spec self-edits: §EXT §13 META)"。上一轮汇报的剩余清单漏列了这一条，按"剩下的"一并处理；本仓库的 `.claude/rules/spec-edit.md` 已写明 spec 改动按 §13 META 走
- [ ] R5 发版：plugin 0.121.0（minor，规范 minor 版本随之发出），按发版手册

不在本仓库：
- [x] R6 converge 汇报格式：`~/.claude/skills/converge/SKILL.md`（用户级、不在任何仓库），汇报改成核心 §10 的三部分
- [x] R7 F14：code-graph-mcp 仓库（用户自己的）`claude-plugin/scripts/adopt.js`、`src/mcp/server/mod.rs`、`tests/routing_bench.rs` 的 "Grep" 写法。已推送到 code-graph-mcp 的 `main`（eaf5dca5），不单独发版，随它下一次发版发出（使用者选 2A）
- [x] R8 B6、B7：mattpocock/skills（第三方）的两句；上游 2026-11-19 的 main 仍有这两句。不向上游提 issue（使用者选 3B）；按使用者"做减法"的要求，在本项目的 `.claude/settings.local.json` 里停用该插件（`claude plugin disable … --scope local`），用户级设置不动

理由的来源（R2，不编造）：
- Hard-AUTH override：v8.0.0 changelog（相邻缺陷进遗留、用户的"精准修改"）、v6.11.0 `[add]` §5 Obvious-follow-on；理由取授权本身的含义：用户批准的是给他看过的范围。
- Report shape：v8.0.0（用户自己的汇报格式），钉住项的 why（`transcript-structure-scan`、`sampling-audit` 按标题和三段名解析）。
- Honesty rules：v8 计划 R1 保留的三条诚实规则；理由取汇报的用途：用户不重跑检查就据此决定下一步。
- Specificity：v6.x changelog 的 30 天审计（被拦的词换成同义词再出现）；理由取可核对性：数字能核对，形容词不能。

- 2026-11-20（第二轮）：R1–R4 完成，并入 v8.6.0（尚未发布）。核心 23,977 → 24,192 字节（+215，余量 808）；extended 38,638 字节。R6 完成：converge 第六步改成 `## 汇报` 三部分，六项内容全部保留、按三部分归位；原文件备份在本会话 scratchpad。R7 在 code-graph-mcp 仓库里另有记录 `tasks/specs/grep-directive-wording.md`。

- 2026-11-20（R8）：停用的依据：10-21 到 11-20 本机 167 个会话里 Skill 调用 13 次，mattpocock 2 次（都是 `pr`，不在本项目）；本项目 31 个会话 0 次。它在每个会话列出 11 个技能（描述约 2.2 KB）。本仓库发布的文件（规范、hooks、commands、scripts、bin）不引用它；`tests/scripts/spec-structure.test.js` 禁止规范写插件技能名的那条检查里有它的前缀，属于通用检查，保留。

## 验证记录
- `node --test tests/scripts/spec-structure.test.js`（只改钉住值、未打补丁）→ 失败（97 通过，1 失败：tmp-sweep 整行钉住）
- `grep -c` 逐条计数（extended，Recent changes 之外）→ 通过（9 条旧措辞 0 处；挂载点条件 1 处）
- `node scripts/build-spec-modules.js` → 通过（9 个模块重建；auth、debug、orchestrate、plan、review 的正文有变化，9 个模块的标题行随版本变）
- `node --test tests/scripts/spec-structure.test.js tests/scripts/spec-modules.test.js` → 通过（108/108）
- `node scripts/version-cascade-check.js` → 通过（v8.6 consistent across 3 file(s); plugin semver 0.120.1 consistent across 5 site(s)）
- `node scripts/spec-coherence-audit.js --strict` → 通过（coreDelta=0, extendedDelta=0；5/5 checks clean）
- `npx --no-install prettier --check tests/scripts/spec-structure.test.js` → 通过
- `npm run check` → 通过（exit=0；node 测试 1811 条，1808 通过、0 失败；shell 套件 OVERALL: all suites passed）
- `npm run smoke` → 通过（SMOKE: 2/2 suite(s) passed）
- `ls ~/.claude/rules/` → 通过（只剩 reply-language.md；`~/.claude/skills/context7-mcp/SKILL.md` 仍在）
- 第二轮：新钉住项和构建用例（只改测试、未改规范）→ 失败（8 条：§8.V4 摘要、挂载点条件、Specificity、Hard-AUTH override、Report shape 覆盖句、Honesty、§2 Hard upgrade、构建不重复标题）
- 第二轮：`node --test tests/scripts/spec-structure.test.js tests/scripts/spec-modules.test.js`（改规范、更新 6 个段落哈希后）→ 通过（112/112）
- 第二轮：`node scripts/build-spec-modules.js` → 通过（只有 `auth.md`、`review.md` 变化）
- 第二轮：`node scripts/spec-coherence-audit.js --strict` → 通过（coreDelta=0, extendedDelta=0）；`node scripts/version-cascade-check.js` → 通过
- 第二轮：`npm run check` → 第一次失败（1 条：Recent changes 段哈希，改 Sizing 行之后没有更新）；更新后通过（exit=0；node 1815 条，1812 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）
- 第二轮：`npm run smoke` → 通过（SMOKE: 2/2 suite(s) passed）
- 第二轮：converge `diff` 原文件与新文件 → 只有第六步变化
- 第二轮：Report shape 理由句原写"the user reads every report in these three places"，与前一句"微改一句话汇报"矛盾，发版前自查时改为"the user finds each part by its heading"；钉住项先改、在旧文字上失败，改后 112/112 通过
