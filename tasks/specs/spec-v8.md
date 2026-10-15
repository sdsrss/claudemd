# 规范 v8.0.0：对齐 Opus 5.5 / Claude Code 2.1.301，汇报改三段式，歧义自己决定
状态：进行中

## 背景与目标

分析见 `docs/spec-optimization-plan-2026-10-15.md`（第 8 节是用户 2026-10-15 的决定）。目标：

- 规范只写 harness 没写、或比 harness 更严、或与 harness 冲突时要裁决的内容；
- 汇报改成用户的三段式（变更 / 验证 / 遗留），信号只剩 `[AUTH REQUIRED]`；
- 低风险、可逆的歧义自己决定、记下来继续，问题统一放到汇报末尾；
- spec 文件改用用户的模板，交接写进 spec；
- 承重的约束不动：先复现、先红、打 tag 前独立评审、§5 硬授权清单、§8、完成声明附本会话证据。

## 范围

- 做：
  - 核心 `spec/CLAUDE.md` 改写为 v8.0.0；extended 的 auth / plan / verify / review / debug / session / memory / orchestrate / ship 各段随之改；删 `modes` 模块（HACK / EMERGENCY / §0.2-EXT），AUTONOMOUS 的要点并入核心 §5；
  - `transcript-structure-scan.sh`、`scripts/sampling-audit.js`、`evidence-gate.sh` 认三段式，旧的四段式照认（采样审计要读 30 天历史）；
  - `spec-status-drift` 测试认新模板的"状态："行；
  - `doctor` 加 `MEMORY.md` 索引行长度提示；
  - 钉子、哈希、hard-rules、规范版本级联、CHANGELOG、README、项目 CLAUDE.md、OPERATOR.md 同步；
  - 发版前 A/B（Opus 5.5，插件加载），打 tag 前独立评审。
- 不做：
  - 不删任何 HARD 规则（§13 META：删除要先挂 30 天宽限），只改写内容，编号不变；
  - 不改 `rework-breaker.sh`（G2 窗口到 10-26）、不改 `evidence-gate` 的通道（G1b 修订：任何给模型的通道要先过 0.8 精确率）；
  - 不改 `session-start-check.sh` 的检查点横幅、`session-end-check.sh` 的检查点写入（没有 spec 的任务仍用它）；
  - 不在 10-26 之前合入 `main` 或打 tag；
  - claude-mem-lite 的召回减量（提示词已给用户，在那个仓库做）。

## 验收标准

- [x] AC1：核心不大于 v7.3.0（23,182 B），且不含 `[PARTIAL`、`Four-section`、`HACK`、`EMERGENCY`、`modes.md` — 验证：`wc -c spec/CLAUDE.md; grep -c -E '\[PARTIAL|Four-section|HACK|EMERGENCY|modes\.md' spec/CLAUDE.md`
- [ ] AC2：26 条 HARD 规则全部还在，锚点都能在规范里找到 — 验证：`node --test tests/scripts/hard-rules-drift.test.js`
- [ ] AC3：全套检查绿 — 验证：`npm run check`、`npm run smoke`
- [ ] AC4：三段式汇报被 `transcript-structure-scan` 和 `sampling-audit` 同样判定，四段式仍被识别 — 验证：`node --test tests/scripts/structure-scan-parity.test.js`、`bash tests/hooks/transcript-structure-scan.test.sh`
- [ ] AC5：`evidence-gate` 把"变更"段当作完成声明，"未运行 / 无法运行"豁免 — 验证：`bash tests/hooks/evidence-gate.test.sh`
- [ ] AC6：A/B（Opus 5.5，每格 10 次）B 臂：L0/L1 技能调用 0；先复现、先红、打 tag 前评审都不低于 A 臂减 1；三段式汇报 ≥ 9/10；歧义任务中途提问 0/10 且写下决定 ≥ 9/10 — 验证：`tasks/v8-ab/RESULT.md`
- [ ] AC7：打 tag 前独立评审无未修的 Critical / High — 验证：评审报告路径记在验证记录里
- [ ] AC8：10-26 之后合入 `main`、打 tag、发布，tag 的 ci 与 npm-publish 绿 — 验证：`gh run list -R sdsrss/claudemd --commit <sha>`

