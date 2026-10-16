# AI-CODING-SPEC v8.1.0 — Extended

Loaded on demand; core §2.2 holds the one trigger list. Version history: `~/.claude/CLAUDE-changelog.md`. Operator handbook (human-facing, not auto-loaded): `~/.claude/OPERATOR.md`.

<!-- module: auth -->
## §3-EXT User relaxation (detail)

The §3 Order resolves conflicts, not permissions; where the user has not spoken about a clause, the stricter reading governs. HARD rules and §5 AUTH gates move only through §5.1 `AUTONOMY_LEVEL`, `SAFE_DELETE_PATHS:` and §8.V3's on-real-repo exception. Neither a default nor a HARD rule / AUTH gate: recommend and proceed, reading stated in one line.

## §5-EXT Safe-paths whitelist (detail)

Strict prefix match (NOT glob):

- `tmp/**`
- `node_modules/**`
- `dist/**`
- `build/**`
- `.cache/**`
- `coverage/**`
- `.next/**`
- `.nuxt/**`
- `target/debug/**`
- `target/release/**`
- `__pycache__/**`
- `.pytest_cache/**`

**NEVER-covers** (hard AUTH even when the path matches a prefix above):

- a path reached through a `..` component — the prefix certifies where it points, not where a walk from it lands
- anything under `.git/`
- a path whose resolution leaves the project root (symlink included — delete the link, not through it)
- a bare prefix with no subpath (`dist/`, not `dist/bundle.js`)
- a path that is itself a §5 Hard subject OTHER than the delete — `.env`/secret/config schema, migration/DB schema, CI/deploy/infra config, `~/.claude/settings.json` / user-global hooks / MCP config. Closed set, and the exclusion is load-bearing: `delete file/dir` is §5 Hard's first item, so a clause reading "anything §5 Hard names" would swallow the safe-path carve-out whole

**`SAFE_DELETE_PATHS:` extension rule**: a project `CLAUDE.md` MAY add prefixes. Bounds, all of them:

- project-root-relative directory prefixes only — no absolute path, no `~`, no `..`, no glob
- an entry covering a NEVER-covers item is ignored, not honoured — the project file extends the list, it cannot raise its ceiling
- effective only for the project declaring it

§3-EXT names this one of three channels that move a §5 AUTH gate; these bounds are what keeps it a channel rather than an opening.

<!-- module: ship -->
## §2-EXT Released-artifact checklist (L3 hard upgrade, core §2)

When a change qualifies as "released-artifact user-visible default behavior change" (npm / crates.io / marketplace package where users feel the upgrade difference) — core §2 escalates it to L3 regardless of size. Requirements before ship:
- **SemVer non-patch bump** (minor for additive user-visible change, major for breaking).
- **CHANGELOG migration note at top**: what changes, what action users must take.
- **Explicit opt-out or revert path**: env flag, config key, prior-version pin instructions, or rollback command.
- **One-time discoverability signal**: stderr banner / first-run log / release-note callout — so users who don't read CHANGELOG still notice.

Missing any item on a user-visible default change = incomplete ship; list it under the report's open items.

<!-- module: plan -->
## §2.S SPEC ARTIFACT

Spec = what & why (stable); plan = how & when (volatile). A spec outlasts many plans.

### Spec file
- Path: `tasks/specs/<slug>.md` (project CLAUDE.md may override via `SPEC_DIR:`). Auto-create, no AUTH. One file per task, kept current: it is the hand-over, so someone with no context must be able to continue from it. Body in the user's language (core §1).
- Template (indented two spaces here only so its `#` lines are not read as this file's headings; headings in the user's language, 中文 shown, English in parentheses):

