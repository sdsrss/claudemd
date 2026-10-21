# doctor：fail-open 修好后可以确认清零（`--ack-fail-open`）
状态：已完成

## 背景与目标
`/claudemd-doctor` 的 `hook-fail-open` 行：30 天窗口里只要有一条"先决条件缺失"类的 fail-open 记录（jq 不在、patterns 文件读不了、状态目录写不进等），这一行就红、doctor 退出 3。使用者按提示修好之后，这一行仍然红满 30 天，doctor 的退出码在这段时间里不再反映现状（0.113.3、0.113.4 的 CHANGELOG "Not changed"；backlog 第 75 行）。

使用者 2026-10-20："遗漏的工作按你的建议执行"。我上一轮的建议是：加一个"使用者确认已处理"的标记让这一行转绿，不为十几种原因各定义一个"已恢复"判据。

目标：修好之后有一条明确的命令让这一行转绿；问题没修好时它自己会重新变红；默认行为（不加新参数时的判定、退出码）不变。

## 范围
- 做：`scripts/doctor.js` 新参数 `--ack-fail-open` 与判定；`commands/claudemd-doctor.md`、README、`docs/ARCHITECTURE.md` 的用法；测试；CHANGELOG；发 0.114.0。
- 不做：按原因自动判断是否恢复；改 fail-open 的分类（bad-event / 无从判定 / 先决条件缺失三类不变）；改别的检查。

## 验收标准
- [x] AC1：有未确认的红类记录时，`--ack-fail-open` 写下确认文件（列出被确认各行的 ts、hook、原因），同一次输出里这一行为绿，并写明这次新确认了几条 — 验证：`node --test tests/scripts/doctor.test.js`（ack-fail-open 用例）
- [x] AC2：确认之后再出现一条红类记录，这一行重新变红，并同时报出已确认的条数 — 验证：同上
- [x] AC3：没有可确认的记录（没有红类，或都已确认）时不写文件，输出说明原因 — 验证：同上
- [x] AC4：确认文件损坏或读不了时视为没有确认（红的照红） — 验证：同上
- [x] AC5：确认文件写不进时 doctor 退出 1 并说明原因；不加参数时的判定与退出码与 0.113.4 相同 — 验证：同上 + 现有 `doctor.test.js` 的 fail-open 用例不改仍通过
- [x] AC6：命令页、USAGE、README、ARCHITECTURE 说的与代码一致；命令页写明只在使用者确认原因已修好后才用 — 验证：`npm run check`（含 exit-code-doc-drift 等闸门）+ 发版前评审

## 方案
（2026-10-21 第三版。前两版用"确认时刻"做判据，两轮评审的 3 个 Medium 都出在时刻比较与原地写入上，见决策节。）
- 确认文件：`<stateDir>/fail-open-ack.json`（`stateDir` 即 `~/.claude/.claudemd-state/`，可被 `CLAUDEMD_STATE_DIR` 改），内容 `{"acknowledged":[[ts, hook, reason], …]}`：被确认的每一条先决条件缺失类记录一项，三部分照日志原样。
- 判定：窗口内每条先决条件缺失类记录按日志顺序比对；文件里有与它三部分完全相同、且还没被用掉的一项 → 已确认，用掉那一项；否则未确认。按计数比对（多重集合），因为写不进节流标记的 hook 每次运行都记一行，同一秒同一原因可能有两行，确认其中一行不能顺带确认另一行。读写两边都不看任何时钟。
- 结果：有未确认的 → 红（与 0.113.4 一样），说明里加上已确认的条数；全部已确认 → 绿，说明"都已确认，之后记下的任何一条会重新变红"。文件读不了、解析不了、没有 `acknowledged` 数组、不是普通文件（先 lstat，FIFO 不会卡住，符号链接不跟随）→ 全部算未确认。
- 为什么安全：先决条件没修好时，hook 下一次记录时写的新行不在文件里，这一行立刻重新变红；确认只能藏住它当时列出的那几行，时钟超前、回拨、手改文件里的时间都扩大不了这个范围。代价：确认之后、受影响的 hook 下一次记录之前，doctor 是绿的（状态目录可写时，hook 每个原因每分钟最多记一行）。
- `--ack-fail-open`：判定之前，若有未确认的行，写确认文件：列出窗口内全部先决条件缺失类记录（之前已确认、仍在窗口内的保留；已出窗口的去掉），然后这一次的结果按新文件出（转绿）。写法：先写 `<路径>.<pid>`，再 rename 到路径上——符号链接、FIFO 被替换而不是穿过；路径上是目录时 rename 报 EISDIR；任何失败都删掉临时文件。输出加顶层字段 `failOpenAck`：写了是 `{written:true, acknowledged:<这次新确认的条数>}`，没写是 `{written:false, reason}`。写不进时抛错，CLI 退出 1，消息带路径与错误码。
- USAGE 的"只读，只有一个例外"改为"两个参数之外只有一个例外"；Exit codes 的 1 写明包括确认文件写不进。
- 红行的说明加一句：修好后用 `/claudemd-doctor --ack-fail-open` 确认，没被确认的 fail-open 会让它重新变红。命令页写明：只在使用者说原因已修好之后运行，不要为了让检查变绿自己去跑；退出 1 时看消息末尾的错误码（EACCES/EROFS 是状态目录不可写，本身就是 fail-open 的一个原因）。
- 卸载：`CLAUDEMD_STATE_FILE_RE` 认 `fail-open-ack.json` 与 `fail-open-ack.json.<数字>`；clean-residue 两者都不收。
- 版本：新增 CLI 参数（向后兼容的契约变化），不加参数时判定不变 → 0.114.0（minor）。规范不变（v8.2.0）。

