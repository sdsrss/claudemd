# AI-CODING-SPEC v6.11.3 — Extended

Loaded on demand per §EXT in `CLAUDE.md`. Applies to L3 / Override / ship / review / orchestration tasks. L2 no longer auto-loads this file (v6.5). Version history: `~/.claude/CLAUDE-changelog.md` (externalized v6.9.0).

## §5-EXT Safe-paths whitelist (detail)

Core §5 Safe-paths lifted the concrete prefix list here (v6.8). Strict prefix match (NOT glob):

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

Core NEVER clauses and `SAFE_DELETE_PATHS:` extension rule still bind — see core §5 Safe-paths whitelist.

## §2-EXT Override modes

Universal: Iron Law #2 + §8 SAFETY + §8 Anti-hallucination bind every mode. Per-task scope. Announce mode entry/exit inline ("entering HACK: prototyping in tmp/ — exits when promoted"). Modes cannot coexist.

**Mode entry**:
- **[HACK]** ("try / benchmark / spike / explore / 试试 / 探索" + scope clearly `tmp/` or `scripts/`): silent enter.
- **[EMERGENCY]** ("prod / incident / outage / 500 / rollback / 故障 / 回滚 / 挂了" + user ack): silent enter.
- **[AUTONOMOUS]** (ScheduleWakeup / CronCreate / RemoteTrigger / no interactive user): silent enter.
- **Weak/ambiguous** trigger: ASK once. "No" → normal flow.

### [HACK] — prototype/explore

| Aspect | Behavior |
|---|---|
| §5 AUTH | deps in `tmp/`/`scripts/` → soft; others hard |
| §4 ceremony | normal |
| §7 Iron Law #1 | SKIPPED |
| Output scope | `tmp/` or `scripts/` ONLY |
| Allowed ops | read any source; call pure/read-only prod; NO import/invoke of side-effectful prod (DB writes, external API, email/SMS, FS writes outside `tmp/`, queue publishes) |
| Bench against prod | prefer read replicas; if primary only, state risk + kill-switch condition (abort trigger) before execution; off-peak preferred |

**Artifact hygiene**: [HACK] output must NOT become prod code. To promote, exit HACK first, then run L2/L3.

### [EMERGENCY] — prod incident

| Aspect | Behavior |
|---|---|
| §5 AUTH | within allowed-ops → natural-language confirm; outside → full `[AUTH REQUIRED]` |
| §4 ceremony | skip FULL / brainstorming / planning / TDD |
| §7 Iron Law #1 | SKIPPED during incident; follow-up task restores discipline |
| Output scope | incident scope only |

**Allowed ops** (each: state current → target → recovery condition before execution):
- Revert SHA / commit revert
- Feature flag toggle
- Scale / restart / pod bounce
- Rollback deploy (previous green)
- Hotfix with revert plan
- Partial-rollback script (idempotent, §8, user "go")
- Cache invalidation / CDN purge — record keys
- Pause cron / queue — record TTL + resume
- Rate-limit / WAF rule — record TTL + rollback
- Read-only mode toggle — resume checklist

**Intervention priority**: (1) strongest causal evidence → (2) smallest blast radius → (3) fastest reversibility. Ties → prefer lower-blast. State chosen option + (1)/(2)/(3) reasoning before executing.

**Exit ritual**: incident report (Timeline / Root-cause / Rollback / Follow-ups) in prose; file L2/L3 follow-up task. Closure of incident ≠ closure of bug.

### [AUTONOMOUS] — scheduled / no interactive user

| Aspect | Behavior |
|---|---|
| §5 hard ops | Do NOT execute. Write to `tasks/pending-auth-<date>.md` with op + scope + risk + recommendation; defer until next interactive session. |
| Allowed execution | L0/L1 + items in `tasks/auto-approved.md` (one per line, e.g. `op:deps-bump-patch`). Whitelist must exist before this mode runs. |
| L2+ | Write `blocked: needs-interactive-AUTH — <reason>` to the task file; skip execution. |
| Exit ritual | Write `tasks/autonomous-run-<date>.md`: ran / blocked / failed / pending-auth. |

Serves maintenance scripts (formatters, patch-bumps, doc sync) — NOT feature development.

### Mode interactions
[EMERGENCY] during [HACK] → EMERGENCY supersedes, HACK dropped. [HACK] during [EMERGENCY] → reject ("resolve incident first"). No mode coexistence.

