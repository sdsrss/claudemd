# 下一批次的遗留小修：tmp 回收的并发与挂载点、sandbox-disposal 遥测带目录名、askRate 标明未校准

状态：进行中

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
- 不做：
  - D#718 L2（复查和 `rmSync` 之间写进来的文件会被一起删）：不在使用者选的 B 里。D#718 已关闭，L2 和精确计数改记在 D#729。
  - 并发回收的重复计数：APFS 上两个进程对同一目录的 rmdir 都能成功（864b03a 的记录）；本机 Node 26 / Linux 上也重复计数（见决策）。按 ENOENT 处理修不了，维持现状。
  - vitest 一类的挂载点检查：它的签名只允许两层、第二层只能是 40 位十六进制名字的普通文件，挂载点只能出现在 `ssr` / `client` 本身，且里面只有这种文件，不改。
  - CHANGELOG：发版时写（runbook 第 3 步）。

## 验收标准

- [x] AC1：`removeAgentTargets` 和 `removeVitestTargets` 遇到别人先删掉的目标时，`errors` 为空、`deleted` 不计；其他错误（如 EACCES）仍记为失败、CLI 仍 exit 3。验证：`node --test tests/scripts/housekeeping.test.js`，新增用例改动前失败。
- [x] AC2：`agent-tmp-*` 目录里任何条目与顶层设备号不同，扫描和删除前复查都跳过它，`skipped` 写 `mount-point`，目录保留。验证：同上，新增用例改动前失败。
- [x] AC3：`sandbox-disposal` 的 warn 和 block 行带 `extra.names`，是 stderr / block 原因里列出的目录的 basename，最多 5 个；含 `"` 或 `\` 的名字仍是合法 JSON。验证：`bash tests/hooks/sandbox-disposal.test.sh`，新增用例改动前失败。
- [x] AC4：`sampling-audit` 汇总和每个分类的 `askRate` 带 `precision: null`、`status: "collecting"`；计数不变。验证：`node --test tests/scripts/sampling-audit.test.js`，新增用例改动前失败。
- [x] AC5：`npm run check` 退出 0，`npm run smoke` 为 SMOKE 2/2。
- [ ] AC6：随下一个非紧急批次发版（与 `tasks/specs/gate-precision-fixes-2026-11-03.md` 同批），CHANGELOG 写明这四处改动。验证：发版记录 `tasks/specs/release-*.md`。

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
- [ ] S4：随下一个批次发版 — 覆盖 AC6 — 依赖：S3

## 决策与进展

- 2026-11-03：使用者回复"1.推 2. B 3.现在 4.不改"。B 范围按当时的写法是 D#718 的 L7、L8 和 D2、D3，L2 不在内。
- 2026-11-03：L7 两类回收一起改，不只改 agent-tmp：exit 3 由两类共同决定。可逆，代价是一个帮助函数。
- 2026-11-03：并发探针（4 个 `tmp --apply` 同跑 400 个 `agent-tmp-*` 目录，用测试时钟推后 73 小时，每轮 5 次）：改前 20 个进程中 19 个 exit 3、每轮 10–27 个 ENOENT 错误；改后 20/20 exit 0、0 个错误，两种情况下 400 个目录都删光。删除计数改前改后都多算（改前每轮合计 678–1,134，改后 938–1,147）：Node 26 的 `rmSync` 在两个进程同删一棵树时常常都返回成功，所以 Linux 上也多算，不只 macOS。要精确只能先改名再删（D#718 给 L2 的修法，现记在 D#729），这个计数只写进 `tmp-sweep.last.json`，仓库里除了测试没有读它的代码，不做。
- 2026-11-03：`RULE-HITS-SCHEMA.md` 写"added after 0.119.0"，不写下一个版本号，和 0680b63 的 `tags` 一样：版本号要到发版时才定。
- 2026-11-03：提交（本地 `next-release`）：b16adfc（tmp 回收 L7、L8），a35765b（`names` 与 `askRate` 标签）。
- 下一步：随下一个非紧急批次发版（11-09 起），与 `tasks/specs/gate-precision-fixes-2026-11-03.md` 同批。发版 PR 推送前先跑 bash 3.2（本机没有能在宿主上运行的 3.2）。

## 验证记录
- `node --test tests/scripts/housekeeping.test.js` → 改前失败：新增 3 条（两条 ENOENT 记成错误，挂载点那条目录被列为目标）；改后通过：116 通过，0 失败，1 跳过（跳过的那条改前就跳过）。
- `bash tests/hooks/sandbox-disposal.test.sh` → 改前 30/32（31、32 失败：行里没有 `names`）；改后 32/32；`( trap '' PIPE; … )` 下 32/32。
- `node --test tests/scripts/sampling-audit.test.js` → 改前 95/100（D3 新用例，以及按新形状更新断言的 4 条）；改后 100/100。
- 并发探针（scratchpad 里的 `l7probe.sh`，未入库）→ 改前 exit 3 有 19/20，改后 0/20。
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1,803/1,806（0 失败，3 跳过），35 个 shell 套件 2,636/2,636，shellcheck 94 个文件无警告（改前 0680b63：node 1,799/1,802，shell 2,632/2,632）。
- `npm run smoke` → 通过：SMOKE 2/2。
- bash 3.2 运行时套件 → 未运行：本机的 `bash:3.2` 和 `loop-eng-bash32` 镜像都是 musl 链接，不能在宿主上运行；发版 PR 的 macOS 腿用 3.2.57 跑全部 hook 套件。