```
  # <feature or task name>
  状态：草稿 | 进行中 | 已完成   (Status: draft | in progress | done)

  ## 背景与目标 (Background and goal)
  ## 范围 (Scope)
  - 做： (In:)
  - 不做： (Out:)
  ## 验收标准 (Acceptance criteria)
  - [ ] AC1：<observable behaviour> — 验证：`<command or steps>`
  ## 方案 (Design)
  <key design, interface and data changes, trade-offs and why, research findings>
  ## 计划 (Plan)
  - [ ] S1：<slice> — 覆盖 AC1 — 依赖：无 — 执行：主会话 | <agent>
  ## 决策与进展 (Decisions and progress)
  - <decision and why / where the work stands / blockers / awaiting the user>
  ## 验证记录 (Verification record)
  - `<command>` → <verdict>
```

### When required
- **L3**: mandatory, written before AUTH (§4.FULL step 4) with background, scope, acceptance criteria and design filled.
- **L2**: when the change crosses ≥2 Modules, runs past ~50 changed lines or adds a dependency (core §2). Bugfix restoring documented behavior → no spec file.

### Spec changes mid-work
- Goal, scope or acceptance criteria change → contract shift → ASK the user.
- Design or plan tightening → decide if reversible; record it under decisions and progress.
- Tick plan items and acceptance criteria as they are verified; set the status to done only when every criterion has a passing verification record. Re-classify in prose if the level shifts.

### Plan drift threshold (mid-implementation)
During execution, if the plan's file map / naming / schema / signatures disagree with the actual code:
- **1 mismatch**: fix inline, note it under the report's open items.
- **≥2 mismatches in one task**: list each under the report's open items as file:line before/after. Not a bracketed signal — core §0 has exactly one, and a second token shaped like it is one the reader has to learn for no gain.
- **≥5 mismatches across a task OR any cross-task contradiction**: pause and escalate to re-planning in prose. Do NOT silently rewrite plan intent.

Common drift source: plan sketches (type lists / table fields / filesystem shapes / test import paths) written without Reading the real artifact — verify against code, not the sketch.

<!-- module: plan -->
## §4 FLOW

### §4.FULL (L3 full path)

For L3 hitting: auth/payment/crypto, prod data-migration, breaking schema, ≥4 Modules, cross-cutting architecture.

1. **Clarify**: product + tech questions in one ask, tagged `[product]` / `[tech]`.
2. **Plan**: in the spec file's plan section, user-reviewed. 2-5 min tasks with file paths / code / verify steps. Runtime-heavy ops (backfill / migration / build / model training) = single task regardless of runtime; annotate wall-clock + offline-window.
3. **Plan review** (optional): 3-view self-critique (CEO / design / eng) on user request or auth/payment/crypto/cross-module ≥5. Default: user reviews + inline eng self-critique (1 paragraph).
4. **AUTH**: §5 hard. User confirms plan and risk.
5. **Isolate**: worktree or branch (stash before switching). At L3 this overrides core §7 Git's current-branch default.
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

**Escalate to §4.FULL** if any FULL trigger appears mid-work (new auth/payment/crypto; Modules >3; data-migration introduced). Re-run step 3 on the widened scope; add the security pass if security surface appeared. Do NOT silently continue under lite.

<!-- module: debug -->
## §6 DEBUG

```
env/dep/config    → fix + 1 retry → pause, surface blocker in prose
syntax            → auto-fix ≤2 attempts
L1 code bug       → §7.L1-bugfix (core)
L2+ code/logic    → Iron Law #3 below (root cause first)
env/staging/deploy → investigate there first (logs / config / deploy diff); code cause → row above
UI/visual         → browser capture (core §2.1) → route per cause
sideways          → STOP + stash → re-plan (note pivot reason)
```

### Iron Law #3: NO FIX WITHOUT ROOT CAUSE (L2+)
Investigate → Analyze → Hypothesize → Implement (with §7 evidence). Symptom-only fixes banned at L2+.

### Three-strike rule
Same error signature 3× → roll back the path that introduced it. Signature = `error_msg_normalized[:80]` + `exception_type`; 2+ matching = same. **Manual trigger**: user repeat-failure feedback (e.g. "又失败 / 又挂 / again") counts as a strike regardless of signature match. Reset on user "continue / 忽略" or approach explicitly pivots (new file, new hypothesis stated in prose). After 3 fails, question architecture — no 4th patch.

