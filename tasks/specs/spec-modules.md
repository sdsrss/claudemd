---
status: implemented
revision: 5
---

# Spec v7.0.0: per-phase modules, loaded by hooks

Source: docs/audit/20260926-180700.md §10 (design), §11.3 B7 (batch), §12.3 (tier-2 revision). Authorized with the plan's L3 batches on 2026-09-26 (Q2).

## goal

Each kind of task sees the rules it needs, each rule is written once, and the rules a task needs arrive deterministically instead of by the model choosing to read a 49 KB file. Measured today: extended is read whole in 50% of interactive sessions (65% counting Bash reads), skill routing is written in four places that disagree, and a hook hint to read a file is followed in 25/46 Opus 5.5 turns.

## non-goals

- No rule changes meaning. Every rule keeps its ID (the § anchor telemetry, `hard-rules.json`, golden pins and coherence audit key on). Wording may shorten only where a module no longer needs a cross-reference to reach its context.
- No new HARD rule (§13.2). No change to any hook verdict other than the new load check (tier 3).
- No change to §8 SAFETY text or placement: it stays in core, whole.

## constraints

1. **Core keeps what every task needs** (target ≤ 20 KB, from 24,989 B). §10.5 of the audit said ≤ 15 KB; measured section sizes say otherwise: §0, §1, §2, §3, §5, §8, §10, §11 alone are ~16 KB, and each holds HARD or AUTH rules that must be resident. The core module index replaces §2.2 and the `→ §EXT` pointers.
2. **Modules are built, not hand-split** (r3): `spec/CLAUDE-extended.md` stays the single source in the repo; a marker line `<!-- module: <name> -->` opens each module and holds until the next marker, and `<!-- module: none -->` marks maintainer-only text. The installer writes each module to `~/.claude/spec/<name>.md` and installs extended itself as a short stub index. Everything keyed on extended's sections (golden pins, the Sizing line, the routing-table parser, `hard-rules.json` anchors, `spec-coherence-audit`) keeps working; sections move within the file so each module is contiguous. Cap 6 KB each (the audit's 4 KB cannot hold ship.md without splitting one procedure), 45 KB total. Each has frontmatter `triggers:` (tier 2) and `loads-on:` (prose for the index line).
3. **Tier 1 — index**: one line per module in core, saying when to read it, not where a section is.
4. **Tier 2 — injection** (12.3 revision): a `UserPromptSubmit` hook injects a matching module's body as `additionalContext`, once per session per module (again after a compaction). Triggers are calibrated on historical prompts before shipping (budget below).
5. **Tier 3 — load check**: before `git tag` / `git push --tags` / `gh release create` / `npm publish`, a `PreToolUse` check requires `ship.md` injected or read this session. Deny in this repo; advisory for everyone else until §13.3's gates pass.
6. **Installer**: `SPEC_FILES` gains the module directory; copy, hash, backup, uninstall, doctor drift and `/claudemd-update` treat it as a set. `~/.claude/CLAUDE-extended.md` stays one version as a stub pointing at the modules, so an old core or a user habit that reads it gets an answer.
7. **Maintainer-only text leaves agent-loaded files**: §13 META / §13.1–13.3, Recent changes and the Sizing line move to `OPERATOR.md` and the changelog; the agent-facing part of §13 META (spec changes are L3; show the diff) already lives in `.claude/rules/spec-edit.md` for this repo. Scripts that read the Sizing line from extended (`spec-sizing`, `version-cascade-check`, `spec-coherence-audit`) move with it.
8. **Release**: spec v7.0.0 (loading protocol changes: major per §13 META). Plugin version per the runbook. CHANGELOG migration note, revert path (pin the previous plugin), one-time notice.

## module map (new ← current)

