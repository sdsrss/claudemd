# 提示词审计修复（2026-11-20）：规范 v8.6.0
状态：已完成

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