### Dead-end record
Append to the spec file's decisions section (else the report's open items): `dead-end: <approach> — <why failed> — DO NOT RETRY this task`.
Save it as a feedback memory only on user request ("记住这个") or same-session recurrence.

<!-- module: verify -->
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

<!-- module: ship -->
### Ship-baseline rationale (core §7)
Core §7 defines the rule: before a push that fires CI/Release, check pushed-branch pipeline color; red → fix / annotate / ASK. Rationale in brief: stacking on red loses attribution for the next shipper; local green ≠ pipeline green (CI toolchain / lint-ruleset / env / platform drift); "I think CI is green" is not a check — state the concrete command run (`gh run list ...`) and cite the result.
Override form: commit body line `known-red baseline: <one-line reason>` (e.g. `known-red baseline: flaky test_x.y quarantined in issue #N, fix landing in PR #M`). Absence of this line + red baseline = spec violation.

<!-- module: verify -->
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

<!-- module: orchestrate -->
## §11-O ORCHESTRATE

Universal session rules live in core §11 SESSION — they bind whether or not this module is loaded. The rules below apply to orchestration contexts specifically.

### Defaults
- **Overlapping edits run serially**: two subagents whose edit surfaces may intersect (grep-guessed files overlap) are not run in parallel.

### Subagent rules
- **1 task = 1 subagent**, briefed fully the first time.
- **Worktree spawn**: an `isolation: "worktree"` agent's prompt gives paths relative to its worktree, never the main checkout's absolute path — the harness rejects those.
- Subagent output uses §7 evidence format.
- **Output reaches main only at turn end**: inside a cycle you are blind to a subagent's report, so the default is to yield per core §11. A cycle that genuinely cannot yield polls the report file below; the notification channel itself is not pollable.
- **Report by file**: the harness cuts a teammate's reported result at 4000 chars. Any spawn whose report can run longer — every review or audit — gets an absolute output path in its spawn prompt for the full report, and ends on a message of ≤1500 chars: verdict, count per severity, one line per blocking finding, the path. Cut anyway → ONE message asking for the file, never for a resend; once a report has landed, send its author nothing — each message wakes it into another completion event.
- **Integration re-verify**: after a subagent reports done with evidence, main runs integration check (integration / e2e / cross-module smoke) on merged state before claiming its own done. Do not duplicate unit tests.
- **A subagent has nobody to ASK**: §0's ambiguity ASK and §5's `[AUTH REQUIRED]` both block on a user, and a spawned agent has none — the harness says so in its own system text. So inside a subagent: pick a reading per §0 and state it in the report, and STOP at a §5 hard-AUTH boundary — finish the in-scope non-hard work, list the boundary under open items as `<op> needs AUTH`, and leave the operation to main. Never self-authorize, never wait for an answer that cannot arrive.
- **Subagent non-convergence (HARD)**: 3× similar-signature failure on one sub-task → pull back to main; no 4th spawn.
- L3 build: `plan.md` §4.FULL step 6.
- Impact analysis before structural modifications; module overview before changes to unfamiliar code.

### Cross-session reference
User says "上次/之前/yesterday" → scan `tasks/` and `tasks/specs/` mtime <7d, confirm "你说的是 `<slug>`?"; ASK only if no match.
**Multi-candidate**: ≥2 matches → list as `<slug> (<date>) — <goal>` and ASK; never guess.

<!-- module: review -->
## §12 PLUGINS

### Hard cooperation rules
- **Author ≠ reviewer (HARD)**: reviewer = fresh subagent, empty context, with or without a review skill installed. No self-review in costume. No subagent can be spawned, or a harness or tool setting blocks it → name the block and ASK once; refused or impossible → L2: report the review as could not run, naming the block; L3 not executable: escalate.
- **Blind brief**: an empty context is not independence — the spawn prompt carries the author's view in. Give the artifact (commit range / paths), the contract (spec / issue / acceptance criteria) and the questions; withhold the author's rationale, its verdict (`fixed` / `correct`), earlier rounds' findings and any expected count. Author claims worth checking go in a separate `claims to falsify` list. Each finding cites file:line plus a reproducing command or quoted evidence; unexamined scope goes under `NOT CHECKED`. A re-review after repair is a new spawn, never a message to the reviewer who found the defect.
- **L3 two-tier review**: a fresh-subagent review per sub-task, then one pre-ship review across the whole change.
- **Ship order**: branch finished → pre-ship review → ship → deploy → monitoring checklist.

