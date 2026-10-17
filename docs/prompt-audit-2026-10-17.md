# 提示词审计：本项目会话加载的 Claude Code 配置（2026-10-17）

方法：Claude Code `/doctor prompt-audit`，按随附的 `shared/prompt-audit.md`（claude-api 技能 2.1.302）依次执行：盘点、来源、模式扫描、报告、建议 diff。只出报告和补丁，**没有改任何被审文件**。

补丁目录：`docs/prompt-audit-2026-10-17/`。
- `patches/`：25 个补丁，每条发现一个，各自能打在未修改的文件上。
- `all-repo.diff`：仓库内的合并版，`git apply --check` 通过。
- `all-home.diff`：`~` 下的合并版，`patch -d ~ -p1 --dry-run` 通过。

## 0. 前提

- **目标模型**：Claude Opus 5.5（`claude-opus-5-5`），即本会话的模型。只有 code-graph 插件的 `code-explorer` 在 frontmatter 里固定了 `model: sonnet`，它按 Sonnet 5.5 审。
- **跨模型说明**：`~/.claude/CLAUDE.md` 是本仓库 `spec/CLAUDE.md` 的安装副本（逐字节相同），随插件发给所有用户，也会加载进子代理。官方迁移指南说，Sonnet 5.5 和 Haiku 5.5 在 `low` effort 下更容易提前停下、不做验证就报完成，并建议给它们**加**上继续工作和验证的文字。所以凡是删减验证类、继续工作类规则的建议，都单独标出了跨模型风险。
- **范围**：
  - 项目内：`CLAUDE.md`，`.claude/rules/hook-shell.md` 和 `spec-edit.md`（都只在匹配 `paths:` 时加载），`.claude/agents/release-reviewer.md`，以及 22 个嵌套的 `CLAUDE.md`（`spec/` 1 个，`tasks/` 下评测夹具 21 个）。
  - 用户级（每个项目都加载）：`~/.claude/CLAUDE.md`，`~/.claude/rules/reply-language.md`，`~/.claude/commands/gsd/*.md`（6 个），`~/.claude/agents/gsd/*.md`（4 个），`~/.claude/skills/*/SKILL.md`（60 个：59 个由 gstack 生成，加 `converge`）。
  - 插件提供、**只报告不改**：claude-mem-lite 6.27.0、claudemd 0.112.0、code-graph-mcp 0.171.1、mattpocock-skills 1.3.1 的技能、命令和子代理。
- **未审，并说明原因**：
  - 不存在的：祖先目录的 `CLAUDE.md`/`AGENTS.md`、`CLAUDE.local.md`、`.claude/CLAUDE.md`、托管策略文件（`/etc/claude-code/` 不存在）、output-styles。
  - 按要求不读的：settings 文件、`.mcp.json`、`~/.claude.json`。
  - 不在本次清单里的：由 hook 注入的 `~/.claude/spec-modules/*.md`、自动记忆 `MEMORY.md`，以及停用插件（superpowers 7.0.0 等）。
  - 没有 `@` 导入。
- **第 4 组（请求构造代码）**：范围内没有，不适用；只做了子代理花名册检查。

## 1. 摘要

影响最大的三条：

1. **`spec/CLAUDE.md` 被当成指令加载（F1，High）。**
   - Claude Code 在读到某个子目录里的文件时，会把该目录的 `CLAUDE.md` 当作指令载入（已查官方文档 code.claude.com/docs/en/memory）。
   - 本项目 189 份会话记录里，`spec/CLAUDE.md` 以 `nested_memory` 载入了 10 次：8 次与全局规范同版，等于把 23 KB 核心重复加载一遍；2 次是不同版本。09-22 那次是全局 6.30.0 对仓库草稿 6.31.0；10-16 v8 发版那个会话是全局 v7.2.0 对仓库 v8.0.0。
   - 也就是说，同一个上下文里放着两版规范，没有任何东西说明哪一版生效。
   - `tasks/` 下 21 个夹具（v7.0.0–v7.3.0 的完整规范）至今 0 次载入，但读到夹具目录里任何文件都会触发。
   - 修法：项目 settings 里加 `claudeMdExcludes`（新文件，补丁 P01）。
