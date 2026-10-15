---
module: plan
loads-on: for L3 work, specs and plans, or a change crossing modules
triggers: 架构|重构|规划|实施方案|设计方案|(?<![A-Za-z0-9_])refactor(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])migration(?![A-Za-z0-9_])|迁移|(?<![A-Za-z0-9_])L3(?![A-Za-z0-9_])
trigger-window: head
---

# AI-CODING-SPEC v7.3.0 — module: plan

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §2.S SPEC ARTIFACT

Spec = what & why (stable); plan = how & when (volatile). A spec outlasts many plans.

### Spec file
- Path: `tasks/specs/<slug>.md` (project CLAUDE.md may override via `SPEC_DIR:`). Auto-create, no AUTH.
- Frontmatter: `status: draft | approved | implemented | deprecated` + `revision: <n>`.
- Body: `goal / non-goals / constraints / success-criteria / open-questions / # Change log`.
- **Worktrees**: independent `tasks/`; merge `lessons.md` to main on worktree-finish.

### When required
- **L3**: mandatory. Initial draft: `goal` + `success-criteria` + `constraints`; rest fills during §4.FULL steps 1-3. All 6 complete before AUTH (step 4).
- **L2**: NOT default. Agent proposes when cross-module (≥2 Modules) OR >50 LOC OR new dep. User "yes/skip". Bugfix restoring documented behavior → no spec.
- **L2 minimal**: only `goal` + `success-criteria` required.

### Spec changes mid-work
- `goal / non-goals / success-criteria` change → contract shift → user ASK.
- `constraints / open-questions` tightening → auto-decide if reversible.
- Every change bumps `revision`, appends to `# Change log`. Re-classify in prose if level shifts.

### Plan drift threshold (mid-implementation)
During execution, if the plan's file map / naming / schema / signatures disagree with the actual code:
- **1 mismatch**: fix inline, note in report under Uncertain.
- **≥2 mismatches in one task**: report them under Not done and Uncertain per §10, listing each deviation as file:line before/after. Not a bracketed signal — core §0 has exactly two, and a third token shaped like them is one the reader has to learn for no gain.
- **≥5 mismatches across a task OR any cross-task contradiction**: pause and escalate to re-planning in prose. Do NOT silently rewrite plan intent.

Common drift source: plan sketches (type lists / table fields / filesystem shapes / test import paths) written without Reading the real artifact — verify against code, not the sketch.

## §4 FLOW

### §4.FULL (L3 full path)

For L3 hitting: auth/payment/crypto, prod data-migration, breaking schema, ≥4 Modules, cross-cutting architecture.

1. **Clarify**: product + tech questions in one ask, tagged `[product]` / `[tech]`.
2. **Plan**: in `tasks/<n>.md`, user-reviewed. 2-5 min tasks with file paths / code / verify steps. Runtime-heavy ops (backfill / migration / build / model training) = single task regardless of runtime; annotate wall-clock + offline-window.
3. **Plan review** (optional): 3-view self-critique (CEO / design / eng) on user request or auth/payment/crypto/cross-module ≥5. Default: user reviews + inline eng self-critique (1 paragraph).
4. **AUTH**: §5 hard. User confirms plan and risk.
5. **Isolate**: worktree or branch (stash before switching).
6. **Build**: TDD per task, independent sub-tasks in subagents; fresh-subagent review per sub-task, 2-stage (spec, quality) on §5-hard ones.
7. **Branch finish**: rebase / squash, changelog, clean tree.
8. **Pre-ship review**: fresh subagent, whole change (`review.md`).
9. **Optional** (user request only): a second opinion (another model or tool).
10. **Ship**: per `ship.md`.
11. **Deploy**: project deploy path; by hand → `ship.md`.
12. **Monitor** (declarative): emit checklist (metrics / thresholds / rollback trigger / command). User monitors; agent does NOT hold session.

**Security pass**: L3 on auth/payment/crypto/permissions → STRIDE review before ship.

### §4.FULL-lite (L3 reduced path)

**Eligible**: L3 AND no auth/payment/crypto AND ≤3 Modules AND no prod data-migration. Fits: non-security architecture refactor, CI/infra reshape, deps major bump, framework upgrade, non-breaking schema reorg.

1. Clarify: as FULL.1 if scope fuzzy; else skip.
2. Plan: as FULL.2.
3. Plan self-critique: inline 3-view (CEO / design / eng).
4. AUTH: §5 hard.
5. Isolate: as FULL.5.
6. Build: TDD. Per-task review collapsed into step 7.
7. Pre-ship review: one fresh-subagent pass (per-task drift + cross-cutting).
8. Ship: per `ship.md`.
9. Deploy: as FULL.11.
10. Monitor: declarative checklist.

**Escalate to §4.FULL** if any FULL trigger appears mid-work (new auth/payment/crypto; Modules >3; data-migration introduced). Re-run step 3 as FULL.3; add the security pass if security surface appeared. Do NOT silently continue under lite.
