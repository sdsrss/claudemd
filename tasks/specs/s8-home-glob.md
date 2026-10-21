# §8 闸门：`~/*` 与 `$HOME/*` 这类只有通配符的目标按裸变量拒绝
状态：已完成

## 背景与目标
`.converge/BACKLOG.md` 第 175 行：`rm -rf ~/*`、`rm -rf "$HOME"/*` 被 §8 闸门放行，而 `rm -rf ~`、`rm -rf "$HOME"` 被拒。回归语料把这两种放行标成 `pass`（corpus.tsv:57 "whitelist + glob"，自 v0.17.2；:92，自 941ecfd），所以它们是闸门有意的判决，改它是改判决（allow→deny），不是修实现与文档不符。

闸门自己的理由支持改：`hooks/pre-bash-safety-check.sh` 白名单分支的注释说，白名单只证明变量是 shell 设定的，不证明目标有界，所以要求残余里至少有一个非 `/` 字符；它举的例子是 Steam 事故 `rm -rf "$STEAM_ROOT/"*`（变量为空）。但 `*` 正是那次事故的形状，现在却被算成"有子路径"。两条理由在这里都成立：
- 变量为空时：`"$HOME"/*`、`$TMPDIR/*`（Linux 上 TMPDIR 常未设）展开成 `/*`。GNU rm 的 `--preserve-root` 只护 `/`，不护 `/*`。`~` 在 HOME 为空串时也展开为空（bash 行为）。
- 变量不为空时：`~/*`、`$HOME/*` 删掉家目录下全部非隐藏内容，与裸 `~` 的理由（"bare $HOME rms the entire home"）相同。

使用者 2026-10-21："需要我决定的，你深入思考给出科学准确的建议，然后按你的建议执行"（第 175 条在上一份汇报里列为要使用者决定的事项）。

目标：残余（去掉变量展开与引号后剩下的字面部分）只由 `/` 和 `*` 组成且至少有一个 `*` 时，按裸变量处理；`~` 后面只跟 `/` 和 `*` 时同样按裸 `~` 处理。其余判决一律不变。

## 范围
- 做：`hooks/pre-bash-safety-check.sh` 白名单分支与 F43 折叠的"裸"条件、`~` 分支的正则；拒绝文案说明通配符；语料改标与新增行；`tests/hooks/pre-bash-safety.test.sh`（若语料不由它驱动则加用例）；`docs/S8-RESIDUALS.md` 若提到这两种形状；CHANGELOG（迁移说明、退路）。
- 不做：`~/.*`、`$HOME/.*`（只删点文件，残余里有 `.`，属另一个判断）；`?`、`[…]` 通配；非白名单变量（已按未验证变量处理）；有选择条件的 find（`S8_FIND_BOUNDED`，与裸变量分支同样豁免）。

## 验收标准
- [x] AC1：`rm -rf ~/*`、`rm -rf "$HOME"/*`、`rm -rf $HOME/*`、`rm -rf ${HOME}/*`、`rm -rf "${HOME:?}"/*`、`rm -rf "$TMPDIR"/*`、`rm -rf "$PWD"/*`、`rm -rf ~/**`、`rm -rf ~/*/`、`find ~/* -delete` 被拒 — 验证：语料行 + `bash tests/hooks/pre-bash-safety.test.sh`
- [x] AC2：对照不变：`rm -rf ~/cache`、`rm -rf ~/.cache/*`、`rm -rf "$HOME/cache"`、`rm -rf $TMPDIR/claudemd-*`、`find ~/* -name '*.tmp' -delete`、`rm -rf ~*`（不是家目录） — 验证：同上
- [x] AC3：真实命令回放（transcript 里全部不重复 Bash 命令中含 rm/find 的子集），新旧钩子对比：deny→allow 为 0；allow→deny 每条逐一核对，只能是 AC1 的形状 — 验证：`tasks/s8-replay/replay_sha.py` + `cmp_sha.py`
- [x] AC4：只能 allow→deny（按构造）：改动只在"裸"条件里把 `*` 与 `/` 同等看待，满足新条件的目标走已有的拒绝分支 — 验证：读码 + AC3
- [x] AC5：发版说明有迁移说明与退路（单条命令用使用者的 `[allow-rm-rf-var]`，或写出字面子路径；整体回退按 docs/ROLLBACK.md） — 验证：发版前评审

## 方案
- 白名单分支：`[[ ! "$residue" =~ [^/] ]]` → `[[ ! "$residue" =~ [^/*] ]]`，F43 折叠条件同改（两处必须一致，否则 `${HOME:?}/*` 折叠不到 HOME 分支）。为什么只能 allow→deny：新条件成立 ⊇ 旧条件成立；新增成立的情形全部走 HOME/PWD/OLDPWD/TMPDIR 分支里已有的拒绝；新条件不成立时旧条件也不成立，路径与以前相同。
- `~` 分支：`'^~/*$'` → `'^~(/[/*]*)?$'`。`~*` 不匹配（bash 里 `~*` 是用户名为 `*` 的波浪号前缀，查不到时保持字面，匹配当前目录下以 `~` 开头的文件，不是家目录）。
- 文案（发版前评审后定稿，db827e7）：rm 的情形说"变量后面只有 `*` 与 `/`，没有写出它下面的子路径，白名单只认写出的子路径；写出子路径"，`~` 的情形另给 `./~`（名字就叫 `~` 的目录）的出路；find 沿用裸变量的文案（要求加选择条件）。初稿说"匹配它下面的全部内容"，对 `"$HOME"*`（家目录本身和同级目录）、带引号的字面 `*`、`${HOME:?}`（不会为空）都不成立。
- 版本：已发布工件的默认判决变化（allow→deny）→ L3、非补丁版本号（0.115.0）、CHANGELOG 迁移说明与退路、发版说明醒目处写明。

