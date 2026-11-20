# 0.121.0：规范 v8.6.0（提示词审计两轮修复）

状态：进行中

## 背景与目标

- 使用者 2026-11-20："把剩下的做完了，一起推送 合并 发版 清理"。
- 本批内容（`next-release` 上 v0.120.1 之后的提交，`main` 是它的祖先，不需要 rebase）：
  - 规范 v8.6.0 第一轮（dc4b34d）与第二轮（审计剩余项），设计记录 `tasks/specs/prompt-audit-fixes-2026-11-20.md`。
  - 模块构建：同一模块回到已开过的 `##` 段时不再重复标题。
  - 只影响仓库自身的：a0445a6（tag 推送不再跑 ci 矩阵）、2414208（run-all 并行跑 shell 套件），以及几份记录。
- 发版节奏：规范改动不属于必须立即发的 (a)–(c) 类；使用者明确要求发版。上一次发版 11-09，本周额度未用。
- 版本号 0.121.0：规范次版本更新时插件发次版本（CHANGELOG 版本策略）。

## 范围

- 做：五处版本号；CHANGELOG 条目（≤3,000 字节）；按发版手册发布；发版后 `next-release` 快进到 `main`。
- 不做：code-graph-mcp 与 mattpocock 两项（不在本仓库，见设计记录 R7、R8）。

## 计划

- [x] S1：从 `next-release` 切出 `release/v0.121.0`；五处版本号；CHANGELOG 条目单独扫描
- [x] S2：`npm run check`、`npm run smoke`
- [ ] S3：提交、推送、开 draft PR；PR CI 全绿
- [ ] S4：发版前评审（新开的评审代理）
- [ ] S5：合入 `main`、带注释的 tag、GitHub Release；main 的 ci、npm-publish、`npm view`、`_npmUser`
- [ ] S6：`next-release` 快进到 `main` 并推送；删除已合并的本地分支

## 决策与进展

- 2026-11-20：`main` 的 CI（c7b3603，ci run 42768838781）为绿；`main` 与 `origin/main` 一致。
- 2026-11-20：`next-release` 上本批新增两个提交：1a27e61（模块构建不重复 `##` 标题）、85d3a50（v8.6.0 第二轮）。
- 2026-11-20：CHANGELOG 条目 2,161 字节，单独扫描通过。
- 2026-11-20：切分支后、评审前自查发现 85d3a50 的 Report shape 理由句写"every report"，与"微改一句话汇报"矛盾；在 `next-release` 上修（ec5dfb8），发版分支快进。

- 2026-11-20：PR CI run 44812798047 失败，与本批改动无关：`ubuntu-latest` 在 11-10 到 11-20 之间从 ubuntu-24.04 换成 ubuntu-26.04（镜像 20261116.202.1，GCC 15，默认 C23），bash 3.2 缓存 10 天未用已被回收，从源码重编时 `make` 报 "too many arguments to function 'list_reverse'"（C23 下 `()` 表示无参数），之后还有 GCC 14 起默认为错误的隐式函数声明。在 ubuntu:26.04 容器里复现；`CC="gcc -std=gnu17 -fpermissive"` 加 bison 可以编出 3.2.57(2)-release。改 `.github/workflows/ci.yml` 属于 CI 配置（硬授权），已请使用者授权。
- 2026-11-20：第一轮评审（新开的评审代理，c7b3603..197d1b5）：Critical 0、High 0、Medium 2、Low 12（L12 在范围外、早于本批）。逐条对照代码核实后处理：
  - M1（改规范，先写失败钉住）：核心 §11 "Multi-task / subagent / cross-session → `orchestrate.md`"，而 v8.6.0 删了该模块唯一的跨会话内容。改为 "Multi-task / subagent → `orchestrate.md`"。
  - M2（改 hook 文字，先写失败用例）：`hooks/tmp-sweep.sh:141` 的临时根占满提示列出 Agent temp residue 的"全部条件"，缺挂载点一条。补上；`tests/hooks/tmp-sweep.test.sh` 用例 13 先改，修复前 19/20，修复后 20/20。
  - L1、L2、L3、L10（CHANGELOG，使用者会读）：bind mount 不被 `tmp-sweep` 识别；"leaves alone"改为"asks first"；"no longer has"改为"no longer requires"；补上删掉的第 6 步指针。M2 之后"hooks 未变"不成立，标题和 Not changed 一并改。
  - L4（改规范）：lite 升级到 FULL 时"Re-run step 3"，而第 3 步已改为按需；改为重跑第 2、4 步（使用者重新确认计划和风险）。
  - L5（改规范）：FULL 第 6 步 "TDD per task" → "per slice"；同类的 lite 第 7 步 "per-task drift" → "per-slice drift"。
  - L6、L7、L8（改规范理由句）：Hard-AUTH "approving a task is not approving each hard step in it or what the work turns up"；Specificity "a reader can check a claim that says what was measured, and against what"；Honesty "the reader of a report did not watch the work"。
  - L9（规范 changelog）：Why 的引文补全为 "for review, verification, or to double check your work"，并写明保留发版前评审的原因（§12 Author ≠ reviewer）。
  - L11（测试标签）：四个钉住项的版本标签改为 v8.6.0，随本轮一起改。
  - L12（范围外，不在本次 diff）：`/claudemd-clean-residue --apply`（`scripts/clean-residue.js:202`）递归删除前不查挂载点。记为遗留与待办。

## 验证记录
- `npm run check`（发版分支，版本号已改）→ 通过（exit=0；node 1815 条，1812 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）
- `npm run smoke` → 通过（SMOKE: 2/2 suite(s) passed）
- `node scripts/version-cascade-check.js` → 通过（v8.6 consistent across 3 file(s); plugin semver 0.121.0 consistent across 5 site(s)）
- 评审修复：新钉住和改动的钉住（7 条）在旧文字上失败，修后 `spec-structure` + `spec-modules` 116/116 通过
- 评审修复：`bash tests/hooks/tmp-sweep.test.sh` → 修前失败（19/20），修后通过（20/20）
- 评审修复：`BASH32_BIN=<容器里编的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过（44/44 套件）
- 评审修复：`npm run check` → 通过（exit=0；node 1819 条，1816 通过、0 失败、3 跳过；shell 套件 OVERALL: all suites passed）；`npm run smoke` → 通过（2/2）
- 评审修复：CHANGELOG 条目 2,589 字节，单独扫描通过；`version-cascade-check`、`spec-coherence-audit --strict`（coreDelta=0, extendedDelta=0）通过