<!-- module: ship -->
### Ship-pipeline hardening (HARD)
On `ship` / `deploy` / `create-release` / `merge-and-push`, after reading this module, run the release from a written checklist: the project's ship runbook, else a listed ship skill. Neither → ship by hand against the checklist below and state `manual ship because <reason>` as the REPORT's first line — absence = spec violation.

**Pre-tag review**: no tag before a fresh-subagent reviewer has reviewed the release (§12 Author ≠ reviewer; it and the brief rules are in `review.md`: read it before spawning the reviewer).

Checklist (a runbook or skill may cover it in its own words): version sites in sync, CHANGELOG entry, release notes from its top entry, the release artifact (GitHub Release vs. bare tag), CI green on the pushed SHA. Each step fails silently by hand; the REPORT line lets a reviewer audit a checklist-less ship against this list. A deploy no deploy skill runs, from a runbook or by hand, needs `[AUTH REQUIRED op:manual-deploy]` before the atomic run below starts: the ship request covers push, tag and release, not a deploy.

**Manual-ship atomicity (HARD, clarification)**: a ship run without a ship skill — from a runbook or by hand — is still **one atomic turn**. Upon entering it, (1) enumerate every remaining step inline (typically commit → push → pre-tag review → tag → release-artifact → CI verify) as a visible plan, and (2) execute them back-to-back within the same turn. No turn-ending between commit and the final report with CI green. Green CI (or equivalent release-gate signal) is the Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: a hard failure (push rejected, tag collision, CI red) — stop at the failure with full context, not at a clean green step. **Second exception**: awaiting any subagent whose report this ship needs (the pre-tag reviewer, a repair or repro spawn), whenever it was spawned — yield per core §11 naming it; its completion re-invokes the cycle, which resumes at the next step. The user's single ship-AUTH — per §5 "per-task, per-scope" — covers push/tag/release; do not re-litigate it one manual step at a time.

**Runbook**: a project's ship-runbook memory (§11-EXT-MEM Ship-runbook consolidation) is read together with this module. A runbook may repeat the obligations above, never waive them; where the two differ, this module wins, and every §12 HARD obligation binds unchanged.

<!-- module: review -->
### Review-finding repair
- **Receiving a review** (any source): verify each finding against the code before implementing it.
- **Critical/High**: repair as L2. Iron Law #1 applies — failing test first.
- **Security (any severity)**: failing test must reproduce vulnerability (not just touch code path). No "added a check" without RED test.
- **Medium**: L2 if ship-blocking; L1 if isolated.
- **Low**: user discretion. Default skip with reason logged.
- **Resume**: re-review the repair commit only (delta scope, a new spawn). Green → resume the ship. Depth limit 2; third miss → escalate with full context.
- **Mature-solution check**: many findings in one round, a repair outgrowing the change it repairs, or immature tech underneath → before another patch round, search established open-source projects / libraries solving the same problem (web search / context7) and recommend adopt vs build, citing sources and trade-offs.

<!-- module: none -->
## §13 META (Agent-facing)

