# 0.113.4：命令页跟上 0.113.3、ship/debug 触发词补漏、macOS 并行计数探针
状态：已完成

## 背景与目标
0.113.3（2026-10-20）改了六个命令背后的行为，但它们的命令页（模型读的文字）没改，列在 CHANGELOG 的 Not changed 里（D#493）。同一版的 Not changed 还记着 ship/debug 模块触发词漏掉"打个tag""测试挂了"。并行 `housekeeping tmp --apply` 的删除计数修法在 macOS CI 上失败、原因不明，已撤回（D#494），计划是在下一个发版 PR 里加探针、读 macOS 那条腿。

使用者 2026-10-20 授权："文本发版，改 6 个命令页、ship/debug 触发词，加 macOS 探针"。doctor 的 `hook-fail-open` 一项不在授权范围里，不做。

目标：六个命令页说的与代码一致；触发词按真实提示词补上漏掉的说法、不新增误注入；拿到 macOS 上并行 rmdir 计数的现场数据，打 tag 前要么修掉、要么撤掉探针。

## 范围
- 做：
  - 六个命令页：`claudemd-bypass-audit.md`（`--cwd` 只是查找兜底）、`claudemd-analyze.md`（退出码）、`claudemd-uninstall.md`（restore 还原符号链接）、`claudemd-refresh.md`（卸载后安装失败的提示）、`claudemd-status.md`（`manifestError` / `manifest-unparseable`）、`claudemd-statusline.md`（恢复整个对象；拒绝 `[]`/`null`）。
  - 同一缺陷的另一处：`spec-coherence-audit.js` USAGE 的 "Default: always exit 0"。
  - `spec/spec-modules.json` 的 ship、debug 触发词，重建模块，`trigger-calibrate.mjs` 的副本同步。
  - macOS 探针测试（临时，打 tag 前修或撤）。
  - 记录类：`.converge/BACKLOG.md` 同步 0.113.3 的结果；D#328 的等待理由；`residuals-0.113.3` spec 里引错的 SHA。
- 不做：
  - doctor `hook-fail-open`（不在授权范围，改退出码语义）。
  - `ship` 两侧加 `-` 边界（`ship-baseline` 误配）：真实提示词里只靠连字符形式命中的 2 条，1 条之后真的发了版，改了得失相抵。
  - 英文 "test failed / tests fail"：这次的发现只点了中文，真实提示词里没有数据。
  - 规范版本：触发词是模块元数据，0.103.0、0.104.0 改触发词时规范都没升版，这次同样保持 v8.2.0。

## 验收标准
- [x] AC1：六个命令页各自说出 0.113.3 的行为，新测试把每句钉住，并在能跑的地方把句子和真实行为连起来 — 验证：`node --test tests/scripts/command-page-behaviour.test.js`（改页前失败，改页后通过）
- [x] AC2（评审后缩小）：`帮我打个tag` 注入 ship；`发个版`、`测试挂了` 两个分支撤回，作为 RESIDUAL 行留在 case 21；对照行不注入 — 验证：`bash tests/hooks/spec-module-inject.test.sh`（改前新行失败，改后通过，bash 5.3 与 3.2）
- [x] AC3：真实提示词回放：ship、debug 新增命中逐条列出，没有新增误注入 — 验证：`node scripts/offline-eval/trigger-calibrate.mjs` 前后数字 + 逐条清单
- [x] AC4：macOS 探针的 CI 输出读到，结论写进本文件；探针在 tag 前修掉或撤掉 — 验证：PR CI 的 macos-latest 日志
- [x] AC5：`npm run check` 退出 0；PR CI 7/7；发版前独立评审；tag、npm、GitHub release — 验证：runbook 第 1–10 步

## 方案
- 命令页：只改说错或没说的句子，不重写整页。新测试 `tests/scripts/command-page-behaviour.test.js`：每页一条整行钉住新句子；能便宜跑起来的行为（analyze 的非目录 `--project` 退出 1、bypass-audit 的 `--help`、status 对坏 manifest 返回的字段、statusline 对 `null` 的拒绝）在沙箱 HOME 里实跑，断言页里引用的字段名或值确实出现在输出里。
- 触发词（真实提示词 659 条，207 个会话，本机全部留存的会话记录）：
  - ship：`打\s*tag` → `打\s*(个|一个)?\s*tag`；加 `(?<![开触研出批激散引])发(个|一个?)版(?!本号)`（评审后加了前后两个边界）。回放新增 1 条（"把剩余的做完了发个版……"，确实是发版请求），无误配。
  - debug：加 `(测试|用例|单测|CI)`（CI 两侧 ASCII 边界）后接最多 2 个非空白非标点字符，再接 `挂了|挂掉|跑挂|失败了|失败`（后面须是空白、标点或结尾）`|红了|没过`（评审后从 4 个字符收窄到 2 个，并限定 失败 的后文）。头 300 字符窗口内回放新增 0 条：既没有补到漏的，也没有新增误配；理由是这些是"失败的测试"的常见中文说法，模块的 loads-on 本来就写着 failing test。
