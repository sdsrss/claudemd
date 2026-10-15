---
status: implemented
revision: 5
---

# v7.3 — 技能路由下放给 description，规范只写行为

来源：2026-10-15 分析 `docs/spec-model-capability-review-2026-10-15.md`（本地）§5 的 K1–K3；用户同日"动手，按你的建议优化"。

## goal

1. 删掉 `skills` 模块（§4 FLOW 的 Routing / Composite / Skill invocation，§12 Skill routing table 及其 Detection / Absent / Gated / Batch 段、user-only 行），以及核心里指向它的文字。
2. 核心的技能文字收成一行：按 description 判断；L0/L1 不调用；插件"有可能就必须调用"的措辞不覆盖这个判断。
3. 发版、L3 流程、评审、调试、验证文字里不再点名技能（`gs:/…`、`sp:…`、`matt:…`），只写要做的行为。
4. 只存在于 `skills` 模块里的规则先搬到对应模块，含义不变。
5. 删掉只为路由表服务的代码：`scripts/lib/spec-routing.js`、`tests/scripts/spec-routing-consumers.test.js`、doctor 的三项 `routing:*` 检查、`spec-structure` 里的 §4↔§12 联结测试。

## non-goals

- 不改技能调用的语义：L2 及以上按 description 判断、插件强制措辞不覆盖，和 v7.2.0 相同。L2 是否放松由 A/B 的 C 臂回答，不在本版。
- 不动 K4/K5（停用 superpowers、插件去重）：那是用户全局配置，单独 AUTH。
- 不动 K6–K9（消融、`omitClaudeMd`、度量通道、强调词理由）。
- 不改 core §1 语言条款（lang-drift 窗口）；不改任何 hook 的判定。

## constraints

- 每条被删的条款先 `git grep` 原句，列出成员，确认没有别处的唯一引用（`feedback_spec_dedupe_is_not_restatement`）。
- HARD 规则不删：`§12-ship-pipeline-hardening`、`§12-manual-ship-atomicity`、`§12-author-not-reviewer` 的锚点保持；"无子代理时 L3 不可执行"保留 HARD，搬进 `plan.md`。
- 发版硬化规则的放宽（有 runbook 时不再要求 `manual ship because` 一行）写进 changelog 的理由；"手动"重新定义为"没有 runbook 也没有发版技能"。
- core ≤ 25,000 B、extended ≤ 50,000 B；Sizing 行解到不动点。
- 发版走 release 分支 + draft PR + 发版前独立评审；推送和打 tag 前问用户。

## success-criteria

- `node scripts/build-spec-modules.js --check`：10 个模块，无 `skills`。
- `git grep -E 'gs:/|sp:[a-z]|matt:[a-z]' -- spec/CLAUDE.md spec/CLAUDE-extended.md spec/spec-modules/` 只剩 Recent changes / changelog 的历史叙述。
- `npm run check` exit 0；`npm run smoke` 通过。
- 新的核心 Skills 行、Ship triggers 行、§5.1 行、发版硬化两段都有整行钉，并做变异检验。
- 离线 A/B（plugins 启用）：L0/L1 任务技能调用 0；fixture 发版 `Unknown skill` 0、打 tag 前有评审；先复现 / 先红不低于 A 臂减 1。
- 发版前独立评审无未处理的 Critical/High。

## open-questions

- A/B 的环境：`scripts/offline-eval/run.mjs` 能否在启用插件的条件下跑（R4(c) 用的是无设置 `-p`）。若不能，记录替代方案及其局限。

# Change log

- r1（2026-10-15）：初稿，按分析文档 K1–K3 定范围。
- r2（2026-10-15）：目标 1–5 在 `next-release` 上实现（规范 v7.3.0）。实施中的两处偏离：
  - `plan.md` 首稿超出模块注入预算（memory + plan 合计超过 9,800 字符，`spec-module-inject` case 16 变红）。为此把"无子代理 → L3 不可执行"并进 `review.md` 的 Author ≠ reviewer（HARD 锚点覆盖，`hard-rules-drift` 不再需要豁免行）；删掉 bootstrap/scaffold 一行（核心 §2 的文件数规则已经把它判为 L2）。这样两者合计 9,765 字符。
  - 另外删掉了几条只存在于表里、别处已有规定的条目：Composite requests、设计自问、第二意见的"说明"、低频工具的降级文件。changelog 的"Dropped"一条逐项列出。
  - 待验证（发版关卡，结果追加在这里）：离线 A/B（插件启用）、发版前独立评审。
