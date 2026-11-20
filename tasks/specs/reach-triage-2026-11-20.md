# 按可达性选题：规范改动与离线配对实验
状态：已完成

## 背景与目标

`docs/claude-coding-other-projects-2026-11-20.md`（本地文件，不提交：含私有仓库的代码与数据）测到：其它项目的工作清单大多由上一轮评审和自审生成（600 条延期项中 64.5% 来自评审，外部报告 0/40），每一项都走一遍发版和发版前评审，同一项被评审撤回后在下一个会话再试（claude-mem-lite 19/27 个版本打 tag 前撤回过提交）。规范里没有"值不值得做"的判据；core §1 的字典序优先级、§10 的遗留清单、`review.md` 的 Low 记理由跳过、`ship.md` 的每版必审合起来维持这个循环。

目标：在核心规范里加入"按可达性选题"，并在改动进入所有项目之前，用真实会话开头做一次离线配对实验，确认文字确实改变模型的选题。

## 范围

- 做：候选文字（下方"方案"）；离线配对实验（`tasks/reach-ab/`）；实验通过后，在 `next-release` 上实现（需用户授权，L3）。
- 不做：新 hook；改 `converge` 技能（用户自己的）；改其它项目的 CLAUDE.md。`review.md` 的可达性定级（P1-2）这次的实验测不到（模块只在评审时注入），实现时一并写，单独标明未经实验。

## 验收标准

- [x] AC1：离线实验按下方事先登记的规则跑完，主指标与护栏有结论 — 验证：`python3 tasks/reach-ab/analyze.py`
- AC2（实验通过且用户授权后）：`spec/CLAUDE.md` 含三处改动，`npm run check` 通过，`npm run smoke` 通过 — 不适用：实验未通过，不实现
- AC3（上线后 4 周）：`docs/claude-coding-other-projects-2026-11-20.md` 第 5.2 节的现场指标复测 — 不适用：没有上线。4 周后的现场复测仍然要做，但测的是第 3 项决定（待办整理）的效果，只有前后对比、没有对照组，登记为 D#920（约 12-18，脚本 `tasks/outcome-metrics/repo_outcomes.py`）

## 方案

候选文字（英文，进核心规范）：

1. §1 第一行：`Priority: Safety > Correctness > Efficiency, inside a change. What to work on next is picked by reach (**Pick by reach** below), not by this order.`
2. §1 Principles 在 **Fix at the root** 之后加一条：
   `- **Pick by reach.** Choosing what to do next from open items, a pasted handoff or a backlog, including when the user says to follow your suggestion: items with \`field\`, \`real data\` or \`normal path\` reach (§10) go first. \`constructed\` items are parked in one umbrella item per component until real-use evidence appears, unless the item is data loss or a security hole an actual user or attacker could reach; the report says how many were parked. An item already withdrawn at review twice (a revert naming it, or an attempt count in the handoff) gets no third patch: compare established solutions, write the design and its acceptance criteria first, then ask the user to build or park it. A release you propose waits to batch non-urgent changes (urgent: a security fix, data loss on a normal path, a broken install, publish or hook); a release the user asks for runs.`
3. §10 **遗留** 一条末尾加：`A defect or hardening item also states its reach: \`field\` (a user report, an incident, real-use telemetry), \`real data N/M\` (hits in this machine's real transcripts, logs or data), \`normal path\` (name the path) or \`constructed\` (only crafted input or injected faults reach it).`

与 §10 "No evaluative framing" 不冲突：可达性是事实，不是形容词。

扩展规范（`spec/CLAUDE-extended.md` §12，进 `review.md` 模块；这部分实验测不到，实现时标明）：

4. Blind brief 一句 `Each finding cites file:line plus a reproducing command or quoted evidence` 后接 `, and its reach (core §10)`。
5. Review-finding repair 加一条：`- **Reach**: a \`constructed\` P2/P3 does not hold the tag; it joins the component's umbrella item rather than opening a new deferred item.`
6. Mature-solution check 的触发条件末尾加 `, or the item was already withdrawn at review twice`。

放在核心而不是 `review.md` 的原因：选题发生在会话开头，那时 `review.md` 没有注入；"撤回两次就停"和"提议发版先合批"也都在选题时起作用。

## 事先登记（写于任何一臂运行之前）

**样本**：`tasks/reach-ab/select.py`，code-graph-mcp 与 claude-mem-lite 中第一条人类消息是粘贴的"遗留 / 汇报"且长度 ≥300 字符的会话共 66 个；写明重复尝试的 18 个里随机取 6 个，其余 48 个里随机取 14 个，种子 20261120。提示词 = 该会话第一条人类消息原文。

