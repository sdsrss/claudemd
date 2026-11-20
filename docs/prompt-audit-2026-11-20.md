# 提示词审计：本项目会话加载的 Claude Code 配置（2026-11-20）

方法：等同 Claude Code `/doctor prompt-audit`。用它交给 claude-api 技能的范围原文，按随附的 `shared/prompt-audit.md`（本机 2.1.326 起的版本，哈希 `df5bbf4a`；10-17 那次用的是 2.1.302 的版本）依次执行：盘点、来源、模式扫描、报告、建议 diff。只出报告和补丁，**没有改任何被审文件**。

补丁目录：`docs/prompt-audit-2026-11-20/`
- `patches/`：6 个补丁，每条发现一个，各自都能打在当前未修改的 `spec/CLAUDE-extended.md` 上（`git apply --check` 7/7 通过，含合并版）。
- `all-repo.diff`：合并版。

上一次：`docs/prompt-audit-2026-10-17.md`。逐条对照见第 4 节。

## 0. 前提

- **目标模型**：Claude Opus 5.5（`claude-opus-5-5`），即本会话的模型。`.claude/agents/release-reviewer.md` 自己固定了 `claude-opus-5-5`，结论相同。code-graph 插件的 `code-explorer` 固定 `sonnet`，它只报告、不改。
- **跨模型说明**：`~/.claude/CLAUDE.md` 和 `~/.claude/spec-modules/*.md` 是本仓库 `spec/` 的安装副本（逐字节相同，本次已核对 10/10），随插件发给所有用户，也会进入子代理。官方迁移指南对 Sonnet 5.5 和 Haiku 5.5 在 `low` effort 下的建议方向相反：加继续工作和验证的文字。所以凡是删减验证、委派类文字的建议，都单独写了跨模型风险。
- **范围**：
  - 项目内：`CLAUDE.md`；`.claude/rules/hook-shell.md` 和 `spec-edit.md`（按 `paths:` 加载）；`.claude/agents/release-reviewer.md`；嵌套的 `spec/CLAUDE.md` 和 `tasks/**/CLAUDE.md`（32 个评测夹具），只查加载行为，不逐行审。
  - 用户级（每个项目都加载）：`~/.claude/CLAUDE.md`；`~/.claude/rules/context7.md`、`reply-language.md`；`~/.claude/skills/converge/SKILL.md`、`context7-mcp/SKILL.md`。
  - 本次经你同意加入：`~/.claude/spec-modules/` 下 9 个模块（由 claudemd 的 hook 按提示词匹配注入；10-17 那次没审）。它们是 `spec/CLAUDE-extended.md` 的构建产物（`spec-edit.md`），所以补丁打在 extended 上，模块重新构建得到。
  - 插件提供的、**只报告不改**：claude-mem-lite 6.35.4 的 8 个命令、claudemd 0.120.1 的 16 个命令、code-graph-mcp 0.204.0 的 2 个技能和 1 个子代理、mattpocock-skills 1.3.1 本会话列出的 11 个技能。只做了信号扫描和 10-17 那批发现的复查，没有逐行通读。
- **未审，并说明原因**：
  - 不存在的：祖先目录的 `CLAUDE.md`/`AGENTS.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md`、`.claude/commands|skills|output-styles`、`~/.claude/commands|agents|output-styles` 下的文件（gsd 和 gstack 已卸载）、托管策略文件（`/etc/claude-code/` 不存在）。
  - 按要求不读的：settings 文件、`.mcp.json`、`~/.claude.json`。
  - 不在这次清单里的：hook 注入给模型的文字（`hooks/*.sh` 的 `additionalContext`）、自动记忆 `MEMORY.md`、`.claude/plugin_*.md`（项目 `CLAUDE.md` 按路径指向，不是 `@` 导入）、停用的插件（superpowers 7.0.2 等）。
- **第 4 组（请求构造代码）**：范围内没有，不适用。子代理花名册检查见第 3 节末尾。
- **第 3 组（工具描述）**：项目没有自定义工具；技能和子代理的描述按路由文字看过。

## 1. 摘要

要出补丁的发现全在 9 个模块里；核心规范和项目文件这次只有 Low 和只标记的条目。影响最大的三条：

