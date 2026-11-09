# 下一批次的遗留小修：tmp 回收的并发与挂载点、sandbox-disposal 遥测带目录名、askRate 标明未校准

状态：已完成

## 背景与目标

- 2026-11-03 剩余工作分析，使用者选 B："D#718 的 L7、L8 和 D2、D3"随下一个非紧急批次发（11-09 起）。
- D#718（0.119.0 评审遗留，`tasks/specs/release-0.119.0-2026-11-03.md`）：
  - L7：几个 `housekeeping.js tmp --apply` 同时跑时，别人先删掉的目录让 `rmSync` 抛 ENOENT，记成失败，进程 exit 3。
  - L8：`agent-tmp-*` 的遍历用 lstat，但不比较设备号；`rmSync` 递归删除时会进入目录里的挂载点，把挂载的文件系统里的文件一起删掉。用户态 FUSE（sshfs 等）不需要 root 就能挂。
- D2（`docs/claudemd-effect-assessment-2026-11-03.md` 第 5 节）：`sandbox-disposal` 的 warn / block 行只记 `{count, mode}`，30 天 73 行，事后没法复核提醒准不准。
- D3（同上）：`sampling-audit --json` 的 `askRate` 在分类器从未校准（`ASK_RATE_PRECISION = null`）时照样输出 `assent: 0`，读 JSON 的脚本会读成"0% 同意"。
- 目标：并发回收不再报假失败；回收不越过挂载点；warn / block 行带上目录名；`askRate` 和 `byRule` 一样带 `precision` 与 `status`。

## 范围

- 做：
  - `scripts/housekeeping.js`：两类回收（vitest、agent-tmp）的 `rmSync` 遇到 ENOENT 时，不算失败、不计数；`agentResidue` 遍历时，任何条目的 `st.dev` 与顶层不同就跳过整个目录，在 `skipped` 里写 `mount-point`。
  - `hooks/sandbox-disposal-check.sh`：warn 和 block 两种行的 `extra` 加 `names`（报告的目录 basename，最多 5 个，与 stderr 列表一致）。`docs/RULE-HITS-SCHEMA.md` 同步。
  - `scripts/sampling-audit.js`：汇总和各分类的 `askRate` 加 `precision`（`ASK_RATE_PRECISION`）和 `status`（与 `byRule` 同一套取值）。
  - 对应测试，改动前失败。
  - 第二轮（2026-11-03 剩余工作分析，"按你的建议执行"）：`scripts/lib/runbook-review-check.js` 认 `pre-tag review` 和 `fresh … subagent(s)` 两种写法；`docs/S8-RESIDUALS.md` 登记 F37 NPXARG 并加语料行，闸门不改。
- 不做：
  - D#718 L2（复查和 `rmSync` 之间写进来的文件会被一起删）：不在使用者选的 B 里。D#718 已关闭，L2 和精确计数改记在 D#729。
  - 并发回收的重复计数：APFS 上两个进程对同一目录的 rmdir 都能成功（864b03a 的记录）；本机 Node 26 / Linux 上也重复计数（见决策）。按 ENOENT 处理修不了，维持现状。
  - vitest 一类的挂载点检查：它的签名只允许两层、第二层只能是 40 位十六进制名字的普通文件，挂载点只能出现在 `ssr` / `client` 本身，且里面只有这种文件，不改。
  - CHANGELOG：发版时写（runbook 第 3 步）。
  - D#729（复查与 `rmSync` 之间写入的文件、并发时的删除计数）：不修，理由见决策。
  - D#665（bash 3.2 下 watchdog 的 sleep 持有 fd）：不在这批，延期项保留。

## 验收标准

