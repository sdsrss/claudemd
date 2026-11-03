# 代理临时残留：不再为删除上一个任务的临时目录请求授权

状态：进行中

## 背景与目标

- 2026-10-06 → 11-03 的转录（`docs/claude-session-audit-2026-11-03.md`，本地文档）：193 个主会话、240 份汇报里，讲删临时目录的遗留有 89 条。按关键词匹配，其中 30 条在等使用者授权（另有 11 条措辞不同）。这 30 条里使用者回复了 13 条，13 条都批准，0 条拒绝；没回复的 17 条，目录一直没删。11-03 现场：`~/.cache/tmp` 有 2.0 GB、31 个目录，没有一个带 `.keep`；`/tmp/claude-1000`（tmpfs）有 5.2 GB，几乎全是已结束会话的 scratchpad。
- 成因是规则链：核心 §5 Hard 把 `delete file/dir` 定为硬授权；免授权白名单只认项目根目录下的相对路径，NEVER-covers 排除了离开项目根目录的路径，`SAFE_DELETE_PATHS:` 也不能写绝对路径；§8.V4 只要求创建它的任务删；§0 要求范围外发现的东西逐项询问；§7-EXT-TMP 写着 "No auto-clean without AUTH"。
- 目标：上一个任务或会话在临时根目录里留下的、可以确认是代理建的目录，任何任务都能直接删，并在汇报里写一行；创建时就标明归属；万一没人删，hook 兜底回收。

## 范围

- 做：
  - 核心 §5 Soft 行、§8.V4。
  - extended §5-EXT 新增 Agent temp residue 一段，§5.1-EXT 表 `aggressive` 行，§7-EXT-TMP。
  - `scripts/housekeeping.js tmp` 增加 `agent-tmp-*` 这一类回收，默认扫描目录加上 `/var/tmp`；`sandbox-disposal-check` 认 `agent-tmp-*`。
  - `hooks/tmp-sweep.sh` 的提示文字与文件头注释；README 的 tmp-sweep 行。
  - 规范版本级联 v8.4.0 → v8.5.0、两份 changelog 条目、Sizing；`tests/scripts/spec-structure.test.js` 的哈希与锁定行。
  - 本仓库 `.claude/agents/release-reviewer.md` 的临时目录前缀 `rrev-` → `agent-tmp-rrev-`（不随插件发布）。
  - 随下一个批次发版。
- 不做：
  - hook 自动删 scratchpad：harness 是否在 resume 时复用它，没查到文档，只走模型侧规则。
  - 改 §8 rm 变量闸门。
  - 改汇报遗留的写法（使用者 11-03 决定不改）。

## 验收标准

- [x] AC1：`housekeeping.js tmp --apply` 删除临时根目录下名字为 `agent-tmp-*`、本用户所有、不是符号链接、顶层没有 `.keep`、里面没有 socket 或 FIFO、所有条目的 mtime 和 ctime 都早于 72 小时的目录；不满足其中任一条的都保留；删除前重新检查一次。验证：`node --test tests/scripts/housekeeping.test.js`。新增用例在改动前失败。
- [x] AC2：`tmp-sweep` 的压力提示说明 `agent-tmp-*` 会自动回收，写出上一个会话的残留可以不问就删的全部条件，而不是"一律交给使用者"。验证：`bash tests/hooks/tmp-sweep.test.sh`。新增断言在改动前失败。
- [x] AC3：`spec/spec-modules/auth.md` 有 Agent temp residue 一段，写明条件（临时根目录的 `agent-tmp-*` 或已结束会话的 scratchpad 目录、本用户、非符号链接、24 小时无改动、无 `.keep`、没被引用）以及"不问、汇报写一行"；核心 §5 Soft 行和 §8.V4 指向它。验证：`grep -n 'Agent temp residue' spec/CLAUDE.md spec/spec-modules/auth.md`，读整行。
- [x] AC4：`npm run check` 退出 0，`npm run smoke` 为 SMOKE 2/2。验证：`npm run check; echo exit=$?`；`npm run smoke`。
- [ ] AC5（发版后约 4 周）：复测遗留里"删临时根目录里上一个任务留下的目录要授权"的条数，基线 8 条 / 28 天（回复 3 条，都批准）；复测 `~/.cache/tmp` 里没有 `.keep`、闲置超过 3 天的 `agent-tmp-*` 目录数，基线 0。验证：本地脚本 `tasks/temp-residue-audit-2026-11-03/openitems.py`（gitignored）。

