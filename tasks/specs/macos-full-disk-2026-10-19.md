# macOS bash 3.2 磁盘写满：D#417、D#421，随 D#444 发 0.113.2
状态：进行中

## 背景与目标
2026-10-19 使用者让我判断剩余工作哪些值得做并执行。逐项按"发生概率 × 后果 ÷ 成本"核对后的结论见"决策与进展"。要做的两项触发条件相同：macOS 自带的 bash 3.2，并且临时文件或日志写不进去（磁盘满、配额、文件大小上限）。

- D#421：bash 3.2 的 printf/echo 内建命令写文件失败时，BSD libc 把没写出去的字节留在 stdout 缓冲里，下次刷新就写到了 hook 真正的 stdout 上。`pre-bash-safety-check.sh` 在输出 deny JSON 之前先写 rule-hits 日志（`record_section_deny`），所以这时 stdout 是"deny JSON + 一行日志"，Claude Code 读不出一个决定，§8 的拦截丢失。0.112.0 PR CI（run 39029952035，macos-latest，banned-vocab 26n）实测出现过。
- D#417：bash 3.2 把每个 here-string（`<<<`）都写成临时文件；写不进去时那条命令不执行。`verify-log.sh` 和 `test-failure-debug.sh` 随后因 `set -u` 以 `TOOL: unbound variable` 退出（本机 bash 3.2.57 复现，见验证记录），其余各处静默跳过判断。

目标：在这种条件下，每个 hook 的 stdout 仍然只有它自己的那一个 JSON 对象（或为空）；不再有 here-string 依赖临时文件。其他行为不变。

## 范围
- 做：
  - D#421：`hooks/` 下所有把 stdout 重定向到文件、而写入者是内建命令、shell 函数或复合命令（`{ }`、循环、`if`）的地方，改为在一个 stdout 就是该文件的子 shell 里写：`( printf … ) > file`。源码检查用 `hook-sigpipe-source.test.js` 现有的 shell 扫描器（抽到 `tests/lib/shell-scan.mjs` 共用），不按行豁免带 `2>/dev/null` 的写法（e0f5c5a 被撤的原因）。
  - D#417：`hooks/` 下所有 `<<<` 改为 `< <(printf '%s\n' …)`。静态检查：`hooks/` 下不再有 here-string。
  - 发版 0.113.2：连同 `next-release` 上的 D#444（acc4cd1、072c434、2caaab0、51ebe85）。
- 不做：
  - `session-end-check.sh` 写暂停检查点的 here-doc（`cat > "$TMP_PAUSED" <<EOF`）：它的产物写在项目里，macOS 上 `/tmp` 与项目在同一个卷，here-doc 写不进去时检查点本来也写不进去，现有代码已按写入失败处理。
  - D#420、D#144、`git -c k=v commit`：理由见"决策与进展"。

## 计划
- [x] D#417：失败用例（静态 + bash 3.2 运行时），修复（1b0e6d5，rebase 前的 SHA）
- [x] D#421：扫描器抽出（b772b5b）；源码检查（先红），修复全部位置；STDOUT 行为用例（只在 macOS bash 3.2 上有区分力）（3c8fbe6）
- [x] 全量检查：`npm run check`、bash 3.2 运行时 44 个套件、`npm run smoke`（发版分支头上再跑一遍）
- [ ] 发版 0.113.2：发版分支 + 草稿 PR（含 macOS CI）、发版前评审、tag、npm、GitHub release