2. **§8 "不许深度遍历 `~/.claude/`" 的理由写错了目录（F2，High，影响所有用户）。**
   - 规则说"输出落在 `~/.claude/tmp/`"，本机没有这个目录。现在超长的工具输出存放在 `~/.claude/projects/<project>/<session>/tool-results/`，本机 `~/.claude/projects` 有 1.9 GB。所以"后一次扫描读到前一次扫描的输出"这个机制仍然存在，只是位置变了。
   - 规则推荐的 "Grep tool (excludes tmp/)"：排除 `tmp/` 已经没有意义，而且本会话里根本没有 Grep 工具。
   - 修法：改理由，去掉这条未经核实的推荐（补丁 C02）。
3. **gstack 共享前言里的三处矛盾（第三方生成文件，要在上游修）。**
   - 41 个文件写着"Reuse rules: Step 16."，只有 `ship` 有 Step 16。
   - 51 个文件里，"No em dashes." 和它自己规定的模板 `D<N> — <title>` 冲突。
   - 路由器 `gstack/SKILL.md` 第 187 行说"有技能时不要直接回答"，第 237–240 行又说"用户自己限定的小改动直接回答"。
   - 这些文件是指向 gstack git 检出的符号链接，本地改会被 `gen:skill-docs` 或 `/gstack-upgrade` 覆盖。

另外两条只报告的：
- claude-mem-lite 的 `/mem cleanup` 和 `/update` 让模型调用 `mem_maintain` 和 `mem_compress`，但这两个工具被插件自己隐藏，本会话的工具列表里确实没有（B1）。
- gsd 的 `doctor` 检查一个没有任何代码会写的文件 `.update-pending`（A1，已出补丁）。

**计数**（High / Medium / Low 或只标记）：

| 切片 | High | Medium | Low/标记 | 主要分组 |
|---|---|---|---|---|
| 核心规范 + 项目文件 + 用户规则（F1–F14） | 3 | 7 | 4 | 第 1 组 6 条，第 2 组 8 条 |
| gsd 用户级命令和子代理（A1–A13） | 1 | 12 | 7 | 以第 2 组为主 |
| gstack 60 个技能 + converge（H1–H5、M1–M11、L1–L9） | 5 | 11 | 9 | 第 1 组 13、第 2 组 9、第 3 组 4 |
| 插件（B1–B9，只报告） | 2 | 7 | 约 10 | 以第 2 组为主 |

## 2. 盘点

| 面 | 文件 | 加载时机 | 字节 |
|---|---|---|---|
| 全局核心 | `~/.claude/CLAUDE.md`（= `spec/CLAUDE.md`） | 每个会话 | 23,351 |
| 项目指令 | `CLAUDE.md`（含 claude-mem-lite、code-graph-mcp 两个插件维护的标记块） | 本项目每个会话 | 4,353 |
| 用户规则 | `~/.claude/rules/reply-language.md` | 每个会话 | 267 |
| 路径规则 | `.claude/rules/hook-shell.md`（`hooks/**`）、`spec-edit.md`（`spec/**`） | 碰到匹配文件时（记录：36 次、7 次） | 718 / 1,363 |
| 子代理 | `.claude/agents/release-reviewer.md`（opus-5-5，effort high，worktree） | 被派出时；描述每会话进清单 | 4,646 |
| 嵌套 CLAUDE.md | `spec/CLAUDE.md` + `tasks/**/CLAUDE.md` ×21 | 读到该目录内文件时（记录：10 次、0 次） | 各约 23 K |
| 用户命令 | `~/.claude/commands/gsd/*.md` ×6（设为仅用户可调用） | 用户调用时 | 29,507 |
| 用户子代理 | `~/.claude/agents/gsd/*.md` ×4 | 被派出时；描述每会话进清单 | 19,423 |
| 用户技能 | `~/.claude/skills/*/SKILL.md` ×60 | 描述每会话进清单（4,865 B）；正文在调用时 | 2,618,629 |
| 插件 | mem-lite 8 个命令、claudemd 16 个命令（15 个禁止模型调用）、code-graph 2 个技能和 1 个子代理、mattpocock 11 个技能 | 同上 | — |