## 方案

**核心结构**（节号不变，避免 hook 遥测和模块引用大面积改名）：

- §0 SPINE：流程一行；歧义规则（可逆就决定、记录、继续；只在硬授权边界或不可逆分歧时问，问题放汇报末尾）；Hard-AUTH override（HARD，改写：相邻问题只报告不顺手修）；信号只剩 `[AUTH REQUIRED]`；中途反馈三行。
- §1 语言与原则：语言条款通用化（回复用用户的语言，可由用户级规则固定；通知、hook 文字、子代理报告不改变它）；原则换成用户的六条（英文）。删 Recommend-first（两种模型的 harness 都有）、Zero-assume（被歧义规则取代）。
- §1.5 只留 Module、Evidence、Contract；LOC 和 Local-Δ 删（分档不再按行数）。
- §2 四档按风险定义；硬升级清单原样；spec 文件要求；§2.1 工具与技能（Skills 行原样）；§2.2 模块索引去掉 modes。
- §3 基本不动；加一句：规范与 harness 默认冲突时（提交、汇报标题）以规范为准。
- §5 Hard 清单原样；子代理的未授权部分写进遗留；新增"无人在场"一行（定时任务不执行硬授权操作，写进汇报或 `tasks/pending-auth-<date>.md`）；§5.1 去掉 aggressive 的仪式豁免（已成默认），Never-downgrade 改成覆盖全部 §5 Hard。
- §7：各档验证一表；git 一段（逐改动提交，覆盖 harness 默认）；Iron Law #2 改写成"验证段里写跑了什么、看到什么"；Evidence beyond green tests 原样。
- §8：删模式名；V4 改为"临时文件进 harness 的 scratchpad，别处的产物汇报前自己删"。
- §10：三段式（HARD，编号沿用 `§10-four-section-order`，内容改为"汇报形状"）；Honesty、Specificity 保留并压缩。
- §11：压缩后重读 spec；记忆三行；MEMORY.md 必读（HARD）原样；turn-yield 压缩（Opus 5.5 的 harness 没有"结束回合前检查"那段，所以保留）；session-exit 改为写进 spec，没有 spec 才写 paused。

**为什么删除范围比计划文档窄**：计划文档第 2 节的 harness 原文是在 Fable 5.1 的交互会话里读的。2026-10-15 用 Opus 5.5 的无头会话（bypass 模式）逐字引用系统提示词（`tasks/spec-v8-2026-10-15/sysprobe-opus55-p-bypass.md`），"自主推进不中途问""结束回合前检查""任务范围""写作格式""先说要做什么"这几段都不在。只删两边都有的：该行动就行动与给推荐、如实报告、记忆四类与索引、压缩后继续、子代理委派与通知。

**hook**：三个解析汇报的脚本新旧格式都认。三段式的判定：三部分标题都出现时必须按 变更 → 验证 → 遗留 的顺序；验证段每条要带 通过 / 失败 / 未运行 / 无法运行（英文 passed / failed / not run / could not run）之一。`evidence-gate`：出现"变更 / Changes"段即视为完成声明；验证段含"未运行 / 无法运行 / not run / could not run"时豁免，等同旧的 `[PARTIAL`。

## 计划