- **Spec changes**: patch (wording / clarification, identical behavior) = L2; minor (rule added / relaxed) / major (protocol shift) = L3 per core §2 LLM-visible metadata. Proposal → diff → user ASK at all levels.
- **Version bump**: patch (wording/clarification, identical behavior) / minor (rule added/relaxed, backward-compatible) / major (protocol shift).
- **HARD-rule removal**: rationale + 30-day grace note before deletion.
- **HARD → SHOULD downgrade**: rationale required (which rule, why unreliable, fallback posture).
- **Drift check**: project `CLAUDE.md` ranks with current-turn user per §3 TRUST order — where the spec explicitly delegates (§5.1 AUTONOMY_LEVEL, `SAFE_DELETE_PATHS:`, `TMP_RETENTION_DAYS:`) the project file wins; §8/HARD never yield. Flag obvious contradictions only (conflicting AUTH levels, opposing TDD policy, signal-format overrides) in first reply — no full diff.
- **HARD ≠ always hook-blocked**: `spec/hard-rules.json#rules[].enforcement` partitions the 26 HARD rules by how they are checked — `hook` (mechanical deny / advisory), `self` (Agent self-enforces; 4 of 16 emit advisory rows when their opt-in hooks are on, the other 12 emit nothing), `both` (hook covers a subset, Agent covers the rest), `external` (manual via `/claudemd-rules` + operator audit). Calibrate expectation accordingly: when planning a destructive op, a `self`-enforced HARD will NOT auto-block — Agent owns the gate. Today: 4 hook / 16 self / 5 both / 1 external.

### §0.1 Core growth discipline (HARD)

**Hard cap**: core ≤25K / extended ≤50K bytes; over ceiling → next version MUST net-delete (removal > addition) or refuse the addition. Headroom: the Sizing line under Recent changes. Tier landing / promotion / cadence → `OPERATOR.md §13.1`.

## §13.1 → `OPERATOR.md`

Operator responsibilities live in `OPERATOR.md §13.1` — human-only, not Agent-loaded. The `§13.1` anchor persists in hook telemetry (`§13.1-extended-read`) as a stable label.

## §13.2 HARD-rule budget (rolling, permanent)

Permanent ratchet on new HARD rules (guards scar-driven single-incident accretion). Agent duty:

- NEW incident that would historically spawn a HARD rule → log to `tasks/rule-candidates-<YYYY-MM>.md` as `[candidate] <rule text> — trigger: <incident> — repro-count: 1`; repeat occurrence of the same candidate → increment repro-count. Do NOT edit CLAUDE.md / CLAUDE-extended.md.
- Patch-level fixes (wording, cross-ref, typo) exempt from budget. Rule *removal* and HARD→SHOULD downgrades explicitly encouraged — no budget cost; they *add* budget back (and reset the 20-task counter).
- **Evidence-rebuttal shortcut**: existing HARD shown (in session evidence) to produce wrong behavior → fix the existing rule (downgrade/remove), do not wrap a new rule around it.

Promotion gates (≥3 repros + ≥20 L2+ tasks) and batch-review cadence are operator decisions from audit data → `OPERATOR.md §13.2`.

### §13.3 Advisory → enforce promotion (hook-layer)

Behavior-layer hooks ship default-OFF for FP signal collection (≥30d), then advance OFF → default-ON advisory → `deny` through two operator-judged gates from `/claudemd-audit` data — gates + cadence: `OPERATOR.md §13.3`. Companion to §0.1: §0.1 promotes documentation; §13.3 promotes enforcement. META rule, not HARD — exempt from §13.2 ratchet.

<!-- module: auth -->
## Appendix B — Canonical examples


### B.1 `[AUTH REQUIRED]`

```
[AUTH REQUIRED op:refactor-event-bus scope:src/events/*,src/orders/*,src/billing/*,src/notifications/* risk:4-module-contract-change-event-type-rename-downstream-consumers-affected]

[AUTH REQUIRED op:migration-add-users-2fa-column scope:migrations/0042_users_2fa.sql,src/models/user.py risk:additive-column-default-null-but-concurrent-index-on-5M-rows]
```

<!-- module: verify -->
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

<!-- module: none -->
## Recent changes

Full version history: `~/.claude/CLAUDE-changelog.md`. Only the current version's entry lives here.

**v8.1.0 (minor, 2026-10-16)** — core §7 **Git**: after you merge a branch into the main line, delete the local branch with `git branch -d` (it refuses unmerged work), unless the project keeps it. Asked for by the user after two repos kept merged local branches: nothing in the spec said to delete them, and the branch-prune hook's line left it to the user (it now says to delete them). Design record `tasks/specs/merged-branch-cleanup.md`. No HARD rule added or removed.