## 3. 发现

字段：位置｜原文｜模式（指南的组/行）｜为什么过时｜置信度｜处理。"全局"表示改动影响所有项目；改 `spec/CLAUDE.md` 还会通过发版影响所有用户。

### 3.1 核心规范、项目文件、用户规则

**F1（High）`spec/CLAUDE.md` 和 `tasks/**/CLAUDE.md` 被当作嵌套指令载入**
- 原文：两份规范同时在上下文里（见摘要）。
- 模式：第 2 组"指令文件互相矛盾"；同版本时是重复加载。
- 为什么：这两类文件是本项目的产物或夹具，不是"在这个目录工作时的指令"。在 `spec/` 下工作时真正的指令是 `spec-edit.md`（路径规则，已在工作）。
- 处理：新建 `.claude/settings.json`，内容为 `claudeMdExcludes: ["**/spec/CLAUDE.md", "**/tasks/**/CLAUDE.md"]`（补丁 P01）。文档说模式匹配绝对路径、可用 `**/` 前缀，并且可以放在项目级 settings。文档没说它是否作用于按需载入的子目录文件，所以要按第 5 节第 1 条验证。新建 settings 文件需要你确认。

**F2（High，全局）§8 深度遍历规则的理由**
- 位置：`spec/CLAUDE.md:139`。
- 原文："— stdout lands in `~/.claude/tmp/`, traversal re-reads it exponentially). Use Grep tool (excludes tmp/) or `-maxdepth 1` / explicit paths."
- 模式：第 2 组 Volatile specifics。
- 为什么：`ls -ld ~/.claude/tmp` 报不存在。工具输出现在存到 `~/.claude/projects/<project>/<session>/tool-results/`（本会话目录下有 `toolu_*.txt`）。这句理由写于 2026-04 的 v6.9.2。
- 处理：把理由改成新位置，去掉 Grep 工具推荐（补丁 C02）。禁令本身不放宽。

**F3（High，全局）`~/.claude/rules/reply-language.md:3`**
- 原文："(spec §1 Language contract). Code, commands, paths and commit messages stay in English as the spec says."
- 模式：第 2 组：引用了已不存在的节名，并与它引用的规范矛盾。
- 为什么：v8 核心 §1 已改名为 **Language**，而且写明"commit messages follow the project's existing convention"，不再是一律英文。这个规则文件写于 09-26，早于 v8（10-16）。`reply-language-check.sh` 不读这个文件，改了不影响 hook。
- 处理：改写为"from then on the language I write in decides. Everything else follows core §1 **Language**."（补丁 U03）。

**F4（Medium）`release-reviewer.md:42` 报告渠道**
- 原文："Write the full report to the absolute path the prompt gives … End with a message of at most 1500 characters"
- 模式：1d 不起作用的指令 + 1f 数字上限 + 第 2 组冲突。
- 为什么：发版 runbook 记录，0.109.0 和 0.109.1 一共 4 轮评审，写报告文件都被拒，报告最后都是从最终消息拿到的；runbook 的结论是"别再给路径，让评审把每条 Medium 及以上的复现写进最终消息"。1500 字符的上限来自 0.107.3 时的截断情况，runbook 现在记的是约 5 KB 才截断。
- 处理：改为"把完整报告放进最终消息；如果给了路径且写得进去，同时写一份"（补丁 P04）。相关的规范模块冲突见 F13。

**F5（Medium）`release-reviewer.md:3` 描述里带过期文档路径**
- 原文："and for a batch-end review in docs/audit/20260926-180700.md §11"
- 模式：第 2 组历史叙述 / 第 3 组路由文字。
- 为什么：这份文档被 gitignore，在评审所用的 worktree 里不存在。47 次派出里只有 1 次（09-27）是批次末评审，那一轮的批次计划早已完成。
- 处理：删掉路径，保留"batch-end review"（补丁 P05）。

