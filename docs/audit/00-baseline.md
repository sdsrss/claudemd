# 00 — 基线（2026-09-05，v0.75.0 @ 9ce1460）

> **本文件记录的是 ② 审计当时（`9ce1460`）的快照。** 同日 ③ 优化轮之后的数字见文末
> 「③ 之后」一节；下轮对比请以那一节为起点。原始 JSON：`metrics-2026-09-05.json`（前）
> 与 `metrics-2026-09-05-after.json`（后），两者都是 `npm run metrics` 的产物、均不入库。

本文件是重构轮次的起点快照。所有数字由 `scripts/baseline-metrics.js` 产出，原始 JSON 存于
`docs/audit/metrics-2026-09-05.json`；下轮用同一命令重跑后对照。

> 说明：审计时 `docs/audit/` 按 `.gitignore` 的 `docs/*` 规则为纯本地文件，上一轮
> （2026-09-02 R11）的报告与基线在本机已不存在，本快照是重新建立的第一份。同日 ③ 的
> P2-3 把 `docs/audit/*.md` 加入跟踪白名单（生成的 JSON 仍留本地），`docs/` 整体依旧不进
> npm 包。

## 一键命令（均已在 `package.json` scripts 中，无需 Makefile）

| 目的 | 命令 | 备注 |
|---|---|---|
| 全部测试 | `npm test` | = `bash tests/run-all.sh`：72 node 套件 + 28 hook 套件 + 4 集成套件 |
| 仅 node 测试 | `npm run test:scripts` | |
| 仅 hook 测试 | `npm run test:hooks` | |
| lint 全链 | `npm run lint` | = `lint:argv` → `version-check` → `lint:sh`（shellcheck warning+）→ `lint:js`（eslint）→ `format:check` |
| 格式化 | `npm run format` / `npm run format:check` | prettier，仅 JS |
| 覆盖率 | `npm run test:coverage` | c8 包住 node 测试腿；bash hook 无行覆盖 |
| 本基线全部指标 | `npm run metrics` / `node scripts/baseline-metrics.js --json` | 见下 |
| lint + test | `npm run check` | |

本次基线采集命令（原样可复跑）：

```bash
node scripts/baseline-metrics.js --json > docs/audit/metrics-$(date +%F).json
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^PASS:|^FAIL:|OVERALL"
npm pack --dry-run --json
```

## 指标

| 指标 | 值 | 口径 |
|---|---|---|
| 文件数（git ls-files） | 341 | 全部跟踪文件 |
| 总行数 | 78,540 | 全部跟踪文件 |
| 代码文件数 / 行数 | 178 / 52,441 | `.js` `.mjs` `.sh`，排除 `tests/fixtures/` |
| 超过 50 行的函数 | **59**（JS 52 / bash 7） | JS 用 acorn 精确跨度（114 文件）；bash 用列 0 花括号配对（64 文件） |
| 重复代码率 | **1.65%**（861 / 52,308 行，104 处克隆） | jscpd，`bin/ scripts/ hooks/ tests/`，min 5 行 / 50 token；JS 2.40%，bash 0.22%；104 处中 85 处为 test↔test |
| 循环依赖 | **0** | 静态 import / `source` 图：63 节点，116 边 |
| 测试覆盖率（node 腿） | 行 **92.55%**（11,949 / 12,910）· 分支 86.05% · 函数 96.44% | c8，`bin/` + `scripts/`；hook 套件只计数不测行 |
| lint 错误数 | **0** | shellcheck warning+ 0（info 293 / style 1 不阻塞）· eslint 0 错 0 警 · lint-argv 0 · version-cascade ok · prettier 0 未格式化 |
| 测试结果 | node **1044 pass / 0 fail / 0 skipped**；bash **725 PASS / 0 FAIL**；`OVERALL: all suites passed`，exit 0 | 本机 Linux，node 24 |
| npm 包体积 | 7 文件，unpacked 106,341 B / packed 37,585 B | `claudemd-cli`；CHANGELOG 等未进包 |

### 按顶层目录

| 目录 | 文件 | 行 |
|---|---:|---:|
| tests/ | 190 | 34,036 |
| scripts/ | 41 | 12,823 |
| docs/ | 17 | 9,941 |
| (root) | 12 | 7,839 |
| hooks/ | 21 | 6,640 |
| tasks/ | 34 | 3,747 |
| spec/ | 5 | 2,046 |
| bin/ | 1 | 568 |
| commands/ | 16 | 458 |
| .github/ | 2 | 411 |
| .claude-plugin/ | 2 | 31 |

### 最大的 10 个文件（全部）

| # | 文件 | 行 |
|---|---|---:|
| 1 | CHANGELOG.md | 5,490 |
| 2 | docs/superpowers/plans/2026-04-21-claudemd-plugin.md | 4,705 |
| 3 | hooks/pre-bash-safety-check.sh | 1,774 |
| 4 | package-lock.json | 1,598 |
| 5 | scripts/doctor.js | 1,244 |
| 6 | scripts/sampling-audit.js | 1,113 |
| 7 | docs/superpowers/plans/2026-07-05-statusline-adopt.md | 1,062 |
| 8 | tests/scripts/doctor.test.js | 1,032 |
| 9 | tests/scripts/clean-residue.test.js | 977 |
| 10 | docs/superpowers/plans/2026-07-06-statusline-coexistence.md | 946 |

### 最大的 10 个代码文件

