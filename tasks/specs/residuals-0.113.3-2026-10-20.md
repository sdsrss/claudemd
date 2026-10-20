# 0.113.2 之后剩下能做的，发 0.113.3
状态：进行中

## 背景与目标
2026-10-20 上午先核对了遗留：`main` CI 红（a3c496f 修）、`hook-budget` 在会话临时目录作 TMPDIR 时红（0a337e0）、D#455 状态栏的 here-string（be1a7ec，`next-release`）、D#327 复测前提（80cdce4）。汇报里列了"核实过、但没修"的几条和 converge 积压里约 35 条没复核的 P2。

使用者随后："把剩下能做的做了之后发版"。

我的理解（§0 歧义，选一种并写下）：
- "能做的"指现在就能做、不用等日期也不用使用者动手的项：汇报里那 4 条罕见问题，加上把 converge 积压逐条复核，修其中仍然成立、改动小、会影响插件使用者的缺陷。
- 只影响维护者自己工具的、性能微调、补文档或补测试、已登记接受的残差，以及积压里写明"不要动"的，复核后记下结论，不在这一版里修。
- 会改变已发布产物默认行为的（L3），不做，留给使用者决定。

## 范围
- 做：
  - D#455 状态栏（be1a7ec，已在 `next-release`）。
  - `spec-module-inject` 的提示词经 `--arg` 传给 jq，128 KiB 起 exec 失败，ship 模块不注入（c907e25）。
  - `scripts/*.sh` 不再有 here-string（`perf-baseline.sh` 两处），静态检查覆盖整个目录（8c19e8f）。
  - session-start：没有 node 时，安装失败横幅不再说"本会话会重试"，并且保留哨兵（9152ba8）。
  - converge 积压复核后选出的缺陷（见决策与进展）。
  - 发版 0.113.3（patch：全是修复，规范不变）。
- 不做：
  - doctor 的 `hook-fail-open` 行在一次真实 fail-open 之后红 30 天，按它的建议恢复后也不转绿。要让它恢复后转绿，得为十几种 fail-open 原因各定义一个"现在已恢复"的判据，同时改变 `/claudemd-doctor` 的退出码语义，属于已发布产物的默认行为变化（L3），放进汇报请使用者决定。
  - D#327 / D#328：等 10-29。