**F6（Medium，全局）§2.1 浏览器验证的理由读反**
- 位置：`spec/CLAUDE.md:56`。
- 原文："not `mcp__claude-in-chrome__*` / computer-use (gstack: slow, unreliable)."
- 模式：1a 理由要直说。
- 为什么：247928b 的提交说明表明，原意是"gstack 的文档说 chrome MCP 慢且不可靠"，但这句话读起来像在说 gstack 慢且不可靠。
- 处理：改为 "which gstack's docs call slow and unreliable"（补丁 C06）。

**F7（Medium，全局）§2.1 "unfamiliar module → module overview before 3+ Reads"**
- 模式：1c 策略指导。
- 为什么：删掉这句，什么合法、怎么衡量成功都不变。这句来自 2026-05（v6.11.16），写给更早的模型。有代码图的项目里，插件自己的说明已经覆盖它。"Export-surface edit → impact analysis first" 和 §5 授权相连，保留。
- 处理：删掉这一子句（补丁 C07；C06 和 C07 在同一行，合并 diff 里合成了一个 hunk）。

**F8（Medium，全局）§7 推送前查 CI（HARD）没有写理由**
- 模式：1a 强调旁边没有理由。
- 为什么：理由已经写在 `ship.md`（"stacking on red loses attribution"），核心这里只剩标签。这正是 K9 的做法：给强调补一句理由，标签作为 `hard-rules.json` 的键保留。
- 处理：加"; a push onto red CI hides which change broke it"（补丁 C08，约 +48 B，核心上限 25,000 B）。

**F9（Medium，全局，有跨模型风险）§11 Mid-SPINE turn-yield 里的"别提前停"部分**
- 位置：`spec/CLAUDE.md:184`。
- 原文："Any other stop is not a yield — a progress summary, a next step announced instead of taken; a silent mid-cycle stop … = Iron Law #2 violation. **Tell**: `继续 / next / 怎么停了 / why did you stop` … = confirmed premature stop."
- 模式：1a "Do not stop early"。
- 为什么：当前模型默认就会继续做。本仓库 R4(c) 的对照里，"多文件改动一个回合做完"有规范和无规范都是 5/5。这条里真正模型不知道的上下文（子代理报告只在回合结束后送达，sleep 或给空闲代理发消息都送不到）保留。
- 跨模型：Sonnet 5.5 和 Haiku 5.5 在 `low` 下更容易提前停，所以改写时保留一句平实的继续工作句。
- 处理：替换为"A progress summary is not a stopping point: take the next step."（补丁 C09）。建议先放进 K6 消融测，再决定是否合入（见第 6 节）。

**F10（Medium）项目 `CLAUDE.md:3` 的考古括注**
- 原文："(single source; the verbatim list was deduped here 2026-07-25 — it drifts)"
- 模式：第 2 组历史叙述。
- 处理：删掉括注，保留"§5.1 Never-downgrade set binds as written in core §5.1."作为有意的复述（补丁 P10）。

**F11（Low，只标记）HARD 行缺理由**
- 位置：`spec/CLAUDE.md` 第 11、161、168、172 行。
- 为什么：仓库里找不到可以直接引用的理由，不编造。留给 K9 逐条补理由时一并处理。

**F12（Low，只标记）验证类规则**
- 范围：Iron Law #2、Evidence beyond green tests 等。
- 为什么：指南把 Opus 5 时期的"过度验证"指令列为 Opus 5.5 的复测候选，说法是"以它为起点，在自己的评测上复测"。但这份规范跨模型加载，而官方建议给 `low` effort 的 Sonnet/Haiku 5.5 **加**验证段落。不出补丁，维持 09-29 和 10-15 的保留决定。