| Module | Loads on | From (current sections) | Size now |
|---|---|---|---|
| core | always | §0 (trimmed), §1, §1.5, §2 (no §2.2), §3, §5, §5.1, §7 core, §8, §9, §10, §11 universal bullets, module index | ~20 KB |
| `ship.md` | tag, release, publish, deploy | §EXT §12 Ship-pipeline hardening + Runbook fast-path, §2-EXT Released-artifact checklist, §7-EXT Ship-baseline rationale, core §7 push-fires-CI trigger | ~5.3 KB |
| `review.md` | any review; pre-ship review | §EXT §12 Hard cooperation rules (Author ≠ reviewer, Blind brief), Review-finding repair, §11-O Report by file | ~2.6 KB |
| `skills.md` | choosing a skill | §EXT §12 Skill routing table (the one copy), §4 Routing / Composite / Skill invocation folded in, Division of labor dropped (the table carries it), Detection / Gated = missing | ~5.5 KB |
| `verify.md` | L2+ validation, tests, evidence | §7-EXT (L3 validate, Iron Law #1, evidence ladder, cold-start, evidence validity), core §7 Evidence-beyond-green-tests (non-ship triggers), Appendix B.2, §10-R four-section detail | ~5.2 KB |
| `debug.md` | a bug, a failing test | §6 DEBUG (Iron Law #3, three-strike, dead-end) | ~1.3 KB |
| `plan.md` | L3, specs, plans | §2.S, §4.FULL, §4.FULL-lite | ~4.3 KB |
| `orchestrate.md` | subagents, parallel work | §11-O Defaults, Subagent rules (minus Report by file), Cross-session reference | ~2.8 KB |
| `memory.md` | saving or recalling memory | §11-EXT-MEM (layer routing, auto-memory tree, tag syntax), core §11 memory-routing and auto-memory bullets | ~5.4 KB |
| `auth.md` | deleting, AUTONOMY_LEVEL, public API | §5-EXT, §5.1-EXT, Appendix B.1 | ~3.1 KB |
| `modes.md` | HACK / EMERGENCY / AUTONOMOUS, cancel/switch | §2-EXT Override modes, §0.2-EXT | ~3.8 KB |
| `session.md` | long sessions, context pressure | §11-EXT Session heuristics, §7-EXT-TMP, §11-EXT-MAC, §1.5-EXT | ~2.6 KB |
| OPERATOR.md | (human) | §13 META, §13.1, §13.2, §13.3, Recent changes, Sizing | — |

Dropped with no new home (rule already stated elsewhere, checked before deletion): §4 Routing rows that restate §12's table; Division of labor; §10-V reference list (the patterns file and core §10 carry it). Each deletion is listed in the change log below with where the rule still lives.

## success-criteria

1. Offline A/B (audit §10.10) through `scripts/offline-eval/`: B's spec bytes read per session ≤ 50% of A's; guardrails: T4 and T8 5/5 in B; every other task B ≥ A − 1; T1 reads no module in at least as many runs as A reads no extended.
2. Tier-2 triggers, on this machine's historical human prompts: median modules per prompt ≤ 1; prompts matching ≥ 2 modules ≤ 15%; every session that later tagged a release gets `ship.md` from tier 2 or tier 3 (prompt-only recall is reported, not required: continuation prompts such as "开始" carry no keyword).
3. `npm run check` green, `spec-coherence-audit --strict` 0 C/H/M, every HARD rule ID found exactly once across core + modules, `hard-rules.json` rows carry `file`.
4. A fresh-HOME install, an upgrade from v6.36.0, `/claudemd-update` and uninstall all leave the module set consistent (sandbox HOME, per §8.V3).

## open-questions

1. Does `skills.md` keep all three plugins' rows, or only the rows whose skill is registered on the machine (doctor knows)? Draft: keep all, shipped spec is for every user.
2. Tier 2 for sessions whose first prompt matches nothing but the task turns into a ship later: tier 3 covers ship; the others rely on the index. Acceptable by criterion 1's guardrails, or needs a PreToolUse injection on e.g. the first test edit? Decide from the A/B.
3. TDD default skill (audit E5): `sp:test-driven-development` vs `matt:tdd`, decided by the extra T3 arm; tie keeps sp.

# Change log

- r5 (2026-09-27): shipped as spec v7.0.0. Offline A/B (eight tasks × five runs, Opus 5.5 high; A = v6.36.0): A 34/40, B 37/40; T4 and T8 5/5 in both; no task in B more than one run below A; spec bytes beyond core A 9,972 per run, B 2,117 (21%). Criterion 1 met, including T1 (no module read in 5/5, as A read no extended in 5/5). The first B build tagged before any review in 4/5 ship runs: `ship.md` referred to "Author ≠ reviewer above", which sits in `review.md`. `ship.md` now carries a Pre-tag review line pointing at `review.md` and names the review in the manual-ship step list; the rebuilt arm's ship task went 3/5, 0 tags before review. The harness had not asked `claude -p` for hook events, so the first B run recorded no injections (fixed in 2a36863; three tasks' injection bytes were measured by replaying the hook). Criterion 3: 25/26 HARD anchors found exactly once in core + modules; §0.1 is maintainer text (moved there in v6.36.0, M5) and found in none. `hard-rules.json` rows carry no `file` yet — with the stub extended, v7.1. Criterion 4 checked in a sandbox HOME: fresh install, upgrade from 75b9324 (pre-modules), update restoring a tampered module and removing an orphan, uninstall keep/delete. Open question 2 (non-ship sessions that never match): no guardrail failed; left open. Open question 3: E5 not testable in the harness (no plugins loaded); sp kept per the tie rule. Known: a typo-fix prompt matches `debug`'s triggers; `/claudemd-update`'s preview does not compare modules.

- r4 (2026-09-27): first build — 11 modules, 47.9 KB; skills 8.3 KB and verify 6.9 KB exceed 6 KB. skills holds both §4 Routing and §12's table; removing §4's copy means rewiring `scripts/lib/spec-routing.js#routingPrimaries` and its three consumers (spec-structure join, doctor skills-enabled and gstack-reachable, the 15-primary floor), so the routing dedupe moves to v7.1 and the v7.0 cap is 9 KB per module, 50 KB total. v7.0 still installs the full extended (compatibility); the stub waits for v7.1 too.

- r3 (2026-09-27): modules become build outputs of marked sections in `spec/CLAUDE-extended.md` instead of hand-split files, so rules stay single-sourced and the ~11 tests and 5 scripts keyed on extended keep their subject. Module caps unchanged.

- r2 (2026-09-27): tier-2 calibration (`scripts/offline-eval/trigger-calibrate.mjs`, 191 sessions / 1,426 human prompts since 09-05). Whole-prompt matching: >= 2 modules on 17.4% of prompts (over budget). Hybrid — `ship` on the whole prompt, the other modules on the first 300 characters: median 0 modules, >= 2 modules 4.3%, any module 36.5%, ship prompt-recall 116/131 sessions. Criterion 2's ship recall now counts tier 3, because the misses are continuation prompts.

- r1 (2026-09-27): draft from audit §10 with §12.3's tier-2 revision; core target revised 15 → 20 KB from measured section sizes; module cap 4 → 6 KB.