1. **L3 流程里留着 superpowers 和 gstack 的方法（N3–N5，Medium，影响所有用户）。**
   - `plan.md` 的 §4.FULL 要求"2-5 分钟一个的任务"、"CEO/设计/工程三视角自评"，以及"独立子任务派子代理、每个子任务派新子代理评审、§5 硬类分两阶段评审"。
   - 这些是 2026-04-21 从 `sp:writing-plans`、`gs:/autoplan`、`sp:subagent-driven-development` 抄来的。10-15 的 v7.3.0 删掉了技能名，方法原样留下了。
   - 官方 Opus 5 迁移说明讲得很直接：为 Opus 4.8 加的"多委派"文字要删，"不要用子代理做评审或复核"，自查类指令会造成过度验证。Opus 5.5 一节把这些列为"以它为起点、逐条复测"的对象。
   - 建议：保留发版前那一次独立评审（Author ≠ reviewer），去掉逐个子任务的子代理评审，以及计划粒度和自评视角的规定。
2. **`debug.md` 的 Iron Law #3 是四步套路（N7，Medium）。** "Investigate → Analyze → Hypothesize → Implement" 是 superpowers systematic-debugging 的四个阶段（2026-04-21）。核心 §1 "Fix at the root" 已经用平实的话说了同一件事。补丁保留标题（`hard-rules.json` 用它做锚点），只把正文换成目标和理由。
3. **`auth.md` 对 tmp-sweep 的描述漏了挂载点条件（N2，High，已在待办 D#754）。** hook 从 0.120.0 起不删本身是、或里面有其他文件系统挂载的目录（`scripts/housekeeping.js:316-319`），规范的这句话没跟上。另外，同一节里给代理自己用的删除条件也没有这一条，这是安全规则，只标记、不出补丁（N2b）。

**计数**：

| 切片 | High | Medium | Low / 只标记 | 主要分组 |
|---|---|---|---|---|
| 核心规范 + 9 个模块 | 1 | 5 | 6 | 第 1 组 7 条，第 2 组 5 条 |
| 项目文件（CLAUDE.md、路径规则、release-reviewer） | 0 | 0 | 1（F14，插件维护的块） | 第 2 组 |
| 用户级规则和技能 | 0 | 0 | 2 | 第 1 组 1、第 2 组 1 |
| 插件（只报告） | 0 | 2 | 1 | 第 1 组 2 条，第 3 组 1 条 |

第 3 组：只有插件里 1 条（只报告）。第 4 组：不适用。

## 2. 盘点

| 面 | 文件 | 加载时机 | 字节 |
|---|---|---|---|
| 全局核心 | `~/.claude/CLAUDE.md`（= `spec/CLAUDE.md`，v8.5.0） | 每个会话 | 23,977 |
| 规范模块 | `~/.claude/spec-modules/*.md` ×9（= `spec/spec-modules/`） | 提示词匹配时 hook 注入；没有触发词的（auth、session、verify）靠核心 §2.2 指引去读 | 合计 37,520 |
| 项目指令 | `CLAUDE.md`（含 claude-mem-lite、code-graph-mcp 维护的两个标记块） | 本项目每个会话 | 4,276 |
| 路径规则 | `.claude/rules/hook-shell.md`（`hooks/**`）、`spec-edit.md`（`spec/**`） | 碰到匹配文件时（10-21..11-20 的 30 份记录里：38 次、8 次） | 718 / 1,363 |
| 子代理 | `.claude/agents/release-reviewer.md`（opus-5-5，effort high） | 被派出时；描述每会话进清单 | 5,609 |
| 嵌套 CLAUDE.md | `spec/CLAUDE.md` + `tasks/**/CLAUDE.md` ×32 | 已被 P01 的 `claudeMdExcludes` 排除（同期 0 次载入） | 各约 23 K |
| 用户规则 | `~/.claude/rules/context7.md`、`reply-language.md` | 每个会话 | 1,658 / 209 |
| 用户技能 | `~/.claude/skills/converge`、`context7-mcp` | 描述每会话进清单；正文调用时 | 13,716 / 1,776 |
| 插件 | mem-lite 8 个命令、claudemd 16 个命令、code-graph 2 个技能和 1 个子代理、mattpocock 11 个技能（共 38 个文件，其余被隐藏） | 同上 | — |

## 3. 发现