**F13（只标记，规范模块不在本次范围内）报告渠道三处说法不一**
- 三处：`spec/spec-modules/orchestrate.md:24`（和 extended 一致）写"the harness cuts a teammate's reported result at 4000 chars … gets an absolute output path"；runbook 记 0.109.x 写文件被拒、约 5 KB 截断；`release-reviewer.md` 写 1500 字符。
- 需要你决定：以哪个渠道和数字为准，然后改 orchestrate.md（L3 规范改动）。

**F14（只标记，插件维护的标记块）项目 `CLAUDE.md:45`**
- 原文："Still use Grep for literal strings/regex in non-code files"
- 为什么：本会话没有 Grep 工具。这是 code-graph-mcp 插件维护的块（按你的偏好保留并提交），应当在插件上游改。

**已核对、无发现**：`.claude/rules/hook-shell.md`、`spec-edit.md`，它们引用的 7 个路径都存在。核心其余部分：§0、§1 Principles、§3、§5、§8 其他条目、§10、语言与汇报约定，属于用户自己的约定或有理由的约束，在保留清单内。§3.7 列的、与 harness 逐字重复的条款（Recommend-first 等），v8 核心里已经没有了。

### 3.2 gsd 用户级命令和子代理（全局；会被 gsd-lite 每 24 小时的自动更新覆盖，持久的修法在上游 `sdsrss/gsd-lite`）

| # | 置信度 | 位置 | 问题 | 补丁 |
|---|---|---|---|---|
| A1 | High | `commands/gsd/doctor.md:93` | 检查 `~/.claude/gsd/.update-pending`，没有任何代码写它；hook 实际写的是 `runtime/update-notification.json`（已复核：两个 hook 里 `update-pending` 0 次，`update-notification` 各 1 次） | G-A01 |
| A2 | Medium | `doctor.md:86` | 拿当前项目的 `package.json` 当 gsd 源码版本；在本仓库会误报"v0.13.0 vs v0.112.0" | G-A02 |
| A3 | Medium | `stop.md:46` 对 `:30` | 要模型自己"先写 .tmp 再 rename"，而 `state-update` 工具已经在锁内做原子写 | G-A03 |
| A4 | Medium | `start.md:28` | `codebase-retrieval` 是别的 harness 的工具名，这里没有 | G-A04 |
| A5 | Medium | `agents/gsd/reviewer.md:42-67` | 级别判定规则漏了 L3，并且和同文件的 L3 定义矛盾；级别本来就在计划阶段定好 | G-A05 |
| A6 | Medium | 4 个子代理第 3 行 | 描述太泛（"Two-stage code review…"），会把一般的评审、调试请求路由过去 | G-A06 |
| A7 | Medium | prd/start/resume 的 `<EXTREMELY-IMPORTANT>` | 1a 施压标签，内容本身是有理由的复述 | G-A07 |
| A8 | Medium | `debugger.md:24-33, 42-45` | 同一条根因门槛重复 4 遍，全大写，没有理由 | G-A08 |
| A9 | Medium | `executor.md:12-31` | 防"合理化"清单 + "来自 Superpowers"（该插件已停用） | G-A09 |
| A10 | Medium | `reviewer.md:7-15` | 用施压的方式重复第 18 行的角色说明 | G-A10 |
| A11 | Medium | `debugger.md:54` | "添加日志"与"不改代码"、没有 Edit 工具矛盾 | G-A11 |
| A12 | Medium | `researcher.md:19` | 让 researcher 自己写 `.gsd/research/`，会绕过服务端的提交标记 | G-A12 |
| A13 | Medium（被覆盖设置挡住时影响有限） | `prd.md:2`、`start.md:2` | 描述里枚举触发短语 | G-A13 |

只标记：
- 上下文健康度阈值 40% 对 35%；锁过期 5 分钟对代码里的 10 秒；`review_targets` 和 `task_spec` 字段名与服务端不符；示例日期已过期。
- **两处冲突需要你决定**：executor 的 TDD 例外把 DB 迁移、CI/CD、部署配置当成普通任务，与你核心 §5 的硬授权冲突（是安全规则，所以不出补丁）；`/plugin update gsd` 与 claudemd 命令里"`/plugin update` is not a real CC command"的说法冲突，其中一个是错的，没有验证是哪个。
- 花名册检查：没有重复的子代理定义。gsd `reviewer` 和 `release-reviewer` 的职责不同，问题只在路由，由 A6 处理。

