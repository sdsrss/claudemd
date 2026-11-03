# 0.119.0：spec v8.5.0（代理临时残留）与 agent-tmp-* 自动回收的发版

状态：已完成

## 背景与目标

- 使用者 2026-11-03 说"把剩下能做的工作做了，然后发版"。
- 本批内容：
  - spec v8.5.0（Agent temp residue，设计记录 `tasks/specs/agent-temp-residue-2026-11-03.md`，使用者 11-03 已批准）；
  - `housekeeping.js tmp` 的 `agent-tmp-*` 回收，以及 tmp-sweep 的提示文字（07737a3，评审修复轮改了前缀）；
  - 五处版本号与 CHANGELOG。
- `release-reviewer` 的临时目录前缀（5e2695f，评审修复轮改为 `agent-tmp-rrev-`）在 `.claude/agents/`，不随插件发布，只是落在这段提交范围里。
- 发版节奏：按 11-02 定的规则，这批不属于必须立即发的类别；使用者明确要求现在发。

## 范围

- 做：版本号；CHANGELOG 条目（≤3,000 字节）；设计记录里 rebase 之后的提交号；按发版手册发布。
- 不做：
  - D#665（bash 3.2 watchdog）；
  - D#656（技能复扫）；
  - `~/.cache/tmp` 下 `d546`、`d558`、`d577-a5`、`d591` 的去留（归 claude-mem-lite 的会话）。

## 计划

- [x] S1：`next-release` rebase 到 main（5e2695f），切出 `release/v0.119.0`；五处版本号；CHANGELOG 条目单独扫描（2101 字节，OK）
- [x] S2：`git add` 后 `npm run check`，`npm run smoke`
- [x] S3：提交、推送、开 draft PR（#32）；f03fda9 的 PR CI 全绿（run 41647419898）
- [x] S4：发版前评审（新开的评审代理）两轮、修复轮（e72ba96、288057d）
- [x] S5：合入 `main`、带注释的 tag、GitHub Release；两条 tag 工作流、`npm view`、`_npmUser`（tag v0.119.0 在 288057d）

## 决策与进展

- 2026-11-03：rebase 之后，`next-release` 上的提交号从 1a34726 / f1ddc21 / 747b7c1 变为 07737a3 / 1613b31 / 46945e8；设计记录里的提交号已按新号改正。

- 2026-11-03：第一轮评审（新开的评审代理，e85aea0..f03fda9）：Critical 0、High 1、Medium 4、Low 8。逐条处理见设计记录。修复改了代码（H1、M1、M3），所以要新开一个评审，只审修复提交（深度 2/2）。已推送的 07737a3、1613b31 的提交说明里有旧前缀和旧数字，不改，以 CHANGELOG 为准。
- 2026-11-03：第二轮评审（新开的评审代理，只审修复提交 f03fda9..e72ba96）：Critical 0、High 0、Medium 1、Low 6。代码层面没有阻断问题。修复全是文字，按手册第 7 步走 claim-drift，不再开评审（深度 2/2）：
  - M1：核心 §8.V4 的"其余一律 §5 Hard"与 §5 Soft 的安全路径矛盾，改为"§5 safe-paths 之外"。
  - L3：0.6 GB 那句改为"没被未关闭的延期项引用"。
  - L4："回复的 3 条都批准"改为"没有一条回复是拒绝"。其中一条回复（d370，"按你建议执行"）可能是在答同一份汇报里的另一个问题；"其余 5 条一直留着"删掉，因为其中 4 个目录后来已经删了。
  - L5：§8.V4 标成"in short"并补上"不是符号链接"；hook 提示写明"满足 Agent temp residue 的每一条"并列出全部条件。
  - L6：CHANGELOG 写明 sandbox-disposal-check 只扫 `/tmp`、`/var/tmp`、`~/.claude/tmp`。
  - L7：CHANGELOG 写明 `aggressive` 下不用事先说明。