**Sizing** (v8.1.0, 2026-10-16, single post-edit `wc -c`; ±20B self-rewrite envelope): core 23156 → 23303 bytes (Δ +147); extended 39317 → 36710 bytes (Δ -2607); OPERATOR.md 15335 → 15335 bytes (Δ 0). Size budget: core 23303/25000 (**1697 bytes headroom**); extended 36710/50000 (**13290 bytes headroom**).

<!-- module: session -->
## §1.5-EXT GLOSSARY

Core §1.5 inlines `Module / Evidence / Contract / Δ-contract` (used at L1/L2). Terms core does not define, and clarifications:

- **Assumption** — claim not verified this turn via Read/Grep/tool. Memory recall = assumption.

<!-- module: auth -->
## §5.1-EXT AUTONOMY_LEVEL effects (full table)

| Level | Effect on §5 table |
|---|---|
| `aggressive` | `delete in safe-paths` → no surface-required; `deps dev-only` → none. `cross-module refactor (≥3 Modules)` and `Δ-contract on public API` both stay HARD — core §5.1 Never-downgrade covers every §5 Hard category. |
| `default` | §5 table as written, unchanged |
| `careful` | `deps dev-only` → hard; `cross-module ≥2 Modules` → hard; `L2 local single module` → soft (surface diff inline first) |

No level touches the core §5.1 Never-downgrade set.