### 3.3 gstack 生成的 59 个技能（全局；第三方文件，修法写在模板上，不出补丁）

不出补丁的原因：57 个是指向 `~/.claude/skills/gstack/`（gstack git 检出，VERSION 1.91.121.0）的符号链接，2 个是安装时写入的副本，都带"AUTO-GENERATED … do not edit"。改渲染后的文件会被 `bun run gen:skill-docs` 或 `/gstack-upgrade` 覆盖，还会让这个 git 检出变脏。下表的"处理"写的是给模板或 resolver 的修改建议。另外，上游 v1.91.15.0 已经针对 `claude-opus-5-5` 做过同类审计，老式写法（think step by step、scratchpad、进度节奏、反格式规则）已经是 0 处。

| # | 置信度 | 位置（模板） | 问题 → 建议 |
|---|---|---|---|
| H1 | High | 41 个文件（`generate-evidence-directive.ts:23`） | "Reuse rules: Step 16." 只在 `ship` 能找到（已复核：41 个文件引用，只有 ship 有这一节）→ 只在 ship 输出这句 |
| H2 | High | `plan-design-review:480`（`.tmpl:88`） | 写的是 "GPT-4o vision"，代码默认用 `gpt-5.5`（`design/src/models.ts:40`），与 design-html 的说法冲突（已复核原文）→ 改为"an OpenAI vision model; `GSTACK_DESIGN_MODEL` overrides" |
| H3 | High（只标记） | 51 个文件（`generate-voice-directive.ts:7` 对 ask-user-format 模板） | "No em dashes." 和必须使用的模板 `D<N> — …` 冲突；历史排不出先后 → 要么改 4 个模板串，要么删掉这条禁令，由上游决定 |
| H4 | High | `gstack/SKILL.md:187` 对 `:237-240`（`.tmpl:55` 对 `:105`） | 路由器自相矛盾（已复核原文）；第 187 行更早（0d1bd56） → 删掉第 187 行那两句 |
| H5 | High（只标记） | `retro:965` 对 `:719` | 连续天数一处从今天往回数（模型手算），一处从最新提交日算（脚本）→ 建议统一锚在最新提交日，并用脚本计算 |
| M1 | Medium | 58 个文件的 "When to invoke this skill"（`gen-skill-docs.ts:363`） | 路由文字放在正文里，清单里看不到；有 3 条"Proactively invoke"永远不会生效 → 把一句意图类别并进 description |
| M2 | Medium | learn、context-save、review、health、land-and-deploy、office-hours 等的描述 | 描述只有一句（25–39 B），而本机有同类技能在争路由 → 各加一句意图（约 +1.6 KB，需上游调高 catalog 预算） |
| M3 | Medium | 41 个文件（`generate-completeness-section.ts`） | "boil the ocean" 型的完整性加码，对 Opus 5.5 过宽，也和你 §1 Simple first 冲突 → 把上游给 gpt-5.6-sol 写的"限定在用户任务边界内"那一版也用到 claude |
| M4 | Medium | 41 个文件（ask-user-format） | "≥40 chars"、"≥2 pros" 这类数字下限，没有 hook 检查 → 改成定性描述，保留会被软件解析的标记 |
| M5 | Medium | `ship:20-31`、`gstack:208` 对 `land-and-deploy:21-26` | "deploy"、"land it" 被路由到不负责部署的 /ship → 移到 /land-and-deploy |
| M6 | Medium | `design-review:1343-1370, 1439-1455` | 让模型手算好感值和加权评分 → 改用代码计算 |
| M7 | Medium | `health:544-557` | GBrain 子分数手算，而同文件的总分是代码算的 → 改用脚本 |
| M8 | Medium | `pair-agent:574` | "CRITICAL: You MUST…"（规则本身承重）→ 改用平实语气并说明原因，保留上游测试匹配的短语 |
| M9 | Medium | 52 个文件（Voice） | 禁用词清单 → 改成一句正面描述 |
| L1 | Low | 52 个文件（`model-overlays/claude.md`） | 通用 claude 覆盖层的三条提示：todo 纪律重复了 harness；"动手前先说思路"与你 §1 Think first 一致；"优先专用工具而不是 Bash"与本会话 harness 的说法相反 |
| L2 | Low | `office-hours:881, 1236` | "since Claude Code v2.1.198" 这类版本考古；`run_in_background: false` 在 2.1.302 的 Agent 工具里已没有这个参数 |
| L3 | Low | `investigate:405-409` | 全大写的铁律（有理由）→ 改用平实语气 |
| L4 | Low | `design-review:1484` 对 `:1960` | "Never read source code." 隔了 476 行才被限定范围 → 在原处写明范围 |
| L5 | Low | 52 个文件（遥测标签，109 处） | "ALWAYS RUN" 和第 60 行的"只在 host 允许时运行"矛盾 |
| L6 | Low | 41 个文件（Context Recovery） | "At session start" 写在会在会话中途才载入的正文里 |
| L7 | Low | `_gstack-command`、`connect-chrome` | 与 `gstack`、`open-gstack-browser` 逐字节相同，清单里各出现两次 |

