# claudemd 项目架构审核 — 2026-11-25

- **基线**：`main` f8dcf8e，插件 0.122.1，规范 v9.0.0（今天发布的精简版）。
- **方法**：拆成四路只读子审计（hooks、scripts/命令/CLI、测试/CI/发版流程、文档/记录/文件卫生），我负责跨层部分（分层、分发、规则体系），最后汇总。子审计的关键结论逐条对照代码或日志抽查了约 20 条（附录 A），只有一条需要更正，更正的是我自己的初判。
- **数据来源**：`~/.claude/logs/claudemd.jsonl`（10-22 → 11-26，13,072 行，覆盖你所有项目）、`git` 历史、`gh` 只读查询，以及一次完整 `npm test`（全绿，662.5 s）。
- **影响范围**：没有改动任何代码。本文件放在 `docs/` 下；按项目 `CLAUDE.md` 的布局约定，`docs/` 只在本地，等有已发布文本引用它时再 `git add -f`，所以没有提交。

---

## 0 结论

**一句话**：v9 把模型每轮读到的规范从 24 KB 砍到 2.8 KB，但围绕规范搭起来的那套机器基本没动——给已删规则配的 hook、量合规的脚本、钉文字的测试、发版仪式、记录文件。这套机器是按 v8 和"会有外部采用者"的假设造的。分层结构本身是干净的。问题不在结构，而在**体量**：大约一半的代码和三分之二的文件服务于已经不存在的规则、默认关闭的功能，或没有读者的记录。

**七个维度打分**

| 维度 | 判断 | 一句话依据 |
|---|---|---|
| 架构是否清晰 | **良好，边界偏模糊** | 四层单向依赖、无环、hook 全部 fail-open（`docs/ARCHITECTURE.md:5-12`）。但维护者研究代码混在发布树里，同一逻辑有 bash/JS 两份实现（9 个对拍测试套件），"spec"一词有 3 种含义 |
| 功能是否明确 | **核心明确，外围失焦** | 实测有价值的是 ship-baseline、§8 rm/npx、回复语言、规范安装这 4–5 项。对外暴露的却是 28 个 hook、16 个命令、78 个环境开关和一个 npm CLI |
| 代码是否精炼 | **不精炼** | 字面重复很低（jscpd 0.20%），但 hooks 注释行比代码行多（6,524 : 5,144），1,568 行注释是版本/审计编号形式的历史叙述；`doctor()` 一个函数 1,364 行；`pre-bash-safety-check.sh` 2,782 行，其中约 720 行的规则族在现场 35 天只拒绝过 2 次（都在本仓库里） |
| 流程是否繁琐 | **繁琐（最严重）** | 发版手册 11 步、27.8 KB，另有 62 KB 教训档案；同一 SHA 跑 3 遍 CI（19 个 job，约 386 runner-min）；近 128 个 commit 里 57% 是仪式（版本号、评审修复、记录）；规范版本号散在 12 个文件约 24 处，外加一行自指的 Sizing |
| 规则是否科学 | **方法已经科学，遗留机制没跟上** | v9 用隐藏测试 + 预注册 + 不装组对照，是本项目第一次真正量结果，这一步做对了。但 15 条 HARD 里 6 条靠自觉、无法核查；降级复核只能覆盖 4/15；规则 ID 还是 v8 编号；banned-vocab 闸门 0/13 正确却仍在拒 |
| 模块是否简洁 | **不够简洁** | 至少 6 套独立的命令解析器，3 份"是否测试命令"正则；`status` 基本是 `doctor` 的子集；删除逻辑分散在 5 处；`spec-module-inject` 的预算和延迟逻辑在只剩 2 个模块后已是死代码 |
| 文件是否冗余 | **冗余严重** | `CHANGELOG.md` 1.47 MB（73% 是 0.100.0 之前的条目）；221 KB 的规范变更史装进每个用户的 `~/.claude` 并在 5 个备份里各存一份；127 个跟踪的记录单位里 77 个（1.17 MB）没有任何在用代码引用；本地未跟踪 1.46 GB |

**最值得做的六件事**（详见 §5）

1. **修正 agent 每次会加载、却指向已删条文的文字**：项目 `CLAUDE.md`、`.claude/rules/spec-edit.md`、5 个命令页。零风险，立刻能做。
2. **退役 14 个无 v9 规则或默认无效果的 hook**：hook 代码减 27%，测试减约 5,000 行；每次 Bash 调用起的 hook 进程从 12 个降到 7 个，每次 Stop 从 8 个降到 2 个。
3. **退役合规测量层**：5 个脚本、5 个命令，约 215 KB 代码和 231 KB 测试。它量的是你已决定不再量的东西，8 个检测器全部已标 `closed`。
4. **`pre-bash-safety` 加触发词前置过滤，删掉 0 拒绝的规则族**：约 83% 的 Bash 调用可省约 175 ms，涉及你所有项目。
5. **发版流程瘦身**：CI 不在同一 SHA 上重复测、矩阵 6 腿减到 3 腿、不再写 release 记录文件、文字钉测试降级为手动工具。每次发版 CI 等待从约 66 min 降到约 23 min。
6. **记录归档**：CHANGELOG 截断，规范变更史只留 v9，未被引用的记录取消跟踪，`.gitignore` 改成纯白名单。跟踪体积约 9.3 MB → 约 6 MB。

**对你其它项目的实际影响**：上面这些都**不会改变代码正确率**——结果对照里"只装 hook"组成本 1.04×、正确率与不装相同。收益体现在三处：每次 Bash 调用和每轮结束的延迟、更少的误拒、`~/.claude` 和插件缓存的占用。剩下的都是本仓库的维护成本。这一点我不想夸大（§7）。

---

## 1 现状画像

### 1.1 模型读到的 vs 仓库里有的

| 项 | 大小 |
|---|---|
| 每轮加载的核心规范 `spec/CLAUDE.md` | 2,792 B |
| 按需加载的模块（ship + review） | 2,517 + 1,516 B |
| 仓库跟踪内容合计 | 约 9.28 MB |
| 　产品代码（hooks 12,479 行 + scripts 22,267 行 + bin 662 行） | 35,408 行，约 1.9 MB |
| 　测试（不含 118 个 fixture） | 61,852 行，是产品代码的 **1.75 倍** |
| 　记录类（CHANGELOG、两份 changelog、docs、tasks） | 3.96 MB，占跟踪字节 **42.7%**，占近 30 天新增字节 **52%** |
| 插件缓存，每个版本 | 约 9.3 MB（tests 3.3 MB、CHANGELOG 1.47 MB、docs 1.4 MB 运行时都用不到），本机缓存了 3 个版本 |
| `~/.claude` 规范占用 | 236 KB，其中 221 KB 是 `CLAUDE-changelog.md`；另有 5 个 `spec-backup-*` 各 296 KB |
| 本地未跟踪的 `docs/` + `tasks/` | 1.46 GB（`tasks/transcript-snapshot-2026-11-21/` 一个目录 1.16 GB） |

### 1.2 采用面

仓库 3 星、0 fork、0 issue（创建以来从未有过）、0 外部 PR，1,451 个 commit 全部来自同一作者。npm 上 `claudemd-cli` 月下载 4,248 次，但高峰集中在发版当天，平时每天 6–57 次。这和你 08-24 的判断一致（`tasks/npm-download-attribution-2026-08-24.md`：主要来自镜像同步）。

**含义**：README 的 kill-switch 大全、"外部契约"文档（`ADDING-NEW-HOOK.md`、`RULE-HITS-SCHEMA.md`、`cross-project-pilot.md`）、npm CLI、macOS 多 node 版本矩阵，都是为尚未出现的采用者付的成本。这不等于全部该删（公开插件需要基本的可安装性），但"给外部用户的契约"不应再作为保留某样东西的默认理由。

### 1.3 现场遥测（35 天，13,072 行）

