# Improvement candidates (2026-05)

Distinct from `tasks/rule-candidates-*.md` (which logs HARD-rule promotion candidates under §13.2 budget). This file logs **engineering improvements** to the claudemd plugin's memory layer that surfaced during the v0.21.5 user audit but were deferred per minimal-scope decision. No §13.2 process implied; pull into a normal patch/minor release when ROI is clear.

Source: user audit dated 2026-05-24, session 25/05 ultrathink analysis of "claude-mem-lite × MEMORY.md 智能记忆功能". 5 P-level recommendations were given; P0 + P3 shipped in v0.21.5; P1/P2/P4/P5 logged here.

---

## P1 — Type-distribution audit (data-first)

**Observation**: in this project's `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/`, 21/25 files (84%) are `feedback_*`; 0 `user_*`; 0 `project_*`; 2 `reference_*`; 1 `plugin_*`. Either:

- (a) Solo OSS plugin project genuinely has no cross-session user-profile content (user identity lives in project `CLAUDE.md` `AUTONOMY_LEVEL`) and no project-fact content (spec is single source of truth, `project_*.md` would duplicate). Distribution is correct.
- (b) `feedback_*` is the easiest soft-trigger category to land into, so all rules collapse there regardless of CC's 4-type intent.

**Trigger to act**: run `node bin/claudemd-lint.js audit --type-distribution` (or equivalent in `claudemd-doctor`) across ≥3 active projects. If `feedback_*` consistently dominates beyond ~70% AND there are misclassified entries (e.g. solo-dev profile written as `feedback_*`), add a routing example to `§11-EXT Memory operations` distinguishing the four types with concrete this-vs-that examples.

**Do NOT do now**: pre-emptive spec edits without audit data — per `feedback_spec_net_delete_paired_with_addition.md`, pre-staged spec changes are ready-decisions not execution-backlog.

---

## P2 — Lesson-promotion candidate counter

**Spec rule** (§11-EXT bottom of Memory operations / `feedback_memory_layer_routing.md`): "Promotion path: a recurring bugfix postmortem (cited ≥2 sessions OR caused a regression) → write a `feedback_*.md` trap rule referencing it." Currently zero machine-counting — relies on agent manually flagging "第三次同款复发" in description (e.g. `feedback_cli_flag_shape_silent_fallback.md`).

**Sketch**: extend `claudemd-doctor` with a `--lesson-promotion-candidates` report that:
1. Pulls last-30d `mem_search --type bugfix` via `claude-mem-lite` CLI.
2. Clusters by title-prefix similarity OR shared tag.
3. Lists clusters with ≥2 entries as "candidate promotions to trap-rule" with file paths.
4. Agent reviews + decides per-cluster (no auto-promote).

**Skip if**: claude-mem-lite plugin not present (no recall layer to query — promotion criterion becomes moot).

**Estimated effort**: L1, ~60 LOC + 1 test. Could land in v0.22.x.

---

## P4 — MEMORY.md sub-index threshold

**Observation**: current MEMORY.md is 7176 B / 28 lines. CC truncates `MEMORY.md` past 200 lines. Growth rate over v6.10 → v6.13 ≈ 4-5 lines per minor — comfortable.

**Trigger to act** (tightened 2026-05-24 per v0.21.5 code review): MEMORY.md crosses **40 lines** OR 10 KB. Reviewer's reasoning: at 4-5 lines/minor, the original 50-line trigger fires around v6.18.x (≥6 months). Pulling to 40 lines lands the sub-index design *before* truncation pressure, not after — buying head-room for the design itself rather than absorbing it under deadline. At that point, split into:
- `MEMORY.md` (index of indexes, router)
- `INDEX-feedback.md`, `INDEX-reference.md`, `INDEX-project.md` per-type sub-indexes
- Both `memory-prompt-hint.sh` and `memory-read-check.sh` learn to traverse sub-indexes.

**Preemptive doc**: add a sentence to `§11-EXT Memory operations` once we have a concrete reason — premature now.

---

## P5 — `memory-prompt-hint.sh` sort order (CLOSED — original analysis was wrong)

**Original claim** (from 2026-05-24 ultrathink audit): "the hook caps at 5 sorted by MEMORY.md authoring order — high-precision matches lost when COUNT > 5".

**Re-verification 2026-05-24** (post-write of this file): the cited comment at `memory-prompt-hint.sh:122-123` is part of a v0.19.2 B3 changelog-style annotation block (lines 119-126) explaining WHY the priority sort was added. "Pre-this, output order = MEMORY.md authoring order" describes the historical pre-fix behavior, not current behavior. The actual sort at line 160 is `sort -t$'\t' -k1,1nr -k2,2nr` over `SORT_ROWS` with `tag_count` as field 1 and `mtime` as field 2 — exactly the priority ranking the original audit recommended.

**Status**: not actionable. The improvement is already shipped. Closed candidate.

**Lesson**: when citing inline comments as evidence of stale behavior, Read the surrounding comment block first — a `// before this change, X` annotation is documenting an improvement, not flagging a bug.

---

## P6 — Mechanical Sizing pre-tag check (SHIPPED in v0.21.6)

**Status**: shipped 2026-05-24 in plugin v0.21.6 (spec unchanged at v6.13.2).

**What landed**: `scripts/version-cascade-check.js#runSpecSizingCheck` over-threshold drifts now carry `suggested: {old, new}` — the exact OLD/NEW Sizing-line substrings to edit. CLI prints them as a 3-line block under each drift. Works for both arrowed (`core 24417 → 24432 bytes`) and plain (`OPERATOR.md 6405 bytes`) claim forms.

**Verification**: 446 unit + 2 integration suites pass; functional smoke against synthetic fixtures (arrowed +50B drift on extended, plain +100B drift on OPERATOR.md) produced correct OLD/NEW substrings.

**Effort vs estimate**: estimated ~25 LOC + 1 test; actual ~35 LOC (script) + 2 tests (arrowed + plain forms). Plain-form coverage was added after re-reading `extractSizingClaim` and noticing OPERATOR.md uses plain form when unchanged.

**Why this matters**: next Sizing-rewrite patch (whenever one touches CLAUDE-extended.md content), the corrective edit is one Edit-tool replacement instead of arithmetic-in-head. v0.21.5 burned 2 extra turns on this; v0.21.6+ should land in 1 corrective pass.

---

## Tracking

- Next review: paired with next claudemd-audit cadence (every 20 L2+ tasks OR 30 days per §13.2 batch-review).
- Promotion to action: any candidate gaining a concrete user-visible trigger (e.g. P1 audit data shows misclassification, P4 MEMORY.md crosses 50 lines).
- Drop criteria: no movement in 6 months → archive.
- 2026-07-10 (v0.32.3 pre-tag review, Low, deferred): `spec/hard-rules.json:2` `_doc` still says "§13.1 quarterly demote (rules with 0 hits in 90d)" — canonical window is 30d (core §0.1 → OPERATOR.md §13.1). Doc-comment drift only; fold into next batch patch that touches hard-rules.json.