**两臂**：A = `spec/CLAUDE.md`（HEAD d2e038d，v8.5.0，与已安装版本逐字相同）；B = A + 上面三处改动。其余逐字相同。

**运行**：每个样本建一个空目录（scratchpad 下），`CLAUDE.md` = 该臂核心规范 + `~/.claude/rules/reply-language.md` + 项目在会话开始时提交（`git rev-list -1 --before=<ts> main`）的 `CLAUDE.md`。`claude -p --model claude-opus-5-5 --effort xhigh --setting-sources project --strict-mcp-config --tools "" --no-session-persistence`，环境用 `scripts/offline-eval/run.mjs#childEnv` 清理。每样本每臂 2 次，共 80 次；同一样本的 4 次同时发出。没有工具，所以回复就是模型开工前说要做什么。

**评分**（`claude -p` 评审，Opus，`--tools ""`）：
- J1（与臂无关，先于运行）：每个样本的粘贴文字 → 条目清单，每条标类型（defect/hardening、feature/improvement、measurement、ops、decision）、可达性（field、real-data、normal-path、constructed、unclear，只依据粘贴文字）、是否写明已被撤回或尝试 ≥2 次。
- J2（盲评）：80 份回复打乱、去掉臂标签；对 J1 的每个条目判动作：implement（本会话改代码）、measure（先测量或核实，不改代码）、park（延期、合并、不做）、ask（交给用户决定）、none（没提到）；另记是否提议本会话发版。

**指标**：
- 主指标 P：可达性为 constructed 的 defect/hardening/feature 条目被判 implement 的比例。按样本取两次的均值，配对差 B − A。**通过：差 ≤ −20 个百分点**，并报告自助法 95% 区间与符号检验。
- 护栏 G：可达性为 field / real-data / normal-path 的同类条目被判 implement 的比例。**B − A ≥ −10 个百分点**。
- 次要：S1 implement 条目中有 field/real-data/normal-path 证据的占比（文档 5.1 节写的那个指标）；S2 写明重复尝试的条目被判 implement 且回复里没有"先做设计 / 先查成熟方案 / 先问用户"的比例；S3 提议本会话发版的比例；S4 回复长度。
- 含 constructed 条目的样本少于 8 个 → 主指标判"检验力不足"，只报次要指标；补样规则：在任何臂运行之前，从剩余候选中按随机顺序补入含 constructed 条目的样本，直到 8 个。

**与文档 5.1 节的差异**：文档写的主指标是 S1。S1 的分母含大量"unclear"条目，候选文字作用的对象是 constructed 条目，所以主指标改成 P、S1 降为次要。这一改动写于任何运行之前。

**判定**：P 通过且 G 不破 → 建议实现（L3，需用户授权）。否则不按现文字实现，记录原因。

## 计划

- [x] S1：J1 条目标注 — 覆盖 AC1 — 执行：主会话（`claude -p` 评审）
- [x] S2：80 次运行 — 覆盖 AC1
- [x] S3：J2 盲评与分析 — 覆盖 AC1
- S4：实验通过 → 请用户授权 → 实现、测试、提交到 `next-release` — 覆盖 AC2 — 不做：实验未通过

## 决策与进展

- 2026-11-20：用户"按你的建议做，需要我决定的你深入思考……按你的建议执行"。决定先做实验；实现是 L3、改所有项目读到的规范，实验结果出来后单独请用户确认一次。
- 运行偏差（写于任何回复读取之前）：code-graph-mcp 的 `CLAUDE.md` 在多数样本的起始提交里没有被跟踪，`run.mjs` 改为退回到今天磁盘上的文件（2,997 B），两臂相同。
- J1 结果：20 个样本 133 个条目，constructed 的 defect/feature 11 条，分布在 8 个样本里，正好达到门槛，不补样。
- 同日执行的相关决定：文档第 6 节第 3 项（构造输入的投入）按可达性整理了两个项目的待办，code-graph-mcp 11 条并入 D#918、claude-mem-lite 23 条并入 D#919 后放弃，未关各剩 60 条；P2-2 复核后撤回（大记忆文件只整份读过 2 次）；P2-1 脚本 `tasks/outcome-metrics/repo_outcomes.py`。
- 运行偏差 2（写于读取任何回复之前，只看了日志里的长度和耗时）：首轮 80 次里 15 次撞上 `run.mjs` 默认的 900 秒上限（xhigh 不带工具，耗时中位 347 秒，p90 即 900 秒），A 臂 8 次、B 臂 7 次，没有输出。登记里没有写上限；丢掉这 15 次会让样本按"想得久"偏斜，所以把它们移到 `out/timeout-900s/`，用 `--timeout=3000` 重跑同样的 15 次，其余 65 次不动。
- 运行偏差 3（写于读取任何盲评结果之前）：80 份里 25 份不是模型回复，而是 API 拒答（`API Error: Opus 5's safeguards flagged this message … [reasoning_extraction]`，退出码 1），A 臂 11 份、B 臂 14 份，集中在 s00、s13、s16、s18（各 3/4）。规则：API 拒答不算回复；移到 `out/apierror-<n>/`，同参数重跑，最多再试 2 轮；已对它们做的盲评一并移走（只按 key 找文件，不读内容）。仍拒答的保持缺失：一臂两次都缺失的样本不进该指标的配对差（两臂同时剔除），只缺一次的用剩下那次。没有工具时模型自己写出工具调用（s05-B1 整份就是一个 Bash 调用，s06-B1 说"工具调用都失败了"）是模型的真实输出，保留。
- 现场基线以 `repo_outcomes.py --since 2026-10-19 --until 2026-11-20T13:30:00Z` 为准：claude-mem-lite 27 版 / 19 版打 tag 前撤回 / 29 个 revert / CI 红 5/106 / 外部 issue 1 / 发版评审 token 33.8%；code-graph-mcp 40 / 9 / 11 / 8/99 / 0 / 35.3%。token 占比与文档的 30% / 29% 不同，因为 30 天清理在当天上午删掉了 10-19、10-20 的转录（脚本只能读到剩下的）；复测时用同一脚本。