- 探针：测试里起 4 个子进程并发删同一批目录，三种模式（空目录裸 rmdir；529ad53 的自底向上删除、不复检；带复检），每个进程记下每个目标每一步的结果和 errno，父进程找出被两个进程都算成删除的目录，用 `t.diagnostic` 打出来。测试本身不断言计数（它是记录现场，不是闸门）。

## 计划
- [x] S1：探针测试，先推草稿 PR 让 macOS 腿跑起来 — 覆盖 AC4 — 执行：主会话
- [x] S2：命令页测试（红）→ 改六页 + USAGE（绿）— 覆盖 AC1
- [x] S3：触发词测试行（红）→ 改 json、重建、同步副本（绿）；回放 — 覆盖 AC2、AC3
- [x] S4：读 macOS 探针 → 修或撤 — 覆盖 AC4
- [x] S5：记录类三项
- [x] S6：CHANGELOG、六处版本号、`npm run check`、bash 3.2、PR CI、评审、tag、release — 覆盖 AC5

## 决策与进展
- 2026-10-20：版本取 0.113.4（patch）。命令页是改正文字；触发词补的是模块 loads-on 已经写明的场景（打 tag 属于 "before tagging"，测试挂了属于 "a failing test"），按"恢复已写明的行为"算修复。触发词的开关不变（spec-module-inject 的 kill switch 照旧）。
- 2026-10-20：`next-release` 先快进到 `main`（575ce92），发版分支 `release/v0.113.4` 从它开出。
- 2026-10-20：触发词定稿（f68f3e5）。ship 的 `-` 边界不改：只靠 `ship-`/`-ship` 命中的 2 条提示里 1 条之后发了版。已知误配：debug 新分支会命中"测试没有失败"（中间两个字符），回放里没有这种提示，写进 CHANGELOG 的 Not changed。
- 2026-10-20：PR CI 前两轮红：39456034935 是 ARCHITECTURE.md 的套件数（94→96，e26828b），39458386087 是"spec/ 改了必须升版"闸门（2334033 升版）。两轮 macOS 腿都被 fail-fast 取消，探针第三轮才拿到数据。教训：推之前先跑 `npm run check`，并且 spec/ 一改就同时升版。
- 2026-10-20：探针结果（PR CI 39461011037）：macOS 上两个进程对同一个**空**目录 `rmdir(2)` 都能返回成功——bare 模式 800 个目录 801 / 897 / 885 次成功（Node 20 / 22 / 24），bottomup 模式两个进程记录的 inode 相同；Linux 三种模式都正好 800，readdir 没有重复项。所以"rmdir 成功才计数"在 APFS 上不成立。决定：不修，撤掉探针（本机没有 macOS，能在 macOS 上成立的认领要用 rename 或认领文件，二者都会在进程中途被杀时留下没有扫除匹配的孤儿；而这个数只进 tmp-sweep 的结果文件）。在 `scripts/housekeeping.js` 删除处写明原因，防止有人再试 529ad53 的做法。仓库里没有别的地方把 rmdir 成功当作认领（`grep rmdir hooks/ scripts/ bin/`：rule-hits 的锁回收和 uninstall 的空目录删除都不依赖谁赢）。

- 2026-10-20：发版前评审第 1 轮（一个全新评审，575ce92..bad2e0f）：0C/0H/2M/11L。
  - M1（触发词误配）：ship 的新分支没有 开发/研发 的前向排除，"我想开发一个版本管理工具""发个版本号给我"会注入 ship；debug 的新分支会命中"写测试覆盖登录失败的情况""测试失败率统计"这类写测试的请求。经真实 hook 复现。修：ship 加 `(?<![开触研出批激散引])` 与 `(?!本号)`；debug 的间隔 4→2，标点集加 `:：`，失败 后须是了、空白、标点或结尾。先加 11 个反例行（7 行在旧分支上变红），改后 21/21；逐个去掉每个边界，case 21 都变红。回放结果不变（659 条，ship +1，debug +0，无丢失）。剩下的已知误配写进 CHANGELOG："测试没有失败""用例评审没过"。
  - M2（case 21 钉不住边界）：上面的反例行就是修法，每个边界都有一行能区分。
  - L1 uninstall：相对链接还原成绝对链接，目标不存在的链接被跳过——页面、README、CHANGELOG 改写。L2 statusline：拒绝的形状补上 string、boolean。L3 analyze：exit 1 的条件改为"它读的文件读不了"（含 MEMORY.md）。L4 status：不再说"manifestPath 处的文件不是合法 JSON"（旧版 manifest 与 JSON null 两种情况不成立）。L5 refresh 测试改为真的跑脚本（`claude` 替身），评审者的变异（去掉 `, then /reload-plugins`）现在会让它失败。L6 statusline 的三处"command"改为 statusLine。L7 CHANGELOG 的字符类说法改准。L9 本文件的数字改正。L10 测试里的 `\S+` 改为 `.+`（TMPDIR 带空格）。L11 bypass-audit 的提示改为"两个地方都找不到"。
  - L8（不修）：JS 与 jq 在 emoji（JS 按 UTF-16 码元计数）和 ſ（Oniguruma 的大小写折叠）上不一致。hook 用的是 jq，JS 副本只用于离线校准；两种输入都是评审者构造的，回放里没有。
  - 修复改了触发词（行为），按 runbook 要第 2 轮评审（新开一个评审，只看修复范围）。