**Published client** (defines "public API" for the §5 Hard row `Δ-contract on public API`, at every autonomy level): any consumer outside this repo — external SDK user, npm-install consumer, MCP client (incl. Claude Code reading a server's tool schema), CLI end-user via `npx` / `cargo install` / release binary. **Internal** = same-repo module-to-module only. Uncertainty → treat as published (hard).

<!-- module: session -->
## §7-EXT-TMP TMP_RETENTION policy

**`~/.claude/tmp/` retention**: tool-exhaust, not WIP. Nothing purges it automatically: `/claudemd-clean-residue` reaps entries older than `TMP_RETENTION_DAYS` (default 7; dry-run unless `--apply`), and the residue-audit Stop hook warns when one session grows it by ≥20 entries. No auto-clean without AUTH. Override: project `CLAUDE.md` `TMP_RETENTION_DAYS: 30`.

## §11-EXT Session heuristics (advisory)

SHOULD-level guardrails — apply when condition fires, not Iron Law gates.

- **Redundant Re-Read**: files Read or Written this session don't need re-Read absent external-change signal (user says "pull latest" / commit appears / mtime newer / structural test failure). Unsure → re-read; a third Read on unchanged content is wasted context.
- **Context pressure** (>75% window OR compaction-imminent): (a) prefer fresh-subagent for exploration not requiring main-thread state; (b) compact prose, drop evidential blocks already inline-cited; (c) defer non-critical Re-Read; (d) bring the spec file (without one, `tasks/<slug>-paused.md`) up to date before the next long tool call.
- **Read-before-propose**: don't propose changes to code you haven't Read or Grep'd this session. §1 Simple first covers writes; this covers AUTH-eligible proposals — a `[AUTH REQUIRED]` citing unread code is a false-claim incident.
- **Diagnose-before-pivot**: approach failed once → diagnose (read error, check assumption, focused fix); §6 Three-strike is the upper bound, not the trigger — pivoting too early on a viable approach burns context.
- **Existing-comment protection**: don't remove old comments unless removing the code they describe OR verified them wrong this session. The harness's own default-to-no-new-comments guidance addresses *new* comments, not pruning old.

<!-- module: memory -->
## §11-EXT-MEM Memory operations

One home per fact — double-writing creates drift.

**Terminology**: `claude-mem-lite` = the recall-layer plugin only (FTS5 / timeline / `[mem]` prefix); `MEMORY.md` / **durable layer** = CC built-in 4-type memory only. Avoid bare `mem` in new spec text or hook output — ambiguous between the two layers. Existing identifiers carrying `mem` are scoped: plugin tool/CLI names `mem_save / mem_search / mem_recall / mem_recent` refer to the plugin; `mem-audit.sh` / `mem-audit` in hook telemetry refer to the claudemd Stop hook over the durable layer.

### Layer routing

| Layer | Path | Time horizon | Use for |
|---|---|---|---|
| **Durable (CC built-in 4 types)** | `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md` + `*.md` | session-spanning | user role / preference / cross-session lessons / project-permanent decisions |
| **Time-sensitive recall plugin** (e.g. `claude-mem-lite` FTS5 + timeline) | plugin-managed | days–weeks, rolls off | bugfix lessons / current-project state / recent activity |

**Picking the home**: "will this be true 6 months from now?" Yes → durable. No → recall plugin. Conflict: durable wins; recall layer ages out.

**Plugin-absent fallback**: detect via tool list (no `mem_save`/`mem_search` → plugin unloaded). Recall content then writes to `recall_<topic>_<YYYYMMDD>.md` in durable layer with `[fallback]` tag.

**Body-structure scope**: `mem-audit` Stop hook scans `feedback_*.md` only for `**Why:**` / `**How to apply:**` body markers. `project_*.md` exempt — the incident-log pattern (`project_<topic>_<date>.md`) is fact-only by nature; the hook does not warn when authors omit Why/How there.

### Save triggers (core §11 Memory)

- **Global state** (MUST, any level): a task writes ≥2 files under `~/.claude/` (plugin install / settings / marketplace / statusline / hook / MCP config) → save what + why. Exempt only when the edit leaves a greppable what + why in the artifact itself (a versioned spec's `## Recent changes`, `CHANGELOG.md`, a migration comment); opaque state (plugin / marketplace JSON / hook / MCP config) is never exempt.
- **Lesson body** (a `feedback_*` save): the harness's **Why:** and **How to apply:** lines plus the trigger words a later task would search for, ≤8 lines.
- **Never**: what `git log` recovers, a code invariant (→ a comment), task-local state (→ the spec file), a clean-root-cause bug (→ the recall plugin's bugfix type).

### MEMORY.md tag syntax

- Optional `- [Title](file.md) [tag1, tag2] — description`. Agent matches task keywords against tags before Read.
- **Index line ≤150 characters**: title, tags, one-line hook. `MEMORY.md` loads every session; the detail belongs in the file, and `/claudemd-doctor` flags longer lines.
- **Untagged lines** = agent-driven full content scan from title/description; hook does NOT auto-block.
- **Tag specificity (SHOULD)**: tags ≥4 chars AND specific to the topic. Avoid generic single-word EN tags (`hook` / `plugin` / `test` / `cli` / `audit` / `done` / `spec` / `ship` when memory not actually about ship-flow) that substring-match incidental occurrences. Prefer multi-word phrases (`hook-fail-open` / `cli-flag-shape` / `audit-pipeline-filter`). The hook applies word-boundary matching with 0-2 char declension tolerance (`hook` → `hooks` / `hooked`; `cli` ≠ inside `clippy`); generic exact-word tags still fire — fix at authoring time.
- Rule of thumb: if removing the tag wouldn't change agent's decision quality on a typical command match, the tag is too generic.
- **Ship-runbook consolidation (SHOULD)**: per project, ship-trigger tags (`ship / release / deploy / 发布 / 发版 / 打tag`) belong to exactly ONE memory file — the project's ship runbook, holding the full release flow (pre-ship checks → atomic steps → post-ship). Flow changes edit that file; other ship-adjacent lessons keep their topical tags and get `[[links]]` from the runbook instead of own ship tags. Effect: §11 read-the-file at ship costs one predictable Read instead of tag fan-out.

<!-- module: session -->
## §11-EXT-MAC macOS shell portability (cross-ref)

Implementation discipline (BSD-vs-GNU `stat`, `wc -l` padding, missing `timeout`, `mktemp` symlink, exec-bit) is not a spec rule: hook scripts `source` the plugin's `hooks/lib/platform.sh` and call its wrappers — a `command -v` guard alone falls silently false.