### Released-artifact checklist (L3 hard upgrade, core §2)
When a change qualifies as "released-artifact user-visible default behavior change" (npm / crates.io / marketplace package where users feel the upgrade difference) — core §2 escalates it to L3 regardless of LOC. Requirements before ship:
- **SemVer non-patch bump** (minor for additive user-visible change, major for breaking).
- **CHANGELOG migration note at top**: what changes, what action users must take.
- **Explicit opt-out or revert path**: env flag, config key, prior-version pin instructions, or rollback command.
- **One-time discoverability signal**: stderr banner / first-run log / release-note callout — so users who don't read CHANGELOG still notice.

Missing any item on a user-visible default change = incomplete ship; file as Uncertain in REPORT.

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
- **≥2 mismatches in one task**: `DONE_WITH_CONCERNS` — list each deviation (file:line before/after).
- **≥5 mismatches across a task OR any cross-task contradiction**: pause and escalate to re-planning in prose. Do NOT silently rewrite plan intent.

Common drift sources to watch: Haiku-sourced type lists differing from schema CHECK constraints; existing table having fields the plan sketch omitted; real filesystem schema (e.g. `~/.claude/tasks/`) differing from plan's assumed shape; plan-sketched test import paths that don't match actual test-helpers filename.

## §4 FLOW

### Routing

| Request type | Primary → Secondary | Notes |
|---|---|---|
| code/logic bug | **sp** (L1: reproduce→§7; L2+: sp:systematic-debugging) | gs:/investigate only for env/staging/deploy |
| env/staging/deploy bug | **gs:/investigate** | → sp if root cause is code |
| UI/visual bug | **gs:/browse** → route per cause | |
| feat | **sp** (L0-L1: edit→§7; L2: sp:TDD→§9→§7; L3: §4.FULL or §4.FULL-lite) | **L2-additive** (new branch/field/endpoint/optional param, no prior failing path): RED-first short evidence per §7-EXT Additive exception — skip full sp:TDD ceremony. Bugfix always needs prior reproduction. |
| bootstrap / scaffold | **sp** — L2; bundle deps one AUTH; skip §4.FULL | |
| ship L2 | **gs** — sp:finishing → gs:/review → gs:/ship → gs:/land-and-deploy | Skip /autoplan, /codex. /qa: skip unless user-facing. |
| ship/deploy/PR | **gs** — gs:/review → gs:/ship → gs:/land-and-deploy → monitoring checklist | |
| prod incident | **gs** — [EMERGENCY] → revert or flag-off | |
| QA on staging | **gs:/qa** (fix) or gs:/qa-only (report) | |
| review | **per-task**: sp:requesting-code-review; **pre-ship**: gs:/review; **from user**: sp:receiving-code-review | One entry point per context |
| 2nd-opinion (opt-in) | **gs:/codex** | User request only; never auto |
| browser/web verify | **gs:/browse** ONLY | Never mcp__chrome or computer-use |
| design/UI | **gs:/design-consultation** → gs:/design-review | |
| perf check | **gs:/benchmark** (before/after) | |
| security audit | **gs:/cso** | |
| Q&A (no code) | direct answer; context7 for API claims | |
| product/biz clarify | **gs:/office-hours** | |
| tech/arch clarify | **sp:brainstorming** | |
| mixed product+tech | combined ask, tag `[product]`/`[tech]` | |
| 2+ independent tasks | **sp:dispatching-parallel-agents** | |
| low-freq utilities | gs:/freeze, /guard, /retro; support ops | |

### Composite requests
Primary verb: "更快"→perf; "挂了/500"→bug; "好看"→design; "也加"→expansion.
Chain: clarify → primary → secondary only if needed → ship. Do NOT flatten to one row.
Example: "登录页又慢又报 500" → bug first (resolve 500), then perf only if slowness persists after fix.

### Skill invocation
Routing keyword / task type / user names skill. sp before gs, except clarify and ship (gs entry).

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

## §6 DEBUG

```
env/dep/config    → fix + 1 retry → pause, surface blocker in prose
syntax            → auto-fix ≤2 attempts
L1 code bug       → §7.L1-bugfix (core)
L2+ code/logic    → sp:systematic-debugging (4-phase root cause)
env/staging/deploy → gs:/investigate
UI/visual         → gs:/browse → route per cause
sideways          → STOP + stash → re-plan (note pivot reason)
```

### Iron Law #3: NO FIX WITHOUT ROOT CAUSE (L2+)
Investigate → Analyze → Hypothesize → Implement (with §7 evidence). Symptom-only fixes banned at L2+.