字段：位置｜原文｜模式（指南的组/行）｜为什么｜置信度｜处理。模块的位置写成"安装后的模块文件:行（extended 源码:行）"。"全局"表示改动影响所有项目；改 `spec/` 还会随发版影响所有用户（L3，按 `spec-edit.md` 的流程走）。

### 3.1 High

**N2（High，全局）tmp-sweep 那句漏了挂载点条件**
- 位置：`spec-modules/auth.md:56`（extended:50）。
- 原文："The plugin's `tmp-sweep` hook deletes an `agent-tmp-*` directory once no mtime or ctime in it is within 72 h, it holds no socket or FIFO and it has no `.keep`"
- 模式：第 2 组"易过时的具体事实"。仓库本身和它矛盾。
- 为什么：`hooks/tmp-sweep.sh:17-19` 和 `scripts/housekeeping.js:24, 316-319` 还要求目录"neither is nor holds a mount of another filesystem"（0.120.0 加入）。规范 v8.5.0（11-03）早于这次修改。待办 D#754 已经记了这一条。
- 处理：补上这个条件（补丁 `N2-tmp-sweep-mount-condition`）。

**N2b（只标记，安全规则）代理自己的删除条件也没有挂载点这一条**
- 位置：`auth.md:51-54`（extended:45-48）。
- 为什么：hook 不删挂载点，但给代理的 "Agent temp residue" 条件（owner、非符号链接、24 h、无 `.keep`）没有这一条。代理按这节对 `agent-tmp-*` 跑 `rm -rf`，会进入挂载的文件系统。
- 处理：指南要求，冲突一方是安全规则时只标记、不出补丁。如果要改，就在第 52 行加"and it neither is nor holds a mount of another filesystem"。这一条收紧规则，不是放宽。

### 3.2 Medium

**N3（Medium，全局）计划粒度"2-5 min tasks … code"**
- 位置：`plan.md:64`（extended:117）。
- 原文："2-5 min tasks with file paths / code / verify steps."
- 模式：1c 过度规定 + 1d 化石。
- 为什么：来自 `sp:writing-plans`（v7.3.0 前的原文是"**Plan**: sp:writing-plans. 2-5 min tasks …"，2026-04-21 引入）。那是为较弱的执行者把计划切碎、并把代码写进计划的做法。指南说现在模型的计划通常优于手写脚本。这句还和同一文件第 33 行的模板（`S1：<slice> — 覆盖 AC1 — 依赖 — 执行`）不一致。
- 处理：改为"slices, each with the files it touches and how it is verified"（补丁 `N3-plan-task-granularity`）。

**N4（Medium，全局）三视角自评**
- 位置：`plan.md:65`、`:84`（extended:118、137）。
- 原文："3-view self-critique (CEO / design / eng) on user request or auth/payment/crypto/cross-module ≥5. Default: user reviews + inline eng self-critique (1 paragraph)." 和 "Plan self-critique: inline 3-view (CEO / design / eng)."
- 模式：1c 过度规定；Opus 5 一节的 "Self-check instructions are the same trap"。
- 为什么：三个视角就是 gstack `/autoplan` 的三个评审技能（v7.3.0 前写作 "gs:/autoplan … inline 3-view self-critique"）。gstack 已在 10-17 卸载。官方说明：要求模型自查会触发额外工作；Opus 5.5 要复测这类指令。用户评审（第 2 步）和 §5 AUTH 的 risk 字段都保留。
- 处理：FULL 第 3 步改为"(optional, on user request): review the plan from the angles the user names."；lite 第 3 步改为"Plan review: as FULL.3."。步骤编号不变，`plan.md:93` 的 "Re-run step 3" 仍然成立（补丁 `N4-plan-three-view-self-critique`）。

**N5（Medium，全局，有跨模型风险）逐个子任务派子代理做评审**
- 位置：`plan.md:68`、`:88`，`review.md:17`，`orchestrate.md:28`（extended:121、140、282、269）。
- 原文："TDD per task, independent sub-tasks in subagents; fresh-subagent review per sub-task, 2-stage (spec, quality) on §5-hard ones."；"Per-task review collapsed into step 7."；"L3 two-tier review: a fresh-subagent review per sub-task, then one pre-ship review across the whole change."；"L3 build: `plan.md` §4.FULL step 6."
- 模式：1d 化石，是指南为 Opus 5.5 点名的复测对象（Opus 5 时期的过度验证指令）。
- 为什么：
  - 这是 `sp:subagent-driven-development` 的做法（v7.3.0 前写作 "per-task in sp:subagent-driven-development"）。
  - Opus 5 一节原话：为 Opus 4.8 加的 "delegate more" 指引应删掉；子代理"Do NOT use … for review, verification, or to double check your work"；删掉验证脚手架"reduces over-verification with no capability regression"。
  - 09-27 的一次统计（记在 `project_prompt_audit_2026-09-26` 记忆里，本次没有重算）：09-05 起本机交互会话派出 492 个子代理，其中 416 个是评审或审计。评审本来就是这里最大的子代理成本。