- [x] AC1：`removeAgentTargets` 和 `removeVitestTargets` 遇到别人先删掉的目标时，`errors` 为空、`deleted` 不计；其他错误（如 EACCES）仍记为失败、CLI 仍 exit 3。验证：`node --test tests/scripts/housekeeping.test.js`，新增用例改动前失败。
- [x] AC2：`agent-tmp-*` 目录里任何条目与顶层设备号不同，扫描和删除前复查都跳过它，`skipped` 写 `mount-point`，目录保留。验证：同上，新增用例改动前失败。
- [x] AC3：`sandbox-disposal` 的 warn 和 block 行带 `extra.names`，是 stderr / block 原因里列出的目录的 basename，最多 5 个；含 `"` 或 `\` 的名字仍是合法 JSON。验证：`bash tests/hooks/sandbox-disposal.test.sh`，新增用例改动前失败。
- [x] AC4：`sampling-audit` 汇总和每个分类的 `askRate` 带 `precision: null`、`status: "collecting"`；计数不变。验证：`node --test tests/scripts/sampling-audit.test.js`，新增用例改动前失败。
- [x] AC5：`npm run check` 退出 0，`npm run smoke` 为 SMOKE 2/2。
- [x] AC6：随下一个非紧急批次发版（与 `tasks/specs/gate-precision-fixes-2026-11-03.md` 同批），CHANGELOG 写明这四处改动和 AC7 的 doctor 改动。验证：发版记录 `tasks/specs/release-*.md`。
- [x] AC7：doctor `runbook-review-step` 把写有 `pre-tag review` 或 `fresh … subagent(s)` 的手册算作有评审步骤；只在教训里提到评审者的手册仍然报。验证：`node --test tests/scripts/runbook-review-check.test.js`，新增用例改动前失败；本机 doctor 从 4/9 变成 2/9。
- [x] AC8：F37 NPXARG 登记在 `docs/S8-RESIDUALS.md`，语料 `S8-NPXA1`–`S8-NPXA9`，闸门判定不变。验证：`bash tests/hooks/pre-bash-safety.test.sh`。
- [x] AC9：发版前提前跑 bash 3.2.57 运行时套件，全部通过。验证：`BASH32_BIN=<本机编译的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh`。

## 方案

- **ENOENT**：别人先删掉，或正在删同一棵树时，`rmSync` 抛 ENOENT。按"别人删了"处理：不进 `errors`，不计数。没有重试：如果目录还剩一部分，里面条目被删会刷新父目录的 mtime 和 ctime，下一次扫描会等它重新过门槛。两类回收共用一个 `rmTarget` 帮助函数，因为 exit 3 由两类的 `errors` 共同决定，只修一类，并发时仍然 exit 3。
- **挂载点**：lstat 不跟符号链接，但路径解析照样穿过挂载点，所以挂载点本身的 `st.dev` 是被挂载文件系统的设备号。同设备的 bind mount 需要 root 或用户命名空间，这里不处理，记在注释里。
- **测试**：这台机器禁止非特权用户命名空间（`kernel.apparmor_restrict_unprivileged_userns = 1`），没法真挂载。用 `node:test` 的 `mock.method(fs, 'lstatSync')` 给一个内部目录换一个设备号；ENOENT 用 `mock.method(fs, 'rmSync')`，先真删、再调用原函数。`housekeeping.js` 用 `import fs from 'node:fs'` 并调用 `fs.xxx`，所以替换对它生效，不需要在代码里加测试接口。
- **`names`**：用 `hook-common.sh` 已经载入的 `_rule_hits_json_escape` 转义，jq 不在时也能写。字段叫 `names` 不叫 `paths`，因为记的是 basename。
- **`askRate`**：沿用 `byRule` 的 `precision` / `status`，`status` 由同一个判断（`precision ≥ PRECISION_GATE` 才是 `calibrated`）得出。`mergeAskRate` 只加计数，这两个字段留在目标对象上。

## 计划

- [x] S1：先写失败用例（housekeeping 3 条、sandbox-disposal 1 条、sampling-audit 1 条），跑一次确认失败 — 覆盖 AC1–AC4 — 依赖：无 — 执行：主会话
- [x] S2：改 `housekeeping.js`、`sandbox-disposal-check.sh`、`sampling-audit.js`、`RULE-HITS-SCHEMA.md` — 依赖：S1
- [x] S3：`npm run check`、`npm run smoke`，分两个提交到 `next-release`（tmp 回收一个，两处遥测一个） — 覆盖 AC5 — 依赖：S2
- [x] S5：第二轮：doctor 指纹（先写失败用例）、F37 登记、本机 bash 3.2，`npm run check`、`npm run smoke` — 覆盖 AC7–AC9 — 依赖：S3 — 执行：主会话
- [x] S4：随下一个批次发版 — 覆盖 AC6 — 依赖：S3、S5

## 决策与进展

- 2026-11-03：使用者回复"1.推 2. B 3.现在 4.不改"。B 范围按当时的写法是 D#718 的 L7、L8 和 D2、D3，L2 不在内。
- 2026-11-03：L7 两类回收一起改，不只改 agent-tmp：exit 3 由两类共同决定。可逆，代价是一个帮助函数。
- 2026-11-03：并发探针（4 个 `tmp --apply` 同跑 400 个 `agent-tmp-*` 目录，用测试时钟推后 73 小时，每轮 5 次）：改前 20 个进程中 19 个 exit 3、每轮 10–27 个 ENOENT 错误；改后 20/20 exit 0、0 个错误，两种情况下 400 个目录都删光。删除计数改前改后都多算（改前每轮合计 678–1,134，改后 938–1,147）：Node 26 的 `rmSync` 在两个进程同删一棵树时常常都返回成功，所以 Linux 上也多算，不只 macOS。要精确只能先改名再删（D#718 给 L2 的修法，现记在 D#729），这个计数只写进 `tmp-sweep.last.json`，仓库里除了测试没有读它的代码，不做。
- 2026-11-03：`RULE-HITS-SCHEMA.md` 写"added after 0.119.0"，不写下一个版本号，和 0680b63 的 `tags` 一样：版本号要到发版时才定。
- 2026-11-03：提交（本地 `next-release`）：b16adfc（tmp 回收 L7、L8），a35765b（`names` 与 `askRate` 标签）。
- 2026-11-03（第二轮）：使用者要求看遗留里哪些该做、分析剩余有价值的工作，并"按你的建议执行"。
- 2026-11-03：D#729 不修。要丢文件，得有进程在复查与 `rmSync` 之间的几毫秒里，往一个所有条目闲置超过 72 小时的 `agent-tmp-*` 目录写入；改名的修法也只把静默丢失变成写入方报 ENOENT（已打开的 fd 照样写进改名后的目录）。删除计数只写进 `tmp-sweep.last.json`，没有代码读它。本机 0.119.0 的回收结果：`agent.targets` 为空，删除 0。可逆：要修时从本段和 D#729 的说明重来。
- 2026-11-03：D#665 不在这批：只有一次 macOS CI 失败（run 41478358763）；按 `hooks/lib/platform.sh` 的注释，影响限于读调用方 fd 3 以上的进程等到上限，而且只在没有 `timeout` / `gtimeout` 时走这段纯 bash 实现；修法要在 3.2 下做 500 次循环测量。
- 2026-11-03：doctor `runbook-review-step` 在本机报了 4/9 份手册，其中 gsd-lite（"One fresh-subagent pre-tag review (HARD)"）和 claude-mem-lite（"6. r1: two fresh blind subagents"）其实有评审步骤，是误报；loop-eng、loop-testing 只在教训里提到评审者，是真报，属于那两个项目，在那边处理。
- 2026-11-03：F37 NPXARG 由 0.119.0 上线后的一次拦截发现（`npx --version 2>&1`，包名报成 `2>&1`）。两个方向：误拒 30 天 7 次加 11-03 的 1 次；漏拒（路径样的参数值被当成本地包，后面的包不查）在 4,776 条调用 npx 一族的真实命令里 0 次。只登记：两个方向的修法都是新切词，误拒方向是拒绝变放行。
- 2026-11-03：0.119.0 上线后（T0 16:07:10Z 起）113 行遥测、5 次拦截：§8 rm 3 次，npx 1 次（F37），banned-vocab 1 次：`-F -` here-doc 的提交信息里有一句复述旧拒绝文案的 `(reported 8x slower)`，在反引号外面；用 v0.119.0 和 HEAD 的 hook 重放这条命令都拒绝，本批不改变它的判定（落地的 23c8800 改写成了 "they got the 8x tail"）。
- 2026-11-03：bash 3.2 本机可以跑：在 `ubuntu:24.04` 容器里从源码编译（runbook 的写法），得到的 glibc 二进制能在宿主上运行。上一条"本机没有能在宿主上运行的 3.2"只对 `bash:3.2` 和 `loop-eng-bash32` 两个 musl 镜像成立。
- 2026-11-03：提交（本地 `next-release`）：44fc93c（doctor 指纹），a567a1e（F37 登记）。
- 2026-11-03（第三轮，"遗留的工作……按你的建议执行"）：`next-release` 推到 origin（b3ccb85..b66b622，不触发 CI）。F37 漏拒方向仍只登记：0/4,776 的上限按三分之一法则约为每条命令 0.06%，修它会让 `--prefix <目录> <包>` 这种真实写法新增误拒，并且算作要立刻发版的 §8 改动。复测脚本固定在 `tasks/npx-f37-2026-11-03/`（gitignored，`replay.sh` 复现了 4,776 / 7 / 放行 0），11-30 复测记为 D#737，出现 1 次放行来源不明的包就按"只会让放行变成拒绝"的方式修。loop-eng、loop-testing 的发版手册记忆在操作顺序里各加一句打 tag 前评审（loop_eng 仓库的 `RELEASING.md` §2 也没有这一步，没有改：那是另一个仓库，`CLAUDE.md` 有未提交的改动）；doctor `runbook-review-step` 变为 9/9 通过。其他项目的 MEMORY.md（9 个项目 190 行超过 150 字符，2 个超出 12KB）不在这里改：缩短等于改那些项目召回用的标签，合并条目要对照各自的代码。
- 2026-11-09：随 0.120.0 发布（发版记录 `tasks/specs/release-0.120.0-2026-11-09.md`，tag v0.120.0 在 49459b8）。发版前评审补了挂载点的另一种情况：`agent-tmp-*` 目录本身就是挂载点时，顶层和所有条目设备号相同，b16adfc 的比较不触发；修复为顶层再与临时根比较。runbook-review-step 的 `fresh` 前加了词边界（`refresh … subagents` 曾被当成评审步骤）。

## 验证记录
- `node --test tests/scripts/housekeeping.test.js` → 改前失败：新增 3 条（两条 ENOENT 记成错误，挂载点那条目录被列为目标）；改后通过：116 通过，0 失败，1 跳过（跳过的那条改前就跳过）。
- `bash tests/hooks/sandbox-disposal.test.sh` → 改前 30/32（31、32 失败：行里没有 `names`）；改后 32/32；`( trap '' PIPE; … )` 下 32/32。
- `node --test tests/scripts/sampling-audit.test.js` → 改前 95/100（D3 新用例，以及按新形状更新断言的 4 条）；改后 100/100。
- 并发探针（scratchpad 里的 `l7probe.sh`，未入库）→ 改前 exit 3 有 19/20，改后 0/20。
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1,803/1,806（0 失败，3 跳过），35 个 shell 套件 2,636/2,636，shellcheck 94 个文件无警告（改前 0680b63：node 1,799/1,802，shell 2,632/2,632）。
- `npm run smoke` → 通过：SMOKE 2/2。
- bash 3.2 运行时套件（S3 时）→ 未运行：本机的 `bash:3.2` 和 `loop-eng-bash32` 镜像都是 musl 链接，不能在宿主上运行。S5 时改为在 docker 里编译后运行，见下。
- `node --test tests/scripts/runbook-review-check.test.js` → 改前失败（4 份都报，应只报 kilo、lima）；改后 4/4。本机 doctor：改前 4/9，改后 2/9。
- `bash tests/hooks/pre-bash-safety.test.sh` → 通过：1278/1278，`Residuals: xfn=106 xfp=23`；语料文件的 xfn / xfp 行从 103 / 18 变成 105 / 22。新行逐条用探针核过：xfp 四条现在拒绝，xfn 两条现在放行，对照三条按标签判定。
- `npm run check`（a567a1e）→ 通过：exit 0；node 1,804/1,807（0 失败，3 跳过），35 个 shell 套件 2,645/2,645，shellcheck 94 个文件无警告。
- `BASH32_BIN=… CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh`（a567a1e，3.2.57 在 `ubuntu:24.04` 里编译，源码包 sha256 与 ci.yml 一致）→ 通过：44 个套件。
- `npm run smoke`（a567a1e）→ 通过：SMOKE 2/2。