| # | 文件 | 行 |
|---|---|---:|
| 1 | hooks/pre-bash-safety-check.sh | 1,774 |
| 2 | scripts/doctor.js | 1,244 |
| 3 | scripts/sampling-audit.js | 1,113 |
| 4 | tests/scripts/doctor.test.js | 1,032 |
| 5 | tests/scripts/clean-residue.test.js | 977 |
| 6 | scripts/baseline-metrics.js | 897 |
| 7 | tests/scripts/sampling-audit.test.js | 868 |
| 8 | tests/hooks/memory-read-check.test.sh | 819 |
| 9 | tests/scripts/install.test.js | 811 |
| 10 | tests/hooks/hook-budget.test.sh | 787 |

### 超过 50 行的函数（非测试代码，按长度）

| 文件:行 | 函数 | 行数 |
|---|---|---:|
| scripts/doctor.js:120 | doctor | 1,069 |
| scripts/install.js:80 | install | 377 |
| bin/claudemd-lint.js:154 | lintCmd | 240 |
| scripts/status.js:147 | status | 196 |
| hooks/pre-bash-safety-check.sh:110 | sanitize_cmd | 186 |
| scripts/uninstall.js:53 | uninstall | 183 |
| scripts/hard-rules-audit.js:48 | hardRulesAudit | 165 |
| bin/claudemd-lint.js:395 | auditCmd | 145 |
| hooks/lib/rule-hits.sh:164 | rule_hits_append | 140 |
| scripts/lesson-bypass-audit.js:183 | lessonBypassAudit | 129 |
| scripts/sampling-audit.js:663 | samplingAudit | 126 |
| scripts/lib/lint.js:97 | stripIdentifiers | 107 |

其余 47 个在 51–99 行之间；完整清单见 JSON `longFunctions`。测试文件内的匿名 test 回调占 JS 52 个中的 17 个。

### 覆盖率最低的 5 个文件（行）

| 文件 | 行 % | 分支 % |
|---|---:|---:|
| scripts/version-cascade-check.js | 73.78 | 72.34 |
| scripts/safety-coverage-audit.js | 75.10 | 84.72 |
| scripts/baseline-metrics.js | 75.36 | 74.81 |
| scripts/lib/statusline-hosts.js | 88.11 | 90.24 |
| scripts/toggle.js | 88.15 | 86.66 |

### 非测试代码的克隆（jscpd，≥5 行）

| 行数 | A | B | 性质 |
|---:|---|---|---|
| 18 | scripts/audit.js:151 | scripts/hard-rules-audit.js:209 | main 块 argv 样板 |
| 16 | scripts/audit.js:153 | scripts/sparkline.js:192 | 同上 |
| 8 ×6 | scripts/audit.js:153 | clean-residue.js:470 / doctor.js:1187 / lesson-bypass-audit.js:315 / safety-coverage-audit.js:428 / status.js:341 / … | 同上 |
| 15 ×3 | scripts/install.js:459 | lint-argv.js:255 / uninstall.js:238 / update.js:95 | 无 argv 契约版 main 块 |
| 14 | scripts/design-detect.js:379 | scripts/statusline-adopt.js:26 | realpath 版 main 守卫 IIFE |
| 11 ×2 | scripts/safety-coverage-audit.js:426/437 | scripts/spec-coherence-audit.js:616/630 | 输出/退出码尾巴 |
| 11 | hooks/session-start-check.sh:455 | hooks/session-start-check.sh:525 | banner 合并 jq 程序 |
| 10 | hooks/memory-read-check.sh:48 | hooks/ship-baseline-check.sh:48 | PreToolUse:Bash hook 前导 |
| 10 | scripts/lint-argv.js:155 | scripts/lint-argv.js:207 | 扫描循环 |
| 6 | hooks/lib/hook-common.sh:595 | hooks/pre-bash-safety-check.sh:253 | awk 引号状态机（语义有意不同，见审计"不建议做"） |

## 架构文档

`docs/ARCHITECTURE.md`（264 行）已含：四层模块清单（模块→职责→对外接口）、静态依赖图、6 条主流程（每条 ≤5 步）、不变量、状态文件清单、hook 分类表。本轮核对：19 个 `scripts/*.js|sh`、19 个 `scripts/lib/*.js`、15 个 hook、16 个 command、72/28/4 套件数均与当前树一致；`tests/scripts/architecture-drift.test.js` 在 `npm test` 中对状态路径与 `spec_section` 表持续把关。无需重写。

---

## ③ 之后（同日，`audit/2026-09-05-round12` 分支 6 次提交后）

同一命令复算。文件与总行数的增量全部是本轮入库的两份审计报告，不是代码增长。

| 指标 | ② 基线 | ③ 之后 |
|---|---:|---:|
| 跟踪文件 / 总行 | 341 / 78,540 | 343 / 78,898 |
| 代码文件 / 行 | 178 / 52,441 | 178 / 52,484 |
| 超 50 行函数（JS + bash） | 59（52 + 7） | 59（52 + 7） |
| 重复率 | 1.65% | 1.36% |
| 克隆 / 其中非测试 | 104 / 19 | 91 / 6 |
| 循环依赖 | 0 | 0 |
| 覆盖率 行 / 分支 / 函数 | 92.55 / 86.05 / 96.44 | 93.06 / 86.41 / 96.46 |
| node 测试 | 1044 / 0 | 1049 / 0 |
| bash 测试 | 725 / 0 | 728 / 0 |
| shellcheck warning+ / eslint / prettier / lint-argv | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| npm 包（文件 / packed） | 7 / 37,585 B | 7 / 38,359 B |

最大的 3 个代码文件（不变）：`hooks/pre-bash-safety-check.sh` 1,774；`scripts/doctor.js` 1,235（−9）；`scripts/sampling-audit.js` 1,110（−3）。

剩余非测试克隆 6 处，逐条去向见 `2026-09-05-audit.md` 的「下轮关注点」。
