# 0.120.1：§8 npx 闸门检查 `--package=` 和第二个 `-p` 指名的包；0.120.0 遗留项的处理

状态：已完成

## 背景与目标

- 0.120.0 发版前评审第一轮 L8（延期项 D#750）：`npx --package=<包> ./路径`、`npm exec --package=<包> -- ./路径` 放行一个没钉版本、本地也没有的包；空格写法 `--package <包>` 拒绝。
- 2026-11-09 使用者说"遗留的工作，深入思考，给出科学准确的建议，然后按你的建议执行"。
- 目标：按 §8 NPX 规则（lockfile → 本地 → 钉版本，都不满足就拒绝），`--package` / `-p` 指名的每个包都按 `--package <包>` 的现有规则检查；原来被检查的那个词照旧检查，判定只会从放行变成拒绝。

## 测量（2026-11-09，本机现存转录 10-11..11-09，741 份，91,102 条不同的 Bash 命令；排除本会话）

- 调用 npx 一族的命令 3,784 条。
- 带 `--package=` 的真实命令 2 条，都是 gsd-lite 装自己打的本地包：`npm exec --yes --package="file://$SP/gsd-lite-0.17.0.tgz" -- node -e …`（10-21）和 `npm exec --yes --package="file:$N/enginepkg-1.0.0.tgz" -- enginepkg`（11-02，子代理）；0.120.0 已因 `--` 之后的 `node`、`enginepkg` 拒绝。（第一次只数出 1 条：截命令片段的正则取到了第二条前面散文里的 "npx"，把它当成了噪音；发版前评审 M1 指出。）
- 同一个运行器段里有两个及以上 `-p` / `--package` 的：0 条。
- 读代码找到的同类漏洞：`npx -p <钉版本的包> -p <来源不明的包> <命令>` 放行（循环在第一个 `-p` 的值处停下）；`pnpm dlx` / `yarn dlx` / `bunx` 的 `--package=` 同样放行；`--package=` 的值是远程地址（`https://…tgz`、`github:…`、`git+https://…`）也放行，而空格写法这些都拒绝。
- npm 11.19.0 的 `bin/npx-cli.js`：第一个不以 `-` 开头的词（或 `--`）之前都是 npm 的参数；`-p`、`-p=`、`--package`、`--package=` 都是 `--package`，可以重复；之后的词交给要运行的命令。

## 范围

- 做：
  - `hooks/pre-bash-safety-check.sh`：另走一遍同一段词，收集第一个不以 `-` 开头的词之前（`--` 当作参数跳过）所有 `-p X`、`--package X`、`-p=X`、`--package=X` 的值；原来的 `pkg_token` 不变，收集到的其他值逐个过同一套判定（本地路径 / 钉版本 / lockfile 或 node_modules），任何一个拒绝就拒绝。`--no-install` / `--no` 照旧使所有包放行。
  - 语料行（拒绝、对照、已知误拒）、带 cwd 的用例、`docs/S8-RESIDUALS.md` F37 的说明、CHANGELOG 条目。
  - 按发版手册发 0.120.1（发版节奏：§8 漏拒属立即发版的 (a) 类）。
- 不做：
  - F37 的带值参数（`--cache ./c`、`--userconfig ./x` 后面的包不检查）：要给每个运行器建带值参数表，是一次新的切词；按 D#737 在 11-30 复数时再定。
  - `file:` 本地包规格：空格写法 `-p file:./x.tgz` 已经拒绝（误拒）；新写法沿用同一套判定，也拒绝。改成放行是拒绝变放行，与本次漏拒修复分开处理，登记进 F37。
  - 0.120.0 遗留 L5（同一记忆文件在索引里两行）：10 个 MEMORY.md 里 0 处，登记不改。
  - 0.120.0 遗留 L9（`.5x`、`v1.8x`、`1,000.25x` 引用不完整）：判定不变，只影响拦截理由里引用的文字；10-11..11-09 日志里倍数拦截 3 次（`21x slower`、`2x slower`、`8x slower`），登记不改。
  - `spec/CLAUDE-extended.md` §5-EXT tmp 回收条件没写挂载点：随下一次 spec 改动修，记延期项。
  - 已推送提交说明里的不准确说法：不改写历史。

## 计划