## 计划
- [x] S1：测试（红）：ack 写入与转绿、确认后新行转红、无可确认不写、坏文件按未确认、写不进退出 1、不加参数行为不变
- [x] S2：实现 + USAGE + 红行说明（绿）
- [x] S3：命令页、README、ARCHITECTURE
- [x] S4：CHANGELOG、版本号、`npm run check`、PR CI、发版前评审、tag、release

## 决策与进展
- 2026-10-20：`/tmp/claudemd-sync-*` 先查过：是 `hooks/version-sync.sh:50` 每个会话一个的 0 字节哨兵，`:57` 删除 24 小时前的，按设计如此，不是残留。

- 2026-10-20：实现 25d80cc（先写 5 个用例，4 个改前失败；坏文件那条是对照，改前改后都过）。`npm run check` 随后在四个闸门上失败，都是"新的状态文件要登记"：ARCHITECTURE 的 State locations、uninstall 的 `CLAUDEMD_STATE_FILE_RE`（及其变异对照）、jsonl-null-row 的 JSON.parse 声明、USAGE 里路径后的句号被当成第二个文件名。f1a89e6 补齐；沙箱里 `CLAUDEMD_PURGE=1` 卸载时，标准状态目录整个删掉，非标准目录只删 fail-open-ack.json、保留无关文件。
- 2026-10-20：backlog 复核（子代理）：131c、141b、160（两项）、163、167、169、174（两项）、177 仍是缺陷并有复现；171、172、173、175 剩下的不是缺陷。这些不并进 0.114.0（避免扩大这一版的评审面），列入汇报作为下一批。

- 2026-10-20：发版前评审第 1 轮（一个全新评审，a66c6c1..884cc6c）：0C/0H/1M/8L。
  - M1：`ackedAt` 晚于现在（时钟曾超前、手改）会藏住之后所有 fail-open，而且 `--ack-fail-open` 看不到待确认的行、修不回来。修：读的时候晚于现在的 ackedAt 算没有确认；写的时候 ackedAt 取被确认的最新一行自己的 ts（不取墙钟），并且只确认 ts 不晚于现在的行（L1、L3 同根）。
  - L1：行的 ts 是整秒，墙钟毫秒的 ackedAt 会藏住确认后 1 秒内写的行；读日志和写确认之间别的会话追加的行也会被确认——改用最新一行的 ts 后两者都不成立，剩下"同一秒的行一起确认"写进 CHANGELOG。
  - L2：hook_record_failopen 每个 hook×原因 60 秒最多记一行，"下一次运行就写新行"不准确；页面、README、CHANGELOG、注释改成"下一条记录下来的"并写明一分钟。
  - L3：ts 晚于现在的行，旧代码写 acknowledged:1 但其实藏不住；现在这种行不确认，全是这种行时不写文件并说明原因。
  - L4："ts 解析不了的行算未确认"基本空洞（readHits 先丢掉了），从 CHANGELOG 删掉，注释写明只有数字 ts 会走到这里。
  - L5：评审者的 5 个存活变异，加用例后连同新守卫共 8 个变异各让至少 1 个用例失败。
  - L6：确认文件位置是 FIFO 时 doctor（不加参数）也会卡死；现在先 lstat，只读普通文件。
  - L7：本文件的验证命令写错了测试文件名，已改。L8：页面补上退出 1 时怎么说。
  - 修复改了代码，按 runbook 要第 2 轮评审（新开，只看修复范围）。

