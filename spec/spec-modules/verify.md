---
module: verify
loads-on: when validating an L2+ change: evidence tiers, test scope, report shape
triggers: 
trigger-window: head
---

# AI-CODING-SPEC v7.1.0 — module: verify

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §7-EXT VALIDATE (L3)

```
L3  TDD + full suite + e2e                    → inline evidence with numbers+baseline
    (no e2e infra: integration + smoke → [PARTIAL: no-e2e-infra], follow-up filed)
```

L2 evidence rules → core §7 (inline prose with numbers+baseline). The 5-tier evidence ladder and cold-start handling below bind at **L2+**, not L3 only. Iron Law #1 below binds at L2+ — its one-line form lives in core §7; this section carries the detail.

### Iron Law #1: NO CHANGE WITHOUT FAILING EVIDENCE (L2+)

**Additive exception**: no prior failing path (new field validation / new branch / new endpoint / new optional param / additive schema) → TDD RED-first: write test covering new behavior, confirm fails, implement to green. Log: "additive: new-test-first, no prior failing path". Does NOT apply to bugfix — bugfix always needs prior reproduction.

[HACK] skips Iron Law #1 entirely.

### Evidence ladder (L2+, prefer highest tier)

1. **Failing unit/integration test → fix → green.** (sp:TDD enforces.)
2. **Executable repro script** (shell/python). When test infra absent.
3. **Snapshot / DOM assertion / log reproducer.** Visual or runtime bugs. Visual → `gs:/browse` capture.
4. **Minimal harness in `tmp/`.** Legacy / glue code.
5. **Last resort**: state "no reproducer — <structural reason>". Valid reasons only: unmockable hardware / prod-scale race / third-party side channel.

Falling to tier N requires stating why N-1 unfit.

**Intermittent**: tier-2 stress script forcing race window counts as tier-1 proxy. State: "intermittent: tier-2 stress-repro used as tier-1 proxy, reason: <timing/concurrency/external>". Must reproduce ≥1 failure in documented run-count.

**UI copy / user-facing text**: text-only → L1-copy (core spec). Text + layout/logic → tier-3 (snapshot or gs:/browse screenshot). No snapshot infra → `[PARTIAL: visual-not-verified]` + file follow-up.

### Cold-start (no test framework)
- Justify once in `tasks/lessons.md` (`no test framework, cold-start mode — reason: <…>`).
- L2+ → tier-2 repro script committed under `tests/repro/<slug>.sh`.
- Close with `[PARTIAL: no-test-infra]` + follow-up "bootstrap test framework".
- Exit: once framework lands, clause stops applying to new tasks.

### Evidence validity (HARD)
- **Semantic linkage**: the claim ("fixed X") must follow from the observation ("test Y went from FAILING to PASS"). Existence (`grep`/`ls`/`cat`/`git status`) ≠ behavior — auxiliary context only.
- **Valid evidence types**: test-runner output, executable script output, runtime log, HTTP response (status+body), DOM assertion, benchmark output.
- **Test scope (SHOULD)**: prefer tests covering modified files + direct importers. Transitive optional — no cheap graph tool OR full suite >5min → co-located + smoke on known direct consumers + note scope limit in Uncertain.
- **Enforcement**: completion claims must cite the tool-call output that grounds them — inline, same sentence or next. §10 Specificity binds: no "significantly improved / robust / N× faster" without numbers + baseline. A bare "Done" claim or one preceded by banned adjectives = NOT DONE — rewrite with absolute numbers or ratios with baseline.

Order: project CI > defaults. No CI → build + smoke and report `[PARTIAL]`.

## §10-V Banned-vocab (reference list)

Core §10 keeps the quick-check (top-5 EN + 中文). The mechanical gate is the plugin's `hooks/banned-vocab.patterns` (deny/advisory on prose + commit text regardless of which spec files are loaded); the OK-shapes below are the fix recipes.

**OK (absolute)**: "reduced p99 580ms → 140ms" / "12/12 tests pass" / "65 → 64 tests after consolidation".

**OK (ratio with baseline)**: "1453 → 1490 tests (+2.5%)" / "cut FTS latency from 380ms to 95ms (4×)".

**OK (中文 with baseline)**: "FTS 查询 380ms → 95ms（4×）" / "fixed at schema.mjs:147, 12/12 tests pass".

When banned, fix = strip the hedge, state the specific case with absolute or baseline-anchored number.

## §10-R COMPLETE (L3)

### Full four-section (L2 and L3 always — core §10, which is the layer that binds at L2)
```
Done:      <items, each with inline evidence (test/run output + numbers+baseline)>
Not done:  <deferred, with reason>
Failed:    <blocked, with cause>
Uncertain: <not sure about, stated as "uncertain because <X>">
```

**L3 zero-issue short** (Not done=∅, Failed=∅, Uncertain=∅): single `Done:` paragraph with evidence inline, no four-section scaffolding needed. L3 only; L2 follows core §10.

**Multi-task**: each task writes its own block. Do NOT merge.

**EMERGENCY mode adds**: incident report (Timeline / Root-cause / Rollback / Follow-ups); file follow-up task.

### Auto-decisions (post-AUTH ambiguity)
One prose line: "chose <X> over <Y> because <rationale>; reversible (cost: <est>) if wrong." No bracketed form.

### Lessons file (SHOULD)
- Path: `tasks/lessons.md`. Cap 30 entries, newest first. Prepend on user correction. Drop oldest when full.
- Read when a task's keywords match an entry; no session-start read — MEMORY.md and the recall plugin are the session-start layer (§11-EXT-MEM).
- Format: `- <YYYY-MM-DD> [pattern]: <wrong> → <rule>`.

## Appendix B — Canonical examples

### B.2 Valid vs invalid evidence

**Valid** (bugfix, ties prior-failing anchor to fresh pass):
> Done: fixed double-apply coupon bug. Checked: tests/orders/test_checkout.py::test_coupon_applies_once, pre-fix FAILED expected 90.00 got 100.00, post-fix PASSED; coupon now subtracts once.

**Invalid — existence ≠ behavior**: `grep -n "def apply_coupon" src/orders/checkout.py → 127:def apply_coupon(…)` then claiming "fix works". ❌ Presence of the function is not proof it behaves.

**Invalid — bugfix missing prior-failure anchor**: `pytest -q → 47 passed` then claiming "bug fixed". ❌ Need RED proof before GREEN — cite the failing run or test name that now passes.

**Valid — additive new endpoint** (no prior-failing path; RED-first on new tests):
> Done: added GET /users/{id}/preferences. Checked: tests/users/test_preferences.py 3 passed: unknown → 200+{}, known → dict, deleted → 404; contract matches spec success-criteria.

**Valid — intermittent/concurrency** (tier-2 stress-repro as tier-1 proxy):
> Done: closed double-charge race window with row-level lock. Checked: ./scripts/stress_race.sh --workers 20 --iterations 5000, pre-fix 47/5000 double-charges, post-fix 0/5000 across 3 runs. Intermittent: tier-2 stress-repro used as tier-1 proxy, reason concurrency-dependent.