### Three-strike rule
Same error signature 3× → roll back the path that introduced it. Signature = `error_msg_normalized[:80]` + `exception_type`; 2+ matching = same. **Manual trigger**: user "又失败 / 又挂 / again" counts as a strike regardless of signature match. Reset on user "continue / 忽略" or approach explicitly pivots (new file, new hypothesis stated in prose). After 3 fails, question architecture — no 4th patch.

### Dead-end record
Append to plan: `dead-end: <approach> — <why failed> — DO NOT RETRY this task`.
Session-scoped. Promote to `tasks/lessons.md` only on user request ("记住这个") or same-session recurrence.

## §7-EXT VALIDATE (L3)

```
L3  TDD + full suite + e2e                    → inline evidence with numbers+baseline
    (no e2e infra: integration + smoke → [PARTIAL: no-e2e-infra], follow-up filed)
```

L2 evidence rules → core §7 (inline prose with numbers+baseline). L3 adds TDD discipline (Iron Law #1 below), 5-tier evidence ladder, and cold-start handling.

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

### Ship-baseline rationale (core §7)
Core §7 defines the rule: before a push that fires CI/Release, check pushed-branch pipeline color; red → fix / annotate / ASK. Rationale:
- **Silent stacking on red** hides your change's effect inside pre-existing failure — when CI stays red, attribution gets lost and the next shipper inherits an unclear diff.
- **Local green ≠ pipeline green**: CI toolchain version, lint-ruleset drift, env vars (`CI=true` branches), and platform differences (Linux-only signal / Windows path separator) are the usual sources. `cargo test` / `pytest` / `npm test` passing locally is necessary, not sufficient.
- **Concrete-call requirement** prevents "I think CI is green": state the command you ran (`gh run list ...` / `circleci ...` / `buildkite-agent ...`) and cite the result.

Annotation form when overriding: commit body line `known-red baseline: <one-line reason>` (e.g. `known-red baseline: flaky test_x.y quarantined in issue #N, fix landing in PR #M`). Absence of this line + red baseline = spec violation.

## §10-V Banned-vocab (reference list)

Core §10 Specificity rule lifted the full list here (v6.8). Core keeps examples + scope; full enumeration below — consult only when drafting a claim you're unsure about.

**OK (absolute)**: "reduced p99 580ms → 140ms" / "fixed at schema.mjs:147" / "12/12 tests pass" / "covers 3 of 3 branches I modified" / "65 → 64 tests after consolidation".

**OK (ratio with baseline)**: "1453 → 1490 tests (+2.5%)" / "cut FTS latency from 380ms to 95ms (4×)".

**OK (中文 with baseline)**: "FTS 查询 380ms → 95ms（4×）" / "1453 → 1490 tests（+2.5%）" / "fixed at schema.mjs:147, 12/12 tests pass".

**Banned — adjectives (EN)**: "significantly improved" / "robust" / "production-ready" / "more efficient" / "should work" / "cleaner code" / "comprehensive" / "best practice" / "industry-standard".

**Banned — hedges (EN)**: "presumably" / "likely" / "in principle" / "arguably" / "in theory" / "seems to work" / "appears correct" / "it should be fine".

**Banned — baseline-less ratios (EN)**: "70-80% faster" / "2× better" / "most of the time" / "usually passes" / "often fails".

**Banned — adjectives (中文)**: "显著提升 / 大幅改善 / 更高效 / 明显优于 / 基本可用 / 相当不错 / 通常如此 / 一般来说 / 大部分情况".

**Banned — baseline-less ratios (中文)**: "N 倍提升 / M% 更快 / 大多数时候 / 多数情况下" (no stated reference).

When banned, fix = strip the hedge, state the specific case with absolute or baseline-anchored number.

## §10-R COMPLETE (L3)

### Full four-section (L3 always; L2 when any section non-empty — see core §10)
```
Done:      <items, each with inline evidence (test/run output + numbers+baseline)>
Not done:  <deferred, with reason>
Failed:    <blocked, with cause>
Uncertain: <not sure about, stated as "uncertain because <X>">
```

**L3 zero-issue short** (Not done=∅, Failed=∅, Uncertain=∅): single `Done:` paragraph with evidence inline, no four-section scaffolding needed.

**Multi-task**: each task writes its own block. Do NOT merge.

**EMERGENCY mode adds**: incident report (Timeline / Root-cause / Rollback / Follow-ups); file follow-up task.

### Auto-decisions (post-AUTH ambiguity)
One prose line: "chose <X> over <Y> because <rationale>; reversible (cost: <est>) if wrong." No bracketed form.

### Lessons file
- Path: `tasks/lessons.md`. Cap 30 entries, newest first. Prepend on user correction. Drop oldest when full.
- Read at session start and after compaction; cite when pattern matches.
- Format: `- <YYYY-MM-DD> [pattern]: <wrong> → <rule>`.

## §11-O ORCHESTRATE

Universal session rules live in core §11 SESSION — they bind whether this extended spec is loaded or not. The rules below apply to orchestration contexts specifically.

### Defaults
- **Parallel-preferred**: ≥2 tasks with disjoint scope + no shared mutable state → sp:dispatching-parallel-agents. File-scope overlap possible (grep-guessed edit surfaces intersect) → default serial, no justification needed.
- **Fresh-context-first**: research/exploration/scan/isolated repro → fresh subagent.
- **Automate-first**: reversible + below AUTH-soft → execute with one-line reason.

### Subagent rules
- **1 task = 1 subagent**. Research/explore offloaded by default.
- Complex → more subagents, never longer main context. Subagent output uses §7 evidence format.
- **Integration re-verify**: after a subagent reports done with evidence, main runs integration check (integration / e2e / cross-module smoke) on merged state before claiming its own done. Do not duplicate unit tests.
- **Batch review**: ≥3 tasks OR ≥2 including ≥1 L2+ → sp:requesting-code-review for cross-task drift (error/log format, shared types). Single-task → no batch review.
- **Subagent non-convergence (HARD)**: 3× similar-signature failure on one sub-task → pull back to main; no 4th spawn.
- L3 → sp:subagent-driven-development (built-in 2-stage review).
- Impact analysis before structural modifications; module overview before changes to unfamiliar code.

### Cross-session reference
User says "上次/之前/yesterday" → scan `tasks/` and `tasks/specs/` mtime <7d, confirm "你说的是 `<slug>`?"; ASK only if no match.
**Multi-candidate**: ≥2 matches → list as `<slug> (<date>) — <goal>` and ASK; never guess.

## §12 PLUGINS

### Division of labor

| sp = THINK + EXECUTE | gs = DECIDE + SHIP |
|---|---|
| brainstorming | office-hours (product/biz clarify) |
| writing-plans | autoplan (3-view plan review) |
| using-git-worktrees | review (pre-ship comprehensive) |
| subagent-driven-development | ship → land-and-deploy |
| test-driven-development | document-release (auto via /ship) |
| systematic-debugging | investigate (env/staging bugs) |
| requesting-code-review | qa, qa-only, browse |
| receiving-code-review | design-consultation, design-review |
| finishing-a-development-branch | cso, benchmark, codex |
| dispatching-parallel-agents | freeze, careful, guard, retro |

### Hard cooperation rules
- **Author ≠ reviewer (HARD)**: reviewer = fresh subagent, empty context. No self-review in costume.
- **L3 two-tier review**: per-task in sp:subagent-driven-development; pre-ship cross-cutting via gs:/review.
- **Ship pipeline owned by gs**: sp:finishing → gs:/review → gs:/ship → gs:/land-and-deploy → monitoring checklist.

### Ship-pipeline hardening (HARD)
On `ship` / `deploy` / `create-release` / `merge-and-push`, after loading extended, invoke the `ship` skill. Manual ship allowed ONLY if stated in REPORT: `manual ship because <reason>` — absence = spec violation.

Rationale: ship encapsulates mechanical checklists (manifest sync across package.json / plugin.json / marketplace.json / Cargo.toml, CHANGELOG voice, release-notes generation, GitHub Release artifact vs. bare git tag) that are silent-failure-prone when bypassed. Historical incidents grounding this rule: **v2.33.2** version-sync test-failure cycle (mismatched versions across manifests caused CI failure that looked like test bug); **v2.6.3~v2.8.0** tag-without-release auto-update stall (bare tags shipped without GitHub Release artifact broke auto-updater expecting Release assets). Both were recoverable but burned 30+ min each.

Override form: in the REPORT's Done section, first line states `manual ship because <reason>` (e.g. `manual ship because CI down for unrelated infra work, manifests verified by hand at :4f2e1`). Reviewer can then audit the manual diff against the skill's checklist.

**Manual-ship atomicity (HARD, clarification)**: when override applies, the manual path is still **one atomic turn**. Upon entering it, (1) enumerate every remaining step inline (typically commit → push → tag → release-artifact → CI verify) as a visible plan, and (2) execute them back-to-back within the same turn. No turn-ending between commit and the final Done-with-CI-green report. Green CI (or equivalent release-gate signal) is the Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: a hard failure (push rejected, tag collision, CI red) — stop at the failure with full context, not at a clean green step. Rationale: without a skill's step-list pulling the agent forward, `git commit` looks like a natural pause, and the user's ship AUTH — which per §5 "per-task, per-scope" already covers push/tag/release — gets re-litigated one manual step at a time. User's single `[AUTH]` on ship is one AUTH on the full pipeline.

### Review-finding repair
- **Critical/High**: repair as L2. Iron Law #1 applies — failing test first.
- **Security (any severity)**: failing test must reproduce vulnerability (not just touch code path). No "added a check" without RED test.
- **Medium**: L2 if ship-blocking; L1 if isolated.
- **Low**: user discretion. Default skip with reason logged.
- **Resume**: re-run gs:/review on repair commit only (delta scope). Green → resume at gs:/ship. Depth limit 2; third miss → escalate with full context.

### Fallback table
| Missing | Fallback |
|---|---|
| sp:test-driven-development | manual RED-GREEN per §7 ladder |
| sp:systematic-debugging, gs:/investigate | §6 + Iron Law #3 |
| sp:writing-plans | inline `tasks/<n>.md`; user reviews |
| sp:brainstorming, gs:/office-hours, /design-* | self-ask: intent→constraints→options→recommend |
| sp:dispatching-parallel-agents | sequential; note downgrade |
| sp:using-git-worktrees | single tree + branch; stash before switch |
| sp:subagent-driven-development | main + fresh-subagent review per sub-task (HARD). No subagent → L3 not executable, escalate |
| sp:*-code-review, gs:/review | fresh subagent + review brief; serves per-task and pre-ship |
| sp:finishing-a-development-branch | manual: rebase, squash, changelog, clean-tree |
| gs:/autoplan | user reviews; inline 3-view self-critique (CEO/design/eng) |
| gs:/ship, /land-and-deploy | manual git push + `[AUTH REQUIRED op:manual-deploy]` |
| gs:/browse | request user screenshot/log |
| gs:/canary | monitoring checklist (metrics/thresholds/rollback trigger/command); user monitors |
| gs:/benchmark | hyperfine/time/native; `tasks/perf-<n>.md` |
| gs:/cso | manual STRIDE on auth/payment/crypto paths |
| gs:/codex | skip; note "no second-opinion review" in §10 |
| gs:/freeze, /guard, /retro | inline scope-lock; retro in `tasks/retro-<date>.md` |

Detection: first call fails → session flag → auto-degrade. Flag expires after 5 turns or env change.
**Batch confirmation**: ≥3 fallbacks needing user input → consolidate into ONE message.

## §13 META (Agent-facing)

- **Spec changes = L2 minimum**: modifying this document changes Agent behavior — contract-Δ on author-Agent relationship. Proposal → diff → user ASK.
- **Version bump**: patch (wording/clarification, identical behavior) / minor (rule added/relaxed, backward-compatible) / major (protocol shift).
- **HARD-rule removal**: rationale + 30-day grace note before deletion.
- **HARD → SHOULD downgrade**: rationale required (which rule, why unreliable, fallback posture).
- **Drift check**: project `CLAUDE.md` wins per §3 TRUST order. Flag obvious contradictions only (conflicting AUTH levels, opposing TDD policy, signal-format overrides) in first reply — no full diff.

## §13.1 OPERATOR RESPONSIBILITIES (human-facing)

Not Agent rules. These govern the human maintaining this spec. Separated so Agents don't allocate attention to directives they cannot execute.

- **Self-audit cadence**: every ~50 L2+ tasks OR 4 weeks, whichever first — review `tasks/lessons.md`, count rule invocations where captured, prune never-used rules, promote frequently-repeated lessons.
- **Drift monitoring**: watch for silent spec violations — Agent claiming "Done" without inline evidence tying the claim to tool output, or using §10 banned vocabulary. Each instance signals a rule misunderstood or too burdensome.
- **Version discipline**: let a minor version run through ≥20 real L2+ tasks before the next. Adding rules without invocation data is how specs bloat.
- **Size budget** (soft ceilings, v6.9.0 baseline): core ≤ 25k chars, extended ≤ 50k chars. Rationale: every byte in core loads every turn; extended loads every L3/ship/Override turn. Unchecked accretion silently trades user-instruction context for spec-rule context. Over ceiling → next version MUST net-delete (removal bytes > addition bytes) or refuse the addition. Track current size in the `Sizing` line of `CLAUDE-changelog.md` / `Recent changes` entry so the ceiling is a live signal, not a historical aspiration.

### §13.2 HARD-rule budget (rolling, permanent)

Permanent ratchet on new HARD rules. Rationale: v6.6 → v6.7.5 (~1 month) added 9+ HARD entries, each scar-driven from one incident — §13.1 Version discipline (≥20 real L2+ tasks between minor bumps) was violated. v6.8 shipped a 30-day freeze window; v6.9 makes the ratchet permanent. Budget language (not "freeze") because the door is not closed — it's gated.

**Policy**:
- NEW incident that would historically spawn a HARD rule → log to `tasks/rule-candidates-<YYYY-MM>.md` as `[candidate] <rule text> — trigger: <incident> — repro-count: 1`. Do NOT edit CLAUDE.md / CLAUDE-extended.md.
- Repeat occurrence of same candidate → increment repro-count.
- Promotion eligibility requires BOTH: **≥3 repros across distinct sessions** AND **≥20 real L2+ tasks since the last HARD addition**. Either missing → log-only.
- Patch-level fixes (wording, cross-ref, typo) exempt from budget.
- Rule *removal* and HARD→SHOULD downgrades explicitly encouraged — no budget cost; they *add* budget back (and reset the 20-task counter).

**Evidence-rebuttal shortcut**: existing HARD shown (in session evidence) to produce wrong behavior → fix the existing rule (downgrade/remove), do not wrap a new rule around it.

**Batch-review cadence**: every 20 L2+ tasks OR 30 days (whichever first) — merge overlapping `rule-candidates-*.md` entries, promote eligible, prune stale.

## Appendix B — Canonical examples

### B.1 `[AUTH REQUIRED]`

```
[AUTH REQUIRED op:refactor-event-bus scope:src/events/*,src/orders/*,src/billing/*,src/notifications/* risk:4-module-contract-change-event-type-rename-downstream-consumers-affected]

[AUTH REQUIRED op:migration-add-users-2fa-column scope:migrations/0042_users_2fa.sql,src/models/user.py risk:additive-column-default-null-but-concurrent-index-on-5M-rows]
```

### B.2 Valid vs invalid evidence

**Valid** (bugfix, ties prior-failing anchor to fresh pass):
> Done: fixed double-apply coupon bug (tests/orders/test_checkout.py::test_coupon_applies_once — pre-fix FAILED expected 90.00 got 100.00, post-fix PASSED; coupon now subtracts once).

**Invalid — existence ≠ behavior**: `grep -n "def apply_coupon" src/orders/checkout.py → 127:def apply_coupon(…)` then claiming "fix works". ❌ Presence of the function is not proof it behaves.

**Invalid — bugfix missing prior-failure anchor**: `pytest -q → 47 passed` then claiming "bug fixed". ❌ Need RED proof before GREEN — cite the failing run or test name that now passes.

**Valid — additive new endpoint** (no prior-failing path; RED-first on new tests):
> Done: added GET /users/{id}/preferences (tests/users/test_preferences.py: 3 passed — unknown → 200+{}, known → dict, deleted → 404; contract matches spec success-criteria).

**Valid — intermittent/concurrency** (tier-2 stress-repro as tier-1 proxy):
> Done: closed double-charge race window with row-level lock (./scripts/stress_race.sh --workers 20 --iterations 5000: pre-fix 47/5000 double-charges; post-fix 0/5000 across 3 runs). Intermittent — tier-2 stress-repro used as tier-1 proxy, reason: concurrency-dependent.

### B.3 L3 summary formats

**Zero-issue single paragraph**:
> Done: added GET /users/{id}/preferences with default-empty response (pytest tests/users/test_preferences.py: 3 passed — unknown → 200+{}, known → dict, deleted → 404; contract matches spec success-criteria).

**Full four-section (with Uncertain)**:
```
Done:      pagination cursor on GET /orders; OpenAPI updated (pytest tests/api/test_orders_pagination.py: 12 passed in 1.4s, covers empty / single-page / exact-fit / mid-page).
Not done:  (none)
Failed:    (none)
Uncertain: cursor opacity — used urlsafe_b64 without encryption; reversible by swapping encoder; user confirm before ship.
```

### B.4 EMERGENCY incident report

Prose mode-entry ("entering EMERGENCY: checkout 12% error on /checkout"), then the report block, then mode-exit ("incident closed, back to normal").

```
Timeline:   18:42 alert (error 12% on /checkout) → 18:45 identified bad deploy a1b2c3d (#4521) → 18:47 user-approved revert to d4e5f6a → 18:51 baseline 0.2%.
Root-cause: #4521 changed Stripe webhook sig-verify, silently rejected live webhooks.
Rollback:   git revert of a1b2c3d as e7f8g9h. Verified via prod logs (checkout error dropped to baseline; sig-verify errors gone).
Follow-ups: L2 task filed `tasks/webhook-sig-verify-fix.md`; done-criteria: failing test reproduces rejection then re-applied with correct sig path.
```

### B.5 Auto-decision one-liners

- "chose `async def` over sync wrapper because caller chain is already async under FastAPI; reversible (rename + remove `await`, 2 LOC) if wrong."
- "ordered fields `id, created_at, updated_at, <domain>` per project convention `src/models/*.py`; reversible (migration reorder, 1 file) if wrong."
- "used `dict[str, list[int]]` over dataclass because map is construction-time only, never escapes function; reversible (extract dataclass, 8 LOC) if wrong."

### B.6 L3 spec example

```markdown
---
status: approved
revision: 3
---

# Goal
Add per-user rate limiting to public API to prevent abuse while preserving headroom for legitimate bursts.

# Non-goals
- Per-endpoint rate limits (future work)
- Distributed rate limit state (single-region for now)

# Constraints
- Must not add p50 latency >5ms
- Must handle Redis outage gracefully (fail open with alert)
- Must emit metrics compatible with existing Datadog dashboards

# Success criteria
1. `GET /api/*` returns 429 when user exceeds 100 req/min over rolling window
2. Response includes `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers
3. Integration test: 101st request within a minute returns 429; 60s later, 429 clears
4. Redis connection failure: logs warning, serves traffic without limit

# Open questions
- Should internal service-to-service calls be exempt? → Yes, bypass via mTLS identity check
- What happens to WebSocket connections? → Rate limit applies to connection, not messages (revision 3)

# Change log
- 2026-04-10 r1: draft
- 2026-04-12 r2: added Redis-outage fail-open constraint (user request)
- 2026-04-14 r3: clarified WebSocket behavior
```

## Recent changes

Full version history (v6.8.1 and earlier): `~/.claude/CLAUDE-changelog.md`. Only the current version's entry lives here.

**v6.11.3 (patch, 2026-04-30)** — §11 MEMORY.md read-the-file footnote clarified; documents the hook/agent split: hook enforces only tagged matches, untagged lines are agent-driven full content scan. No rule additions, removals, or downgrades. Resolves a real over-trigger pattern observed in `claudemd` v0.5.0: untagged MEMORY.md entries forced N unrelated Reads on every push, and the trigger regex `(release|deploy|ship)` matched anywhere in the command (commit messages, MR descriptions, file paths) → false-positive denials.

- **§11 footnote** (core, ~+250 chars) — clarifies that "Untagged lines = full-scan" means agent-driven content scan based on title/description, NOT hook-enforced auto-block. Plugin-side `hooks/memory-read-check.sh` updated in claudemd v0.5.1 to skip untagged entries and anchor the trigger regex to command-segment-start. Together: tag the lines you want hook-enforced; leave the rest for agent judgment.

HARD tally unchanged: §0.1 Core growth discipline / §0 Hard-AUTH override / Iron Law #2 / §7 Ship-baseline / §7 User-global-state audit / §8 Verify-before-claim (V1–V4) / §10 Four-section order / §10 Honesty rules / §10 Specificity / §11 MEMORY.md read-the-file / §11 Mid-SPINE turn-yield / §11 Session-exit mid-SPINE. **12 HARD in core + 4 §EXT-side, zero delta from v6.10.2**.

**Sizing** (v6.11.3, 2026-04-30): core 23394 → 23643 chars (+249, +1.1%); extended 42302 → ~42050 chars (Recent-changes block compaction net of v6.11.3 entry). Size budget (§13.1): core 23643/25000 (1357 chars headroom, 94.6% utilized — closer to ceiling, still safe); extended ~42050/50000 (~7950 chars headroom, ~84% utilized). Runtime L0/L1/L2 ≈ 5.91k tokens (core only). L3/Override/ship ≈ 16.6k tokens (no change from v6.11.2). §13.2 budget cost = 0; 20-task counter preserved.

## §1.5-EXT GLOSSARY (full definitions)

| Term | Definition |
|---|---|
| **LOC** | additions + deletions per `git diff --stat`, excluding blank/comment-only lines. |
| **Module** | single-package repo: each `src/<subdir>/` is a Module. Monorepo: each workspace/package root is a Module. Sub-folders inside a Module are NOT separate modules. |
| **Local-Δ** | ≤2 files (source + its co-located test counts as one; co-located = test path mirrors source path). No exported-symbol change, no import-surface change, no config/schema touch. |
| **Assumption** | claim not verified this turn via Read/Grep/tool. Memory recall = assumption. |
| **Contract** | interface visible to external callers: signature, return/error type, API shape, status code, CLI flag, config key, I/O schema, security semantics. |
| **Evidence** | tool-call output showing specific behavior. *Fresh* = same turn or re-run after last change. |
| **Task** | one SPINE cycle. New user request = new task unless explicit continuation. |

## §5.1-EXT AUTONOMY_LEVEL effects (full table)

| Level | Effect on §5 table |
|---|---|
| `aggressive` | `cross-module refactor (≥3 Modules)` → soft; `Δ-contract public API` → soft when consumer is internal-only; `delete in safe-paths` → no surface-required; `deps dev-only` → none |
| `default` | §5 table as written, unchanged |
| `careful` | `deps dev-only` → hard; `cross-module ≥2 Modules` → hard; `L2 local single module` → soft (surface diff inline first) |

**Published client** (binds `aggressive` Δ-contract judgment): any consumer outside this repo — external SDK user, npm-install consumer, MCP client (incl. Claude Code reading a server's tool schema), CLI end-user via `npx` / `cargo install` / release binary. **Internal** = same-repo module-to-module only. Uncertainty → treat as published (hard).

## §7-EXT TMP_RETENTION policy

**`~/.claude/tmp/` retention**: harness SHOULD purge `mtime > 7d` at SessionStart (tool-exhaust, not WIP). Residue check ≥100 stale (>7d) + unconfigured harness → surface recommendation inline; no auto-clean without AUTH. Override: project `CLAUDE.md` `TMP_RETENTION_DAYS: 30`.

## §11-EXT Session maintenance heuristics (full)

Demoted from core §11 in v6.11.0 (non-HARD, low per-session hit rate; core pointer retained). These are guardrails, not gates — agents SHOULD apply when the condition fires, but missing them does not violate Iron Law #2.

- **Redundant Re-Read**: files Read or Written in this session do not need re-Read absent external-change signal (user says "pull latest" / commit message appears / mtime newer than last Read / structural test failure suggesting stale content). Unsure → re-read. Freshness is cheaper than staleness, but a third Read on unchanged content is wasted context.
- **Correction pressure**: if the user rejects ≥2 auto-decisions within a single task, switch to ASK-first for remaining sub-decisions of that task. Rejection signals the agent's inferred defaults are drifting from user intent — narrow the autonomy band until a fresh task resets it.
- **Context pressure** (>75% window OR compaction-imminent): (a) prefer fresh-subagent for any exploration/research that doesn't require main-thread state; (b) compact prose, drop evidential blocks already in inline citations; (c) defer non-critical Re-Read; (d) consider `tasks/<slug>-paused.md` checkpoint before the next long tool call to preserve resumability.

## §11-EXT Auto-memory decision tree (full)

Evaluate top-down; first match wins:

**Step 1: Global-state hard trigger** (MUST any level, skip judgment):
`~/.claude/` global-state writes across ≥2 files in one task (plugin install/uninstall / settings migration / marketplace edits / statusline chain swaps / hook registration / MCP config) → save `project`/`feedback` memory naming what + why.

**Exemption (self-describing artifact)**: edit produces durable in-artifact "what + why" a future session can grep without loading memory (versioned spec with `## Recent changes` / `CHANGELOG.md` / migration comment) → trigger satisfied, skip `mem_save`. Test: can rationale be recovered from the artifact alone? Opaque state (plugin install / marketplace JSON / hook registration / MCP config) fails this test → still save.

**Step 2: L2+ retrospective trigger** (MUST at L2+, overrides Step 3):
one of —
- (a) preventable-error pattern (>2 wasted tool iterations OR hypothesis falsified by DB/grep/tool in a reusable way)
- (b) non-default decision or non-obvious sequencing (spec-skill conflict resolved with non-default tradeoff, OR ship/release/env step not derivable from docs)

Body: `[context]` + `[what to do differently]` + `[trigger words]`. ≤8 lines.

**Step 3: Judgment test** (L0/L1, and L2+ when Steps 1-2 miss):
durable project artifact (overview / phase / plan / next-step / recommendation / retrospective / completion) whose insight would have changed a decision this session if known upfront AND has ≥1 future-reuse probability → save; else skip.

**Always skip regardless of step**:
`git log`-recoverable content, code invariant (→ inline comment), session-local state (→ `tasks/`), clean-root-cause bug (→ `mem_save` bugfix type, not this tree).

After any `memory/*.md` write: refresh `MEMORY.md` index line.