## 方案

- **规则**（extended §5-EXT，进 `auth.md`）：同时满足以下条件的目录算代理临时残留，任何任务都可以直接删，不需要授权；删除后在汇报里写一行，含路径和大小：
  1. 位置：`$TMPDIR`、`/tmp`、`/var/tmp`、`~/.cache/tmp` 下名字以 `agent-tmp-` 开头的直接子目录（不用 `cc-`：Claude Code 自己的 socket 目录叫 `cc-socks`）；或者 harness scratchpad 根目录下、与本会话同级的会话目录，且该会话的转录 24 小时没有写入。
  2. 属于当前用户，不是符号链接，解析后仍在该根目录内。
  3. 里面任何文件 24 小时内都没有改动。
  4. 顶层没有 `.keep`，也没有被未关闭的 spec 文件、`tasks/*-paused.md` 或延期项点名。
- 其他目录来源不明，删除仍要硬授权。
- **创建约定**（§8.V4）：自己起名的临时目录用 `agent-tmp-<任务>-` 前缀；要保留就写 `.keep`，写明原因和保留到什么时候。
- **兜底回收**（`housekeeping.js tmp`）：`agent-tmp-*`、无 `.keep`、没有 socket 或 FIFO、所有条目的 mtime 和 ctime 都早于 72 小时，就自动删。hook 查不了"是否被引用"，所以门槛比模型侧的 24 小时长，保留只能靠 `.keep`。遍历用 lstat，不跟符号链接；碰到 24 小时内的文件就提前结束；单个目录最多看 200,000 个条目，超出就跳过，并在 `skipped` 里注明。
- **为什么是前缀，而不是"转录里能看到是代理建的"**：前缀不用读转录就能判断，hook 也能用；使用者自己放在 `/tmp` 里的东西不会带这个前缀。
- **为什么 scratchpad 只走模型侧**：scratchpad 由 harness 管理，hook 判断不了会话是否结束（resume 会怎样也没查到）；模型侧用"转录 24 小时没写入"判断。
- **安全**（按 STRIDE 逐项过了一遍，只列有关的几项）：
  - 篡改 / 越权：符号链接、他人文件、解析后跑出根目录，这三种情况都排除。
  - 误删在用目录：24 小时（hook 为 72 小时）无改动，删除前再检查一次。
  - 误删刻意保留的东西：`.keep`，以及"被引用就不删"。
  - 不涉及凭据和网络。
- §5.1 Never-downgrade 不受影响：这里改的是规范自己对 Soft 删除的定义，不是靠 level 或项目设置去降级。
- **版本**：v8.5.0，属于小版本（按 §13 META，放宽规则算 minor）。

## 计划

- [x] S1：先写失败测试，再实现 `housekeeping.js` 的 `agent-tmp-*` 回收、`/var/tmp` 根目录、CLI 输出 — 覆盖 AC1 — 依赖：无 — 执行：主会话
- [x] S2：改 `tmp-sweep.sh` 的文字和注释，测试先红后绿；改 README 的 tmp-sweep 行 — 覆盖 AC2 — 依赖：S1 — 执行：主会话
- [x] S3：改规范文字，重建 modules；版本级联、两份 changelog、Sizing、spec-structure 的哈希和锁定行 — 覆盖 AC3 — 依赖：S1 — 执行：主会话
- [x] S4：跑 `npm run check` 和 `npm run smoke`，然后提交到 `next-release`；release-reviewer 的前缀单独提交到 main — 覆盖 AC4 — 依赖：S1–S3
- [x] S5：0.119.0 按发版手册发布，发版前评审两轮（发版记录 `tasks/specs/release-0.119.0-2026-11-03.md`） — 依赖：S4 — 执行：主会话 + release-reviewer
- [ ] S6：发版约 4 周后复测（延期项 D#719；从 0.119.0 在本机的 T0 起算，T0 要等使用者 /claudemd-refresh 并重启之后才有）— 覆盖 AC5 — 依赖：S5

## 决策与进展

