# 记忆索引行写入时检查 + 核心头注释（2026-11-25）
状态：草稿（等用户授权进入实现）

## 背景与目标

来源：2026-11-25 在 daagu 跑的 `/doctor prompt-audit`，它给本仓库写的提示词在 `/home/ai/dev/daagu/docs/prompt-audit-2026-11-25/claudemd-prompt.md`，报告在 `/home/ai/dev/daagu/docs/prompt-audit-2026-11-25.md`。提示词三项：

1. 核心 §11 Memory 的"index line ≤150 characters"和各项目的实际写法脱节：10 个项目 368 行里 220 行（60%）超长。唯一的检查是 `/claudemd-doctor` 的 `memory-index-lines`，advisory，只在手动跑时出现。要求先量提示的准确率和截短的代价，再在三种做法里选：(a) 规则不变、写入时检查；(b) 标签不计长度；(c) 改上限。
2. §1 给技能文件加例外（converge 保留的中文标记）。**用户 2026-11-25 决定不做**（"converge 技能我让改成英文了，可这一个不用管"）。
3. `spec/CLAUDE.md` 第 3 行注释写着 "Canonical: `~/.claude/CLAUDE.md`"，但那是插件装过去的副本，`/claudemd-update` 会覆盖本地改动。

不在范围内：§11 Mid-SPINE turn-yield（上次审计的 F9，挂在 D#328 上等实验）。

## 测量（第 1 项）

方法：`tasks/memory-index-write-check-2026-11-25/measure_hint.py`（本地）。对 `~/.claude/logs/claudemd.jsonl` 里每个 `memory-prompt-hint` 的 `suggest` 行，在会话 transcript 里找到那次提示的原文（提示里带命中的标签），再看：
- 是否被读：提示之后同一会话里有没有 `Read` 这个文件，或者有没有 Bash 命令点名它；
- 截短代价：在该文件**当前**的索引行里，至少一个命中标签的结束位置是否在前 150 个字符以内（截到 150 后命中是否还在）。

数据范围：日志 2026-10-22 起，157 个 suggest 行，其中 24 行的 transcript 已不在，余下 133 次提示、378 个（提示, 文件）对。

| 指标 | 结果 |
|---|---|
| 提示后同一会话被读 | 197/378（52.1%）；同一轮内 184/378（48.7%） |
| 按项目被读 | daagu 91/180，code-graph-mcp 57/120，claudemd 26/54，claude-mem-lite 20/21，gsd-lite 2/2，sgc 1/1 |
| 截到 150 字符后命中仍在 | 344/363（94.8%）；另 15 对的标签已从当前索引行删改，无法测 |
| 只看 >150 的长行 | 206/225 命中仍在（91.6%） |
| 截短会丢的 19 个命中里被读的 | 3/19（16%）；保留下来的 344 个里被读 190/344（55.2%） |
| 命中标签在标签块里的位置 | 第 1–3 个占 302/528 次标签命中；第 8 个及以后 58/528 |

行长构成（10 个项目 368 行，按字符数）：标题中位 29 / p90 42，标签块中位 40.5 / p90 79，描述中位 47 / p90 108。标签不计长度时仍有 108/368 行超 150。

写入渠道（2026-10-01 起的 transcript）：改 MEMORY.md 的工具调用 Edit 35、Write 1、Bash 约 33（`echo '- [...]' >> MEMORY.md`、`printf`、`cat >> <<EOF`、`sed -i`）。这段时间新增或改动的索引行 52 行（去掉一个测试夹具），39 行超 150（75%）；其中 Bash 写的 27 行里 23 行超长，Edit 25 行里 15 行，Write 1 行里 1 行。

局限：
- "被读"衡量的是 agent 有没有照提示去读，不是文件是否真的相关；相关率没有测（daagu 会话 n=4 的轶事是 1/4 相关，不作证据）。
- 截短用的是现在的索引行，不是提示当时的；15 对的标签已经改过，排除在外。
- "截短"测的是从尾部机械截断。实际压缩由作者改写，丢的应当更少，所以 94.8% 是保留率的下限。

## 决定（第 1 项）：选 (a)

- 截短丢的命中少（19/363 = 5.2%），而且丢掉的那部分本来就很少被读（3/19，对比保留部分的 190/344）。提示词给 (a) 的适用条件是"截短丢掉的命中很少"，符合。
- 不选 (b)：命中主要靠靠前的标签，不靠尾部标签（第 1–3 个标签占 57%）；而且标签不计长度后仍有 108/368 行超长，(b) 解决不了超长。
- 不选 (c)：没有数据说明别的数值更合适。命中几乎都落在前 150 个字符内，放宽上限只会让每个会话多加载些描述文字，提示的命中率不会因此提高。
- 写入时检查必须覆盖 Bash：新写的超长行里，23/39 是用 Bash 追加的。只挂 Edit|Write 的检查会漏掉多数新写的超长行。