- 2026-11-03：e72ba96 的 PR CI（run 41652259310）在 macOS node 22 上失败，失败的是"里面有 socket 就不删"这一条用例。原因在测试夹具：runner 的临时路径长 129 字节，超过 macOS unix socket 路径 104 字节的上限，`listen` 没报错，socket 却没建在目录里，扫描自然看不到它。在 Linux 上把 `TMPDIR` 设成 139 字节就能复现（旧夹具报 `listen EINVAL`）。修法：先 `chdir` 进目录，用相对名 `s` 来 `listen`，并在扫描前断言 socket 确实在目录里。修复后，长、短两种 `TMPDIR` 下 `housekeeping.test.js` 都是 113 通过、1 跳过；去掉 socket 判断的变异仍然让这条用例失败。只改了测试，不需要再开评审。
- 遗留（不在本版修）：
  - 第二轮 L1：e72ba96 的提交说明写"10 个新用例在修复前失败"。按评审的数法，在 f03fda9 的脚本上是 114 个用例里 11 个失败、102 个通过；13 个新名字的用例里 5 个失败，其余 8 个在旧代码上也通过（旧正则不匹配 `agent-tmp-*`），但在新代码上都能被变异检验打红。提交已推送，不改，以本记录为准。
  - 第二轮 L2：复查遍历完一个目录之后、`rmSync` 之前写进去的文件，会被一起删掉。窗口和一次遍历一样长；f03fda9 的代码就是这样，vitest 那一类也一样。
  - L7：几个 sweep 并发时会把别人删掉的条目算成自己的失败（ENOENT，exit 3），删除数也会重复计算。vitest 那一类原来就是这样。
  - L8：属主只检查顶层目录；`rmSync` 会进入目录里的挂载点。这台机器上没有 root，没法写测试。

## 验证记录

- `node scripts/version-cascade-check.js` → 通过（v8.5 三个文件一致；插件版本 0.119.0 五处一致）
- `node bin/claudemd-lint.js lint --file <单独取出的条目>` → 通过（OK: no §10-V hits，2101 字节）
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1786/1789（3 个跳过）；shell 1771 条 PASS、0 条 FAIL
- `npm run smoke` → 通过：SMOKE 2/2
- 修复轮 `npm run check`（`git add` 之后）→ 通过：exit 0；node 1796/1799（3 个跳过）；shell 1772 条 PASS、0 条 FAIL
- 修复轮 `npm run smoke` → 通过：SMOKE 2/2
- 修复轮变异检验：前缀改回包含 `cc-`、去掉顶层 ctime、去掉内部 ctime、去掉 socket 判断、去掉 FIFO 判断、时钟接口不设门禁、`--min-age-minutes` 传到 agent 扫描，每个都至少让 1 个用例失败
- 修复前后：`tmp-sweep.test.sh` 在修复前的 hook 和脚本上 17/20（8c、12、13 失败），修复后 20/20；`sandbox-disposal.test.sh` 用例 30 修复前失败，修复后 30/30；`housekeeping.test.js` 新用例在修复前的脚本上失败 10 个，修复后 113 通过、1 跳过
- 最终提交 288057d 的 PR CI（run 41657087398）→ 通过：7/7
- `git merge --ff-only` 到 main 并推送（288057d）；带注释的 tag v0.119.0 已推送；GitHub Release v0.119.0 已创建；PR #32 显示 MERGED（2026-11-03T15:08:33Z）
- tag 的 `ci`（run 41660806138）→ 通过；`npm-publish`（run 41660806059）→ 通过，`publish` job 打出 `+ claudemd-cli@0.119.0`（15:38:20Z）
- `npm view claudemd-cli@0.119.0 version _npmUser` → 通过：`0.119.0`，`GitHub Actions <npm-oidc-no-reply@github.com>`（15:39:31Z 可见，publish 后约 70 秒）；dist-tags latest = 0.119.0