- [x] S1：先写失败用例（语料行 + 带 cwd 的用例），在 0.120.0 的 hook 上确认失败
- [x] S2：改 hook；`--package` 语料行全绿；F37 说明
- [x] S3：真实命令新旧回放（`git archive` 取 v0.120.0 和新 hook），分别数放行变拒绝、拒绝变放行
- [x] S4：版本号、CHANGELOG 条目；`npm run check`、`npm run smoke`、bash 3.2.57 运行时
- [x] S5：release 分支、draft PR、PR CI；发版前评审
- [x] S6：合入 `main`、tag、GitHub Release、tag 工作流、`npm view`
- [x] S7：`next-release` 快进；本记录收尾；延期项 D#750 关闭，spec 挂载点条件记延期项

## 决策与进展

- 2026-11-09：L8 选择立即修复发版而不是只登记。理由：修法不需要新的切词（`-p` / `--package` 本来就在闸门的参数表里，只是漏了 `=` 写法和重复出现），能做到只加拒绝；使用者还没装 0.120.0（本机仍是 0.119.0，日志里 0 行 0.120.0），一次 `/claudemd-refresh` 同时装上两版。
- 2026-11-09：PR CI（dd2a676，run 42762062099）7/7 通过。
- 2026-11-09：发版前评审（新开的评审代理，49459b8..dd2a676）：Critical 0、High 0、Medium 1、Low 7；声明 1–8 在代码上成立，评审者重跑回放得到同样的 461/461、0/0（不同 Bash 命令 91,140 条，回放 7,974 条，转录新增所致）。逐条核实后处理：
  - M1（改文字）：`--package=` 的真实命令是 2 条，不是 1 条，两条都是 `file:` 本地包，正是 F37 新登记的（3）误拒形状。改 F37 真实命中一格和本记录测量一节；两条在两版上都被拒，判定不变。
  - L1、L2、L3（改本记录）：探针数 15 条；修复前的数字重跑并写明两次运行的差别；范围一行改成"第一个不以 `-` 开头的词之前，`--` 当参数跳过"，与代码、hook 注释、CHANGELOG 一致。代价：`npm exec -- --package=<包> ./bin`（`--` 之后的 `--package=` 其实是命令名）新增误拒，形状没有真实用法，接受。
  - L4（补测试）：收集循环里 `-c` / `--call` 跳过取值、`-p=` 两支没有用例，去掉任何一支测试仍全绿。加 `S8-NPXP24`（`-p=` 之后的 `-p`）、`S8-NPXP25`（`-c` 的值之后的 `-p`）；各自在对应变异体上变红，在 0.120.0 上失败。
  - L5（登记）：`npm exec --package=localpkg -- eslint && npx localpkg` 写两行相同的 `npx-allow-local`（去重键带运行器，行里不带）；成因在 0.120.0 就有（`npm exec localpkg && npx localpkg` 已写两行），本版让 `--package=` 也走到这里。`docs/RULE-HITS-SCHEMA.md` 的说法与代码一致，CHANGELOG 没有相关说法。不改。
  - L6（改 CHANGELOG）：评审者构造的 1,500 个 `-p`、15,400 字符的命令，在有三种 lockfile 的目录里，0.120.0 133 ms 拒绝，dd2a676 超过 3 秒被杀（按放行算），属 E3。CHANGELOG"旧版拒绝的仍拒绝"补上"除非多出的检查让很长的命令超过 3 秒限制（E3）"。
  - L7（改 CHANGELOG 措辞）：`--package=https://…/x@1.0.0.tgz` 因 `*@[0-9]*` 按钉版本放行，空格写法同样放行，属 F17。CHANGELOG 改成"远程值得到与空格写法相同的判定，所以 `https://…/x.tgz`、`github:…`、`git+https://…` 被拒"。
  - 修复只改文字和测试，不改代码，按手册不再开评审，自己跑 claim-drift。
- 2026-11-09：修复提交 c7b3603 后 `node scripts/claim-drift.js --range=49459b8..HEAD`：列出的名字里与本版有关的（pre-bash-safety-check、`--prefix`、`--no-install`、`--yes`，README 79/110/377 行、ARCHITECTURE 179/325 行、RULE-HITS-SCHEMA 35/36 行）逐行重读，没有与 head 代码矛盾的说法。
- 2026-11-10：c7b3603 的 PR CI 7/7 通过后，`main` 快进到 c7b3603 并推送，打带注释的 tag v0.120.1，建 GitHub Release；PR #34 显示 MERGED（06:29:15Z），远程 `release/v0.120.1` 已被 GitHub 删除，本地 `git branch -d`；`next-release` 对齐到 `main` 并推送。延期项 D#750 关闭；spec 挂载点条件记为延期项 D#754。