- 2026-10-20：第 2 轮评审（新开，884cc6c..34173aa）：0C/0H/2M/9L。
  - M2-1：未来时刻的 ackedAt 到点后重新生效，藏住这段时间里记下的 fail-open，不需要任何人再跑参数；时钟超前时本版自己就能写出这种文件（hook 的行 ts 也超前，ackedAt 取的是它）。读码确认：`readFailOpenAckMs` 只比较"现在"。
  - M2-2：确认文件位置不是普通文件时 `--ack-fail-open` 换不掉它：FIFO 上写入卡死，目录报 EISDIR，符号链接会把内容写到状态目录外。读码确认：写入是普通 `writeFileSync`。
  - L：两处计数/时刻没有用例区分（covered 与 pending 混用的变异存活）、lstat→stat、mkdir、typeof 三个守卫无用例、数字 ts 时的原因文字错、"同一次运行转绿"在有未来行时不成立、`--help` 没随修复更新、"一分钟一行"在状态目录不可写时不成立（那时不节流）、页面退出 1 的说法在 EISDIR/EACCES 时指错原因、本文件方案节仍写旧设计、同一秒之外还有 hook 在两次 jq 之间停顿超过 1 秒的竞态（只读码）。
  - 按组件归因：两轮的 3 个 M 都在确认文件的时刻比较与写入上；这个组件就是本版的全部收益，撤回等于不发版。
  - 根因：用时间做确认的判据，跨时钟调整不成立；在固定路径上原地写，遇到非普通文件就出错。可行的改法（未实现）：确认文件改存被确认各行的指纹（ts+hook+原因，只留窗口内的），一行是否已确认看指纹是否在集合里，不再比较时间；写入改为写临时文件再 rename（rename 会替换符号链接与 FIFO 而不是穿过它们，目录则报错）。这是第三次设计，按 runbook 深度上限 2 交给使用者决定。
  - 现状：release/v0.114.0 草稿 PR #14 未合并、未打 tag；`main` 与 npm 仍是 0.113.4；本地 next-release 上有 25d80cc、5a8c124（版本号）、f1a89e6、884cc6c，未推送。

- 2026-10-21：使用者选 A（"选a,把剩下能做的都做了后发版"）。5adebf6 按上面的方案重做：确认文件存被确认各行的 [ts, hook, reason]，按计数比对，不比较时钟；写入走临时文件 + rename。12 个用例替换旧的，在旧设计上 9 个失败（FIFO 那条卡到 60 秒超时），另 3 个（无可确认、状态目录不存在、退出 1）是旧设计已满足的对照。12 个变异（集合代替计数、stat 代替 lstat、去掉 mkdir、直接写不 rename、只写新行、计数用总数、不删临时文件、比对去掉三部分之一（3 个）、不在同一次转绿、去掉"无可确认不写"）各让至少 1 个用例失败。卸载的 purge 用例加上确认文件、`.4242` 临时文件和使用者的 `.bak`（改正则前失败：`purge left claudemd's own fail-open-ack.json.4242 behind`）。按 runbook，这是改了代码的修复，要重新走评审（新开，看修复范围）。
- 2026-10-21：backlog 那 8 条缺陷不并进 0.114.0，单独发 0.114.1：每一版的评审范围小，出问题时归因清楚；代价是多一轮 CI 与评审。