### 3.4 converge（用户手写，全局，出补丁）

- **M10（Medium）`converge/SKILL.md:133`**："不超过 10 行"属于 1f 数字上限 → 改为"写给不看代码的人：不贴代码、不讲实现细节，只覆盖下面六项"（补丁 S-M10）。
- **M11（Medium）第 24、70、75、146 行**："旧版…已删除，不要恢复"属于 1d 相对于旧版的写法 → 删掉"旧版/已删"的考古，保留现行规则和它的理由（补丁 S-M11）。
- L8（Low）：描述 407 B，占全部描述字节的 8.4%，里面有行为规定和 5 个近义触发短语。可以改为："对已有项目跑一轮收敛式改进：选一个视角（找bug、测功能、补验证、去冗余、理流程、性能、体验、架构）扫透，当轮修完扫出的 P0/P1。用户要求跑一轮改进、继续收敛或批量修复项目时使用。"
- L9（Low）："实测"叙述多数是规则的理由，保留。

### 3.5 插件（只报告，修法在上游）

| # | 置信度 | 位置 | 问题 |
|---|---|---|---|
| B1 | High | mem-lite `mem.md:33-35`、`update.md:20-25` | 调用 `mem_maintain`、`mem_compress`，这两个工具被 `hidden: true` 隐藏（已复核：本会话的工具列表里没有）→ 改用 `cli.mjs maintain/compress` |
| B2 | High | mem-lite `memory.md`、`update.md`、`lesson.md` | `/mem:memory` 这类命名空间不存在，实际是 `/claude-mem-lite:…` |
| B3–B5 | Medium | mem-lite bug、lesson、adopt、update | 版本历史叙述；未定义的词 "sdscc"；"Summarize … in zh-CN" 和用户语言约定冲突 |
| B6 | Medium | mattpocock `diagnosing-bugs:22` | "Be aggressive. Be creative. Refuse to give up."（1a） |
| B7 | Medium | mattpocock `code-review:66,72` | "Under 400 words."（1f） |
| B8 | Medium | claudemd `commands/claudemd-rules.md:7` | 版本考古（来源就在本仓库） |
| B9 | Medium | claudemd `commands/claudemd-clean-residue.md:11` | 引用 "§EXT §7-EXT"，应为 `§7-EXT-TMP`（已复核：extended 第 163 行 §7-EXT 是 VALIDATE，第 396 行才是 TMP 保留政策）（来源在本仓库） |

