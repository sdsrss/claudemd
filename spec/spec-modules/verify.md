---
module: verify
loads-on: when validating an L2+ change: evidence tiers, test scope, report shape
triggers: 
trigger-window: head
---

# AI-CODING-SPEC v8.0.0 — module: verify

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §7-EXT VALIDATE (L3)

```
L3  TDD + full suite + e2e                    → verification lines with numbers+baseline
    (no e2e infra: integration + smoke, e2e reported as could not run, follow-up filed)
```

L2 evidence rules → core §7 (numbers with their baseline, in the report's verification part). The 5-tier evidence ladder and cold-start handling below bind at **L2+**, not L3 only. Iron Law #1 below binds at L2+ — its one-line form lives in core §7; this section carries the detail.

### Iron Law #1: NO CHANGE WITHOUT FAILING EVIDENCE (L2+)

**Additive exception**: no prior failing path (new field validation / new branch / new endpoint / new optional param / additive schema) → TDD RED-first: write test covering new behavior, confirm fails, implement to green. Log: "additive: new-test-first, no prior failing path". Does NOT apply to bugfix — bugfix always needs prior reproduction.


### Evidence ladder (L2+, prefer highest tier)

1. **Failing unit/integration test → fix → green.**
2. **Executable repro script** (shell/python). When test infra absent.
3. **Snapshot / DOM assertion / log reproducer.** Visual or runtime bugs. Visual → browser capture (core §2.1).
4. **Minimal harness in `tmp/`.** Legacy / glue code.
5. **Last resort**: state "no reproducer — <structural reason>". Valid reasons only: unmockable hardware / prod-scale race / third-party side channel.

Falling to tier N requires stating why N-1 unfit.

**Intermittent**: tier-2 stress script forcing race window counts as tier-1 proxy. State: "intermittent: tier-2 stress-repro used as tier-1 proxy, reason: <timing/concurrency/external>". Must reproduce ≥1 failure in documented run-count.

**UI copy / user-facing text**: text-only → L1-copy (core spec). Text + layout/logic → tier-3 (snapshot or browser screenshot). No snapshot infra → report the visual check as could not run + file follow-up.

**Web-visible behaviour** to verify: a browser pass over the changed user-facing surface, reported as §7 L2 evidence. No browser reachable → ask the user for a screenshot or log; neither → report it as could not run (no browser).

### Cold-start (no test framework)
- Justify once in the spec file or the report (`no test framework, cold-start mode — reason: <…>`).
- L2+ → tier-2 repro script committed under `tests/repro/<slug>.sh`.
- Report the test suite as could not run (no test infra) + follow-up "bootstrap test framework".
- Exit: once framework lands, clause stops applying to new tasks.

### Evidence validity (HARD)
- **Semantic linkage**: the claim ("fixed X") must follow from the observation ("test Y went from FAILING to PASS"). Existence (`grep`/`ls`/`cat`/`git status`) ≠ behavior — auxiliary context only.
- **Valid evidence types**: test-runner output, executable script output, runtime log, HTTP response (status+body), DOM assertion, benchmark output.
- **Test scope (SHOULD)**: prefer tests covering modified files + direct importers. Transitive optional — no cheap graph tool OR full suite >5min → co-located + smoke on known direct consumers + note the scope limit under open items.
- **Enforcement**: completion claims must cite the tool-call output that grounds them — in the report's verification part, one line per check. §10 Specificity binds: no "significantly improved / robust / N× faster" without numbers + baseline. A bare completion claim or one preceded by banned adjectives = NOT DONE — rewrite with absolute numbers or ratios with baseline.

Order: project CI > defaults. No CI → build + smoke, and report CI as could not run.

## §10-V Banned-vocab (reference list)

Core §10 keeps the quick-check (top-5 EN + 中文). The mechanical gate is the plugin's `hooks/banned-vocab.patterns` (deny/advisory on prose + commit text regardless of which spec files are loaded); the OK-shapes below are the fix recipes.

**OK (absolute)**: "reduced p99 580ms → 140ms" / "12/12 tests pass" / "65 → 64 tests after consolidation".

**OK (ratio with baseline)**: "1453 → 1490 tests (+2.5%)" / "cut FTS latency from 380ms to 95ms (4×)".

**OK (中文 with baseline)**: "FTS 查询 380ms → 95ms（4×）" / "fixed at schema.mjs:147, 12/12 tests pass".

When banned, fix = strip the hedge, state the specific case with absolute or baseline-anchored number.

## §10-R COMPLETE

### Report shape (core §10)
```
## 汇报

**变更**：<what changed, files, commit and branch, spec path>
**验证**：
- `<command>` → 通过（<numbers with baseline>）
- `<command>` → 未运行（<why>）
**遗留**：<unfinished work, risks, decisions: options / cost / your pick>
```

**Multi-task**: each task writes its own report. Do NOT merge.

### Auto-decisions (post-AUTH ambiguity)
One prose line in the spec file's decisions section (else the report's open items): "chose <X> over <Y> because <rationale>; reversible (cost: <est>) if wrong." No bracketed form.

## Appendix B — Canonical examples

### B.2 Valid vs invalid evidence

**Valid** (bugfix, ties prior-failing anchor to fresh pass):
> **Changes**: fixed the double-apply coupon bug in `src/orders/checkout.py`.
> **Verification**:
> - `pytest tests/orders/test_checkout.py::test_coupon_applies_once` before the fix → failed (expected 90.00, got 100.00)
> - the same test after the fix → passed; the coupon now subtracts once

**Invalid — existence ≠ behavior**: `grep -n "def apply_coupon" src/orders/checkout.py → 127:def apply_coupon(…)` then claiming "fix works". ❌ Presence of the function is not proof it behaves.

**Invalid — bugfix missing prior-failure anchor**: `pytest -q → 47 passed` then claiming "bug fixed". ❌ Need RED proof before GREEN — cite the failing run or test name that now passes.

**Valid — additive new endpoint** (no prior-failing path; RED-first on new tests):
> **Changes**: added GET /users/{id}/preferences.
> **Verification**:
> - `pytest tests/users/test_preferences.py` → passed (3/3: unknown → 200 + {}, known → dict, deleted → 404); the contract matches the spec file's acceptance criteria

**Valid — intermittent/concurrency** (tier-2 stress-repro as tier-1 proxy):
> **Changes**: closed the double-charge race window with a row-level lock.
> **Verification**:
> - `./scripts/stress_race.sh --workers 20 --iterations 5000` before the fix → failed (47/5000 double charges)
> - the same run after the fix, 3 runs → passed (0/5000 each); a tier-2 stress reproduction stands in for tier 1 because the bug depends on concurrency