- 保留：`review.md:15` 的 Author ≠ reviewer，以及 FULL 第 8 步和 lite 第 7 步的那一次发版前独立评审。
- 跨模型：如果子代理用 Sonnet/Haiku 写代码，逐任务评审能接住更多问题。补丁只删"必须逐任务派评审"，主会话仍可以自己决定派。
- 处理：见补丁 `N5-per-subtask-subagent-review`（4 处，`orchestrate.md:28` 的指针随之删除，否则会指向一个不再讲子代理的步骤）。

**N6（Medium，全局）`orchestrate.md` 里的策略提示**
- 位置：`orchestrate.md:29`（extended:270）。
- 原文："Impact analysis before structural modifications; module overview before changes to unfamiliar code."
- 模式：1c 策略指导。
- 为什么：10-17 的 F7 已经把同一句从核心 §2.1 删掉了（那次没审模块）。删掉它，什么合法、怎么衡量成功都不变。前半句和核心 §2.1 "Export-surface edit → impact analysis first (feeds §5 AUTH)" 重复，核心那句因为连着 AUTH 而保留。来源是 2026-04-21。
- 处理：删除（补丁 `N6-orchestrate-strategy-coaching`）。

**N7（Medium，全局）Iron Law #3 的四步套路**
- 位置：`debug.md:25`（extended:162）。
- 原文："Investigate → Analyze → Hypothesize → Implement (with §7 evidence). Symptom-only fixes banned at L2+."
- 模式：1c 给判断型任务规定步骤。
- 为什么：这是 superpowers systematic-debugging 的四个阶段，2026-04-21 引入。核心 §1 "Fix at the root. Reproduce first, state the chain from trigger to symptom, then change" 已经说了目标。
- 处理：标题不动（`hard-rules.json` 的 `§iron-law-3` 用它做 `section_anchor`），正文改为目标和理由（补丁 `N7-iron-law-3-choreography`）。

### 3.3 Low / 只标记

**N8（只标记，第 2 组冲突，涉及禁令）`orchestrate.md:32-33` 的 Cross-session reference**
- 原文："User says "上次/之前/yesterday" → scan `tasks/` … confirm "你说的是 `<slug>`?"; ASK only if no match. **Multi-candidate**: ≥2 matches → … ASK; never guess."
- 问题：
  - 自身矛盾："confirm"本身就是问，后面又说"只在没匹配时问"。
  - 与更新的核心冲突：核心 §0 Ambiguity（v8.0.0，10-15）说低风险时选一个、记下来、继续做；核心 §2.1 说 "Did we / why" 先查记忆。这一条写于 04-21。
  - 加载不上：它在只有"并行/子代理"类提示才注入的模块里，而它的触发条件是"上次"。
- 为什么不出补丁：旧的一方含"never guess"禁令，指南要求这种冲突只标记。需要你决定：删掉这一节，交给核心 §0 和 §2.1；还是把它移进核心 §2.1 并改成与 §0 一致。

**N9（Low）`review.md:12` 和 `:20` 两个相同的 "## §12 PLUGINS" 标题。** extended 里 §12 分成两段，各自生成了一个同名标题。"PLUGINS" 这个名字是 v7.2 插件路由时代留下的，现在这节讲的是评审和修复。不影响行为，不出补丁。

**N10（Low）核心 `spec/CLAUDE.md:48` "(spec self-edits: §EXT §13 META)"。** 这是只对本仓库有意义的指针，却写在发给所有用户的核心里。§13 只在 extended 里，没有任何模块带它，而核心第 62 行又说 extended "do not read it whole"。不出补丁。

**F11（Low，10-17 遗留，仍未处理）HARD 行旁没有理由。** 核心第 11、161、168、172 行。仓库里仍找不到可以直接引用的理由。10-23 的决定是不做 K9 消融；只有某条规则在真实会话里测到违反时，才对那一条做配对回放（`docs/spec-model-capability-review-2026-10-15.md` §9.5）。

