# 提示词审计修复与 0.113.0 发版
状态：进行中

## 背景与目标
2026-10-17 的 `/doctor prompt-audit`（`docs/prompt-audit-2026-10-17.md`）给出 25 个补丁和 4 处冲突。使用者的指示（2026-10-17）：
- gsd：给一份提示词，使用者到 gsd-lite 仓库执行。
- gstack：使用者自己卸载；规范里不再调用它。
- 规范改动：已授权。
- 其余按审计报告的建议执行，做完后发版并清理。

## 范围
- 做：
  - 规范：核心 §2.1 删掉 gstack 的 UI 验证子句（C06 随之作废）和"module overview before 3+ Reads"（C07）；§8 遍历规则的理由（C02）；§7 推送前查 CI 补理由（C08）；extended §11-O 报告渠道（冲突 i，按实测数据改）；extended §6 / §7-EXT 两处 "(core §2.1)" 指针；OPERATOR.md 降级阈值的说法（D#399）。规范版本 v8.1.0 → v8.2.0。
  - 本仓库命令：B8 `claudemd-rules.md` 的版本考古，B9 `claudemd-clean-residue.md` 的节号。
  - 项目文件：P01 `.claude/settings.json`（claudeMdExcludes，要实测是否生效），P04/P05 `release-reviewer.md`，P10 `CLAUDE.md`。
  - 用户级：U03 `~/.claude/rules/reply-language.md`，S-M10/S-M11 `~/.claude/skills/converge/SKILL.md`，发版 runbook 记忆里报告渠道的说法。
  - gsd-lite 提示词（冲突 ii、iii 写进去）。
  - 发版 0.113.0：连同 next-release 上已有的 D#404、D#357、perf-baseline、D#405。
- 不做：
  - C09（§11 不要提前停）：按原建议先进 D#328 消融（10-29 复扫时决定），这次不合入。
  - gstack 卸载（使用者自己做）；冲突 iv（gstack 文案）随卸载作废。
  - 插件 B1–B7（claude-mem-lite、mattpocock）：只报告，修法在上游。

## 验收标准
- [x] AC1：核心与 extended、模块、hard-rules、OPERATOR、commands、README 里不再有把 UI 验证路由到 gstack 的文字 — 验证：`grep -n -i gstack spec/CLAUDE.md spec/CLAUDE-extended.md spec/spec-modules/*.md`
- [x] AC2：规范树一致 — 验证：`node scripts/version-cascade-check.js`、`node scripts/spec-coherence-audit.js --strict`（coreDelta=0, extendedDelta=0）
- [x] AC3：`npm run check` 退出码 0
- [x] AC4：P01 实测：同一读取动作，无 settings 时出现 `spec/CLAUDE.md` 的 nested_memory，有 settings 时不出现 — 验证：两次无头 `claude -p` 会话记录对比
- [ ] AC5：0.113.0 发版：PR CI 绿、发版前评审完成、tag 的 ci 和 npm-publish 绿、`npm view claudemd-cli version` = 0.113.0

## 方案
- 报告渠道（冲突 i）实测：本项目会话记录中，带 `name` 派出的代理经 idle notification 回报，结果被截在 4064 字符并附 "[result truncated — ask the agent for the rest via SendMessage]"（10-16 至 10-17 的 0.111/0.112 评审全部如此）；不带 name 的后台代理经 task-notification 回报，结果完整（10-17 最长 35,521 字符）。所以 extended 的 "4000" 只对带名派出成立；runbook 的"约 5 KB"不对；release-reviewer 的 1500 是自设上限。改法：评审和审计不带名派出，完整报告放在最终消息里。
- `/plugin update`（冲突 iii）：官方文档 code.claude.com/docs/en/discover-plugins 会话内只有 `/plugin` → Installed → Update now，外壳里是 `claude plugin update <plugin>@<marketplace>`（`claude plugin update --help` 也有）。gsd 的 `/plugin update gsd` 错，claudemd 的说法对，不改。
- gsd 的 TDD 例外（冲突 ii）：建议 gsd-lite 把迁移、CI/CD、部署配置类 task 在计划阶段至少定为 L2（需要独立审查），TDD 豁免不降低审查级别、不跳过用户确认。
- §2.1 删除 gstack 子句后不指定替代工具：chrome MCP "慢且不可靠"的说法来自 gstack 自己的文档，没有本仓库的证据，留给 harness 列出的工具。

## 计划
- [x] S1：规范文字改动 + 版本级联 + changelog + pins + 模块构建 — 覆盖 AC1、AC2 — 执行：主会话
- [x] S2：B8/B9 命令文字 — 覆盖 AC3
- [x] S3：项目文件 P01/P04/P05/P10 + P01 实测 — 覆盖 AC4
- [x] S4：用户级 U03/S-M10/S-M11 + runbook 记忆
- [x] S5：`npm run check`、CHANGELOG、六处版本号 — 覆盖 AC3
- [ ] S6：按 runbook 发版 — 覆盖 AC5
- [ ] S7：gsd-lite 提示词；清理

## 决策与进展
- 2026-10-17：C09 不进本次发版（见范围）。
- 2026-10-17：冲突 i 以实测为准（见方案）。
- 2026-10-17：0.112.0 的 CHANGELOG "Not changed" 里还有一条规范文字待随下次规范发版：extended §11-EXT-MEM 的 `<encoded-cwd>`。一并改为 `<encoded-git-root>`（c9df0e9）。
- 2026-10-17：`.claude/settings.json` 原本被 `.gitignore` 的 `/.claude/*` 忽略；加例外改为跟踪，因为 release-reviewer 在 worktree 里运行，未跟踪的文件到不了那里。
- 2026-10-17：converge 的 L8（描述改写）只是建议、没出补丁；gstack 卸载后技能清单的构成会变，这次不改。
- 2026-10-17：本地 A/B 脚本 `tasks/{skill-ab,v8-ab,merged-branch-ab,r6b}/run-ab.mjs` 会复制 `~/.claude/skills/gstack/SKILL.md`，gstack 卸载后会报错；D#328 的消融脚本要去掉这一步。
- 提交：e556f41（规范 v8.2.0）、f85c1a3（命令 B8/B9）、d8f0441（项目文件）、c9df0e9（记忆路径）。

## 验证记录
- `node --test tests/scripts/spec-structure.test.js tests/scripts/spec-modules.test.js` → 通过（97/97）
- `node scripts/version-cascade-check.js` → 通过（v8.2，6 处 0.113.0 一致）；`node scripts/spec-coherence-audit.js --strict` → 通过（coreDelta=0, extendedDelta=0）
- AC1 `grep -n -i gstack spec/CLAUDE.md spec/CLAUDE-extended.md spec/spec-modules/*.md` → 通过（只剩 Recent changes 里的历史说明 1 行）
- AC4 无头 `claude -p`（haiku，`--setting-sources project,local`）读 `spec/hard-rules.json`：无 settings 时出现 `spec/CLAUDE.md` 的 nested_memory，有 settings 时没有（`spec-edit.md` 照常载入）；读 `tasks/skill-ab/A/` 下文件：无 settings 时载入该目录 `CLAUDE.md`，有时 0 个 → 通过。4 份探针会话记录已删除。
- `( trap '' PIPE; npm run check )` on c9df0e9 + version bump → 通过（exit 0；node 1545/1546，1 个因 SHFMT 未设置跳过；全部 shell 套件通过；shellcheck 94 个文件；bash 3.2 运行时步骤因 BASH32_BIN 未设置跳过，hooks 在此前各提交上已用 bash 3.2.57 跑过）
- `npm run smoke` → 通过（2/2）