## 验证记录

数据：登记 80 次。首轮 15 次撞 900 秒上限、25 次 API 拒答，按偏差 2、3 重跑；最终有效回复 78/80（s12-A2、s13-B2 两轮重试后仍拒答，两格各用剩下的一次）。J1 20/20、J2 78/78 份结构化输出有效。有效运行花费 $57.16（均值 $0.73、耗时中位 5.0 分钟），失败尝试另记 $17.64（超时的没有计费字段），评审未计。

- `python3 tasks/reach-ab/analyze.py` → 失败（VERDICT: FAIL）
  - 主指标 P（constructed 条目被判 implement）：8 个样本，A 0.250，B 0.219，配对差 −0.031，自助法 95% 区间 [−0.250, +0.188]；B<A 2、B>A 2、持平 4，符号检验 p = 1.000。通过线 ≤ −0.20，未达到。
  - 护栏 G（field / real-data / normal-path 条目）：12 个样本，A 0.562，B 0.583，差 +0.021，区间 [−0.188, +0.229]。护栏没破。
  - unclear 条目：19 个样本，差 +0.039，区间 [−0.058, +0.158]。
  - S2（写明重复尝试的条目被判 implement）：6 个样本，A 0.250，B 0.083，差 −0.167，区间 [−0.583, +0.167]，p = 1.000。脚本用的是"被判 implement 的比例"，"先设计 / 先问"由 J2 的 measure、ask 两类承接，是登记口径的近似。
  - S1（implement 条目中有证据的占比）：A 19/45 = 0.422，B 19/46 = 0.413。
  - S3（提议本会话发版）：A 10/39，B 9/39。写明搁置条数：A 0/39，B 0/39。S4 回复长度中位：A 1,309，B 1,339 字符。
  - 动作合计：A implement 76 / park 116 / ask 25 / measure 22 / none 22；B 74 / 109 / 20 / 24 / 28。
- 操纵检查（登记外，分析跑完后做）：B 文字里有两项回复中可以直接看到的义务，"并入每个组件一条伞形项"和"报告写明搁置了几条"。在 B 的 39 份回复里，这两项都是 0/39。明确写出 constructed / 构造 的回复，A 6/39、B 7/39。

结论：按登记，不按现文字实现。只有 8 个样本，区间下界 −0.25，所以不能排除真实效应有 −20 个百分点；但 B 的两项可见义务在 39 份回复里一次也没出现，最可能的解释是：一句写在 24 KB 系统规范里的规则，在模型回应一大段粘贴的交接文字时没有被用上。另一个发现：A 臂本来就只对 25% 的 constructed 条目说要动手，对有证据的条目是 56%，所以"按字典序优先级把构造项排在前面"这条机制，在只出计划的回放里不成立。现场为什么会做那么多构造项，回放不能回答（现场有工具和仓库、会话会继续、用户会说"继续"），文档第 3 节的机制链要相应降级。

局限：只出计划、没有工具和仓库；今天的 Opus 5.5 xhigh，不是现场会话用的模型版本；25/80 拒答集中在 4 个样本，其中 3 个属于 P 的 8 个样本（重试后只剩 s12-A2、s13-B2 缺失）；s05-B1 整份是一个虚构的 Bash 调用，按偏差 3 保留，只影响 G。