**F12（只标记，维持）验证类规则**：核心 Iron Law #2、§7 Evidence beyond green tests、`verify.md` 的 Evidence validity。Opus 5.5 一节把 Opus 5 时期的过度验证指令列为复测对象，但这些条款管的是"报告完成时要拿出证据"，不是"多加一步验证"。官方对 `low` effort 的 Sonnet/Haiku 5.5 的建议是加验证文字。维持 09-29、10-15、10-17 的保留决定。N5 是其中唯一一处真的在规定"派子代理复核"的文字，所以单独出了补丁。

**F14（只报告，插件维护的块，10-17 遗留）**：项目 `CLAUDE.md:45` "Still use Grep for literal strings/regex in non-code files"。本会话没有 Grep 工具。本机 Claude Code 2.1.329 里有 `EMBEDDED_SEARCH_TOOLS` 开关，所以 Grep/Glob 是否提供大概取决于构建和配置；这是推断，没有读到它的判定代码。这段由 code-graph-mcp 插件维护（按你的偏好保留并提交），要在插件上游改。

**N11（只标记，全局）`~/.claude/rules/context7.md`**
- 原文："Use even when you think you know the answer"，以及"whenever the user asks about a library … even well-known ones like React …"
- 模式：1a 的"If in doubt, use [tool]"类加码。但它是路由文字，指南的保留清单第 6 条允许路由文字带校准过的力度，所以只标记。
- 另外两点：
  - 规则文件正文与 `~/.claude/skills/context7-mcp/SKILL.md` 正文逐字相同（本次 diff 为空），context7 MCP 服务器自己的说明里也有几乎相同的一段，所以每个会话里这段话至少出现两次。
  - 它的触发比核心 §2.1 宽："Unfamiliar or possibly stale fact → look it up (context7 / official docs / web search)"。两边都在 `~` 下，规则文件不在 git 里，排不出先后。
- 需要你决定：保持现状，还是删掉规则文件、只留 MCP 服务器自带的说明。

**converge 汇报格式（只标记，10-17 §3.6 遗留）**：`converge/SKILL.md:131-140` 规定六项汇报，和核心 §10 的 `## 汇报`（变更、验证、遗留）不一致。converge 没有点名它覆盖 §10。核心 §3 让规范优先于技能文字，但两边的文字模型都会读到。

**插件（只报告，修法在上游）**：
- **B6（Medium，仍在）** mattpocock `skills/engineering/diagnosing-bugs/SKILL.md:22`："**Be aggressive. Be creative. Refuse to give up.**"（1a）。
- **B7（Medium，仍在）** mattpocock `skills/engineering/code-review/SKILL.md:66, 72`："Under 400 words."（1f 数字上限）。
- **重叠的评审技能（Low）**：本会话同时列出内置的 `code-review`（"Review the current diff, or a PR …"）和 `mattpocock-skills:code-review`（"Review the changes since a fixed point …"）。属于第 3 组的近义重叠，路由靠描述区分。

**子代理花名册**：`release-reviewer`（项目）、`code-graph-mcp:code-explorer`（插件）和内置代理之间没有重复定义。

### 3.4 核对过、没有发现的

- `.claude/rules/hook-shell.md`、`spec-edit.md`：点到的 11 个路径和符号都存在（`hooks/lib/platform.sh`、`docs/HOOK-PROTOCOL.md`、`scripts/version-cascade-check.js`、`spec-coherence-audit.js`、`build-spec-modules.js`、两个测试文件、`spec/OPERATOR.md`、`hard-rules.json`、`PINNED_BLOCKS`/`HEADING_INVENTORY` 等）。
- `release-reviewer.md`：F4、F5 已修。第 34 行"Report every finding … Do not filter to high severity"正是官方对评审提示的建议（严重度过滤会压低召回）。
- `memory.md` 的行为描述：mem-audit 只扫 `feedback_*.md`（`hooks/mem-audit.sh:140`）；"0-2 char declension tolerance" 在 `hooks/lib/memory-tags.sh:35`。
- `verify.md:58`：commit 文本被拒（`banned-vocab-check.sh`）、聊天正文只提醒（`transcript-vocab-scan.sh`），说法属实。
- `session.md:20` 把 `~/.claude/tmp` 叫作 "tool-exhaust, not WIP"：起初列为候选，核对后撤回。`scripts/clean-residue.js:350-351` 和 `/claudemd-clean-residue` 的说明都把它当作有意的定义（只有带 `.keep` 的目录算 WIP），harness 对 scratchpad 的说明也一致。
- `ship.md:37` 的 Manual-ship atomicity 属于"别提前停"的写法，但发版是脆弱操作，半截的发版有害，在保留清单第 3 条内。
- 信号扫描（核心和 9 个模块）：没有退役模型名、"think step by step"、"try to/if possible"、"you tend to" 类特质描述，也没有"相对旧版"的写法。核心的 25 处大写词里，14 处是 §11 定义的强度等级 "HARD"，其余是 MUST 6、NOT 4、NEVER 1。

