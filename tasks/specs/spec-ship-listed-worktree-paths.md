---
status: implemented
revision: 1
---

# spec v6.35.0:`ship` 可用时才调用;worktree 代理用相对路径

## goal

消除 2026-09-26 分析里两类由规范措辞直接引发的失败:

1. core §2.2 写 "`ship` skill required",9 次 `Skill` 调用以 `Unknown skill: ship` / `gstack:ship` 失败。本机 gstack 的 ship 在 `~/.claude/skills/gstack/ship/SKILL.md`,是 gstack 路由下的子技能,Claude Code 不注册它。
2. `isolation: "worktree"` 的代理提示词里写主仓库绝对路径,harness 在 4 天里拒绝了 75 次。

## non-goals

- 不改 §EXT §12 的 Ship-pipeline hardening(HARD)与 Detection:「未列出 = 缺失 → Fallback(`manual ship because <reason>`)」本来就在,core 只是改成和它一致。
- 不替用户链接 gstack 子技能(改 `~/.claude/skills/` 属于用户全局状态);doctor 只提示。

## constraints

- core ≤25000B(开工前 24979B,余量 21B);extended ≤50000B(开工前 49810B)。
- 规范 minor 版本(规则放宽 + 新增)→ L3,§13 META;版本级联:hard-rules.json、两个标题、changelog、三个 manifest 描述、README。
- spec-structure 的块哈希只允许改动过的块变化。
- 用户授权:2026-09-26 AskUserQuestion「P1-3/P1-5 规范自改」。

## success-criteria

1. core §2.2 读作 "`ship` skill if listed (else manual)";core 24994B。
2. §EXT §11-O 新增 Worktree spawn 一条。
3. `version-cascade-check` 通过;`spec-coherence-audit --strict` coreDelta=0、extendedDelta=0。
4. `/claudemd-doctor` 的 `routing:ship-skill`(advisory)区分「已注册 / 在但未注册 / 不存在」,三种情况各有用例。
5. spec-structure 只有 core 前言、core §2、extended 前言、§11-O、Recent changes 与两份标题清单的哈希变化。

## open-questions

- core 余量只剩 6B;下一次 core 增加必须先净删(§0.1)。

# Change log

- r1 (2026-09-26): written and implemented in one pass after the AUTH.