| hook | 行数 | 其中有效动作 |
|---|---|---|
| pre-bash-safety | 7,367 | 231 拒绝（rm 194、npx 36、反弹 shell 2）；另有 7,062 行 allow 记录，占全日志 54% |
| verify-log | 3,295 | 全部在 11-02 之前，之后已关闭 |
| memory-prompt-hint | 756 | 173 次建议；583 行 `suppress-source` 只是记日志 |
| ship-baseline | 534 | 20 次拒绝（按 OPERATOR 记录，33 次拒绝里 31 次 CI 确实是红的，经 `gh` 核实） |
| sandbox-disposal | 216 | 216 次警告，只在终端显示，不进上下文 |
| evidence-gate / rework-breaker | 185 / 88 | 全部在 11-02 之前，之后已关闭 |
| reply-language | 181 | 181 次要求重述 |
| session-start | 169 | 78 次压缩提醒、51 次暂停横幅 |
| spec-module-inject | 132 | 注入 ship/review 模块 |
| memory-read-check | 39 | 30 次拒绝（约一半相关） |
| branch-prune / mem-audit / session-end | 39 / 21 / 25 | mem-audit 的 21 次指向同样 5 个文件，从未被修正 |
| spec-module-gate / banned-vocab | 8 / 2 | banned-vocab 自 0.120.1 起 0 次 |
| **零记录**的 10 个 | 0 | 原因见 §3：默认关闭 5 个、写入方从未启用 1 个、监视的目录不存在 1 个、无触发路径 1 个、只在罕见路径记录 1 个、记在别的 hook 名下 1 个 |

---

## 2 七个维度

### 2.1 架构是否清晰 — 良好，边界偏模糊

**做得好的**
- 四层（L1 hooks / L2 scripts / L3 commands / 独立 CLI）依赖单向：L1 不引用 L2，`bin/` 只引用 `scripts/lib/`。`baseline-metrics.js` 的真实树测试断言无环。
- hook 统一 fail-open，统一的 stdin/stdout 协议（`docs/HOOK-PROTOCOL.md`）。
- 每个 hook 都有独立 kill switch。

**问题**
1. **受众混在一起**。研究用的测试工具装进了每个用户的插件缓存（`scripts/offline-eval/`，98 KB，在 `~/.claude/plugins/cache/claudemd/claudemd/0.122.0/scripts/offline-eval/` 下已确认）。只有维护者需要的检查（`tasks-review-cadence`、`runbook-review-step`、session-end 的发版节奏提示）出现在每个用户的 `doctor` 和 hook 里。用户命令 `/claudemd-analyze` 审计的其实是插件自己的规范，而 CI 已经保证它是干净的。
2. **反过来，真正有价值的研究资产却没有被跟踪**。v9 的依据——结果对照工具 `tasks/claudemd-value-2026-11-25/`（代码约 54 KB，`OPERATOR.md:13` 规定今后改规则必须先跑它）——在 gitignore 里。它还从发布树 `scripts/offline-eval/run.mjs` 引用 5 个辅助函数。发布树里放着已结题的研究代码，在用的研究代码却只存在于本机。
3. **同一规则有两份实现**。banned-vocab 在 bash（`grep -iE`）和 JS（`scripts/lib/lint.js`）各一份；sanitize 有三份；memory-tags 和用户回合解析也各有两份。为了让它们保持一致，有 9 个对拍套件，共 1,937 行。
4. **规范的分发管道比规范本身重得多**。把 2.8 KB 规范复制进 `~/.claude` 这件事，由 install.js（943 行）、backup.js、spec-hash.js、update.js、spec-diff.js、install-drift.js、version-sync hook、session-start 漂移检查共同维护，合计约 106 KB。这条链路是 v8 时代为 24 KB、9 个模块设计的。
5. **命名歧义**。"spec"同时指 `spec/`、`tasks/specs/`、`docs/superpowers/specs/`；仓库里有两份 changelog、两份 `CLAUDE.md`；`docs/` 根目录里 7 份参考文档和 9 份带日期的分析混放。

**建议**：研究代码移出发布树，在用的结果对照工具改为跟踪（只要代码，不要 52 MB 输出），放进一个开发目录，例如 `eval/`。用户面不再出现维护者专用的检查。双实现在退役（§2.2）之后大多自然消失，剩下的保留一份即可。

### 2.2 功能是否明确 — 核心明确，外围失焦

**实测有价值、或你明确要的**：ship-baseline（CI 红时拒绝 push）、§8 rm 空变量和 npx 未固定版本、回复语言、规范的安装与同步，以及可能的 memory-read-check（精度约 50%，见 §2.5）。

**对外暴露的面**：28 个 hook（29 个注册项）、16 个斜杠命令、78 个环境开关、一个 npm CLI，外加状态栏接管和 DESIGN.md 生成这两个与"编码纪律"无关的功能。

**失焦之处**
- **14 个 hook 不服务任何 v9 规则，或在默认配置下什么都不做**（逐个裁决见 §3）。其中 5 个默认开启却没用，你每个项目都在为它们付延迟：
  - `session-summary`：每轮结束 434 ms，把 4.2 MB 日志 `jq -s` 整读两遍（`hooks/session-summary.sh:121`）。
  - `spec-module-gate`：每次 Bash 调用 50 ms，默认 `log` 模式，什么都不输出。
  - `residue-audit`：监视的 `~/.claude/tmp` 根本不存在。
  - `mem-audit`：21 次警告都指向同样 5 个文件，从未修正。
  - `session-extended-read`：v8 和 v9 都没有任何地方指示去读 `CLAUDE-extended.md`。
- **合规测量是一整层用户功能**：`/claudemd-sampling-audit`、`/claudemd-rules`、`/claudemd-sparkline`、`/claudemd-bypass-audit`、`/claudemd-analyze`，以及 `/claudemd-audit` 的 `selfCompliance`。
  - `scripts/sampling-audit.js:95-156` 的 8 个检测器全部标 `closed`。
  - 它的 `RULE_KEYS`（`:51-58`）里 4 条规则 v9 已经删除。
  - `hard-rules-audit` 报 `staleReviews: 15`，也就是 15/15 条规则都"该复核了"。
  - 你 11-25 已明确"停止围绕规范本身的测量"（`feedback_spec_change_needs_outcome_evidence`）。
- **npm CLI 的唯一用途是 banned-vocab**。而 banned-vocab 在 v9 里只剩冻结的 hook 和扩展规范里的参考列表，11-03 的人工标注是 13 次拒绝 0 次正确。

**建议**：明确定位为"薄安全网"，产品面收敛到 **约 14 个 hook、8 个命令**（§3、§4）。状态栏和 DESIGN.md 是可选功能，成本低、与核心无冲突，留不留由你定（我倾向保留，作为独立功能写进 README 的"附带功能"一节）。

### 2.3 代码是否精炼 — 不精炼

| 信号 | 数值 | 位置 |
|---|---|---|
| hooks 注释行 : 代码行 | 6,524 : 5,144（1.27） | 例：pre-bash-safety 1,729 : 1,006；`hook-common.sh:16-69` 用 54 行注释解释一行 `: "${HOME:=}"` |
| scripts 注释行 : 代码行 | 6,418 : 14,445（0.44） | rule-hits-parse.js 1.07、lint.js 1.17 |
| 注释里的历史叙述（版本号、日期、审计编号、轮次） | hooks 745 行 + scripts 823 行 | 其中 49 处 `D#` 编号已无法解析，claude-mem-lite 在 11-25 删除时没有归档 |
| 超过 100 行的函数 | 18 个 | `doctor()` 1,364、`installLocked` 536、`runHookSelfTests` 427、`lintCmd` 274 |
| 只被测试引用的导出 | 294 个里 125 个 | |
| 字面重复 | 0.20%（jscpd） | 这一项是好的 |
| 现场几乎不拒绝的规则族 | 约 720 行 | pre-bash-safety 的 remote-run（P2b，0 次）、curl\|sh（P3，0 次）、comment-pass（0 次）、命令替换/socat/`/dev/tcp`/解释器单行（P3b–d，2 次，都在本仓库） |