## 4. 与 10-17 的对照

| 10-17 | 状态 | 依据 |
|---|---|---|
| F1 嵌套 `spec/CLAUDE.md`、夹具被当指令加载 | 已修，仍有效 | 10-21..11-20 的 30 份记录：`nested_memory` 只有两条路径规则（38、8 次），`spec/` 和 `tasks/` 的 CLAUDE.md 0 次 |
| F2 §8 遍历理由写错目录 | 已修 | 核心第 139 行现在写 `projects/<project>/<session>/tool-results/` |
| F3 reply-language 规则引用旧节名 | 已修 | 现文"Everything else follows core §1 **Language**." |
| F4、F5 release-reviewer 报告渠道、过期路径 | 已修 | 第 54 行"Put the full report in your final message"；描述里没有路径 |
| F6、F7 §2.1 的 gstack 理由、overview 子句 | 已修 | 核心第 56 行已无这两处；同一句在 `orchestrate.md:29` 的副本见 N6 |
| F8 §7 推送前查 CI 没有理由 | 已修 | 第 127 行带"a push onto red CI hides which change broke it" |
| F9 §11"别提前停" | 按决定保留 | C09 没有合入；10-23 决定不花钱做 K6 消融（每臂 20 次检测不出小效应，见 capability review §9.5） |
| F10 项目 CLAUDE.md 考古括注 | 已修 | 第 3 行已无括注 |
| F11 HARD 行缺理由 | **仍未处理**（Low） | 见 3.3 |
| F12 验证类规则 | 维持只标记 | 见 3.3 |
| F13 报告渠道三处说法不一 | 已一致 | `orchestrate.md:24`、`review.md:16`、release-reviewer 第 54 行、runbook 第 7 步都是"不给 name，完整报告放进最终消息" |
| F14 "Still use Grep" | **仍在**（插件块） | 见 3.3 |
| A1–A13（gsd） | 不再适用 | `~/.claude/commands`、`agents` 已为空 |
| H1–H5、M1–M9、L1–L7（gstack） | 不再适用 | gstack 已卸载，`~/.claude/skills` 只剩 converge、context7-mcp |
| M10、M11、L8（converge） | 已修 | 第 133 行已无"10 行"上限；没有"旧版…已删除"；描述 273 B |
| §3.6 converge 汇报与 §10 不一致 | **仍在**（只标记） | 见 3.3 |
| B1、B2、B5（mem-lite） | 已修 | 6.35.4 的命令里已无 `mem_maintain`/`mem_compress`、`/mem:` 命名空间、`zh-CN` |
| B3、B4（mem-lite） | 未复查 | 这次没有逐行读 mem-lite 命令 |
| B6、B7（mattpocock） | **仍在** | 插件仍是 1.3.1 |
| B8、B9（claudemd 命令） | 已修 | `claudemd-rules.md` 已无版本考古；`clean-residue` 引用已无 `§EXT §7-EXT` |

## 5. 建议 diff

| 补丁 | 发现 | 改的源文件 | 重建后变化的模块 | 影响面 |
|---|---|---|---|---|
| `N2-tmp-sweep-mount-condition` | N2 | `spec/CLAUDE-extended.md:50` | `auth.md` | 全局、所有用户 |
| `N3-plan-task-granularity` | N3 | extended:117 | `plan.md` | 同上 |
| `N4-plan-three-view-self-critique` | N4 | extended:118、137 | `plan.md` | 同上 |
| `N5-per-subtask-subagent-review` | N5 | extended:121、140、269、282 | `plan.md`、`orchestrate.md`、`review.md` | 同上 |
| `N6-orchestrate-strategy-coaching` | N6 | extended:270 | `orchestrate.md` | 同上 |
| `N7-iron-law-3-choreography` | N7 | extended:162 | `debug.md` | 同上 |

