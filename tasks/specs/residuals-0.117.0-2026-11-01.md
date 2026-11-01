# 0.117.0：遗留项收尾（检测器标注、doctor 推断依据、statusline 覆盖）

状态：进行中

## 背景与目标

- 2026-11-01 盘点后，使用者授权"继续完成剩余工作，按你建议执行；需要拍板的，深入思考、给出科学准确的建议，然后按建议执行"。
- 剩下的工作：D#576（§10-V、§11-turn-yield 的样本标注）；10-24 分拣留下的四条"待决定"（F27、`case` 锚点、共享符号守则、doctor `hook-drift` 的推断依据）；statusline 笔记里的遗留项；`improvement-candidates` 的 P4。D#567（技能复扫）没到样本量，只存快照、改到期条件。

## 范围

- 做：`scripts/sampling-audit.js`（API 错误记录不算代理停下；两条检测器关闭）；`scripts/doctor.js`（依据是 `plugin-cache` 推断时三行不计入退出码，导出 `countsTowardExit`）；对应测试；statusline 的四处覆盖缺口（只加测试）；`commands/claudemd-audit.md`、`commands/claudemd-sampling-audit.md` 各一句状态描述（模型可见文本，只把与代码不符的事实改对）；`.gitignore` 跟踪 hook-drift 笔记；各笔记写决定；CHANGELOG；发 0.117.0。
- 不做：改 §8 闸门（F27、F34 维持已登记的残差）；把共享符号守则加进核心规范；删孤儿渲染脚本（#5，见决策）；识别以其他 id 运行渲染脚本的 provider（新发现，记为延期项）；H4 的 `ASK_RATE_PRECISION`；`spec/` 不动。

## 验收标准

- [x] AC1：API 错误记录（`isApiErrorMessage: true`）之后用户说"继续"，不计为 §11-turn-yield 违规；普通的中途停下仍计。验证：`node --test tests/scripts/sampling-audit.test.js`（新夹具 `turn-yield-api-error`，修复前 2 次违规、期望 1 次）；全量扫描 3 → 0（1035 次机会）。
- [x] AC2：§10-V、§11-turn-yield 报 `status: closed`，`closedReason` 带实测数字，`precision` 为 null；audit 的 `selfCompliance` 八条都是 closed。验证：`node --test tests/scripts/sampling-audit.test.js tests/scripts/audit.test.js`。
- [x] AC3：依据是 `plugin-cache` 时，`hook-drift`、`plugin cache:staleness`、`plugin-root:stale-registration` 照常显示红行，带 `advisory: true` 和"不计入退出码"一句，退出码不因它们为 3；`installed-plugins` 依据的同一状态仍退出 3。验证：`node --test tests/scripts/doctor.test.js`（两条新用例，4 个变异体全抓到）。
- [x] AC4：statusline 四处覆盖缺口各有用例，并能抓到对应变异体。验证：`node --test tests/scripts/install.test.js tests/scripts/statusline-adopt.test.js tests/scripts/statusline-hosts.test.js`。
- [ ] AC5：`npm run check`、`npm run smoke` 通过；PR CI 绿；打 tag 前评审通过。

## 方案

- D#576：预注册要每条规则约 50 条被标出的样本。实测本机仍保留的全部 transcript（151 个主会话、所有项目、最早 10-06）每条只有 3 条，transcript 30 天后删除，攒不够。于是标注全部被标出的样本（普查），加 9 条 turn-yield 对照，三位互不可见、不知道哪些被标出的 Opus 盲评代理。结果：被标出的 6 条 0 条违规、全部一致。§10-V 的 0/3 上界 0.71，过不了 0.8；turn-yield 三条同一原因，修掉后 0 条。两条都关闭。记录：`tasks/sampling-detector-labeling-2026-07-24.md` 的 2026-11-01 一节；材料在 `tasks/sampling-labeling-2026-11-01/`（本地）。
- doctor：沙箱实测（源码目录运行、健康安装、缓存里一个中断安装留下的 0.200.0）时 `hook-drift` 是唯一计入的红行，退出码取决于哪个残留目录版本最高。0.85.0 让这一行重新计入的理由是"运行根目录可实测"，`plugin-cache` 不在此列。写测试时发现 `plugin cache:staleness` 读同一个推断，`plugin-root:stale-registration` 也是，三行一起处理。实现：检查对象加 `advisory: true`，退出码判定改用导出的 `countsTowardExit`。

## 计划

- [x] S1：turn-yield 修复（先红后绿）— 覆盖 AC1 — 869f04e
- [x] S2：两条检测器关闭、测试与两份命令页 — 覆盖 AC2 — 98cb71d
- [x] S3：doctor 三行（先红后绿，变异检验）— 覆盖 AC3 — 308d32d
- [x] S4：statusline 覆盖测试 — 覆盖 AC4 — 024de12
- [x] S5：笔记写决定、跟踪 hook-drift 笔记 — 4fa2959
- [ ] S6：发 0.117.0（版本号七处、CHANGELOG、`npm run check`、release 分支与草稿 PR、PR CI、打 tag 前评审、tag、GitHub Release、npm）— 覆盖 AC5

## 决策与进展

- F27（反引号锚点误拒）：不收窄。去掉反引号会放过两条真正执行的语料行；误拒 0.89.0 以来 2 次、都在本仓库测试文本里。已登记的残差即是记录。
- `case` 锚点：已在 0.116.5 登记为 F34，关闭笔记。
- 共享符号守则：作为已覆盖关闭（核心规范"改导出接口先做影响分析"、项目 CLAUDE.md 的 grep 确认、三次复现已被机械闸门关掉；核心 23,422/25,000 字节）。
- statusline：dry-run 那一处不是缺陷（不做改动的路径在 dry-run 下都返回各自的结果）。#5 不修：本机 code-graph 以 `_previous` 运行 claudemd 的渲染脚本，而 claudemd 判定为未注册，照原方案删除会弄坏状态栏。同一状态下渲染脚本不会被刷新（本机是 09-05 的版本，缺 D#455），记为延期项。
- P4：关闭，doctor 的 12 KB 预算已取代它。
- D#567：样本 26/62，10-25 以后 0 个新增；transcript 保留期会删掉窗口开头，已存只读快照 `tasks/model-capability-2026-10-15/skill_sessions_p3_snapshot_2026-11-01.jsonl`，到期条件改为按数量并要求定期快照。
- 版本号：次版本（0.117.0），先例 0.54.0 关闭检测器写作 `change:`。

## 验证记录

- `node --test tests/scripts/sampling-audit.test.js`（修复前）→ 失败（turn-yield-api-error：期望 1，实际 2）
- `node --test tests/scripts/sampling-audit.test.js tests/scripts/audit.test.js tests/scripts/help-discoverability.test.js` → 通过（158/158）
- `node --test tests/scripts/doctor.test.js`（修改前，新用例）→ 失败（`advisory` 为 undefined）；修改后 → 通过（117/117）；变异检验 4/4
- `node --test tests/scripts/install.test.js tests/scripts/statusline-adopt.test.js tests/scripts/statusline-hosts.test.js` → 通过（110/110）；变异检验 7/7，改动前的测试 0/3