- 2026-10-21：第 3 轮评审（新开，按新设计看整个发版范围 a66c6c1..7a2b6c8）：0C/0H/2M/8L。
  - M1：hook_record_failopen 的节流标记若写于时钟超前时（标记时刻在未来），`now - last` 为负，被当成"一分钟内刚记过"，之后该 hook×原因的 fail-open 一律不记，直到时钟追上标记——确认之后一个没修好的原因在这段时间里保持绿，正是本版设计针对的时钟场景。修：标记时刻晚于现在算过期（hooks/lib/hook-common.sh），fail-open.test.sh T24（修前失败：rows=0）。
  - M2：只在比对时去掉 ts 或 hook 的变异（写入的文件仍是三部分）12 个用例全过：用例里被确认的行与变体并排，计数比对仍能用掉一项。补一个用例：被确认的行不在日志里，变体单独一行。之后 15 个变异（含 3 个只改比对）各让至少 1 个用例失败。
  - L1：绿/红行与 --help 说"任何 fail-open 会让它重新变红"，实际只有 live-environment（先决条件类）会。改文案。
  - L2："每个原因每分钟一行"应为"每个 hook×原因"。L3："不加参数时与 0.113.4 相同"只在没写过确认文件时成立。L4：确认写不进时同一次的 --prune-backups 也不执行。L5：状态目录位置是普通文件时报 EEXIST，页面没说。L6：文件跟随 CLAUDEMD_STATE_DIR，页面/--help/CHANGELOG 只写了默认路径。L7：页面的原因列表漏了 transcript-missing、event-fields-missing 等，后两者本地设置修不好。L8：AC1 仍要求写确认时间。全部按文字修。
  - 修复改了代码（hook-common.sh 一行、doctor.js 文案），按 runbook 第 4 轮新开评审只看修复范围；这是使用者同意的"两轮评审"里的第二轮。

- 2026-10-21：第 4 轮评审（新开，只看修复范围 7a2b6c8..aac4226）：0C/0H/0M/6L。M1、M2 的修复核实成立（T24 在旧 hook-common 上 70/71；只在比对去掉 ts/hook 的变异只有新用例抓到）。
  - L1：hook 不读 CLAUDEMD_STATE_DIR（hook-common.sh:487 写死 `$HOME/.claude/.claudemd-state`），页面把 doctor 的状态目录和 hook 的混为一个。L2：`CLAUDE_CONFIG_DIR`、不写会话记录的会话也会产生 transcript-missing，"本地设置修不好"不全对；原因持续时确认没有用，页面没说。L4：CHANGELOG 说页面解释"每个"错误码，说多了。L5：升级说明没提 hook 修复会让 0.113.4 吞掉的行出现；小节的提交列表漏了 c412116、6d6b0fa。L6：T24 只测了提前一天，`now + 3600 >= last` 的变异存活。全部只改文字与测试：页面、CHANGELOG 改写；加 T24b（提前 30 秒），它在旧条件和该变异下都失败。
  - L3（范围之前就有）：docs/RULE-HITS-SCHEMA.md:69 把 transcript-missing、event-fields-missing 写成建议级，与代码相反；0.115.0 的 177 修复已改正，本版不动。
  - 文字与测试修复不再开评审，按 runbook 做 claim-drift。评审到此结束（使用者同意的两轮）。

- 2026-10-21：发布 0.114.0。cd68796 快进到 main，tag v0.114.0（带注释），GitHub Release 已建，PR #14 合并；npm `+ claudemd-cli@0.114.0`（07:20:22Z），dist-tags.latest 为 0.114.0（07:22:06Z）。

## 验证记录
- `node --test tests/scripts/doctor.test.js`（13 个 ack-fail-open 用例，在 cd68796 的全量检查里）→ 通过
- `bash tests/hooks/fail-open.test.sh`（含 T24、T24b）→ 通过（72/72）
- `npm run check`（cb07cf8，与 cd68796 只差 CHANGELOG 正文）→ 通过（node 1617/1618，跳过 1；shell 套件全过）
- PR CI 39555722080（cd68796）→ 通过（7/7）
- tag CI 39557692211、main CI 39557687720、npm-publish 39557692215（cd68796）→ 通过
- `npm view claudemd-cli dist-tags.latest` → 0.114.0