## 计划
- [x] spec-module-inject 128 KiB（c907e25）
- [x] scripts/*.sh here-string（8c19e8f）
- [x] session-start 无 node 横幅（9152ba8）
- [x] converge 积压复核（只读子代理，75 条）与选出的修复（7 个执行代理 + 主会话 §8 组）
- [ ] 发版 0.113.3：发版分支、CHANGELOG、六处版本号、`npm run check`、bash 3.2 运行时、smoke、草稿 PR、CI、发版前评审、tag、npm、GitHub release

## 决策与进展
- 2026-10-20：jq `--arg` 传大段文本的位置共 19 处（`grep`），只有 `spec-module-inject.sh:85` 传的是使用者整段提示词、长度无上限；其余是模块正文（预算 9,800 字符）、拒绝理由（pre-bash-safety 截到 30,000 字符）、文件路径列表等有界内容，不改。
- 2026-10-20：session-start 无 node 的横幅选"说明原因 + 保留哨兵"，不选"不出横幅、等 node 回来"：后者在 node 一直不回来时使用者永远收不到提示，而这时插件也不会再升级。保留哨兵的代价是每个会话一条横幅和一行 `bootstrap-fail-banner` 日志，可以用 `DISABLE_BOOTSTRAP_FAIL_BANNER=1` 关掉。

- 2026-10-20：复核结果（80cdce4）：75 条未划掉的 P2 里，40 条仍是缺陷，31 条不是缺陷（性能微调、缺文档或测试、已接受残差、"不要动"），3 条已修，1 条过时。修了 34 条整条和 3 条的一部分。
- 2026-10-20：按文件把修复分成互不重叠的 7 组，派执行代理各在 worktree 里先写失败用例再修，主会话做 §8 组（`rm -rf ~`、`npm x`），然后逐组拣到 `next-release`。
- 2026-10-20：不修、留给使用者的：178（cross-repo-write 引号里的分隔符，修法 0241e73 已写好未拣入：与 `tasks/specs/cross-repo-write.md` r7 使用者"撤回到简单形式"的决定冲突）；179a（banned-vocab 放行引号里的词，要权衡绕过口子）；166（触发词是模型可见文字，L3）；doctor fail-open（退出码语义，L3）。不修、有依据的：124（前提没复现，0.107.1 起已登记为已知限制）、141a（1,500 个暂停文件不现实）、179c（会把 §8 的拒绝变成放行）。
- 2026-10-20：执行代理报的同类遗漏一起修了：重定向顺序这一类在 `hooks/` 下还有 13 处、另有 5 处写入完全没丢弃 stderr（737d6d7），加了源码规则。session-end 的 `make tests`/`make unittest` 不再算验证：与 npm 脚本名的规则一致，本机会话里出现的 make 目标只有 `lint-js`、`test-js`，维持。
- 2026-10-20：`commands/claudemd-clean-residue.md` 的类别数随 branch-prune 新状态类改了（漂移测试要求）；其余因修复而说得不全的命令页（bypass-audit、analyze、uninstall、refresh、status）是模型可见文字，没改，列入 CHANGELOG 的 Not changed。
- 2026-10-20：发版前评审第 1 轮（三个不带名的评审并行，b3f7169..164ad9b）：对外承诺侧 0C/0H/2M/10L，hooks 侧 0C/0H/2M/9L，脚本侧 0C/0H/3M/6L。
  - 撤回两个组件（修的是罕见漏报，引入的误报有真实数据或更常见）：b893a1c（evidence-gate 后台运行，573528b）、ad5605f（session-end make 目标，7f1a749）。
  - 修复：status 改为纯增量（0974a1e）；claudemd-cli 严格 UTF-8、`audit <path> -h`、CONTRIBUTING 退出码表写明"无法使用的输入用 2"（8d24040）；branch-prune 认领失败照常提示（8ec325e）；sandbox-disposal 的 touch 与 tmp-sweep 的 nohup 重定向（42d8031）；doc-check 逗号后的比例（7ddcdb4）；模块标记近似写法（37829d4）；statusline 恢复整个对象（107b61e）；mem-audit 取第一个链接（be8fa47）；test-failure-debug 锁过期（270847c）；语料行编号与 F21 登记（6fdb653）；文档（61a494c）；CHANGELOG 按三份报告改写。
  - 退出码的取舍：先按表把 lint 的非 UTF-8 改成 1，随后改回 2——这个 CLI 本来就用 2 表示"无法使用的输入"（文件不存在、目录、不是会话记录的 JSON），表与现状不符，改的是表。
  - 不修：已发布提交说明里引用了拣入前的 SHA（b1732d3、7d92c78、b654165），改要重写已推送的历史；branch-prune 认领不随压缩重置；推送闸门的其他命令位置形状、`--help` 豁免只读第一段（0.113.2 起就如此）。
- 2026-10-20：PR CI run 39426400220（164ad9b）macOS/Node 24 腿红：529ad53 的并行计数用例 4 个进程报 946 个删除（实为 800）。本机没有 macOS，找不出 APFS 上为何两个进程的 rmdir 都算成功；这个计数只进 tmp-sweep 的结果文件，撤回这部分（864b03a），保留 `truncated` 和 `--root`。131 号随之变为部分修复：整条 31、部分 6、不修 3。
- 2026-10-20：第 2 轮（一个全新评审，164ad9b..0a66408）：0C/0H/1M/8L。M1：D#174a 的 UTF-16 中文行带换行、含 NUL，改前也会通过，改夹具（95b9a89）。L 中文字类改了（CONTRIBUTING 退出码表、branch-prune 说明、CHANGELOG 的 lint 原因与 test-failure-debug 并发说明）；三个评审者构造的 §8 形状登记为 F21 扩展、F22、F23，不打补丁（39d9d9e）；status 两种少见情况的字段内容与 test-failure-debug 抢过期锁的并发写进 CHANGELOG，不改代码。已到深度上限 2，修复只涉及测试夹具、语料行和文字，按 runbook 用 claim-drift 自查，不派第 3 轮。0a66408 的 PR CI run 39434886152 7/7。

## 验证记录
- c907e25：`bash tests/hooks/spec-module-inject.test.sh` → 改前 17/18（用例 18 失败），改后 18/18（bash 5.3.9 与 3.2.57）；每条提示词耗时 100 次 × 3：改前 11.58/11.00/11.21 ms，改后 11.17/11.27/10.63 ms。
- 8c19e8f：`node --test tests/scripts/hook-full-disk-source.test.js` → 改前失败（perf-baseline.sh:202、:216），改后 12/12；`bash tests/integration/perf-baseline-hermetic.test.sh` → 7/7。
- 9152ba8：`bash tests/hooks/session-start.test.sh` → 改前 88/90（37b、37c 失败），改后 90/90（bash 5.3.9 与 3.2.57）；变异（无条件删除哨兵）→ 37b、37c 变红；`npm run test:scripts` → 1559/1560，1 个跳过（改流程文档前，引用检查失败 1 条）。
- §8 回放（941ecfd、9f86289）：101,102 条不重复真实命令中 4,519 条命中筛选，0.113.2 与新闸门判定 0 条翻转。推送闸门回放（代理）：ship-baseline 1/1,150、banned-vocab 2/4,203、memory-read-check 1/8,589 由放行变拒绝，均为包在 `( )`/`$( )` 里的真实推送或提交。
