# 0.113.4：命令页跟上 0.113.3、ship/debug 触发词补漏、macOS 并行计数探针
状态：进行中

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
- [ ] AC1：六个命令页各自说出 0.113.3 的行为，新测试把每句钉住，并在能跑的地方把句子和真实行为连起来 — 验证：`node --test tests/scripts/command-page-behaviour.test.js`（改页前失败，改页后通过）
- [ ] AC2：`帮我打个tag`、`发个版吧` 注入 ship；`测试挂了` 一类注入 debug；对照行不注入 — 验证：`bash tests/hooks/spec-module-inject.test.sh`（改前新行失败，改后通过，bash 5.3 与 3.2）
- [ ] AC3：真实提示词回放：ship、debug 新增命中逐条列出，没有新增误注入 — 验证：`node scripts/offline-eval/trigger-calibrate.mjs` 前后数字 + 逐条清单
- [ ] AC4：macOS 探针的 CI 输出读到，结论写进本文件；探针在 tag 前修掉或撤掉 — 验证：PR CI 的 macos-latest 日志
- [ ] AC5：`npm run check` 退出 0；PR CI 7/7；发版前独立评审；tag、npm、GitHub release — 验证：runbook 第 1–10 步

## 方案
- 命令页：只改说错或没说的句子，不重写整页。新测试 `tests/scripts/command-page-behaviour.test.js`：每页一条整行钉住新句子；能便宜跑起来的行为（analyze 的非目录 `--project` 退出 1、bypass-audit 的 `--help`、status 对坏 manifest 返回的字段、statusline 对 `null` 的拒绝）在沙箱 HOME 里实跑，断言页里引用的字段名或值确实出现在输出里。
- 触发词（真实提示词 665 条，210 个会话，2026-09-05 起）：
  - ship：`打\s*tag` → `打\s*(个|一个)?\s*tag`；加 `发(个|一)版`。回放新增 1 条（"把剩余的做完了发个版……"，确实是发版请求），无误配。
  - debug：加 `(测试|用例|单测|CI)` 后接最多 4 个非标点字符再接 `挂了|挂掉|跑挂|失败|红了|没过`（CI 两侧 ASCII 边界）。头 300 字符窗口内回放新增 0 条：既没有补到漏的，也没有新增误配；理由是这些是"失败的测试"的常见中文说法，模块的 loads-on 本来就写着 failing test。
- 探针：测试里起 4 个子进程并发删同一批目录，三种模式（空目录裸 rmdir；529ad53 的自底向上删除、不复检；带复检），每个进程记下每个目标每一步的结果和 errno，父进程找出被两个进程都算成删除的目录，用 `t.diagnostic` 打出来。测试本身不断言计数（它是记录现场，不是闸门）。

## 计划
- [ ] S1：探针测试，先推草稿 PR 让 macOS 腿跑起来 — 覆盖 AC4 — 执行：主会话
- [ ] S2：命令页测试（红）→ 改六页 + USAGE（绿）— 覆盖 AC1
- [ ] S3：触发词测试行（红）→ 改 json、重建、同步副本（绿）；回放 — 覆盖 AC2、AC3
- [ ] S4：读 macOS 探针 → 修或撤 — 覆盖 AC4
- [ ] S5：记录类三项
- [ ] S6：CHANGELOG、六处版本号、`npm run check`、bash 3.2、PR CI、评审、tag、release — 覆盖 AC5

## 决策与进展
- 2026-10-20：版本取 0.113.4（patch）。命令页是改正文字；触发词补的是模块 loads-on 已经写明的场景（打 tag 属于 "before tagging"，测试挂了属于 "a failing test"），按"恢复已写明的行为"算修复。触发词的开关不变（spec-module-inject 的 kill switch 照旧）。
- 2026-10-20：`next-release` 先快进到 `main`（575ce92），发版分支 `release/v0.113.4` 从它开出。

## 验证记录