还有约 10 条 Low：code-explorer 里带日期的注释、tdd 指向有歧义的 `code-review`、tdd 的确认门槛与你 §0 Ambiguity 规则冲突、claudemd 命令里的版本号和计划 ID 等。干净的文件：verify、unadopt、explore、index、prototype、research、domain-modeling、codebase-design、pr、wizard、grilling、writing-for-agents、claudemd-design-adopt，以及 claudemd 的 analyze/install/refresh/sparkline/status/statusline/toggle/uninstall。

### 3.6 跨面冲突（只标记）

gstack 的 Completion Status 和"Bounded closer"、converge 第六步，与你 §10 的 `## 汇报` 格式不一致；M3 的"boil the ocean"与 §1 Simple first 不一致；gstack 的 ship 路由与你的 ship 触发词加 runbook 不一致。你的 §3 已经让规范优先于技能文字，但两边的文字模型都会读到。

## 4. 建议 diff

| 补丁 | 发现 | 文件 | 影响面 |
|---|---|---|---|
| P01 | F1 | `.claude/settings.json`（新建） | 本项目 |
| C02 C06 C07 C08 C09 | F2 F6 F7 F8 F9 | `spec/CLAUDE.md` | 全局、所有用户（L3 规范改动） |
| P04 P05 | F4 F5 | `.claude/agents/release-reviewer.md` | 本项目 |
| P10 | F10 | `CLAUDE.md` | 本项目 |
| U03 | F3 | `~/.claude/rules/reply-language.md` | 全局 |
| G-A01 … G-A13 | A1–A13 | `~/.claude/commands/gsd/`、`~/.claude/agents/gsd/` | 全局；会被 gsd-lite 更新覆盖 |
| S-M10 S-M11 | M10 M11 | `~/.claude/skills/converge/SKILL.md` | 全局 |

应用方式：仓库内用 `git apply docs/prompt-audit-2026-10-17/patches/<名>.patch`；`~` 下用 `patch -d ~ -p1 < …`。可以挑着打。C06 和 C07 改的是同一行，单独打一个没问题，两个都要就用 `all-repo.diff`。

## 5. 验证计划（删减是假设，不是结论）

1. **P01**：打补丁后开一个新会话，Read 一下 `spec/hard-rules.json`，再查这个会话的记录里有没有 `spec/CLAUDE.md` 的 `nested_memory` 附件。有，说明 `claudeMdExcludes` 对按需载入的文件无效，要换别的办法。
2. **C02–C09**：走 `spec-edit.md` 的流程：规范版本级联、changelog、`PINNED_BLOCKS`/`HEADING_INVENTORY`、`spec-coherence-audit --strict`。可以和 D#399 一起放进下一次规范发版。C09 先做消融（第 6 节）。
3. **U03**：已确认 `reply-language-check.sh` 不读这个文件；打补丁后下一个会话看回复语言是否不变。
4. **P04**：下一次发版评审时，核对最终消息里是否带全了 Medium 及以上的复现命令。
5. **gsd、gstack、插件**：本地补丁只是临时的，要持久就提到各自上游。

## 6. 与 D#328（K6+K9）的交叉核对

文档 `spec-model-capability-review-2026-10-15.md` §5 K6 第 1 步要求先跑官方审计，再和 §3.6、§3.7 对照，只有两边一致的条款才进入消融。结果：

- **§3.7 与 harness 逐字重复的条款**：v8 核心里已经没有了，这一项不再需要消融。
- **§3.6 R4(c) 的候选**（L0 不走流程、§11 一回合做完、§2.1 查证引用、提交前跑测试、如实报告）：审计只在"§11 一回合做完"上同样给出了中置信度的发现（F9）；"提交前跑测试""如实报告"对应 F12，是低置信度，而且有跨模型风险；另外两条审计没有标。
- **K9（强调旁边补理由）**：审计的 F8（补一条有出处的理由）和 F11（其余 4 行仓库里没有理由）支持这个方向。
- **据此，消融规模可以缩小**：从"基线 + 安慰剂 + 5 个单项"共 7 臂、约 140 次运行，缩到"基线 + 安慰剂 + F9 + 验证类"4 臂、约 80 次。按文档原估算 $150–300 等比例推算，约 $86–171。这是推算，没有试跑。
