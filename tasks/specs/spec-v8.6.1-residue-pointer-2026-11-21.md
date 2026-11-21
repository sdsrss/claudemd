# 核心 §8.V4 的残留条件改为指向 auth.md（2026-11-21）：规范 v8.6.1
状态：已完成

## 背景与目标

D#923（0.121.1 预发评审 L5）：核心 `spec/CLAUDE.md` §8.V4 用 "in short" 复述了 agent temp residue 的条件，但少了两条：目录"resolves inside that root"，以及 scratchpad 一类的"会话记录（transcript）24 小时没有写入"。后者正是"已结束会话"的定义。只照摘要做的会话，可能删掉一个仍在运行、只是 24 小时没碰 scratchpad 的会话的文件。
同一类问题 D#922 已在 0.121.1 处理过：`hooks/tmp-sweep.sh` 的提示不再抄条件，改为"满足规则的全部条件（先读 auth.md 的清单）"。v8.6.0 加挂载条件时，核心和 extended 两处都要改，这就是复述的维护代价。

目标：核心只保留"哪类目录"（temp 根下的 `agent-tmp-*` 目录，或已结束会话的 scratchpad），条件改为"满足 `auth.md` 列出的全部条件（先读它）"。条件本身不变，唯一来源是 `auth.md`（由 extended §5-EXT 生成）。

用户授权：2026-11-21 用户说"继续完成剩余工作……按你的建议执行"，贴出的剩余清单写明 D#923"要改规范版本"。按 L3 的授权处理，范围限于本文件"范围"一节。

## 范围
- 做：
  - `spec/CLAUDE.md` §8.V4 一句。
  - 版本级联 v8.6.0 → v8.6.1（补丁：只改措辞，不增删规则，规则 ID 不变）：`spec/hard-rules.json`、两个标题行、`spec/CLAUDE-changelog.md`、extended 的 Recent changes 和 Sizing、重建 `spec/spec-modules/`（只有标题行变）。
  - `tests/scripts/spec-structure.test.js` 的 §8.V4 整行钉住，以及级联带动的钉住项。
- 不做：
  - `auth.md` / extended §5-EXT 的条件文字（不变）。
  - 插件版本号和发版（随下一批，见"决策与进展"）。

## 验收标准
- [x] AC1：核心 §8.V4 不再复述条件，指向 `auth.md` — 验证：§8.V4 整行钉住先红后绿（`node --test tests/scripts/spec-structure.test.js`）
- [x] AC2：规范树一致 — 验证：`node scripts/version-cascade-check.js`；`node scripts/spec-coherence-audit.js --strict` 报 coreDelta=0, extendedDelta=0
- [x] AC3：模块与 extended 一致 — 验证：`node scripts/build-spec-modules.js` 后 `git diff --stat spec/spec-modules` 只有标题行
- [x] AC4：`npm run check` 退出码 0；`npm run smoke` 通过

## 方案

旧句：`… is deleted without asking only as agent temp residue (`auth.md`; in short: an `agent-tmp-*` dir in a temp root or an ended session's scratchpad, yours, not a symlink, no mount at or under it, idle 24 h, no `.keep`, named by nothing open); anything else there stays §5 Hard.`
新句：`… is deleted without asking only as agent temp residue: an `agent-tmp-*` dir in a temp root or an ended session's scratchpad that meets every condition `auth.md` lists (read it first); anything else there stays §5 Hard.`

比较过的写法：
- 补全清单（加上两条）：核心变长约 80 字节；以后每改一个条件仍要改两处，漏改的问题还会再出现。不选。
- 整段只留 `auth.md` 指针：会话不读模块就不知道哪类目录值得去查，多一次无谓的 Read 或询问。不选。
- 选定写法：保留"哪类目录"（两类，很少变），条件只在 `auth.md` 一处。

对 D#719 的影响：D#719 统计"删 temp 根下目录前问用户"的次数（0.119.0 T0 起约 4 周，到约 11-30）。这句改动可能改变会话是否先读 `auth.md`，所以本改动等那次复测之后再发版，避免把窗口切成两段。

## 计划
- [x] S1：改钉住值 → 测试红 → 改 §8.V4 → 绿 — 覆盖 AC1 — 依赖：无 — 执行：主会话
- [x] S2：版本级联、重建模块、Sizing 不动点 — 覆盖 AC2、AC3 — 依赖：S1 — 执行：主会话
- [x] S3：`npm run check`、`npm run smoke`，提交到 `next-release` — 覆盖 AC4 — 依赖：S2 — 执行：主会话

## 决策与进展
- 同批的另两项（2026-11-21）：
  - D#925 已修，提交 2cf3e3c（`newestMtimeMs` 按 Buffer 遍历）。
  - D#924 不改代码、关闭。L8 条目上限：本机 45 个会话 scratchpad 条目数中位 175、p90 4,452、最大 25,471，按 0.121.1 实测（2 万条 103 ms）最大约 0.13 s，200,000 的上限不会触发；卡死的 FUSE 挂载卡在单次 lstat，上限拦不住；`newestMtimeMs` 对所有候选早有同样的暴露。L9 先查后删的时间窗：逐个查完就删只把窗口从整轮缩到单个目标，rmSync 自身遍历的窗口在用户态关不掉；本机当前 dry run 的删除目标为 0。
- 发版时机：不单独发。等约 11-30 那轮复测（D#674 / D#719 / D#737）之后，与下一批一起发；三项都是 0.121.1 发布说明里写明延后的评审残留。

## 验证记录
- `node --test tests/scripts/spec-structure.test.js`（只改 §8.V4 钉住值）→ 失败（105/106，§8.V4 整行不符），改 §8.V4 后 → 通过（106/106，§8 块哈希按 diff 只含这一行后更新）
- `node scripts/version-cascade-check.js` → 通过（v8.6 consistent across 3 file(s)；plugin semver 0.121.1 across 5 site(s)）
- `node scripts/spec-coherence-audit.js --strict` → 通过（5/5 clean；coreDelta=0, extendedDelta=0；core 24218 → 24162，extended 38807 → 38196）
- `node scripts/build-spec-modules.js` → 通过（9 个模块各只改标题行）
- spec-structure / spec-modules / hard-rules-drift → 通过（129/129；两个标题、两个标题清单、Recent changes 的哈希按 diff 更新）
- `npm run check` → 通过（退出码 0，节点测试 1828 通过 / 0 失败 / 3 跳过，基线 1827 / 0 / 3，多出的 1 个是 D#925 的新测试；207 s）
- `npm run smoke` → 通过（2/2）