- 2026-10-20：第 2 轮评审（新开一个评审，bad2e0f..82a4399）：0C/0H/2M/8L。两个 M 都还在触发词上：debug 分支在"测试没过期的缓存""CI 没过多久就跑完了""测试登录失败了怎么提示"上误配，ship 的 发个版 分支在"帮我发一个版权声明""发个版面截图""转发一个版本"上误配。已到深度上限 2。
  - 按组件归因（两轮合计）：debug 分支 2M+6L、发个版 分支 2M（与 debug 各半）+1L、打个tag 分支 0、命令页/测试/文档 0M+13L、探针 0。真实提示：debug 分支 0/659 命中；发个版 分支 1/659，而那个会话之前已有两条提示注入过 ship（"本地做完的任务要不要提交发版"），ship 每会话只注入一次，召回增益 0。
  - 决定：按记忆 feedback_revert_the_component_not_the_next_defect 的规则（收益与回归不在同一块时，撑回收益为零的那块，发版照发），撤回 debug 分支（回到 0.113.3 的字节）和 发个版 分支，保留 打个tag 分支。不开第 3 轮：撤回恢复的是已发布的字节，打个tag 分支两轮都没有发现；其余修复只涉及测试和文字，按 runbook 用 claim-drift 自查。case 21 的 9 条旧正例改成 RESIDUAL 行（今天不注入，将来有人加回分支会翻红），两轮评审的 22 条反例留作前瞻钉。
  - 第 2 轮的 L：L1（CHANGELOG 说页面写了 manifestPath）改；L4 refresh 用例改为整行比对，评审者的两个变异（`${PLUGIN}-next`、前缀一句话）现在都会让它失败；L6 README 的 "saving its command" 改为 statusLine；L7 注释随 case 21 重写；L8 README 补上绝对链接与跳过失效链接两句，使 82a4399 的提交说明成立。L2、L3、L5 针对的分支已撤回。已推送的提交说明（d2764b1 的"11 neighbours, one per bound"）不改写历史，在 CHANGELOG 的评审段说明。

## 验证记录
- 6a12749 之前：`node --test tests/scripts/command-page-behaviour.test.js` → 改页前 0/6（每条 "lacks the line"），改页后 6/6；第 1 轮评审后改了钉住的句子，5/6 在旧文字上失败，改后 6/6；refresh 用例对评审者的三个变异（去掉 `, then /reload-plugins`、`${PLUGIN}-next`、行首加一句）都失败。
- `bash tests/hooks/spec-module-inject.test.sh` → 最终 21/21（bash 5.3.9）；case 21 的两条 打个tag 正例在 575ce92 的 ship 模块上失败。
- 回放（旧 = 575ce92 的触发词，新 = 最终）：663 条人类提示，没有一条增加或丢失匹配。
- 探针：PR CI 39461011037，macOS bare 模式 801 / 897 / 885（Node 20 / 22 / 24），Linux 三种模式 800。
- 最终 head（2936214，代码同 41402d5）：`( trap '' PIPE; npm run check )` → 退出 0（node 1,603/1,604，1 个因未设 SHFMT 跳过，shell 套件全过）；`tests/lib/bash32-runtime.sh`（bash 3.2.57）→ 44/44，运行前后 `/tmp/sh-thd*` 都是 0；`npm run smoke` → 2/2。
- PR CI：39456034935 失败（套件数）、39458386087 失败（spec 改动未升版），39461011037、39464930475、39471198117、39476706726（最终 head）7/7。
- 发版：`main` 快进到 2936214 并推送，main 的 CI 39479990773 通过；tag v0.113.4（e25f01a）的 ci 39480014593 与 npm-publish 39480014657 全部作业通过；`npm view claudemd-cli dist-tags.latest` → 0.113.4（19:24:45Z，第 1 次轮询）；GitHub release https://github.com/sdsrss/claudemd/releases/tag/v0.113.4；PR #13 已合并。
- 暴露 T0 未记：要等使用者运行 `/claudemd-refresh` 并重启（runbook 第 11 步），两份 PREREG 已写附记。