## 决策与进展
- 2026-10-19：取舍（使用者授权"按你的建议执行"）。
  - 做 D#421：唯一一个会让安全拦截失效的遗留项，发生在与被拦动作相关的场景里（磁盘满时清理文件正是 `rm -rf` 的高发场景）。修法已知（e0f5c5a 的子 shell 形状），缺的是完整的位置清单和不漏判的源码检查。
  - 做 D#417：触发条件与 D#421 相同，修法机械，本机 bash 3.2 能先红后绿，随同一轮评审发出，成本低。
  - 关闭 D#420：#673 对 225 份会话记录的实测，Bash 写入是该记忆文件唯一一次出现的 (会话, 文件) 对有 10 个，其中 7 个是整文件覆盖（等同 Write，本来就该算读过），3 个是追加，最多 2 个会话的拦截结果可能因此改变，很可能是 0；上一次的修法在 bash 3.2 下构造输入要 3.4–4.2 秒（0.111.0 为 1.85–1.91 秒），超出预算。
  - 关闭 D#144：(1) macOS 上 `/tmp` 一路只认 `claudemd-` 前缀，只关系到本仓库测试的残留，扫 `$TMPDIR` 要么照搬这个前缀（同样只关系到本仓库），要么扫 `tmp.*`（`$TMPDIR` 里有各种程序的临时目录，Linux 上 `/tmp` 正是因此不扫 `tmp.*`）；(2) 自身项目目录的排除只在"会话从临时目录启动且 `~/.claude` 路径不规范"时误报，且默认只是提示。
  - 不改 `git -c k=v commit` 的识别：2026-09-19 以来 239 份会话记录里 0 次，`git commit` 开头的 65 次。
  - 更正：上一轮把"无 timeout 时 session-start 套件慢 38 秒"列为遗留，实际 0.113.1 已修（58 秒 → 15 秒，CHANGELOG 0.113.1）。
  - 已在 claude-mem-lite 里关闭 D#420、D#144（drop，附上面的理由）；项目记忆里 D#328 的过期前提已改正。
  - D#327/D#328 等 10-29：D#328 标题里"等 10-26 窗口结束"和"先跑 /doctor prompt-audit"两个前提都已不成立（窗口 10-16 截止，prompt-audit 10-17 已跑），剩下的只是复扫需要的数据量。

- 2026-10-19：D#417 的两处 PreToolUse 热路径（spec-module-gate、cross-repo-write 的逐段切词）用 `set -f` + 不加引号的展开，不加 fork（与 pre-bash-safety 的 rm 循环同一写法）；其余 `< <(printf '%s\n' …)`。bash 3.2 与 5.3 下实测：读到 EOF 时变量置空，`set -f` 切词与 `read -ra` 结果相同。
- 2026-10-19：D#421 的识别器（`tests/scripts/hook-full-disk-source.test.js`，复用抽到 `tests/lib/shell-scan.mjs` 的扫描器）报出 25 处，粗 grep 报出 22 行，其中 21 行是同一批，另 1 行是引号里的正则；识别器多出的 4 处是复合命令和跨行 printf。24 处改为子 shell；`hook_spawn_install` 里那处所在的 detached 子 shell stdout 已是 /dev/null，列入 KEPT。
- 2026-10-19：核实 §8 路径：0.112.0 PR CI 的 macOS 腿上 pre-bash-safety 的 no-tmp 行是通过的，原因是它们用 `session_id:"t"`，`rule_hits_append` 见到 "t" 不写日志（rule-hits.sh:200）；真实会话的 §8 deny 与 banned-vocab 同样先写日志再输出 deny。新加一行带真实 session id 的用例（只在 macOS 上有区分力）。
- 2026-10-19：第一次全量检查红了 3 个 node 用例，都是新文件带来的文档漂移：ARCHITECTURE.md 的 node 套件数（93 → 94）及其变异对照，ADDING-NEW-HOOK.md 没写新门禁。已补，两个套件 24/24。

## 验证记录
- D#417 改前，bash 3.2.57，`(trap '' XFSZ; ulimit -f 0; …)`：`verify-log.sh`（EVIDENCE_WTREE=1）→ `line 49: cannot create temp file for here document: File too large`、`line 50: TOOL: unbound variable`，exit 1；`test-failure-debug.sh`（DEBUG_ON_TEST_FAILURE=1）→ 同样在 51/52 行，exit 1。bash 5.3.9 下两者 exit 0。
- D#417 新用例在旧 hook 上（HEAD 的 worktree + 新测试文件，PATH 指向 bash 3.2.57）：spec-module-gate 17、verify-log 12、test-failure-debug 10、cross-repo-write X23 全部失败；修复后在 5.3.9 与 3.2.57 下：spec-module-gate 16/16、verify-log 13/13、test-failure-debug 10/10、cross-repo-write 58/58、sandbox-disposal 28/28、mem-audit 14/14、memory-prompt-hint 27/27、transcript-structure-scan 33/33、session-start 88/88。
- D#421 源码检查：修复前 25 处报错；修复后 10/10（含 6 个变异行，各自报出预期的那一条）。
- 3c8fbe6 之前的工作树（D#421 已改、未提交）：`( trap '' PIPE; npm run check )` → 失败（node 1553/1557，3 个失败，均为上条文档漂移；所有 shell 套件通过）；bash 3.2 运行时 → 通过（44/44）；`npm run smoke` → 通过（2/2）。补文档后 architecture-drift + subject-set-drift → 通过（24/24）。
- 日志追加 200 行，3 次取最好，负载约 1：bash 5.3.9 1.54 s → 1.54 s；bash 3.2.57 1.61 s → 1.67 s。