**`pre-bash-safety-check.sh` 单独说**：2,782 行，其中约 1,050 行是解析和 sanitize 机制，约 1,670 行是规则。
- 文件自己写着"没有触发词提前退出"（`:120`），所以每次非只读 Bash 都要跑完整解析：p50 195 ms，p90 268 ms。
- 只读快速通道遇到 `|`、`&`、`;`、`>` 就放弃，3,000 条真实命令里只有 37 条（1.2%）能走。
- 83% 的真实命令里根本不含任何 §8 触发词。
- 现场拒绝只来自 rm 族（194）和 npx 族（36）。
- `:1493` 明确说 §8 是护栏而不是防注入边界，但 socat、`/dev/tcp`、解释器 socket 这些检测器只在面对攻击者时才有意义。

**建议**
1. 加前置过滤：命令里不含 `rm|-delete|npx|bunx|dlx|exec|curl|wget` 就直接退出。
2. 删除 P2b、P3b–d 和 comment-pass，约 600 行，语料约 140 行；P3 换成约 20 行的管道正则。
3. allow 行不再写日志。
4. **代价**：字面过滤会放过 `r''m`、`\rm` 这类变形写法。现场是否出现过无法确认（拒绝记录存的是规范化后的文本），这是安全上的取舍，需要你拍板。
5. **注释**：不建议一次性大清洗（改动面太大，评审成本高）。规则改为"每个决定留一行 why，历史进 git log"，改到哪个文件清到哪个。

### 2.4 流程是否繁琐 — 繁琐（最严重）

**发版**

| 项 | 现状 | 来源 |
|---|---|---|
| 发版手册 | 11 步，27.8 KB，每步一大段并夹带历次教训；另有 62 KB 版本教训档案 | memory `feedback_claudemd_ship_from_main_atomic.md` |
| 分支 | `next-release` 存放待发 commit → 每版新建 `release/vX.Y.Z` 并 rebase → draft PR → ff 合并 → 删分支 → 重置 `next-release` | 同上第 5、8、9 步 |
| 同一 SHA 的 CI | PR、main push、npm-publish 各跑一遍，共 19 个 job；`static` job 在两个 workflow 里完全相同，npm-publish 还在同一 SHA 上再跑 4 条测试腿 | `.github/workflows/npm-publish.yml:98,116`、`ci.yml` |
| 矩阵 | 2 个系统 × 3 个 node 版本 = 6 腿 + static | `ci.yml:102,112` |
| 每次发版 | 约 386 runner-min；CI 等待约 66 min；版本 commit 到打 tag 平均 78 min（中位 64） | `gh` 只读查询，90 个 run |
| 30 天 CI 失败 | 6 次，**全部与产品缺陷无关**（4 次是新测试在 macOS 上不稳，1 次 runner 镜像问题，1 次 npm 鉴权） | 各 job 日志 |
| commit 构成（v0.117.0..HEAD，128 个） | 记录 34、评审修复 21、版本号 15、发版文字 3，合计 **57%**；产品代码 31（24%） | 按前缀分类并人工校正 |
| 每版的发版文字 | CHANGELOG 条目、`spec/CLAUDE-changelog.md`、`tasks/specs/release-*.md`（平均 9.7 KB）、PR body、tag message、GH release，加 2 个 memory 文件 | git log |
| 版本号所在位置 | 插件 semver 5 处；规范版本约 24 处、12 个文件；还有一行**自指**的 Sizing（它自己的数字也算进它声明的字节数，要解不动点） | `version-cascade-check.js`、手册第 2 步 |
| 节奏 | 30 天 16 个 tag；11-09 以来每个 minor 版本当天都补了一个 patch | `git for-each-ref` |

**改规范**：`.claude/rules/spec-edit.md:12` 自己承认"一条规则常写在好几个地方：core、§EXT、OPERATOR.md、hard-rules.json、commands/*.md、README"。改一行规范需要：升版本号（约 24 处）、写两份 changelog、解 Sizing 不动点、重建模块、更新 `spec-structure.test.js` 里 20 行整行文字钉和标题清单。有 36 个测试文件引用规范文件，1,126 行测试守着 2.8 KB 核心和 6.4 KB 扩展。

**测试**

| 项 | 现状 |
|---|---|
| 本地 `npm test` | 662.5 s（今天负载约 3，11-10 记录的中位数是 163 s） |
| 关键路径 | `pre-bash-safety` 套件：每个语料行起一次 hook，共 1,306 次，约 370 s |
| shellcheck | 本地跑两遍：`package.json` 的 `lint:sh` 一遍，`tests/run-all.sh:376` 再一遍，每遍 46 s；CI 每腿跑三遍 |
| 文字钉测试 | 25 个文件、7,478 行、242 个测试。版本教训里提到它们时全是"造成摩擦"，按记录核对的范围内**一条用户可见缺陷都没抓到** |
| 不封闭的测试 | `tests/scripts/lesson-bypass-audit.test.js:357` 读真实的 `~/.claude/logs`（本地 10 s，在 CI 上空跑） |
| 死测试工具 | `tests/tools/spec-pin-mutations.py`（356 行）要变异的 `**Yield only on**` 在现行规范里出现 0 次，也没有 runner 调用它 |

**评审到底抓到了什么**（核对了 0.118.0–0.122.0 的 7 份记录）：真正的代码缺陷**只出现在删除/清理路径上**。
- 0.119.0 H1：`cc-` 前缀和 Claude Code 自己的 `/tmp/cc-socks` 撞名。
- 0.120.0 H1：挂载点会被 `rmSync` 删穿。
- 0.121.1 M2：遍历出错时跳过了子树，但 `rmSync` 照样删进去。

其余的 Medium 和 Low 基本都是文字问题。这和 v9 的"按风险触发评审"完全吻合：0.122.1 按 v9 规则没有评审，版本 commit 到 tag 只用了 17 min。

**建议（目标流程）**
1. 平时 commit 进 `next-release`。发版时直接开 `next-release → main` 的 draft PR，不再新建 `release/vX`、不 rebase、不删分支。
2. PR CI 保留 static + 3 腿（ubuntu-20：bash 3.2 解析和运行时、无 `node:sqlite`；ubuntu-24；macos-24）。main push 只跑 static。npm-publish 不再测，改为检查该 SHA 上已有绿色的 `ci` check-run，再加"tag 在 main 上"和"版本号匹配"两项检查。
3. 评审严格按 v9 的触发清单；纯文字的发现写进 PR body，不另开修复轮。
4. 仓库里唯一的发版文字是 ≤3 KB 的 CHANGELOG 条目，不再写 `tasks/specs/release-*.md`，也不再有"record closed"这类 commit。
5. 测试：pre-bash-safety 语料分 3–4 片并行；shellcheck 只跑一遍；文字钉只保留插件 semver 一致性（它在 v0.47.1–3 抓到过真问题）和 hook 实际引用的 §5/§8 行，其余降级为手动工具（和 `claim-drift`、`doc-check` 现在的处理一样）；Sizing 行改为生成或删除。
6. 发版手册从 27.8 KB 压到约 1 页：只留步骤和命令，教训移进档案。

**预计**：每次发版 CI 等待约 66 → 23 min，runner-min 386 → 约 65，本地少 5–8 min，少 2 个 commit 和约 10 KB 记录。

### 2.5 规则是否科学 — 方法已经科学，遗留机制没跟上

**做对的**
- v9 是这个项目第一次用**结果**而不是**流程合规**来判断规则：隐藏测试、预注册标准、不装组对照，成本按每个任务中位比值的几何均值报告。结论也是诚实的：精简版**没过**预注册的成本线（1.17× / 1.26×，线是 1.15×），由你明确接受，而不是事后改线。
- 扩展规范 §0.1 把"新规则要先过结果对照"写成了规则，`OPERATOR.md` §13.3 也给 hook 设了"要有现场证据"的门槛。