## 计划
- [x] S1：语料改标与新增行（红）
- [x] S2：两处条件 + `~` 正则 + 文案（绿）；bash 3.2 下跑该套件（本机无 3.2 二进制：静态检查 bash32-constructs 通过，运行时由 CI 的 macOS 腿跑 /bin/bash 3.2.57）
- [x] S3：真实命令回放（AC3）
- [x] S4：CHANGELOG 段落，随 0.115.0 发版前评审

## 决策与进展
- 2026-10-21：频率。`tasks/s8-replay/extract.py` 抽出 105,658 条不重复真实 Bash 命令；以 rm/find 目标为 `~` 或 HOME/TMPDIR/PWD/OLDPWD 后跟只有 `/` 与 `*` 的正则计数：HOME 1 条、`~` 1 条，两条都不是任务操作（一条是编辑 BACKLOG.md 的脚本引用了这个形状，一条是闸门探针）；TMPDIR/PWD/OLDPWD 0 条。改判的误拒成本按这批数据为 0 条；拦住的是删除整个家目录或 `/*`。

- 2026-10-21：实现 17c036a（分支 wip/s8-home-glob，基于 7a2b6c8）。改前 14 条拒绝行失败、6 条对照通过；改后套件 1195/1195。拒绝文案：rm 的 glob 情形说"只有 * 与 / 的子路径匹配它下面的全部内容（变量为空时是 / 下面的全部内容），写出字面子路径"；find 沿用裸变量的文案。实现时仓库里除本文件外没有别处提到这两种形状；评审后 docs/S8-RESIDUALS.md 的 F20、F22、F24–F26 登记了相关形状。
- 2026-10-21：回放：21,791 条含 rm/find/unlink/shred 的真实命令，旧（7a2b6c8）新（17c036a）两版钩子 `git archive` 快照各跑一遍（P=8，`tasks/s8-replay/replay_sha.py`）：两版都是 allow 20,339 / deny 1,452，`cmp_sha.py` 判定翻转 0、输出字节差异 0。对照：同一套脚本跑 `rm -rf ~/*`、`rm -rf "$HOME"/*`、`rm -rf ~/cache`、`ls`，前两条 allow→deny，后两条不变，说明回放看得见这次改动。频率统计里那 2 条命中是闸门测试文本（Python 字符串、探针脚本里的变量），不是 rm 的目标，所以不翻转。
- 2026-10-21：随 0.115.0 发版（整合分支 integrate/0.115.0）。

- 2026-10-21：发版前评审第 1 轮（hooks 与脚本两个评审）：本组件 1 个 M（`?`、`[…]` 等价通配可绕过，评审建议登记不打补丁）与 L（文案对部分形状不对、文案没有测试钉住、注释过时、F20/F22 的新形状）。修复 db827e7：改文案并以 4 条拒绝原因行钉住（初稿文案下 3 条失败）；登记 F24（xfn）、F20 加两条（xfp）、F22 加一条（xfn）。判定未动：套件 1206/1206。
- 2026-10-21：第 2 轮（新开，只看修复范围）：0C/0H/0M，本组件 L：带引号的字面 `*` 拿到"没有子路径"的文案不成立（F20 误拒，出路是不经变量写出完整路径）；`find ~/? -delete` 不等价于 `*`（改为放行对照，F24 换成 `find ~/?* -delete`）；花括号展开（`~/{a,}`）与 `~/.*` 未登记（登记为 F25、F26）；本文件方案节仍是初稿文案；F20 的真实命中格没更新。全部按文字与语料修，不再开评审。

- 2026-10-21：随 0.115.0 发布。fd0c6f0 快进到 main，tag v0.115.0（带注释），GitHub Release 已建，PR #15 合并；npm `+ claudemd-cli@0.115.0`（09:10:26Z），dist-tags.latest 为 0.115.0（09:17:28Z）。

## 验证记录
- 回放 `cmp_sha.py all.json old.json new.json` → 通过（compared 21791，verdict flips 0，stdout/rc differences 0）
- `bash tests/hooks/pre-bash-safety.test.sh`（改前）→ 失败（1181/1195，14 条新拒绝行）
- `bash tests/hooks/pre-bash-safety.test.sh`（17c036a）→ 通过（1195/1195，Residuals: xfn=61 xfp=14）
- `npm run lint`（工作树）→ 通过（exit 0）
- `bash tests/lib/bash32-constructs.sh` → 通过
- `bash tests/hooks/pre-bash-safety.test.sh`（9f5e7ef 起）→ 通过（1212/1212，Residuals: xfn=71 xfp=16）
- `npm run check`（aa00336）→ 通过（node 1643/1644，跳过 1；shell 套件全过）
- PR CI 39566119854（aa00336）、39568539254（fd0c6f0）→ 通过（7/7）
- tag CI 39571046650、main CI 39571040787、npm-publish 39571047089（fd0c6f0）→ 通过
- `npm view claudemd-cli dist-tags.latest` → 0.115.0
