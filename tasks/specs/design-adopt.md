---
status: implemented
revision: 7
---

> **SHIPPED v0.24.1 (2026-07-05), CI green (ubuntu+macOS) + npm published.** v0.24.0 shipped first but hit a macOS-only CI red (ESM main-guard vs symlinked mkdtemp); v0.24.1 realpath-fixed it. Command-only; no SessionStart hook. See the review-outcome section below for the full 2-round history.

> **2026-07-05 — PIVOTED TO COMMAND-ONLY after 2 adversarial reviews.** Round-1 review (15 root causes) drove a hot-path redesign + detector sweep. Round-2 adversarial re-review (15 more) showed the severe findings concentrate in the **SessionStart auto-hint** (cache/pending collisions, statefile races, FP nagging, residue). User decision (this session): **cut the auto-hint** — the detector is now stateless + command-only, deleting the entire hint-path failure class; the command's diff+consent gate is the safety net. Round-2's detector-CORE findings (nested interpolation #196, digit/underscore props #199, unterminated comment #191, cross-package misattribution #247, `site/` FP #143, wiring-basename FP #291) all fixed with regression tests. Full suite 542 pass; detector verified stateless. **Non-goal now includes**: no SessionStart hook, no auto-firing, no cache/state files. Ship posture per user: pending final go (surface much smaller than reviewed). Findings + resolutions: `tasks/design-adopt-review-findings-2026-07-05.md`.


# design-adopt — 智能识别项目设计规范并协助配置（插件通用能力）

> 来源：2026-07-05 agents.md 文档对比分析 → daagu 手工原型（DESIGN.md 薄指针 + CLAUDE.md 接线）→ 用户指令"产品化为插件能力：装插件后智能识别用户项目涉及设计规范，帮用户智能配置"。
> 定级：L3（released-artifact 行为新增 + LLM-visible metadata：SessionStart hint 文本 + command 模板契约）。冻结状态：用户本指令定向重开内部工作——该功能是插件首个面向第三方的价值点，与冻结记忆的"external validation"目标同向。

## goal

用户安装 claudemd 插件后，在**有设计 token 体系的 UI 项目**里自动获得：(1) 确定性检测（零 LLM、有缓存、静默）；(2) 一条 agent 可见的 SessionStart 提示；(3) 一个命令 `/claudemd-design-adopt`，由 agent 读取真实 token 源生成**薄指针型 DESIGN.md**（facts-only，值表留在代码事实源）并以 sentinel 块接入项目 CLAUDE.md。空项目 / 非 UI 项目 / 已配置项目：零输出零成本。

## non-goals（v1 明确不做）

- 不发明任何设计值（无内置调色板/模板样板——agents.md 生成器的反例是本功能的宪法，见 `feedback_project_doc_facts_only.md`）
- 不做 enforcement（不 deny 硬编码色值；v1 只做上下文供给）
- 不覆盖非 web 生态（Flutter/SwiftUI/桌面 GUI → 后续按需求）
- 无 token 源的 UI 项目（`ui-no-tokens`）不生成任何文件
- 不在无会话内确认的情况下写用户仓库文件
- 不做周期性重扫（仅缓存失效驱动：package.json mtime 变化或 7d TTL）

## 架构（detect → hint → command → generate → wire）

1. **检测器 `scripts/design-detect.js`**（node，确定性，零 LLM）：
   - Gate 0：cwd 无 `package.json` → `no-ui`，静默退出（monorepo 兜底：`packages/*/package.json`、`apps/*/package.json` 有界 glob）
   - Gate 1：UI 信号 = deps ∩ {框架 react/vue/svelte/@angular/core/solid-js/preact} ∪ {组件库 element-plus/antd/@mui/vant/naive-ui/arco/semi/primevue/vuetify/chakra/mantine} ∪ {样式 tailwindcss/unocss/panda/sass/less/styled-components/@emotion}
   - Gate 2：token 源发现（depth≤4、跳过 node_modules/dist、文件数/字节数封顶）：`tailwind.config.*`/`uno.config.*`/`panda.config.*`；`{_variables,variables,_tokens,tokens,theme,_theme}.{scss,less,styl}`；含 `:root` 且 ≥8 个 `--` 自定义属性的 css/scss
   - Gate 3：接线状态 = DESIGN.md 是否存在 / 项目 CLAUDE.md 是否引用（token 文件或 DESIGN.md）
   - verdict：`no-ui | ui-no-tokens | adoptable | unwired | configured` + 机器负载（文件清单/框架/暗色信号）
   - 缓存：state-dir（build 时 grep 现有 helper 定位；cwd 编码用 `tr '/._' '-'` 全宽转换，见 `feedback_cc_cwd_encoding_dots.md`），键 = encoded-cwd + package.json (mtime,size)。预算：warm <50ms，cold <300ms
2. **SessionStart hint**（合入 `session-start-check.sh` 现有 `jq -s` 单对象合并管线，绝不新增独立 emit 路径——`feedback_hook_stdout_single_json_object.md` / lesson #586）：verdict ∈ {adoptable, unwired} 时输出 ≤2 行 agent-facing 提示；每项目状态变化只提示一次（state 标记）；opt-out env `DISABLE_DESIGN_DETECT_HOOK`（接入 /claudemd-toggle 现有 DISABLE_* 家族，build 时核对 toggle.js 注册表形状）
3. **命令 `commands/claudemd-design-adopt.md`**（agent 执行的契约）：
   - 跑检测器 `--json` → no-ui 直接报告退出
   - Read 检出的 token 源（有界）→ 生成 DESIGN.md，模板契约：
     - §1 事实源清单（路径 + 可检测的加载机制，如 vite additionalData / tailwind content）——每行必须引用真实存在的文件
     - §2 硬规则：**证据门控菜单**——语义色变量存在→"只用语义变量禁硬编码"；暗色产物(html.dark/prefers-color-scheme/EP dark css-vars)→暗色规则；间距刻度(≥4 tokens)→网格规则（用实测基数）；mixin/utility 清单→复用优先规则（列实名）；mono 字体 token→数字等宽；WCAG 注释→对比度承诺。**无证据标志的规则一律不写**
     - §3 identity 表（≤8 行，从真实 token 值解析，注明"以 <file> 为准"）
     - 领域色彩语义（如红涨绿跌）不可推导 → 留 `<!-- TODO: 领域色彩语义请人工补充 -->` 标记
   - CLAUDE.md 接线：`<!-- claudemd-design:begin v1 -->` sentinel 块（3-4 行指针+顶级硬规则），幂等可更新；`remove` 子命令对称卸载（镜像 mem-lite adopt/unadopt 语义）
   - 写文件前展示 diff 摘要（会话内确认 = consent 门）
   - `--check`：指针可解析性校验（引用文件存在）

## constraints（build 阶段必须遵守的既有教训）

- 单 JSON emit 契约测试：`jq -s 'length'==1`，测契约不测子串（`feedback_hook_stdout_single_json_object.md`）
- 检测器用 node 不用 bash（macOS bash 3.2 无 `declare -A` 等，`feedback_macos_shell_portability.md`）；hook 胶水若用 platform_* 必须 source platform.sh
- argv 走 `scripts/lib/argv.js#parseStrict`（`feedback_cli_flag_shape_silent_fallback.md`，同款已复发 3 次）
- 测试 fixture：≥1 个 byte-exact 真实样本（daagu variables.scss 节选入库为 fixture）+ 形状变体矩阵（vue+scss / react+tailwind / monorepo / node-cli-no-ui / empty / ui-no-tokens）+ 禁绝对日期 + suite 入口 unset 用户 env（fixture 四条记忆）
- 遥测前缀对齐 hook-registry displayName（`feedback_hook_prefix_match_internal_telemetry.md`）；手测探针前 `DISABLE_RULE_HITS_LOG=1`
- §8.V3：CLAUDE.md 写入路径先在 mkdtemp fixture 沙盒验证；§8.V4 沙盒产物任务内清理
- Released-artifact checklist（§EXT §2-EXT）：minor bump **0.24.0** + CHANGELOG 迁移说明置顶 + opt-out（`DISABLE_DESIGN_DETECT_HOOK`）+ 一次性可发现信号（hint 自宣告 + README 章节）
- 已知环境噪声：fail-open.test.sh 有 pre-existing regex FP（lesson #8602），spec-coherence 跑挂时先对照该已知项

## success-criteria

1. 检测矩阵 6 fixture 全部给出正确 verdict（含 monorepo 兜底与 no-ui 静默）；SessionStart 输出恒为单 JSON 对象（jq -s 契约测试通过）
2. 在 daagu 上运行 `/claudemd-design-adopt --check`（已有手工 DESIGN.md）verdict=configured/unwired 判定正确；在一个干净 UI fixture 上端到端生成的 DESIGN.md 每一行可溯源到检出文件（零发明值——人工抽查 + 模板契约自查清单）
3. 非 UI 项目（claudemd 仓库自身）SessionStart 零新增输出、检测器 warm ≤50ms（实测数字入 REPORT）
4. CI ubuntu+macos 双绿；version-cascade-check 通过；doctor 不新增失败项

## open-questions

1. **hint 激活模式**（用户决策）：A. hint 指示 agent 在会话内出现 UI 工作时主动提议 adopt（推荐，无感+有 consent）/ B. hint 仅提及命令名，agent 不主动 / C. 无 hint，纯手动命令
2. DESIGN.md 写入前 diff 预览是否可被 AUTONOMY_LEVEL: aggressive 项目跳过（默认不跳，v1 保守）
3. `ui-no-tokens` verdict 未来是否值得一条"发现 UI 项目但无 token 体系"的提示（v1 否）

# Change log

- r3 (2026-07-05): build complete, pre-ship review running. **Plan-drift (2 处, DONE_WITH_CONCERNS 级记录)**: (1) opt-out 未进 hook-registry/toggle 家族 — 实现为子功能 env 守卫 `DISABLE_DESIGN_DETECT`（同 `DISABLE_UPSTREAM_CHECK` 家族；registry 家族是独立 hook 专用，误入会牵连 doctor hook-drift 审计）；(2) 子项目兜底超出 spec 原文（仅 workspaces `packages/*`/`apps/*`）— 真实仓库验证发现 fullstack split（空壳根 pkg + `frontend/`）判 no-ui，扩展固定名探测 `frontend|web|client|ui|app|site`，新增 `fullstack/` fixture 锁形状。实测: 激励仓库 verdict=configured (62ms cold / 1ms cached)，本仓库 no-ui 零输出，node 523→534 pass，bash 全绿。
- r2 (2026-07-05): APPROVED — user AUTH granted (L3-enter, v0.24.0)；open-question #1 resolved = **A 主动提议型**（hint 指示 agent 在会话内出现 UI 工作时主动提议 adopt，写文件前会话内确认，每项目提示一次）；#2 维持默认不跳过 diff 预览；#3 维持 v1 否。构建姿态：main 直接构建（repo atomic-ship 惯例，worktree 跳过），pre-ship 单次 fresh review。
- r1 (2026-07-05): initial draft from daagu prototype + agents.md analysis; pending L3 AUTH + open-question #1.