**遗留问题**
1. **"HARD"标签名不副实**。15 条 HARD 里 6 条靠自觉（`self`）、1 条靠外部，没有任何机制能发现违反。v9 核心正文已经不再使用"HARD"这个词，于是这个标签只剩一个用途：喂给降级复核和测试。
2. **降级复核几乎是空转**。`OPERATOR.md` §13.1 自己写明 `demoteCandidates` 永远只可能覆盖 4/15 条；实际运行报 `staleReviews: 15`。这正是你已决定停止的合规测量。
3. **规则 ID 和条文对不上**。`hard-rules.json` 里有 `§11-memory-read`、`§11-session-exit`（v9 核心没有 §11）、`§10-four-section-order`（v9 的汇报是三段，不是四段）、`§iron-law-2`（v9 已不用"Iron Law"这个说法）；另有 14 个遥测 `spec_section` 标签对不上任何规则。
4. **已有证据但还没执行的结论**。
   - banned-vocab：11-03 标注 13 次拒绝 0 次正确，35 天 2 次拒绝，0.120.1 以后 0 次。它仍是 deny 闸门，另有 628 行实现和 923 行测试。
   - memory-read-check：精度约 24/46。
   - memory-prompt-hint：没有任何结果证据，77% 的日志行只是"抑制"记录。
5. **证据的边界要说清**。结果对照只覆盖单回合 JS 任务（基线通过率 90%，有天花板效应），没测长会话；hook 的现场精度是你自己（或 agent）单人标注的，没有第二人复核。这些不推翻结论，但"hook 有价值"目前的证据强度是"现场标注"，不是"对照实验"。
6. **保留下来的核心规则大多是偏好，不是功效**："每个改动本地提交"和"三段式汇报"在对照中让成本 ×1.2–1.3，正确率不变，是你为可追溯性付的价。这是合理的选择，但应当在文档里写明"偏好，已知成本"，避免以后被当成"有效规则"的先例。

**建议**
- `hard-rules.json` 收缩为"闸门清单"：只列有 hook 执行的 5–6 条，ID 改成语义名（如 `ship-baseline`、`rm-empty-var`），不再带章节号。自觉类规则就是规范正文，不需要清单。
- 删除降级复核：`hard-rules-audit.js`、OPERATOR §13.1 的 Demote-loop 一节、doctor 的 `rule-usage` 行。
- 遥测里的旧 `spec_section` 值保留（历史数据要能读），在 `RULE-HITS-SCHEMA.md` 标注为"旧 ID，不是条文指针"。
- banned-vocab 按 12-01 复测执行（§9 决定 2）。

### 2.6 模块是否简洁 — 不够简洁

1. **命令解析器至少 6 套**：pre-bash-safety 自带一套；`hook-common.sh` 的 `hook_flatten_cmd`、`hook_strip_heredoc_bodies`、`hook_trigger_view`；memory-read-check 的 `sanitize_for_tagmatch`；spec-module-gate 的 `_mg_*`；cross-repo-write 的 `xrepo_scan_bash`；ship-baseline 的 push 段和 `cd` 解析。
2. **"这是不是测试命令"有 3 份正则**：`hooks/lib/verify-cmd.sh` 的 T1/T2、`session-end-check.sh:120` 的 `VALIDATE_RE`、`test-failure-debug.sh:68` 的 `TEST_CMD_RE`。"这是不是机器发来的 prompt"的过滤也有 3 份：memory-prompt-hint:81、spec-module-inject:47、reply-language:161。session-id 清洗有 9 份，还用了两种字符类写法。
3. **`hook-common.sh` 62 KB，686 行注释对 479 行代码**，承担了事件解析、拒绝和记录、只读快速通道、heredoc 剥离、命令展平、后台安装、安装失败哨兵、ledger 等 17 项职责。
4. **命令和脚本重叠**：
   - `status` 基本是 `doctor` 的子集。
   - `install` 和 `update` 共用 `copySpecFiles`/`syncSpecModules`，而 version-sync hook 本来就会自动跑 install。
   - 删除逻辑分散在 clean-residue、`doctor --prune-backups`、tmp-sweep→housekeeping、cache-prune、`uninstall PURGE` 五处，挂载点检查写了两份（`clean-residue.js:204`、`housekeeping.js:350,371`）。
   - 按 section 统计规则命中由 4 个脚本各算一遍。
5. **在只剩 2 个模块后成了死代码**：`spec-module-inject` 的 9,800 字符预算和 `pending:` 延迟逻辑（ship.md 2.5 KB、review.md 1.5 KB，加起来不可能触发）；`spec-module-gate` 整个文件（inject 已经送达了模块）。
6. **`tmp-sweep` 的节流判断放在加载库之后**：即使被节流，每次 Bash 也要花 59 ms；把时间戳检查挪到最前面，可以降到约 18 ms 的进程启动成本。

**建议**：先退役（§3、§4），很多重复会随之消失。之后把"命令解析"收敛成 `hook-common.sh` 里一个公共入口，pre-bash-safety 之外的 hook 都只用它；`doctor()` 拆成每项检查一个函数；删除逻辑统一走 housekeeping 一处，挂载点检查只留一份。

### 2.7 文件是否冗余 — 冗余严重

| 文件或目录 | 现状 | 读者 | 建议 | 可省 |
|---|---|---|---|---|
| `CHANGELOG.md` | 1,469,956 B，303 条；0.100.0 之前 1,080,217 B（73%）。一条条目（2173 行附近）一段就超过 4 KB，写的是评审轮次过程 | 机器只读顶部一条（`changelog-structure.test.js`、`claim-drift.js:129-136`）；308 个 GitHub Release 已有全部历史 | 只保留 ≥0.100.0（或最近 20 条），文件末尾写明旧条目的位置（git tag / GH Releases） | 1.07–1.36 MB（仓库和每份插件缓存） |
| `spec/CLAUDE-changelog.md` | 221 KB，63/77 条是 v6 时代；`SPEC_FILES`（`scripts/lib/paths.js:78`）让它装进每个 `~/.claude`，5 个备份各存一份 | 运行时没有读者 | 文件名不变（保住"4 个文件"的契约和约 15 个测试），内容只留 v9 条目，约 6 KB | 约 215 KB × (1 + 备份数) |
| 跟踪的 docs/tasks 记录 | 127 个单位：在用代码引用 39、只被测试引用 11、只被 changelog 引用 40、只被其它记录引用 17、无人引用 20 | — | changelog-only、records-only、无人引用这三类取消跟踪（`git rm --cached`，本地文件保留）；changelog 里的引用通过 `git show <tag>:<path>` 解析 | 约 1.17 MB |
| `docs/audit/` | 533 KB，最后一份是 09-26；代码只引用其中 2 份 | — | 其余 38 个文件取消跟踪（含 26 个早已应用的 `.patch`） | 375 KB |
| `docs/superpowers/` | 372 KB；被链接的那份"设计依据"还写着"Status: Approved… pending implementation plan"，目标 v0.1.0 | README 和 ARCHITECTURE 各链接 1 份 | 5 份执行计划和 4 份未被链接的设计取消跟踪 | 330 KB |
| `tasks/specs/` | 61 份：24 份是发版和收尾的过程记录，14 份是 v9 已删条文的设计，23 份是仍在发布的代码的设计 | — | 留 23 份；`spec-status-drift.test.js:64` 的"至少 5 份"门槛照样满足 | 约 362 KB |
| `README.md` | 62 KB；hook 表 15.7 KB、kill-switch 表 12.6 KB；13 处 v9 后已过时（`:103` 说 §7 允许用 `-D`、`:105` 引用 §10-honesty、`:512` 写 "1.3 MB" 等） | 用户 | 压到 15–20 KB：5 个闸门 5 行，kill-switch 交给 `/claudemd-status --verbose` 列出 | 约 40 KB |
| `.gitignore` | 8.9 KB，79% 是注释；理由链里引用的 §2.S、§13.2 已不存在；另有 5 个被强制加入跟踪却不在白名单里的文档 | git | 改成纯白名单，规则一句话写进 CONTRIBUTING | 约 7 KB |
| `.converge/` | 208 KB，`INTENT.md` 生成于 v0.88.0，有 6 处指向已删条文 | converge 技能 | 重新生成或归档 | — |
| 本地 `tasks/` | 1.46 GB，8,364 个文件；59 个条目（160 MB）超过 30 天没碰 | 本机 | 12-01 复测后把转录快照移出仓库；`preship-review-*`、`*.log`、`metrics-*.json` 可删（需要你授权，不是本任务创建的） | 约 1.4 GB |