## 验证记录

- 修复前（评审修复后的测试文件对 `git archive v0.120.0` 的 hook）：`bash tests/hooks/pre-bash-safety.test.sh` → 失败（预期）：1290/1305，15 条 FAIL：`S8-NPXP1`–`S8-NPXP10`、`S8-NPXP24`、`S8-NPXP25` 期望拒绝得到放行，`S8-NPXP21` 已知误拒变放行，带 cwd 的两个断言。第一次红灯运行是 1290/1302、12 条 FAIL：当时还没有 `S8-NPXP23`–`S8-NPXP25`，带 cwd 的对照因为断言顺序在旧 hook 上也通过（`-p localpkg` 那一例先写了 localpkg 行），调换顺序后单跑 `PASS=0 FAIL=2`
- 修复后：`bash tests/hooks/pre-bash-safety.test.sh` → 通过：1302/1302，`Residuals: xfn=106 xfp=25`
- 变异：去掉收集循环的位置参数边界 → `S8-NPXP17`、`S8-NPXP18` 变红；`--` 结束收集这一支没有可区分的真实形状，删掉（`--` 后的第一个词就是命令，本来就停）
- 36 条探针新旧对比（`git archive v0.120.0` 对新 hook）：15 条放行变拒绝，12 条两版都放行，9 条两版都拒绝，0 条拒绝变放行（原写 17，数错，发版前评审 L1）
- 真实命令回放（`replay.py`，新旧 hook 都是快照，并发 8，沙箱 HOME，会话 id `t`）：转录 741 份，不同 Bash 命令 91,112 条，含 npx/npm/yarn/bun 字样的 7,970 条全部回放；旧版拒绝 461、新版拒绝 461；放行变拒绝 0，拒绝变放行 0；沙箱 HOME 里 0 个文件
- `npm run lint:sh` → 通过：exit 0
- CHANGELOG 条目 1,929 字节，`node bin/claudemd-lint.js lint --file <单独取出的条目>` → 通过（OK: no §10-V hits）
- `node scripts/version-cascade-check.js` → 通过（插件版本 0.120.1 五处一致）
- `npm run check`（`git add` 之后）→ 通过：exit 0；node 1807/1810（3 个跳过）；shell 1784 条 PASS、0 条 FAIL；pre-bash-safety 1303/1303，`Residuals: xfn=107 xfp=25`
- `npm run smoke` → 通过：SMOKE 2/2
- `BASH32_BIN=<scratchpad 里的 3.2.57> CLAUDEMD_BASH32_REQUIRED=1 bash tests/lib/bash32-runtime.sh` → 通过：44/44 个套件
- PR CI（dd2a676，run 42762062099）→ 通过：7/7
- 评审修复后：`bash tests/hooks/pre-bash-safety.test.sh` → 通过：1305/1305，`Residuals: xfn=107 xfp=25`；`S8-NPXP24` 在去掉 `-p=` 一支的变异体上放行（变红），`S8-NPXP25` 在去掉 `-c` 一支的变异体上放行（变红）
- 评审修复后 CHANGELOG 条目 2,068 字节，单独扫描 → 通过（OK: no §10-V hits）
- 评审修复后 `npm run check`（`git add` 之后）→ 通过：exit 0；node 1807/1810（3 个跳过）；shell 1784 条 PASS、0 条 FAIL；pre-bash-safety 1305/1305
- 修复提交 c7b3603 的 PR CI（run 42766725085）→ 通过：7/7
- tag 的 `ci`（run 42768838781）→ 通过：7/7；`main` 的 `ci`（run 42768822012）→ 通过
- tag 的 `npm-publish`（run 42768838859）→ 通过，`publish` job 打出 `+ claudemd-cli@0.120.1`（07:00:52Z）
- `npm view claudemd-cli@0.120.1 version _npmUser` → 通过：`0.120.1`，`GitHub Actions <npm-oidc-no-reply@github.com>`；dist-tags latest = 0.120.1（07:01:50Z 查询；07:00:45Z、07:01:01Z 两次查询还是 404，注册表延迟）
