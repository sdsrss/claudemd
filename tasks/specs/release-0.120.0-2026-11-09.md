# 0.120.0：11-03 两批遗留修复的合批发版（闸门准确率、tmp 回收并发与挂载点、遥测字段、doctor 指纹）

状态：已完成

## 背景与目标

- 使用者 2026-11-09 说"发版"。
- 本批内容（`next-release` 上 11-03 的提交，`main` 是它的祖先，不需要 rebase）：
  - 闸门准确率（设计记录 `tasks/specs/gate-precision-fixes-2026-11-03.md`）：ed3d39f（banned-vocab Path 1 剥离）、23c8800（小数倍数完整引用）、0680b63（memory-read-check 拦截行 `tags`，doctor 先列实际拦截）。
  - 遗留小修（设计记录 `tasks/specs/batch-residuals-2026-11-03.md`）：b16adfc（tmp 回收 ENOENT 与挂载点）、a35765b（sandbox-disposal `names`，askRate 的 `precision` / `status`）、44fc93c（doctor `runbook-review-step` 指纹）、a567a1e（F37 只登记，闸门不改）。
- 发版节奏：两批都不属于必须立即发的类别；记录里定的是 11-09 起随下一个非紧急批次发。11-09 是周一，本周额度未用。
- 版本号 0.120.0：两个 `feat` 提交；0.119.0 带一个 `feat` 也是次版本号。spec 没有改动（仍是 v8.5.0）。

## 范围

- 做：
  - 五处版本号；CHANGELOG 条目（≤3,000 字节）。
  - tmp 回收新加的"有条目在另一个文件系统上就保留"这一条，补进 README、`docs/ARCHITECTURE.md`、`hooks/tmp-sweep.sh` 头注释和 `housekeeping.js` 的 `--help`（b16adfc 只改了代码和测试，这四处还是 0.119.0 的条件列表）。
  - 按发版手册发布；发版后在 `next-release` 上关闭两份设计记录的 AC6 / AC7、S4。
- 不做：
  - `spec/CLAUDE-extended.md` §5-EXT 那句"tmp-sweep 在……时删除"同样没写挂载点。改它要 spec 补丁版本和整套 spec 版本同步，并且是给模型读的规范文字；它漏写的方向是"实际比写的少删"。记为遗留，随下一次 spec 改动修。
  - D#665、D#656、D#674、D#719、D#737（各自的延期项）。

## 计划

- [x] S1：从 `next-release` 切出 `release/v0.120.0`；五处版本号；CHANGELOG 条目单独扫描；四处 tmp 回收说明
- [x] S2：`git add` 后 `npm run check`、`npm run smoke`；bash 3.2.57 运行时套件
- [x] S3：提交、推送、开 draft PR；PR CI 全绿
- [x] S4：发版前评审（新开的评审代理）
- [x] S5：合入 `main`、带注释的 tag、GitHub Release；两条 tag 工作流、`npm view`、`_npmUser`
- [x] S6：`next-release` 快进到 `main` 并推送；在 `next-release` 上关闭两份设计记录

## 决策与进展

