---
module: plan
loads-on: for L3 work, specs and plans, or a change crossing modules
triggers: 架构|重构|规划|实施方案|设计方案|\brefactor\b|\bmigration\b|迁移|\bL3\b
trigger-window: head
---

# AI-CODING-SPEC v7.1.0 — module: plan

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

1. **Clarify**: sp:brainstorming (or gs:/office-hours if product-fuzzy).
2. **Plan**: sp:writing-plans. 2-5 min tasks with file paths / code / verify steps. Runtime-heavy ops (backfill / migration / build / model training) = single task regardless of runtime; annotate wall-clock + offline-window.
3. **Plan review** (optional): gs:/autoplan — on user request or auth/payment/crypto/cross-module ≥5. Default: user reviews + inline eng self-critique (1 paragraph).
4. **AUTH**: §5 hard. User confirms plan and risk.
5. **Worktree**: sp:using-git-worktrees.
6. **Build**: sp:subagent-driven-development, TDD per task. 2-stage review fires only on §5-hard sub-tasks.
7. **Branch finish**: sp:finishing-a-development-branch.
8. **Pre-ship review**: gs:/review.
9. **Optional** (user request only): gs:/codex for 2nd opinion.
10. **Ship**: gs:/ship (auto /document-release).
11. **Deploy**: gs:/land-and-deploy.
12. **Monitor** (declarative): emit checklist (metrics / thresholds / rollback trigger / command). User monitors; agent does NOT hold session.

**Auto-trigger**: gs:/cso on L3 + auth/payment/crypto/permissions.

### §4.FULL-lite (L3 reduced path)

**Eligible**: L3 AND no auth/payment/crypto AND ≤3 Modules AND no prod data-migration. Fits: non-security architecture refactor, CI/infra reshape, deps major bump, framework upgrade, non-breaking schema reorg.

1. Clarify: sp:brainstorming if scope fuzzy; else skip.
2. Plan: sp:writing-plans (same shape as FULL.2).
3. Plan self-critique: inline 3-view (CEO / design / eng) — no gs:/autoplan.
4. AUTH: §5 hard.
5. Worktree: sp:using-git-worktrees.
6. Build: sp:subagent-driven-development, TDD. Per-task review collapsed into step 7.
7. Pre-ship review: gs:/review (single pass, covers per-task drift + cross-cutting).
8. Ship: gs:/ship.
9. Deploy: gs:/land-and-deploy.
10. Monitor: declarative checklist.

**Escalate to §4.FULL** if any FULL trigger appears mid-work (new auth/payment/crypto; Modules >3; data-migration introduced). Re-run step 3 as gs:/autoplan; add pre-ship gs:/cso if security surface appeared. Do NOT silently continue under lite.