## 范围
- 做：
  - 新 hook `hooks/memory-index-lines.sh`（PostToolUse，matcher `Edit|Write|Bash`），见"方案"。
  - 注册与清单：`hooks/hooks.json`、`scripts/lib/hook-registry.js`、`scripts/lib/doctor-hook-tests.js`、`commands/claudemd-toggle.md`、`tests/hooks/hook-budget.test.sh`、`docs/RULE-HITS-SCHEMA.md`、README 的 hook 表；其他按 `grep -rl memory-prompt-hint` 找到、列出全部 hook 的地方。
  - 测试 `tests/hooks/memory-index-lines.test.sh`。
  - 规范 extended §11-EXT 一句（:442，"`/claudemd-doctor` flags longer lines"）改成写入时由 hook 提示、doctor 列出已有的超长行；重建 `spec/spec-modules/memory.md`。
  - 第 3 项：`spec/CLAUDE.md` 第 3 行注释。
  - 两项都并入尚未发布的 v8.6.1（措辞，规则不增不删，ID 不变）：`spec/CLAUDE-changelog.md` v8.6.1 条目、extended Recent changes、Sizing 不动点、`spec-structure.test.js` 的钉住哈希。插件 `CHANGELOG.md` 记在下一个版本（新 hook，minor）。
- 不做：
  - 核心 §11 的规则本身（≤150 不变）、read-the-file 那句。
  - 已有的超长行：不自动截短，由各项目自己压缩；doctor 的 advisory 检查保留。
  - 第 2 项（用户决定不做）；F9 / D#328。
  - 发版（v8.6.1 按原计划等 D#719 复测之后，约 11-30）。

## 验收标准
- [ ] AC1：Edit 写入一行 >150 字符的新索引行 → hook 输出一个 JSON，`additionalContext` 点名该行的字符数和标题 — 验证：`bash tests/hooks/memory-index-lines.test.sh`（先红后绿）
- [ ] AC2：Bash 用 `echo '…' >> MEMORY.md` / `printf` / heredoc 追加的超长行同样提示；只读命令（`grep … MEMORY.md`）不提示 — 验证：同上
- [ ] AC3：不提示的情况：行 ≤150；超长行原本就在文件里、这次没改（Edit 的 old_string 里已有，Write 的 originalFile 里已有）；文件不是 `~/.claude/projects/*/memory/MEMORY.md`；关闭开关 `DISABLE_MEMORY_INDEX_LINES_HOOK=1` — 验证：同上
- [ ] AC4：命令里不含 `MEMORY.md` 时在调用 jq 之前退出；预算测试覆盖它 — 验证：`bash tests/hooks/hook-budget.test.sh`
- [ ] AC5：字符数和 doctor 一致（按码点，行以 `- [` 开头）— 验证：测试里用一行含中文、151 个码点、超过 150 字节的行
- [ ] AC6：核心第 3 行注释说明它是安装副本、要改哪里；注释不进上下文（CC 加载时剥掉）— 验证：`node --test tests/scripts/spec-structure.test.js`
- [ ] AC7：规范树一致 — 验证：`node scripts/version-cascade-check.js`；`node scripts/spec-coherence-audit.js --strict` 无漂移；`node scripts/build-spec-modules.js` 后 diff 只在 memory.md 的那一句
- [ ] AC8：`npm run check` 退出码 0；`npm run smoke` 通过

## 方案

### hook：`memory-index-lines.sh`

1. 开关：`hook_kill_switch MEMORY_INDEX_LINES`（`DISABLE_MEMORY_INDEX_LINES_HOOK=1`，以及全局 `DISABLE_CLAUDEMD_HOOKS=1`）。
2. 快速退出：事件原文不含 `MEMORY.md` 就退出，不起 jq。绝大多数 Bash 调用在这里结束。
3. 找出"这次写的行"：
   - Edit：`tool_input.file_path` 是 `$HOME/.claude/projects/<一段>/memory/MEMORY.md`；候选行 = `new_string` 里不在 `old_string` 里的行。
   - Write：同样的路径条件；候选行 = `content` 里不在 `tool_response.originalFile` 里的行（新建时 originalFile 为空，全部算）。transcript 里的 `toolUseResult` 显示两种工具都带 `originalFile`。
   - Bash：命令含 `MEMORY.md`。要读的索引 = 本项目的 MEMORY.md（与 `memory-prompt-hint.sh` 同一算法：`hook_memory_root` + `hook_encode_project`），加上命令里出现的 `~/.claude/projects/<x>/memory` 或 `$HOME/.claude/projects/<x>/memory` 目录。候选行 = 这些索引里**原样出现在命令文本中**的行。`echo` / `printf` / heredoc / `L='…'; echo "$L" >>` 都把整行写在命令里；`sed -i` 只改一部分，不会命中（漏报，可接受：这类改动多半是在缩短）；只读命令不改文件，但如果整行原样出现在命令里（例如 `grep -F '<整行>'`），会误报一次，可接受。