**文档本身的重叠**：每个 hook 在 3–5 份文档里各描述一遍（README、ARCHITECTURE、RULE-HITS-SCHEMA、HOOK-PROTOCOL、flows），另有约 178 KB 的漂移测试专门让这些文字和代码保持同步。

**建议的最小文档集**：
- README（15–20 KB）、CONTRIBUTING、CHANGELOG（截断后）、LICENSE。
- `spec/*`（变更史只留 v9）。
- `docs/`：ARCHITECTURE（修正过时行，删掉历史标记）、HOOK-PROTOCOL、ADDING-NEW-HOOK（写明 hook 已冻结）、RULE-HITS-SCHEMA（只留契约）、ROLLBACK、S8-RESIDUALS、`flows/bootstrap.md`、`claudemd-value-assessment-2026-11-25.md`，以及代码引用的 2 份审计报告。
- `tasks/specs/` 留 23 份。

**记录政策**：只有在用的发布文本或测试**读取**的文件才跟踪；"被 changelog 或其它记录提到"不算。

---

## 3 hook 逐个裁决（28 个）

"默认"指不设任何环境变量时的状态；"35 天"即 §1.3 的遥测；耗时是沙箱 HOME 下的中位数，含约 18 ms 的测试框架开销。

| hook | 事件 | 行数 | 服务的 v9 规则 | 默认 | 35 天 | 裁决 |
|---|---|---|---|---|---|---|
| pre-bash-safety-check | Pre:Bash | 2,782 | core §8（3 条 HARD） | 开 | 231 拒绝 | **简化**：前置过滤 + 删 0 拒绝族（§2.3） |
| ship-baseline-check | Pre:Bash | 362 | §12 ship | 开 | 20 拒绝，约 94% 正确 | **保留** |
| memory-read-check | Pre:Bash | 365 + 278 lib | ext §13 | 开 | 30 拒绝，约 50% 相关 | **保留，待你决定**（§9） |
| banned-vocab-check | Pre:Bash | 514 + 114 | ext §13 / §10-V | 开 | 2 拒绝，0/13 正确 | **退役候选**（§9 决定 2） |
| spec-module-gate | Pre:Bash | 259 | 无（inject 已送达模块） | 开（log 模式，无输出） | 8 | **退役**；每次 Bash 50 ms |
| cross-repo-write-check | Pre:Edit\|Write\|Bash | 491 | 无（v8 §5 的 grant 条款已删） | 关 | 0 | **退役** |
| session-extended-read | Pre:Read | 54 | 无 | 开 | 0 | **退役** |
| transcript-vocab-scan | Post:* | 153 | §10-V 提示 | 关 | 0 | **退役** |
| rework-breaker | Post:Edit\|Write\|Bash | 205 | 无（v8 §1 已删） | 关 | 88（11-02 前） | **退役** |
| memory-index-lines | Post:Edit\|Write\|Bash | 160 | 无（来自 Claude Code 自己的 memory 指引） | 开 | 新上线，11-26 起暴露 | **保留，待证据** |
| tmp-sweep | Post:Bash | 145 | 基础设施 | 开 | 0（只有 80% 告警会写日志） | **简化**：节流判断前移；删除动作记日志 |
| branch-prune | Post:Bash、PostFail:Bash | 224 | 无（v8 §7 Git 规则已删） | 开 | 39 次，20 个会话 | **退役候选**，或改成命令（§9） |
| verify-log | Post:Bash | 78 | 无（evidence-gate 的数据源） | 关 | 3,295（11-02 前） | **退役**（随 evidence-gate） |
| test-failure-debug | PostFail:Bash | 101 | 无：`debug.md` 已删除，本机上也不存在 | 关 | 0 | **退役**；打开也是空操作 |
| version-sync | UserPromptSubmit | 134 | 基础设施 | 开 | 14（记在 `user-prompt-submit` 名下） | **保留** |
| memory-prompt-hint | UserPromptSubmit | 314 | 无直接对应 | 开 | 173 次建议 / 583 行抑制 | **简化或退役，待你决定**；每个 prompt 288 ms |
| spec-module-inject | UserPromptSubmit | 121 | core §12、review | 开 | 132 | **保留**，删掉预算和延迟死代码 |
| deferred-notice | UserPromptSubmit | 72 | 无 | 实际为关（唯一的写入方从未启用） | 0 | **退役** |
| residue-audit | Stop | 95 | 无（监视的 `~/.claude/tmp` 不存在） | 开 | 0 | **退役** |
| sandbox-disposal-check | Stop | 230 | core §8 临时文件 | 开 | 216 警告 | **保留**，可与 tmp-sweep 合并 |
| mem-audit | Stop | 266 | 无 | 开 | 21（同样 5 个文件） | **退役** |
| transcript-structure-scan | Stop | 365 | 部分 §10 | 关（`TRANSCRIPT_STRUCTURE_SCAN=1` 才开） | 0 | **退役**；检测 1–3 针对 v7 四段式，已无用 |
| evidence-gate | Stop | 356 | core §7（自觉） | 关 | 185（11-02 前） | **退役**；`:318` 自述 21 次里最多 3 次判断正确 |
| ledger-staleness | Stop | 238 | 无（G7 ledger 不在规范里） | 关 | 0 | **退役** |
| reply-language-check | Stop | 224 | core §1 | 关，你本机开 | 181 | **保留**（你的偏好） |
| session-summary | Stop | 161 | 无 | 开 | 无遥测调用 | **退役**；每轮结束 434 ms |
| session-start-check | SessionStart | 1,021 | 基础设施 + 暂停横幅 | 开 | 169 | **简化**：删 ledger 横幅（约 94 行，35 天 1 次）和 summary 横幅（约 58 行） |
| session-end-check | SessionEnd | 560 | ext §13 | 开 | 25 | **简化**：删维护者专用的发版节奏提示（`:469-558`） |

**合计**：退役 14 个（无争议 11 个，加上 banned-vocab、branch-prune、memory-prompt-hint 三个需要你决定的；若后者三个都保留则是 11 个）。

- hook 和 lib 约 12,259 行，减少约 3,300 行（27%）；测试减少约 5,000 行。
- 连带删除 `lib/wtree.sh`、`lib/verify-cmd.sh`、`hook_newest_ledger`。
- hooks.json 从 29 个注册项降到约 15 个。
- 每次成功的 Bash 调用起的 hook 进程从 12 个降到 7 个，每次 Stop 从 8 个降到 2 个。
- 随之可删的环境开关：`DEBUG_ON_TEST_FAILURE`、`SPEC_RESIDUE_THRESHOLD`、`EVIDENCE_GATE_DELIVER`、`LEDGER_*`、`SPEC_MODULE_GATE` 等，以及对应的 `DISABLE_*_HOOK`。另有 12 个开关至今没有写进任何文档。

**与"hook 冻结"的关系**：v9 的设计记录写的是"不删 hook（下线要单独的证据和决定）"。本节提供的就是那份证据。删除属于减法，不是新增或扩展，所以不违背冻结的本意，但仍需要你明确决定（§9 决定 1）。

---

## 4 命令与脚本裁决

### 4.1 斜杠命令：16 → 8

| 命令 | 作用 | 裁决 |
|---|---|---|
| install | 立即运行 install.js | 保留，并吸收 update 的差异预览 |
| update | 比对并应用规范 | 并入 install |
| refresh | 更新 marketplace 并重装 | 保留 |
| uninstall | 卸载前清理、恢复或删除 | 保留 |
| status | 版本、规范哈希、kill switch | 并入 `doctor --verbose` |
| doctor | 健康检查 + 25 个 hook 自检 | 保留并简化：删掉与 v9 矛盾或过时的行，自检只留 4 个拒绝类测试 |
| toggle | 设置 `DISABLE_*_HOOK` | 保留 |
| clean-residue | 清理临时、状态、探针目录 | 保留，改名 `/claudemd-clean`，接管备份清理 |
| statusline | 状态栏接管、检查、移除 | 保留（可选功能） |
| design-adopt | 生成 DESIGN.md | 保留（可选功能） |
| audit | 规则命中汇总 | 降为维护者自用的 `node` 脚本，只留每个 hook 的拒绝、绕过、fail-open 计数（12-01 复测要用） |
| rules / sparkline / sampling-audit / bypass-audit / analyze | 合规与规范测量 | **退役**；analyze 里 MEMORY.md ↔ 文件的检查挪进 doctor |