核心 `spec/CLAUDE.md` 这次没有补丁，用户级文件也没有补丁。

**应用方式**：`git apply docs/prompt-audit-2026-11-20/patches/<名>.patch`，可以挑着打。N3、N4、N5 改的是相邻几行，单独打任何一个都没问题；要打其中两个以上，就用 `all-repo.diff`，或者按顺序打并接受行号偏移。

**打完还要做的**（这些都是 L3 规范改动，按 `spec-edit.md`）：
1. `node scripts/build-spec-modules.js` 重建模块。已在 scratchpad 的临时克隆里试过：合并版打上后重建，5 个模块变化；连同 extended 本身共 6 个文件，14 行增、20 行删。
2. 更新 `tests/scripts/spec-structure.test.js` 的钉住项。同一个克隆里跑 `spec-modules.test.js` + `spec-structure.test.js`：108 条里 102 条通过，6 条失败：§5-EXT、§4 FLOW、§6 DEBUG、§11-O、§12 这 5 段的哈希，以及 tmp-sweep 那一整行的钉住。失败都在预期之内，要逐段确认含义后改钉住值。
3. 规范版本级联、`spec/CLAUDE-changelog.md`、extended 的 Recent changes、Sizing 行的不动点（`spec-coherence-audit --strict`）。
4. 按发版节奏，这些不属于必须马上发版的 (a)–(c) 类，可以放在 `next-release` 上，随下一批发出。

## 6. 验证计划（删减是假设，不是结论）

1. **N2**：纯事实修正，对照 `scripts/housekeeping.js` 即可。合入时把 `tests/scripts/spec-structure.test.js` 里那条整行钉住同步改掉。
2. **N3–N7**：属于"去掉为旧模型写的方法"。§4.FULL 很少真正跑到，真实会话里难以积累样本。可行的检查：
   - 打补丁前后，各用一个 L3 规模的样例任务做一次 `claude -p` 配对回放（沙箱 HOME，按 runbook 的做法），比较子代理派出次数、总 token 和最终是否通过发版前评审。
   - 样本量按 `n = ln(0.05)/ln(1−p)` 先算。如果只想排除"逐任务评审能发现、发版前评审发现不了"的情况，回放成本会很高，那就把这条当作有依据的判断合入，在下一批发版前评审里请评审专门检查 L3 改动。
3. **N8、N11**：需要你先做选择，再出补丁。
4. **插件条目（F14、B6、B7）**：本地补丁只是临时的，要持久就提到各自上游。

## 7. 处置（2026-11-20，同日）

用户的决定：6 个补丁全部打上；N8 删掉；N11 删掉。

- **N2–N7、N8**：作为规范 v8.6.0（minor）提交在 `next-release` 上，随下一批发版发出。设计记录 `tasks/specs/prompt-audit-fixes-2026-11-20.md`，changelog 见 `spec/CLAUDE-changelog.md` v8.6.0。N8 整节删除，没有移进核心：核心 §0 Ambiguity 和 §2.1 已经覆盖这种情况。N2 关闭了待办 D#754。
- **N11**：`~/.claude/rules/context7.md` 已删除，影响本机所有项目。`context7-mcp` 技能和 context7 MCP 服务器自带的说明都还在。逐字节恢复：`sed -n '/^Use Context7/,$p' ~/.claude/skills/context7-mcp/SKILL.md > ~/.claude/rules/context7.md`。
- **仍未处理**（这次没有要求）：N2b、N9、N10、F11、F14、B6、B7、converge 汇报格式。
- **更正（0.121.0 发版前评审）**：第 3.2 节 N4 处理里说 "`plan.md:93` 的 \"Re-run step 3\" 仍然成立"，不对：第 3 步改为按需后，lite 升级到 FULL 时重跑它只在用户要求时才复查计划。0.121.0 改为重跑第 2、4 步（用户重新确认计划和风险）。第二轮（N2b、N9、N10、F11、converge、F14）见设计记录 `tasks/specs/prompt-audit-fixes-2026-11-20.md`。