- 2026-11-09：`main` 的 CI（288057d，run 41660765490）为绿。
- 2026-11-09：CHANGELOG 条目 2,641 字节，单独扫描通过。
- 2026-11-09：aa3dfd9 的 PR CI（run 42697781748）7/7 通过。
- 2026-11-09：第一轮评审（新开的评审代理，288057d..aa3dfd9）：Critical 0、High 1、Medium 4、Low 9。逐条核实后处理：
  - H1（修代码，先写失败用例）：`agent-tmp-*` 目录本身就是挂载点时，顶层和所有条目的 st.dev 相同，原来的比较不触发，`rmSync` 会删掉挂载进来的内容。修法：顶层再和父目录（临时根）比较。新用例在修复前失败（目录出现在 `targets` 里）。
  - M1（改文字）：here-doc 里引用 `git commit -m "…"` 时，提取器只扫那段引用，其余部分不扫，所以也会放行。在沙箱 HOME 里复现：同一段含 `significantly` 的说明，加上那行引用就放行，去掉就拒绝。hook 注释和 CHANGELOG"Not changed"改写。ed3d39f 自己的提交说明就是这种情况；它已在 `next-release` 上推送，不改写历史。
  - M2、M3（修代码，先写失败用例）：静态扫描 0 个候选、但有文件被拦 ≥3 次时，0680b63 让检查变红并建议改标签；拦截也可能是闸门拦对了，doctor 分不清。改为这时检查保持通过，详情前面列出实际拦截。新用例在修复前失败（`ok` 为 false），在 0.119.0 上也失败（没有实际拦截那一段）。
  - M4（修代码，先写失败用例）：`fresh` 前面没有词边界，`/claudemd-refresh so subagents` 被当成评审步骤。加 `\b`；代码注释和 CHANGELOG 改成"整份文件里出现就算，教训里的也算"。新用例在修复前失败。
  - L1、L3、L4（CHANGELOG 写给用户的话，改）：跨行的反引号 CLI 与 hook 仍可能不一致；`work/pass`、`robust.and` 这类形状也被剥掉；只有小写扩展名的文件名被剥掉（沙箱复现：`-F msg-robust.txt` 放行，`.TXT` 拒绝）。
  - L2（hook 注释，随本轮一起改）：剥离后的空格会把两侧的词连起来（`should`x`work`、`70%/p99 faster` 改后拒绝，`claudemd-cli lint` 也拒绝）。
  - L6：随 M3 的修复解决，`ok=false` 时又一定有候选列表，`commands/claudemd-doctor.md` 的说法重新成立。
  - L7：发布的代码注释引用了本地文档 `docs/claudemd-effect-assessment-2026-11-03.md`。使用者 11-03 定的是这份文档只放本地（文档第 10 节），所以不提交，两处代码注释改为引用已跟踪的 `tasks/specs/batch-residuals-2026-11-03.md`。
  - 修复提交 3e89c5c 改了代码，按手册新开评审，只审修复提交（深度 2/2）。
- 2026-11-09：第二轮评审（新开的评审代理，aa3dfd9..3e89c5c）：Critical 0、High 0、Medium 1、Low 7；三处代码修复成立，三个新用例在 aa3dfd9 上失败、在 3e89c5c 上通过。全是文字和测试覆盖，按手册不再开评审，自己跑 claim-drift：
  - M1（CHANGELOG"Not changed"、hook 两处注释）：条件比"here-doc 里引用 `git commit -m`"宽：命令里任何带引号的 `-m` / `--message` 值都会让提取器只扫这些值。沙箱复现：here-doc 之后跟 `git tag -a v1 -m "v1"`，或 here-doc 里写 `python3 -m 'venv'`，含 `significantly` 的说明都放行；去掉就拒绝。改写成这个条件。
  - L1、L2（hook 注释、CHANGELOG）：剥离后的空格让两侧的词连成会被拒绝的短语，不只是"两侧都粘住"；CHANGELOG 补上"也会新拒绝"这个方向（与 lint 一致）。CHANGELOG 不引用具体例子：双反引号里的反引号会被 lint 配对，例子会让条目自己扫出命中。
  - L4（README、`--help`、tmp-sweep.sh 头注释）：改成"本身是或含有另一个文件系统的挂载"，README 加上同文件系统 bind mount 识别不了。
  - L5（CHANGELOG）："列为 skipped"改成"其他条件都满足时列为 skipped"。
  - L6（测试）：加一个只有 `fresh-subagent` 连字符写法的夹具；把正则改成 `\bfresh\s` 的变异让它失败。
  - L7（测试注释和名字）：改成"对照组用的是别的词"，与"整份文件里出现就算"一致。
  - 不改，记为遗留：L3（3e89c5c 的提交说明把"会连起来"说成 CHANGELOG 也写了；已推送）。