- [x] S1：hook 与采样审计认三段式（新旧并存）— 覆盖 AC4、AC5 — 依赖：无 — 执行：主会话
- [x] S2：核心与 extended 改写为 v8.0.0，重建模块，钉子 / 哈希 / hard-rules / 规范版本级联同步 — 覆盖 AC1、AC2、AC3 — 依赖：S1 — 执行：主会话
- [x] S3：`spec-status-drift` 认新模板 — 覆盖 AC3 — 依赖：S2 — 执行：主会话
- [x] S4：`doctor` 的索引行长度提示 — 覆盖 AC3 — 依赖：无 — 执行：主会话
- [x] S5：README、项目 CLAUDE.md、OPERATOR.md、ARCHITECTURE、RULE-HITS-SCHEMA 同步 — 覆盖 AC3 — 依赖：S2 — 执行：主会话
- [ ] S6：A/B — 覆盖 AC6 — 依赖：S2 — 执行：主会话驱动脚本
- [ ] S7：发版提交（插件 0.109.0）、推分支、草稿 PR、CI 绿 — 覆盖 AC3 — 依赖：S1–S6 — 执行：主会话
- [ ] S8：打 tag 前独立评审与修复 — 覆盖 AC7 — 依赖：S7 — 执行：release-reviewer
- [ ] S9：10-26 之后合入、打 tag、发布 — 覆盖 AC8 — 依赖：S8，且两个评估窗口已关 — 执行：主会话，需用户发话

## 决策与进展

- 2026-10-15：用户决定见计划文档第 8 节。汇报格式和交接文件两项用户交给作者定：采用三段式；有 spec 的任务只在 spec 里交接，没有 spec 的保留检查点文件，`tasks/lessons.md` 退役。
- 2026-10-15：不删 HARD 规则，只改写，编号保留，避开 §13 META 的 30 天宽限，也让遥测按 `hook_version` 分段即可。
- 2026-10-15：保留 §11 Correction pressure（两次被否决就改为先问），计划文档原说删。理由：自主决定变多以后，它是唯一的刹车。
- 2026-10-15：R10 的 hook 部分不做：`sandbox-disposal-check` 扫的是 `/var/tmp` 和 `~/.claude/projects` 里编码了临时目录的项目目录，scratchpad 是被认可的位置，不需要它认；`session-extended-read` 只是遥测，不改。
- 2026-10-15：AC1 原定核心 ≤ 15,000 B，改为"不大于 v7.3.0"。原因：计划文档估计的 12 KB 建立在"harness 已写的段落都删"上，Opus 5.5 的系统提示词里缺其中五段，这五段的规则只能留在规范里；核心实测 23,182 → 22,946 B。
- 2026-10-15：§0 Ambiguity 按用户原话写成"低风险、选错代价小的自己定并记下；代价大、撤不回、碰到硬授权的，先做完不依赖答案的部分再问"。依据采样审计 H4（30 天、197 份转录）：被回答的 183 次提问里只有 4 次是附和，达不到预注册的 50% 翻转线，所以代价大的那一半保留提问。
- 2026-10-15：git 默认"在当前分支提交"并写明覆盖 harness 的先开分支：用户的仓库 60 天里在 main 上直接提交 517–955 次、几乎没有合并提交。
- 2026-10-15：§5 No user present 去掉了"任务提示授权的硬操作可以执行"的例外：它会让提示里点名的生产依赖绕过 `[AUTH REQUIRED]`（T4 测的正是这个）；无人在场收窄到定时、循环、远程触发。
- 2026-10-15：spec 模板在 extended 的代码块里整体缩进两格，因为结构测试和模块构建都把行首 `#` 当标题。
- 2026-10-15：`tasks/lessons.md` 在本仓库是被跟踪的文件；规范不再用它，但删除被跟踪文件要授权，这次不删，记在遗留。
- 当前进行到：S6（A/B）。

## 验证记录

- `claude -p --model opus --permission-mode bypassPermissions`（系统提示词逐字引用）→ 通过，结果存 `tasks/spec-v8-2026-10-15/sysprobe-opus55-p-bypass.md`
- `node scripts/sampling-audit.js --global --days=30 --json`（H4）→ 通过：183 次被回答的提问，4 次附和
- S1 `npm run check` → 通过（提交 2b57e45）
- `bash tests/hooks/evidence-gate.test.sh` → 通过 51/51；27、29 在旧 hook 上失败，28 在去掉豁免的变异上失败
- `node --test tests/scripts/structure-scan-parity.test.js` → 通过；去掉 JS 侧"未运行"的变异上失败
- `node scripts/spec-coherence-audit.js --strict` → 通过（0 发现）
- `node scripts/version-cascade-check.js` → 通过