- 2026-11-03：使用者回复"1.按你的建议改 2.按你的建议清 3.不改"，即批准进入实现（L3），并授权一次性清理。清理已完成：36 个目录，`~/.cache/tmp` 2.0 → 1.4 GB，`/tmp/claude-1000` 5.2 GB → 629 MB。`d546`、`d558`、`d577-a5`、`d591`，以及被延期项引用的 `rv-*`，按建议保留。
- 2026-11-03：0.119.0 的发版前评审（e85aea0..f03fda9）：Critical 0、High 1、Medium 4、Low 8。逐条核实后修复：
  - H1：`cc-` 前缀和 Claude Code 自己的 socket 目录（`/tmp/cc-socks`、`~/.cache/tmp/cc-socks`，有 `claude` 进程在监听）撞名。前缀改为 `agent-tmp-`；里面有 socket 或 FIFO 的目录不删。
  - M1：只看 mtime 时，`cp -a`、`rsync -a`、`tar` 填进去的目录会被当场删掉。改为同时看 mtime 和 ctime，参照 systemd-tmpfiles 的 age 规则；atime 不看，因为本身的遍历会刷新它。测试改为把时钟往后推；CLI 的时钟接口只在扫描目录被重定向时生效。
  - M2：核心 §8.V4 写出这一类的条件，其余仍是 §5 Hard。
  - M3：`sandbox-disposal-check` 认 `agent-tmp-*`。
  - M4、L5、L1：发布文字里的数字改为新规则覆盖的部分：临时根目录的授权请求 8 条，回复 3 条，都批准。另外改正了"Not changed"那条。
  - L2：§5.1 Never-downgrade 写明这一类属于 Soft。
  - L3：补测 `--min-age-minutes` 不影响 `agent-tmp-*` 的门槛。
  - L4：hook 提示写出全部条件。
  - L6：auth.md 写明删除前先说明（`aggressive` 下不用）。
  - 不修，记入发版记录的遗留：L7（并发计数，旧代码就有）、L8（属主只查顶层；`rmSync` 不检查挂载点），原因是这台机器上没有 root，没法写测试。
- 2026-11-03：S1–S4 完成。rebase 到 main 之后，`next-release` 上是 07737a3（回收脚本、hook 文字、README）和 1613b31（spec v8.5.0）；main 上是 5e2695f（release-reviewer 的 `cc-rrev-` 前缀）。S5 由使用者 11-03 要求的 0.119.0 发版完成（发版记录 `tasks/specs/release-0.119.0-2026-11-03.md`）。
- 2026-11-03：auth.md 新段补了一句"NEVER-covers above bounds the prefix list; this class carries its own bounds"。原因：NEVER-covers 里有"解析后离开项目根目录的路径"，不补这一句，读者可能以为它也约束新这一类。
- 2026-11-03：hook 回收门槛定为 72 小时，模型侧为 24 小时。理由是 hook 查不了引用，宁可晚删。

## 验证记录

- `node --test tests/scripts/housekeeping.test.js`：改动前失败（85 通过 / 18 失败，新用例全部失败）；改动后通过（103 通过，1 跳过，跳过的那一个改动前就是跳过）。
- 变异检验（housekeeping）：去掉 `.keep` 检查、去掉 uid 检查、放宽名字、去掉删除前复查、跟随内部符号链接、去掉条目上限、门槛改成 24 h，每一项都至少让 1 个用例失败。只去掉顶层的 `isDirectory` 过滤是等价变异（`agentResidue` 里的 lstat 也会拦下），两处一起去掉会让 1 个用例失败。
- `bash tests/hooks/tmp-sweep.test.sh`：用例 13 在改文字前失败；改动后 20/20 通过（用例 12 经由 hook 实际跑一遍回收）。
- `node --test tests/scripts/spec-structure.test.js`：改规范后有 10 个区块哈希变化，逐块读过差异，变化只有标题、§5 Soft 行、§8.V4 行、§5-EXT 新段、§5.1-EXT 的 `aggressive` 行、§7-EXT-TMP、Recent changes 与 Sizing。更新哈希后，加上 8 条整行锁定，spec-structure + spec-modules 108/108 通过。锁定的变异检验：6 个削弱规则的变异，每个都让 2 个用例失败（整行锁定和区块哈希）。
- `node scripts/spec-coherence-audit.js --strict` → 通过（5/5）；`node scripts/version-cascade-check.js` → 通过（v8.5 三个文件一致，Sizing 在 ±20B 内）。
- `npm run check`（`git add` 之后跑）→ 通过：exit 0；node 1786/1789（3 个跳过）；shell 1771 条 PASS、0 条 FAIL；shellcheck 94 个文件无警告。
- `npm run smoke` → 通过：SMOKE 2/2。