### 4.2 脚本

- **退役**：
  - 脚本：`sampling-audit.js`（108 KB）、`hard-rules-audit.js`、`lesson-bypass-audit.js`、`sparkline.js`、`safety-coverage-audit.js`（它自己的 USAGE 写着一次空变异也能通过）、`spec-coherence-audit.js` 的用户命令部分。
  - lib：`runbook-review-check.js`（与 v9 的按风险评审矛盾，修复提示还写着"每次发版加评审"，见 `scripts/doctor.js:1596`）、`memory-maintenance.js` 的 promote/repatriation 部分（读的是 11-25 已删除的 claude-mem-lite 数据库）、`transcript-user-turn.js`。
  - 研究工具：`offline-eval/iron-law-judge.mjs`（结论已出：精度 0/6）、`wtree-verdicts.mjs`。
  - 合计约 215 KB 代码 + 231 KB 测试和 fixture。
- **移出发布树**：`offline-eval/run.mjs`、`s8-shadow.mjs`、`s8-ast/`、`trigger-calibrate.mjs`，连同你的结果对照代码一起放进跟踪的开发目录。插件是整仓克隆，没法按目录排除，只能挪走。
- **拆分**：`doctor()` 1,364 行拆成每项检查一个函数。
- **npm CLI**：去留和 banned-vocab 闸门绑定（§9 决定 2）。下线就 `npm deprecate`，同时删 `bin/`、`lint.js`（如果再无他用）、相关测试和 `npm-publish.yml`，约 130 KB。保留的话，至少删掉 `audit` 子命令（它依赖已 closed 的检测器）。

---

## 5 建议清单（按优先级）

授权一栏按你的全局规则 §5 和本仓库约定标注：**AUTH** 表示要你明确同意；**next-release** 表示改的是发布文件，要等下一个批次版本。

| # | 建议 | 授权 / 通道 | 风险 | 收益 |
|---|---|---|---|---|
| **P0-1** | 修正 agent 会加载的过时文字：项目 `CLAUDE.md:1,3,5`（`AUTONOMY_LEVEL`、core §5.1、core §2）；`.claude/rules/spec-edit.md:8,12`（L3、core §2、§EXT §4） | 直接做（仓库内、非发布文件） | 无 | 每个会话少读到不存在的条文 |
| **P0-2** | 修正发布出去的命令页里的过时引用：`claudemd-statusline.md:32`、`claudemd-design-adopt.md:67`（AUTONOMY_LEVEL）、`claudemd-doctor.md:17`（§11-EXT）；doctor 的 `runbook-review-step` 删除 | next-release | 无 | 用户和 agent 不再被指向与 v9 矛盾的要求 |
| **P1-1** | 退役 11 个无争议 hook（§3） | **AUTH**（删文件、改已发布插件的默认行为）；next-release；按 v9 属于必评审 | 低：9 个默认关闭或空转，2 个（session-summary、spec-module-gate）只影响延迟 | hook 代码 −27%，测试约 −5,000 行，每轮 Stop 少约 600 ms |
| **P1-2** | 退役合规测量层（§4.2），删除 OPERATOR §13.1 的 Demote-loop 一节，`hard-rules.json` 收缩为闸门清单 | **AUTH**（删文件）；改 OPERATOR/hard-rules 要升规范版本 | 低：没有任何自动运行的东西依赖它们 | 约 446 KB 代码和测试；少 5 个命令 |
| **P1-3** | `pre-bash-safety`：前置过滤 + 删 0 拒绝族 + 不记 allow 行 | **AUTH**（改闸门判定）；next-release；必评审 | 中：会放过变形写法（§2.3） | 约 83% 的 Bash 调用省约 175 ms；约 600 行；日志 −54% |
| **P1-4** | 研究代码移出发布树；结果对照代码改为跟踪 | next-release | 低 | 插件缓存 −98 KB；唯一在用的研究资产有了版本记录 |
| **P1-5** | 命令 16 → 8（§4.1） | **AUTH**（破坏性改动：命令消失）；minor 版本，附迁移说明 | 低 | 用户面减半 |
| **P2-1** | CI：npm-publish 改为检查已有 check-run；main push 只跑 static；矩阵 6 → 3 腿 | **AUTH**（CI 配置）；同时改钉住 workflow 文本的 3 个测试 | 低：30 天 6 次失败没有一次是产品缺陷；保留 1 条 macOS 腿兜底 | 每次发版约 −320 runner-min，等待约 −40 min |
| **P2-2** | 不再写 release 记录、不再建 `release/vX` 分支；纯文字的评审发现写进 PR body | 改 runbook（memory 文件） | 低 | 每版 −2 commit、−10 KB；有时少一轮 CI |
| **P2-3** | 测试：pre-bash-safety 分片；shellcheck 只跑一遍；文字钉降级；删 `spec-pin-mutations.py`；`lesson-bypass-audit.test.js` 不再读真实 HOME | 可直接进 `main`（`tests/` 和 `package.json` 不在项目 `CLAUDE.md` 列出的发布目录里）；删文件需 **AUTH** | 低 | 本地 suite 约 −50%；改规范不再撞钉子 |
| **P2-4** | 删除 Sizing 行（或改为生成），规范版本号只留 `hard-rules.json` 一处为准，其它位置由脚本生成 | 规范改动，需升版本 | 低 | 改规范的步骤从约 24 处减到 1 处 |
| **P2-5** | 发版手册重写为约 1 页 | 改 memory | 无 | 每次发版要读的上下文 −25 KB |
| **P3-1** | CHANGELOG 截断；`spec/CLAUDE-changelog.md` 只留 v9；未被引用的 77 个记录单位取消跟踪；`.gitignore` 改纯白名单 | `spec/` 走 next-release；取消跟踪是 `git rm --cached`（本地文件保留） | 低 | 跟踪体积约 −2.5 MB；每份插件缓存约 −2.5 MB；每个 `~/.claude` 约 −215 KB × (1 + 备份数) |
| **P3-2** | README 压到 15–20 KB；ARCHITECTURE、RULE-HITS-SCHEMA 修正过时行 | next-release（README 会进 npm 包） | 无 | 新读者能看完 |
| **P3-3** | 本地清理：12-01 后把转录快照移出；删 `preship-review-*`、`*.log`、`metrics-*.json` | **AUTH**（删的不是本任务创建的文件） | 无 | 约 1.4 GB |
| P4（探索） | 规范改由 SessionStart hook 注入，不再复制进 `~/.claude`，这样 install/backup/drift/version-sync 这条约 106 KB 的链路大部分可以去掉 | 换了送达方式。11-25 的对照已证明送达方式本身会改变行为，所以按你的规则**必须先跑结果对照** | 未知 | 可能是最大的一次结构简化；也可能不可行 |

**发版组织**：按 v9 的"每周最多 2 次"，建议分两个版本。
1. **0.123.0（minor）**：P0-2、P1-1、P1-2、P1-4、P1-5、P3-1、P3-2。全是删除和文字修改，附迁移说明（哪些命令和开关消失、怎么回退到 0.122.1）。涉及闸门和默认行为，按 v9 必评审。
2. **0.124.0**：P1-3 单独发。它改的是 §8 闸门的判定，评审要集中在"前置过滤会不会漏掉真实的 rm/npx 写法"。

P2 里的 CI、流程和测试改动不碰发布目录，可以在这两个版本之间直接进 `main`。P2-4 改的是规范，要跟随某个版本一起发。

---

## 6 目标形态（估算）