- 不修，记为遗留（第一轮编号）：L5（同一文件两行索引时 `tags` 被覆盖、doctor 计数翻倍）；L8（§8：`npx --package=<包> ./路径` 和 `npm exec --package=<包> -- ./路径` 放行一个没钉版本的包，沙箱复现；`--package <包>` 拒绝；pre-bash-safety 在本范围内没有改动，属 F37 一族，是旧问题）；L9（`.5x`、`v1.8x`、`1,000.25x` 仍不完整引用，判定不变）；44fc93c、ed3d39f 等已推送提交说明里的不准确说法。
- 2026-11-09：第二轮修复（49459b8）后跑 `node scripts/claim-drift.js --range=288057d..HEAD`：列出的名字里，与本版改动有关的（banned-vocab-check、tmp-sweep、housekeeping、`--message`、runbook-review-check、sandbox-disposal-check）逐行重读，没有与 head 代码矛盾的说法。
- 2026-11-09：49459b8 的 PR CI 全绿后，`main` 快进到 49459b8 并推送，打带注释的 tag v0.120.0，建 GitHub Release；PR #33 显示 MERGED（22:05:42Z），远程 `release/v0.120.0` 已被 GitHub 删除，本地用 `git branch -d` 删除；`next-release` 快进到 49459b8 并推送。

## 验证记录

- `node scripts/version-cascade-check.js` → 通过（v8.5 三个文件一致；插件版本 0.120.0 五处一致）
- `node bin/claudemd-lint.js lint --file <单独取出的条目>` → 通过（OK: no §10-V hits，2,641 字节）
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1804/1807（3 个跳过）；shell 1784 条 PASS、0 条 FAIL
- `npm run smoke` → 通过：SMOKE 2/2
- `BASH32_BIN=<scratchpad 里编译的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过：44/44 个套件（3.2.57 在 `ubuntu:24.04` 里编译，源码包 sha256 与 ci.yml 一致）
- 第一轮修复：三个新用例（housekeeping"目录本身是挂载点"、doctor"0 个候选时保持通过"、runbook-review-check"refresh … subagents"）在修复前各自失败
- 第一轮修复 `npm run check`（`git add` 之后）→ 通过：exit 0；node 1807/1810（3 个跳过）；shell 1784 条 PASS、0 条 FAIL
- 第一轮修复 `npm run smoke` → 通过：SMOKE 2/2；bash 3.2.57 运行时 → 通过：44/44 个套件
- CHANGELOG 条目修改后 2,856 字节，单独扫描通过
- 3e89c5c 的 PR CI（run 42703108934）：被下一次推送取代，未看完
- 第二轮修复：CHANGELOG 条目 2,934 字节，单独扫描通过；L6 新夹具在 `\bfresh\s` 变异下失败，还原后 5/5
- 第二轮修复 `npm run check`（`git add` 之后）→ 通过：exit 0；node 1807/1810（3 个跳过）；shell 1784 条 PASS、0 条 FAIL
- 第二轮修复 `npm run smoke` → 通过：SMOKE 2/2；bash 3.2.57 运行时 → 通过：44/44 个套件
- 最终提交 49459b8 的 PR CI（run 42705744828）→ 通过：7/7
- tag 的 `ci`（run 42708678183）→ 通过：7/7；`main` 的 `ci`（run 42708649853）→ 通过
- tag 的 `npm-publish`（run 42708678231）→ 通过，`publish` job 打出 `+ claudemd-cli@0.120.0`（22:19:18Z）
- `npm view claudemd-cli@0.120.0 version _npmUser` → 通过：`0.120.0`，`GitHub Actions <npm-oidc-no-reply@github.com>`；dist-tags latest = 0.120.0（22:28:45Z 查询）