4. 判定：候选行以 `- [` 开头，并且码点数 > 150（用 jq `length`，与 doctor 的 `[...l].length` 一致）。
5. 输出（只在有超长行时）：一个 JSON，`hookSpecificOutput.additionalContext`，大意：`[claudemd] §11 memory index: 1 line you just wrote to MEMORY.md is over 150 characters (212: "<title>"). An index line is a title, tags and a one-line hook; move the rest into the memory file and shorten the line now. Lines that were already there are not flagged. The user can turn this off with DISABLE_MEMORY_INDEX_LINES_HOOK=1.`
6. 记录：`hook_record memory-index-lines long-line {"lines":N,"max":L,"tool":"Edit|Write|Bash"}`，用于事后测效果。
7. 任何一步失败都静默退出 0（只做提示，从不阻断）。

比较过的做法：
- 挂到 `mem-audit.sh`（Stop）：它的输出走 stderr、只给人看，而且 24 小时节流，写行的 agent 看不到，不改变写法。不选。
- 只挂 Edit|Write：漏掉 23/39 的新超长行（见测量）。不选。
- PreToolUse 拒绝写入：会挡住记忆保存，代价大于收益。不选。
- 写会话快照比对（覆盖 `sed -i`）：要给每个会话存状态文件，还要清理。不选。

### extended §11-EXT（:442）

旧：`- **Index line ≤150 characters**: title, tags, one-line hook. `MEMORY.md` loads every session; the detail belongs in the file, and `/claudemd-doctor` flags longer lines.`
新：`- **Index line ≤150 characters**: title, tags, one-line hook. `MEMORY.md` loads every session; the detail belongs in the file. A hook flags a longer line as it is written; `/claudemd-doctor` lists the ones already there.`

### 第 3 项：`spec/CLAUDE.md` 第 3 行

旧：`<!-- Canonical: `~/.claude/CLAUDE.md` | Modules: `~/.claude/spec-modules/` (§2.2) | History: `~/.claude/CLAUDE-changelog.md`. -->`
新：`<!-- Source: `spec/CLAUDE.md` in the claudemd plugin repo; `~/.claude/CLAUDE.md` is the installed copy and `/claudemd-update` overwrites edits made there. Modules: `~/.claude/spec-modules/` (§2.2) | History: `~/.claude/CLAUDE-changelog.md`. -->`

上下文成本为零：CC 加载 CLAUDE.md 时剥掉 HTML 注释（daagu 会话加载的副本里没有第 3、37 行）。

另外查过的 `<!-- -->`：
- 第 37 行 `<!-- Extended-only terms (**Assumption**): session.md §1.5-EXT. -->`：指针，准确，不改。
- `spec/spec-modules/*.md` 的 `<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->`：已经说明是生成文件，读者不会把它当源文件改；注入时整行不进上下文。不改。
- `spec/CLAUDE-extended.md` 的 `<!-- module: X -->`：构建标记，不改。
- `spec/CLAUDE-changelog.md` 第 3 行 "Canonical history for …" 不是注释，说的是"版本历史以此为准"，不涉及该改哪个文件。不改。

## 计划
- [ ] S1：hook 测试先写，跑红 — 覆盖 AC1–AC5 — 依赖：授权
- [ ] S2：实现 hook 与注册、清单 — 覆盖 AC1–AC5 — 依赖：S1
- [ ] S3：extended :442 + 核心第 3 行 + v8.6.1 条目 + 钉住哈希 + 重建模块 — 覆盖 AC6、AC7
- [ ] S4：`npm run check`、`npm run smoke` — 覆盖 AC8
- [ ] S5：插件 `CHANGELOG.md` 条目；提交在 `next-release`

## 决策与进展
- 2026-11-25：测量完成，选 (a)，理由见"决定"。第 2 项按用户决定不做。等用户授权进入实现（L3：新 hook 输出 agent 可见的文字，并且改规范文本）。

## 验证记录
- `python3 -I tasks/memory-index-write-check-2026-11-25/measure_hint.py` → 133 次提示、378 对；被读 197/378；截到 150 后命中仍在 344/363