| 指标 | 现在 | 建议后 |
|---|---|---|
| hook 个数 / 注册项 | 28 / 29 | 14–17 / 约 15–18 |
| 每次成功的 Bash 调用起的 hook 进程 | 12 | 7 |
| 每次 Stop 起的 hook | 8 | 2 |
| 不含触发词的 Bash 调用，pre-bash-safety 耗时 | p50 约 195 ms | 约 20 ms（进程启动） |
| hook + lib 行数 | 约 12,259 | 约 8,300（注释清理另算） |
| 斜杠命令 | 16 | 8 |
| 测试行数（不含 fixture） | 61,852 | 约 50,000 |
| 每次发版 CI | 19 job、约 386 runner-min、等待约 66 min | 约 8 job、约 65 runner-min、等待约 23 min |
| 跟踪体积 | 约 9.3 MB | 约 6 MB |
| 每份插件缓存 | 约 9.3 MB | 约 6 MB |
| `~/.claude` 规范占用（不含备份） | 236 KB | 约 21 KB |

这些都是估算，前提是 §5 全部执行；单项收益见 §5 各行。

---

## 7 对你其它项目的影响

按你 11-25 定下的要求，每项改动都要说清它对其它项目的结果或成本有什么影响：

- **代码正确率：不变**。结果对照里只装 hook 组和不装组的正确率相同，本报告的建议没有一条声称会提升代码质量。
- **延迟：每次工具调用都受益**。
  - 退役 session-summary、mem-audit、residue-audit 和 4 个关闭的 Stop hook 后，每轮结束少等约 600 ms（假设 Claude Code 并行执行同一事件的 hook，以最慢的为准；这一点未实测）。
  - pre-bash-safety 前置过滤后，约 83% 的 Bash 调用少约 175 ms。按 35 天 31,350 次 Bash 调用算，约 1.5 小时。
  - spec-module-gate 退役：每次 Bash 少 50 ms。
- **误拒：变少**。banned-vocab 如果下线，就不再有 0 正确率的拒绝。memory-read-check 约一半的拒绝不相关，留不留由你定。
- **上下文：基本不变**。v9 已经砍掉了大头；退役的 hook 大多不往上下文注入内容。memory-prompt-hint 的 173 次建议是唯一有量的注入。
- **占用**：`~/.claude` 少约 215 KB × (1 + 备份数)；插件缓存每个版本少约 3 MB。

---

## 8 不建议做的事

- **不要卸载整个插件**。ship-baseline 和 §8 删除保险有现场证据，而且几乎不花成本。
- **不要重写 pre-bash-safety 的分词器**。加前置过滤、删规则族就够了；分词器是 rm 判定准确率的来源。
- **不要一次性清掉所有注释**。改动面太大，评审成本高；改到哪个文件清到哪个。
- **不要去掉全部 macOS 腿**。09-22 以来 21 次失败的 CI 里有 10 次只是 macOS 单腿失败（近 30 天的 4 次都是新测试自身的问题），保留一条成本很低。
- **不要为了验证这些减法再开一轮合规测量**。只有在改规范文字时才需要跑结果对照（P2-4、P4）。删 hook 和脚本用现有测试和评审就够了。

---

## 9 需要你决定的事

1. **是否按 §3 退役 hook**。v9 的设计记录写的是"下线要单独的证据和决定"，本报告提供证据，决定在你。我的建议是：11 个无争议的直接退役。
2. **banned-vocab 闸门和 npm CLI 是否一起处理**。我的建议：12-01 复测后，如果 30 天内仍然没有真阳性，就一起下线，`npm deprecate claudemd-cli`。
3. **memory-read-check、memory-prompt-hint、branch-prune**。三者都没有结果证据。我的建议：memory-read-check 保留（拒绝的是发版类命令，代价低）；memory-prompt-hint 先关掉 30 天看你是否感觉到差别；branch-prune 改成命令。
4. **pre-bash-safety 前置过滤的安全取舍**：放过变形写法，换来约 83% 调用的延迟下降。我的建议是做，作为单独的版本发，并且必须评审。
5. **CI 配置改动（P2-1）**。属于你全局规则里的 AUTH 项。
6. **记录政策（§2.7）**。今后只有被在用文本或测试读取的文件才跟踪。我建议采纳。

---

## 10 未检查（NOT CHECKED）

- Claude Code 是否并行执行同一事件的 hook：取自官方文档，没有实测。所有墙钟估算都依赖这个假设。
- 变形的 rm/npx 写法在现场出现的频率：拒绝记录存的是规范化后的文本，没法回溯。
- 各类提示（sandbox 216 次、暂停横幅 51 次、memory 建议 173 次、branch-prune 39 次）是否改变了 agent 的行为：需要把日志和转录关联起来分析，这次没做。
- macOS 和 bash 3.2 下的行为：只读了 CI 日志，没在本地跑。
- 本地 `npm test` 662 s 和 11-10 记录的 163 s 差距：运行时机器负载约 3，单次运行无法区分；只排除了 hook 本身退化（新旧版本每次调用 209 / 222 ms）。
- 插件安装能否排除部分路径：没查。如果不能，就只能靠从仓库里删除来缩小缓存。
- 子代理（subagent）转录里的 Bash 调用量：只统计了主转录。
- hook 和脚本内部的 bug：本次是架构审核，不是找 bug。
- `tests/fixtures/` 的 118 个文件逐个是否仍有用：没有审。
- 外部用户是否存在：只有你本机的遥测；npm 下载量主要来自镜像，无法据此判断。

---

## 附录 A 方法与核对记录

**四路子审计**都是只读的，沙箱 HOME 和临时文件都放在会话 scratchpad 下，结束后 `git status` 前后一致。原始数据在 `/tmp/claude-1000/-home-ai-dev-claudemd/4adb69c9-f565-4b3e-98e1-3edd0757fc84/scratchpad/{hooks,scripts,tests,docs}-audit/`。scratchpad 随时可能被清掉，需要保留的话请告诉我。

**我亲自核对的结论**（命令都在本会话里跑过）：

| 结论 | 核对方式 | 结果 |
|---|---|---|
| `SPEC_FILES` 包含 `CLAUDE-changelog.md` | `scripts/lib/paths.js:78` | 属实 |
| CHANGELOG 中 0.100.0 及更早的条目共 1,080,217 B | `tail -n +1345 CHANGELOG.md \| wc -c` | 属实 |
| GitHub Release 共 308 个 | `gh release list --limit 400 \| wc -l` | 属实 |
| 转录快照约 1.1 GB | `du -sh` | 属实 |
| sampling-audit 的 8 个检测器全部 `closed`，`RULE_KEYS` 含 4 条已删规则 | `scripts/sampling-audit.js:51-58,99-150` | 属实 |
| `doctor()` 1,364 行 | awk 统计 | 属实 |
| doctor 的修复提示要求"每次发版加评审" | `scripts/doctor.js:1596` | 属实 |
| 插件缓存保留 3 个版本，都带 offline-eval | `ls ~/.claude/plugins/cache/claudemd/claudemd/` | 属实 |
| pre-bash-safety 没有触发词提前退出 | `hooks/pre-bash-safety-check.sh:120` | 属实 |
| `~/.claude/settings.json` 只开了 `REPLY_LANGUAGE_CHECK` | `jq '.env\|keys'`（只看了键名） | 属实 |
| evidence-gate、verify-log、rework-breaker 最后一次触发在 11-02 | 日志里各 hook 的最大 ts | 属实 |
| session-summary 每轮整读日志 | `hooks/session-summary.sh:121`（`jq -s`） | 属实 |
| `debug.md` 和 `~/.claude/tmp` 都不存在 | `ls` | 属实 |
| evidence-gate 自述 21 次里最多 3 次正确 | `hooks/evidence-gate.sh:318` | 属实 |
| shellcheck 本地跑两遍 | `tests/run-all.sh:376` + `package.json` 的 `lint:sh` | 属实 |
| npm-publish 自带 static 和测试矩阵 | `npm-publish.yml:98,116` | 属实 |
| `spec-pin-mutations.py` 没有 runner 调用，目标文字出现 0 次 | `git grep` + `grep -c` | 属实 |
| `lesson-bypass-audit.test.js` 读真实日志 | `:357` | 属实 |
| **我的初判**：transcript-structure-scan 在 v9 下"结构上不可能触发" | 读 `hooks/transcript-structure-scan.sh:1-52` | **不对，已更正**：检测 4–5 针对 `## 汇报` 三段式，在 v9 下仍然适用。它 0 条记录的原因是默认关闭（`:52`）。检测 1–3 才是 v7 的死代码 |

