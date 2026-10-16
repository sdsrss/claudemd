---
module: ship
loads-on: before tagging, releasing, publishing or deploying
triggers: 发版|发布(新)?版本|(?<![开触研出批激散引])发\s*v?[0-9]+(\.[0-9]+)+|(推送|合并)\S{0,4}\s*发布|打\s*tag|(?<![A-Za-z0-9_])ship(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])cut a release(?![A-Za-z0-9_])|create-release|merge-and-push|(?<![A-Za-z0-9_])release(?![A-Za-z0-9_]).{0,40}(?<![A-Za-z0-9_])to npm(?![A-Za-z0-9_])|npm publish|gh release|(?<![A-Za-z0-9_])deploy(?![A-Za-z0-9_])|上线
trigger-window: whole
---

# AI-CODING-SPEC v8.1.0 — module: ship

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §2-EXT Released-artifact checklist (L3 hard upgrade, core §2)

When a change qualifies as "released-artifact user-visible default behavior change" (npm / crates.io / marketplace package where users feel the upgrade difference) — core §2 escalates it to L3 regardless of size. Requirements before ship:
- **SemVer non-patch bump** (minor for additive user-visible change, major for breaking).
- **CHANGELOG migration note at top**: what changes, what action users must take.
- **Explicit opt-out or revert path**: env flag, config key, prior-version pin instructions, or rollback command.
- **One-time discoverability signal**: stderr banner / first-run log / release-note callout — so users who don't read CHANGELOG still notice.

Missing any item on a user-visible default change = incomplete ship; list it under the report's open items.

## §7-EXT VALIDATE (L3)

### Ship-baseline rationale (core §7)
Core §7 defines the rule: before a push that fires CI/Release, check pushed-branch pipeline color; red → fix / annotate / ASK. Rationale in brief: stacking on red loses attribution for the next shipper; local green ≠ pipeline green (CI toolchain / lint-ruleset / env / platform drift); "I think CI is green" is not a check — state the concrete command run (`gh run list ...`) and cite the result.
Override form: commit body line `known-red baseline: <one-line reason>` (e.g. `known-red baseline: flaky test_x.y quarantined in issue #N, fix landing in PR #M`). Absence of this line + red baseline = spec violation.

## §12 PLUGINS

### Ship-pipeline hardening (HARD)
On `ship` / `deploy` / `create-release` / `merge-and-push`, after reading this module, run the release from a written checklist: the project's ship runbook, else a listed ship skill. Neither → ship by hand against the checklist below and state `manual ship because <reason>` as the REPORT's first line — absence = spec violation.

**Pre-tag review**: no tag before a fresh-subagent reviewer has reviewed the release (§12 Author ≠ reviewer; it and the brief rules are in `review.md`: read it before spawning the reviewer).

Checklist (a runbook or skill may cover it in its own words): version sites in sync, CHANGELOG entry, release notes from its top entry, the release artifact (GitHub Release vs. bare tag), CI green on the pushed SHA. Each step fails silently by hand; the REPORT line lets a reviewer audit a checklist-less ship against this list. A deploy no deploy skill runs, from a runbook or by hand, needs `[AUTH REQUIRED op:manual-deploy]` before the atomic run below starts: the ship request covers push, tag and release, not a deploy.

**Manual-ship atomicity (HARD, clarification)**: a ship run without a ship skill — from a runbook or by hand — is still **one atomic turn**. Upon entering it, (1) enumerate every remaining step inline (typically commit → push → pre-tag review → tag → release-artifact → CI verify) as a visible plan, and (2) execute them back-to-back within the same turn. No turn-ending between commit and the final report with CI green. Green CI (or equivalent release-gate signal) is the Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: a hard failure (push rejected, tag collision, CI red) — stop at the failure with full context, not at a clean green step. **Second exception**: awaiting any subagent whose report this ship needs (the pre-tag reviewer, a repair or repro spawn), whenever it was spawned — yield per core §11 naming it; its completion re-invokes the cycle, which resumes at the next step. The user's single ship-AUTH — per §5 "per-task, per-scope" — covers push/tag/release; do not re-litigate it one manual step at a time.

**Runbook**: a project's ship-runbook memory (§11-EXT-MEM Ship-runbook consolidation) is read together with this module. A runbook may repeat the obligations above, never waive them; where the two differ, this module wins, and every §12 HARD obligation binds unchanged.