- r3（2026-10-15）：离线 A/B（插件启用，Opus 5.5 high，每格 10 次，`tasks/skill-ab/RESULT.md`，本地）通过。
  - A（v7.2.0）48/50，B（v7.3.0）50/50。
  - L0/L1 技能调用两组都是 0/20；`Unknown skill` 两组都是 0；打 tag 前评审两组都是 10/10；先复现、先红两组都是 10/10。
  - C 组（无规范）：先复现 4/10，先红 2/10；L2 新增任务上无规范也是 0/10 调用，所以不在 L2 放松裁决句。
  - A 组也没有复现 `Unknown skill`，K3 的依据仍是转录数据。
  - 费用 $33.45。剩发版前独立评审。
- r4（2026-10-15）：发版前独立评审，结果为 1 High、2 Medium、10 Low，已全部修复。
  - H1：首稿让"发版请求"授权了手动部署。已恢复为部署前必须发 `[AUTH REQUIRED op:manual-deploy]`，并加了整行钉。
  - M1、M2：首稿丢了两样东西：L0/L1 对"发版、接收评审"的例外，以及三条选技能规则（插件之间不分优先级、两个都合适时选更具体的、每步一个技能）。这些都已放回核心 Skills 行。裁决句恢复为覆盖"技能自身的 must 措辞"。
  - Low：前缀扫描加上 Claude Code 实际注册的命名空间写法；sampling-audit 命令文档的残留引用已改；lite 升级的措辞已改；gs 子技能数改为 19（提交 9103bec 的信息里写的 15 未改写历史，在 CHANGELOG 中注明）；"四个联结测试"改为"五个"；changelog 补写了硬化规则和 Author ≠ reviewer 的变化；两份 Dropped 清单已对齐；OPERATOR 的例外与 plan.md 已对齐；核心 Ship triggers 的指代改清楚；CHANGELOG 不再指向未入库的来源。
  - 每处修复都先写钉子、先变红，再改文字。变异检验扩到 18 例，每例都由预期的测试抓到。
- r5（2026-10-15）：修复提交的复审（全新子代理）：0 High、3 Medium、8 Low，已全部修复。
  - M1：恢复后的部署授权只写了"by hand"，而 ship.md 把"by hand"定义为不含 runbook。现改为：凡是没有部署技能执行的部署，不管走 runbook 还是手动，都要在原子发版流程开始前先发 `[AUTH REQUIRED op:manual-deploy]`。这样也解决了 L8：授权停顿不会落在原子流程中间。
  - M2：前缀扫描只检查每行的前 120 个字符。现改为整行检测，并加了一条第 200 列之后也能抓到的对照。这条对照先红后绿。
  - M3：A/B 的 B 组跑的是修复前的草稿，所以在最终文本上重跑了 B2 组（Claude Code 2.1.301）。结果 49/50：L0/L1 技能调用 0/20，`Unknown skill` 0，打 tag 前评审 10/10，先复现、先红都是 10/10；唯一的失败是 T7 有 1 次没引用来源，和 A 组那 2 次同一种。费用 $15.40，A/B 累计 $48.85。
  - Low：
    - L1：例外从"发版"扩成全部 4 个 ship 触发词。
    - L2：裁决句覆盖本行、`ship.md`、`review.md`，并写明"skills or plugins"。
    - L5：正则也匹配不带斜杠和多一个斜杠的写法。
    - L3/L4/L6/L7/L9：都是 changelog 措辞。
  - 变异检验扩到 22 例，每例都由预期的测试抓到，对照组为绿。
  - 这一轮已经到评审深度上限 2：是否再派第三轮，交给用户决定。