**数字口径差异**：拒绝数我统计 231，hooks 子审计统计 232，差的那一条是日志在审计期间新写入的。测试与产品代码的比值，含 fixture 按行算约 2.1×，不含 fixture 是 1.75×，本文统一用后者。

---

## 附录 B 执行记录（2026-11-26）

用户 11-26 授权"按建议执行，需要授权的授权"。执行时重新核对了每条建议，以下几处与正文不同，以本节为准。

**更正**
- §3 合计行写"无争议 11 个"是算错了：表里标"退役"的是 14 个（spec-module-gate、cross-repo-write-check、session-extended-read、transcript-vocab-scan、rework-breaker、verify-log、test-failure-debug、deferred-notice、residue-audit、mem-audit、transcript-structure-scan、evidence-gate、ledger-staleness、session-summary）。
- §5 P1-4 说把研究代码移出发布树能让插件缓存"−98 KB"：不成立。插件缓存是整个仓库的副本（`tests/` 3.3 MB 也在里面），换目录不换体积。改为只删已结题的两个工具（`iron-law-judge.mjs`、`wtree-verdicts.mjs`），`scripts/offline-eval/` 留在原处。
- §5 P3-3 的"约 1.4 GB"几乎全是 `tasks/transcript-snapshot-2026-11-21/`（1.1 GB）。`preship-review-*`、`*.log`、`metrics-*.json` 合计只有 580 KB，删除不可逆、收益可以忽略，所以不删；快照等 12-01 复测用完再处理。
- §6 "每次成功的 Bash 调用 12 → 7 个 hook 进程"：branch-prune 也退役后是 12 → 6。

**和建议不同的决定**
- memory-prompt-hint：直接退役，不做"关 30 天看感觉"。它的依据是 v8 §11 的 MEMORY.md 必读规则（v9 已删），Claude Code 现在自带 memory 召回，"看感觉"也不是有效检验。
- branch-prune：直接退役，不改成命令（它服务的 v8 §7 Git 规则已删，改成命令等于加一个界面）。
- banned-vocab 和 `claudemd-cli`：不动。11-26 已有预注册的下线条件（30 天窗口内 ≥3 次拒绝且 0 次真阳性），在复测前拆掉会推翻预注册。
- `hard-rules.json` 不改成语义 ID：ID 也是历史遥测的 `spec_section` 键，改名会让新旧日志对不上。只把两条由已退役 hook 写段名的自觉规则改为 `null`。
- 命令 16 → 11，不是 8：`status` 并入 `doctor`、`update` 并入 `install`、`clean-residue` 改名都是重组而不是删减，收益小，这一轮不做。
- `pre-bash-safety` 前置过滤（P1-3）：推迟到 12-01 闸门复测之后、作为 0.124.0 单独发。复测窗口中途改 §8 闸门会污染复测；本周两次发版额度也已用完（0.122.0、0.122.1 都在 11-25）。
- 发版不再 rebase，但仍从 `next-release` 切 `release/vX.Y.Z` 开 PR：仓库开了"合并后删除源分支"，直接用 `next-release` 开 PR 会在合并时删掉它。

**执行中发现的问题**
- 退役 hook 后，`install.js` / `uninstall.js` 清理 `settings.json` 旧条目用的是注册表名单，删掉的 16 个名字会认不出来、旧条目留下。已加 `RETIRED_HOOK_BASENAMES`，`tests/scripts/install.test.js` 原有用例在修复前失败、修复后通过。

---

## 附录 C 发布后逐条状态（2026-11-28）

0.123.0 于 2026-11-28 发布（tag `v0.123.0` = 3c8ad88）。用户问"审核文档里的工作做完没"，以下逐条核对正文建议，以本节为准。

**已在 0.123.0 发布**：P0-1、P0-2、P1-1（退役 16 个）、P1-2（`hard-rules.json` 的改动见附录 B）、P1-4（按附录 B 更正）、P1-5（16 → 11）、P2-1、P2-2（保留 `release/vX.Y.Z` 分支，原因见附录 B）、P2-5、P3-1、P3-2。另有 P2-3 的三项：shellcheck 只跑一遍、`spec-pin-mutations.py` 已删、`lesson-bypass-audit.test.js` 随脚本一起删掉；P2-4 的一半：Sizing 行已删。

**等 2026-12-01T16:07Z 之后的闸门复测**
- P1-3：`pre-bash-safety` 前置过滤、删 0 拒绝规则族、不再记 allow 行。作为 0.124.0 单独发，回放真实命令，发版前要评审。
- §9 决定 2：banned-vocab 和 `claudemd-cli` 按预注册条件处理（30 天窗口内 ≥3 次拒绝且 0 次真阳性就下线）。§4.2 说的 CLI `audit` 子命令跟它一起定。
- §4.1 把 `/claudemd-audit` 降为维护者脚本：复测要用它，复测后再定。
- P3-3：1.1 GB 转录快照等复测用完，先问用户再处理。

**发布后补上的**（提交在 `next-release`，随下一版发）
- §2.5 建议 3：`docs/RULE-HITS-SCHEMA.md` 不再说 `spec_section` 驱动 §13.1/§13.2 的升降级统计（这套机制 0.123.0 已删）。分类表前写明这些值是日志键，不是指向现行条文的指针。
- §2.5 遗留问题 6：`spec/OPERATOR.md` 的 Standing decisions 加了"Kept by preference, at a known cost"一条。改了 `spec/`，下一版规范要升到 v9.0.2。
- §2.3 建议 5 和 §8：`CONTRIBUTING.md` 写明注释规则：每个决定一行 why，历史写进提交说明，下次改到哪个文件就清哪个文件的历史注释。同一处的记录政策说法也改成了与 `.gitignore` 一致。

**决定不做，以及原因**
- P2-3 `pre-bash-safety` 测试分片：P1-3 会删掉 0 拒绝的规则族和它们的语料，现在分片，0.124.0 后还得重分一次。等 0.124.0 之后按剩下的语料再看要不要分。
- P2-3 文字钉降级为手动工具：spec-structure 的哈希钉是"规范文字没跑结果对照就被改了"的唯一机械检查（OPERATOR §13.1）。其它漂移测试拦的是用户会读到的错句。0.123.0 删掉的文字连同钉住它们的测试一起删了；11-28 改发版日期只要重钉一行。重钉的成本低于丢掉这些检查。
- P2-4 后半（标题版本号由脚本生成）：Sizing 行删掉以后，要手改的版本号只剩 `hard-rules.json` 和两行标题。模块标题已经由 `build-spec-modules.js` 生成，版本不一致时 `version-cascade-check.js` 会拦下。再写一个生成器只省两处手改。
- §4.1 doctor 自检"只留 4 个拒绝类测试"：保留了 7 个存活检查。它们是唯一在用户机器上、而不是在 CI 里检查"hook 在这台机器上会不会崩"（bash 版本、缺 `jq`）的手段，代价只是 `/claudemd-doctor` 每次多起 7 个短进程。
- §2.6 和 §4.2 的纯重构：`doctor()` 拆成每项一个函数（现在 1,208 行）、删除逻辑统一走 housekeeping、挂载点检查只留一份。用户感觉不到，改动面大；等下次真要改 doctor 或这些删除路径时顺带做。
- §2.6 里改 hook 的三项：
  - 命令解析收敛到 `hook-common.sh` 的一个入口：hook 已冻结为"只修 bug 和删除"，这一项两样都不是。
  - `tmp-sweep` 节流检查前移（每次 Bash 约 59 → 18 ms）：同上；它和 P1-3 一样是每次调用的延迟问题，破不破例由用户定。
  - `spec-module-inject` 用不到的 9,800 字符预算和 `pending:` 逻辑：这是删除，可以跟 0.124.0 一起发；那一版本来就要改 hook、跑 bash 3.2、做评审。
- 本地 `.converge/INTENT.md`（v0.88.0 生成，没有被跟踪）：下次运行 converge 时重新生成，不影响发布。
- P4（规范改由 SessionStart 注入）：按 OPERATOR §13.1 要先跑结果对照，还没开始。值不值得花一次对照的钱（上次两轮共 $110），由用户决定。
