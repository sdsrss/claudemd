# AI-CODING-SPEC v6.25.0 — Extended

Loaded on demand per §2.2 in `CLAUDE.md` — L3 / Override / ship / pre-ship review / orchestration. Version history: `~/.claude/CLAUDE-changelog.md`. Operator handbook (human-only, never Agent-loaded): `~/.claude/OPERATOR.md`.

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

Core NEVER clauses and `SAFE_DELETE_PATHS:` extension rule still bind — see core §5 Safe-paths whitelist.

## §2-EXT Override modes

Universal: Iron Law #2 + §8 SAFETY + §8 Anti-hallucination bind every mode. Per-task scope. Announce mode entry/exit inline ("entering HACK: prototyping in tmp/ — exits when promoted"). Modes cannot coexist.

**Mode entry**:
- **[HACK]** (e.g. "try / benchmark / spike / explore / 试试 / 探索" + scope clearly `tmp/` or `scripts/`): silent enter.
- **[EMERGENCY]** (e.g. "prod / incident / outage / 500 / rollback / 故障 / 回滚 / 挂了" + user ack): silent enter.
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

Common drift source: plan sketches (type lists / table fields / filesystem shapes / test import paths) written without Reading the real artifact — verify against code, not the sketch.

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
| Q&A (no code) | direct answer; docs-lookup for API claims (e.g. context7, if available) | |
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
Same error signature 3× → roll back the path that introduced it. Signature = `error_msg_normalized[:80]` + `exception_type`; 2+ matching = same. **Manual trigger**: user repeat-failure feedback (e.g. "又失败 / 又挂 / again") counts as a strike regardless of signature match. Reset on user "continue / 忽略" or approach explicitly pivots (new file, new hypothesis stated in prose). After 3 fails, question architecture — no 4th patch.

### Dead-end record
Append to plan: `dead-end: <approach> — <why failed> — DO NOT RETRY this task`.
Session-scoped. Promote to `tasks/lessons.md` only on user request ("记住这个") or same-session recurrence.

## §7-EXT VALIDATE (L3)

```
L3  TDD + full suite + e2e                    → inline evidence with numbers+baseline
    (no e2e infra: integration + smoke → [PARTIAL: no-e2e-infra], follow-up filed)
```

L2 evidence rules → core §7 (inline prose with numbers+baseline). The 5-tier evidence ladder and cold-start handling below bind at **L2+**, not L3 only. Iron Law #1 below binds at L2+ — its one-line form lives in core §7 (L2 does not load this file); this section carries the detail.

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
Core §7 defines the rule: before a push that fires CI/Release, check pushed-branch pipeline color; red → fix / annotate / ASK. Rationale in brief: stacking on red loses attribution for the next shipper; local green ≠ pipeline green (CI toolchain / lint-ruleset / env / platform drift); "I think CI is green" is not a check — state the concrete command run (`gh run list ...`) and cite the result.
Override form: commit body line `known-red baseline: <one-line reason>` (e.g. `known-red baseline: flaky test_x.y quarantined in issue #N, fix landing in PR #M`). Absence of this line + red baseline = spec violation.

## §10-V Banned-vocab (reference list)

Core §10 keeps the quick-check (top-5 EN + 中文). The mechanical gate is the plugin's `hooks/banned-vocab.patterns` (deny/advisory on prose + commit text regardless of which spec files are loaded); usage notes + fix recipes live in `reference_banned_vocab_examples.md`.

**OK (absolute)**: "reduced p99 580ms → 140ms" / "12/12 tests pass" / "65 → 64 tests after consolidation".

**OK (ratio with baseline)**: "1453 → 1490 tests (+2.5%)" / "cut FTS latency from 380ms to 95ms (4×)".

**OK (中文 with baseline)**: "FTS 查询 380ms → 95ms（4×）" / "fixed at schema.mjs:147, 12/12 tests pass".

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
- **Author ≠ reviewer (HARD)**: reviewer = fresh subagent, empty context. No self-review in costume. Subagent gated, not absent → Detection below.
- **L3 two-tier review**: per-task in sp:subagent-driven-development; pre-ship cross-cutting via gs:/review.
- **Ship pipeline owned by gs**: sp:finishing → gs:/review → gs:/ship → gs:/land-and-deploy → monitoring checklist.

### Ship-pipeline hardening (HARD)
On `ship` / `deploy` / `create-release` / `merge-and-push`, after loading extended, invoke the `ship` skill. Manual ship allowed ONLY if stated in REPORT: `manual ship because <reason>` — absence = spec violation.

Rationale: ship encapsulates mechanical checklists (manifest sync, CHANGELOG voice, release notes, GitHub Release artifact vs. bare tag) that are silent-failure-prone by hand (incidents: v2.33.2 manifest-sync CI failure; v2.6.3~v2.8.0 tag-without-Release update stall). Override form: REPORT Done first line `manual ship because <reason>`, so a reviewer can audit the manual diff against the skill's checklist.

**Manual-ship atomicity (HARD, clarification)**: when override applies, the manual path is still **one atomic turn**. Upon entering it, (1) enumerate every remaining step inline (typically commit → push → tag → release-artifact → CI verify) as a visible plan, and (2) execute them back-to-back within the same turn. No turn-ending between commit and the final Done-with-CI-green report. Green CI (or equivalent release-gate signal) is the Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: a hard failure (push rejected, tag collision, CI red) — stop at the failure with full context, not at a clean green step. The user's single ship-AUTH — per §5 "per-task, per-scope" — covers push/tag/release; do not re-litigate it one manual step at a time.

**Runbook fast-path (ship-trigger only)**: a project's ship-runbook memory (§11-EXT-MEM Ship-runbook consolidation) MAY end with a coverage stamp: `covers: §EXT §12[, <other §EXT sections>] @ v<core-spec-version>`. At ship, stamp version == current core spec version (visible in core's title line) → Read the runbook + targeted-Read each stamped section; the full extended load for the ship trigger is waived. Bounds: (a) applies only when extended would load solely via ship/release — incl. L3 arising from the released-artifact rule alone; architecture / breaking-schema / migration / prod / infra L3, Override modes, and three-strike still full-load. (b) Stamp missing, version mismatch, or coverage in doubt → full load this ship, then refresh the stamp — each spec release costs exactly one full re-read (self-healing). (c) A stamp is valid only if the runbook inlines the §12 obligations it waives (ship-skill-or-override form + manual-ship atomicity); a stamped runbook lacking them = stamp void. (d) Post-compaction re-read repeats the same fast-path reads. This is an explicit skip-list per §3 stricter-reading scoping; every §12 HARD obligation binds unchanged — the fast-path changes what you read, not what you owe.

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
| sp:dispatching-parallel-agents | sequential |
| sp:using-git-worktrees | single tree + branch; stash before switch |
| sp:subagent-driven-development | main + fresh-subagent review per sub-task (HARD). No subagent → L3 not executable, escalate |
| sp:*-code-review, gs:/review | fresh subagent + review brief; serves per-task and pre-ship |
| sp:finishing-a-development-branch | manual: rebase, squash, changelog, clean-tree |
| gs:/autoplan | user reviews; inline 3-view self-critique (CEO/design/eng) |
| gs:/ship, /land-and-deploy | manual git push + `[AUTH REQUIRED op:manual-deploy]` |
| gs:/browse | request user screenshot/log |
| gs:/qa, /qa-only | gs:/browse pass over the changed user-facing surface; report per §7 L2 evidence, repair via §12 Review-finding repair |
| gs:/canary | monitoring checklist (metrics/thresholds/rollback trigger/command); user monitors |
| gs:/benchmark | hyperfine/time/native; `tasks/perf-<n>.md` |
| gs:/cso | manual STRIDE on auth/payment/crypto paths |
| gs:/codex | skip; note "no second-opinion review" in §10 |
| context7 (API docs-lookup) | WebFetch official docs; cite lookup source in answer |
| gs:/freeze, /careful, /guard, /retro | inline scope-lock; retro in `tasks/retro-<date>.md` |
| gs:/document-release | release notes by hand from the CHANGELOG top entry (gh release body); name the substitution |

Detection: first call fails → session flag → auto-degrade. Flag expires after 5 turns or env change. **Absent-from-listing = missing**: a skill switched off via `skillOverrides` or never installed produces no failing call — it is simply not in the session's skill list, so call-failure detection never fires. Check the routed skill is listed before invoking; unlisted → take its fallback row and name the substitution in one prose line. No fallback row for it → say so in REPORT under Uncertain; do not silently improvise a substitute.
**Gated = missing**: capability listed and callable but blocked by a lower-precedence layer (harness `unless the user requested it`, tool switched off) — neither detector above fires. §3 ranks that layer below this spec, so the gate may not win SILENTLY: name it, then treat as missing → take the fallback row. Where that row itself needs the gated capability (`sp:subagent-driven-development`, `sp:*-code-review` / `gs:/review`) there is nothing to degrade to: ASK once; refused → L2 `[PARTIAL: no independent review]`, L3 not executable, escalate (the subagent-driven row governs). Rows carrying a written non-subagent degrade (`gs:/autoplan` self-critique, `gs:/codex` skip, `gs:/qa`) take it as written.
**Batch confirmation**: ≥3 fallbacks needing user input → consolidate into ONE message.

## §13 META (Agent-facing)

- **Spec changes**: patch (wording / clarification, identical behavior) = L2; minor (rule added / relaxed) / major (protocol shift) = L3 per core §2 LLM-visible metadata. Proposal → diff → user ASK at all levels.
- **Version bump**: patch (wording/clarification, identical behavior) / minor (rule added/relaxed, backward-compatible) / major (protocol shift).
- **HARD-rule removal**: rationale + 30-day grace note before deletion.
- **HARD → SHOULD downgrade**: rationale required (which rule, why unreliable, fallback posture).
- **Drift check**: project `CLAUDE.md` ranks with current-turn user per §3 TRUST order — where the spec explicitly delegates (§5.1 AUTONOMY_LEVEL, `SAFE_DELETE_PATHS:`, `TMP_RETENTION_DAYS:`) the project file wins; §8/HARD never yield. Flag obvious contradictions only (conflicting AUTH levels, opposing TDD policy, signal-format overrides) in first reply — no full diff.
- **HARD ≠ always hook-blocked**: `spec/hard-rules.json#rules[].enforcement` partitions the 25 HARD rules by how they are checked — `hook` (mechanical deny / advisory), `self` (Agent self-enforces; observed via Stop-time advisory scan), `both` (hook covers a subset, Agent covers the rest), `external` (manual via `/claudemd-rules` + operator audit). Calibrate expectation accordingly: when planning a destructive op, a `self`-enforced HARD will NOT auto-block — Agent owns the gate. Today: 6 hook / 16 self / 2 both / 1 external.

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

## Appendix B — Canonical examples

B.3–B.6 removed as illustrative duplicates of §10-R / §2-EXT EMERGENCY / §2.S — do not re-add.

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

## Recent changes

Full version history: `~/.claude/CLAUDE-changelog.md`. Only the current version's entry lives here.

**v6.25.0 (minor, 2026-08-09)** — compression + relocation: attention-budget headroom restore.

- Zero rule-semantics change; zero section renames; enforcement partition unchanged (6/16/2/1). Removed archaeology + bookkeeping prose; rationale essays → one-line citations (rules verbatim); operator-side governance (§13.2 gates, §13.3 gate tables, carry-forward block) → `OPERATOR.md`; core Iron Law #2 L2 example → Appendix B shapes. Decision record: `tasks/spec-lean-cut-candidates-2026-08-09.md` (local).

**Sizing** (v6.25.0, 2026-08-09, single post-edit `wc -c` per `feedback_spec_sizing_recursive_rewrite.md` option 1): core 24793 → 23042 bytes (Δ −1751: compression pass); extended 49964 → 42999 bytes (Δ −6965: compression + OPERATOR relocation); OPERATOR.md 8811 → 11027 bytes (Δ +2216: absorbed §13.3 gates + carry-forward). Size budget: core 23042/25000 (**1958 bytes headroom, 92.17%**); extended 42999/50000 (**7001 bytes headroom, 86.00%**). Drift envelope: ±20B for this line's own rewrite. Runtime L0/L1/L2 ≈ 5.5k tokens (core only).

## §1.5-EXT GLOSSARY

Core §1.5 inlines `LOC / Local-Δ / Module / Evidence / Task / Contract / Δ-contract` (used at L1/L2). Extended-only terms + clarifications:

- **Assumption** — claim not verified this turn via Read/Grep/tool. Memory recall = assumption.
- **Local-Δ note** — co-located = test path mirrors source path.

## §5.1-EXT AUTONOMY_LEVEL effects (full table)

| Level | Effect on §5 table |
|---|---|
| `aggressive` | `Δ-contract public API` → soft when the consumer is internal-only (see Published client below); `delete in safe-paths` → no surface-required; `deps dev-only` → none. `cross-module refactor (≥3 Modules)` stays HARD — the skip-list below says §5 Hard-AUTH still binds, and two passages cannot both be followed (§3 stricter-reading). |
| `default` | §5 table as written, unchanged |
| `careful` | `deps dev-only` → hard; `cross-module ≥2 Modules` → hard; `L2 local single module` → soft (surface diff inline first) |

**`aggressive` skip-list** (core §5.1 pointer): skill soft-trigger announcement optional; §1 Recommend-first single-obvious-option execute-without-preamble is the default; clear-scope bugfix goes fix → test → iterate without proposal. §8 SAFETY + Iron Law #2 + §5 Hard-AUTH still bind — the reductions are ceremony-only and never touch the §5.1 Never-downgrade set.

**Published client** (binds `aggressive` Δ-contract judgment): any consumer outside this repo — external SDK user, npm-install consumer, MCP client (incl. Claude Code reading a server's tool schema), CLI end-user via `npx` / `cargo install` / release binary. **Internal** = same-repo module-to-module only. Uncertainty → treat as published (hard).

## §7-EXT-TMP TMP_RETENTION policy

**`~/.claude/tmp/` retention**: harness SHOULD purge `mtime > 7d` at SessionStart (tool-exhaust, not WIP). Residue check ≥100 stale (>7d) + unconfigured harness → surface recommendation inline; no auto-clean without AUTH. Override: project `CLAUDE.md` `TMP_RETENTION_DAYS: 30`.

## §11-EXT Session heuristics (advisory)

SHOULD-level guardrails — apply when condition fires, not Iron Law gates.

- **Redundant Re-Read**: files Read or Written this session don't need re-Read absent external-change signal (user says "pull latest" / commit appears / mtime newer / structural test failure). Unsure → re-read; a third Read on unchanged content is wasted context.
- **Correction pressure**: user rejects ≥2 auto-decisions in one task → switch to ASK-first for remaining sub-decisions. Rejection signals inferred defaults are drifting.
- **Context pressure** (>75% window OR compaction-imminent): (a) prefer fresh-subagent for exploration not requiring main-thread state; (b) compact prose, drop evidential blocks already inline-cited; (c) defer non-critical Re-Read; (d) consider `tasks/<slug>-paused.md` checkpoint before next long tool call.
- **Read-before-propose**: don't propose changes to code you haven't Read or Grep'd this session. §1 Search-before-write covers writes; this covers AUTH-eligible proposals — a `[AUTH REQUIRED]` citing unread code is a false-claim incident.
- **Diagnose-before-pivot**: approach failed once → diagnose (read error, check assumption, focused fix); §6 Three-strike is the upper bound, not the trigger — pivoting too early on a viable approach burns context.
- **Existing-comment protection**: don't remove old comments unless removing the code they describe OR verified them wrong this session. §1 "default to writing no comments" addresses *new* comments, not pruning old.

## §11-EXT-MEM Memory operations

One home per fact — double-writing creates drift.

**Terminology**: `claude-mem-lite` = the recall-layer plugin only (FTS5 / timeline / `[mem]` prefix); `MEMORY.md` / **durable layer** = CC built-in 4-type memory only. Avoid bare `mem` in new spec text or hook output — ambiguous between the two layers.

### Layer routing

| Layer | Path | Time horizon | Use for |
|---|---|---|---|
| **Durable (CC built-in 4 types)** | `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md` + `*.md` | session-spanning | user role / preference / cross-session lessons / project-permanent decisions |
| **Time-sensitive recall plugin** (e.g. `claude-mem-lite` FTS5 + timeline) | plugin-managed | days–weeks, rolls off | bugfix lessons / current-project state / recent activity |

**Picking the home**: "will this be true 6 months from now?" Yes → durable. No → recall plugin. Conflict: durable wins; recall layer ages out.

**Plugin-absent fallback**: detect via tool list (no `mem_save`/`mem_search` → plugin unloaded). Recall content then writes to `recall_<topic>_<YYYYMMDD>.md` in durable layer with `[fallback]` tag. Routing matrix + lesson disambiguation (bugfix postmortem vs trap rule) → `feedback_memory_layer_routing.md`.

**Body-structure scope**: `mem-audit` Stop hook scans `feedback_*.md` only for `**Why:**` / `**How to apply:**` body markers. `project_*.md` exempt — the incident-log pattern (`project_<topic>_<date>.md`) is fact-only by nature; the hook does not warn when authors omit Why/How there.

**User-override filter** (extends CC built-in `## What NOT to save`): WHAT-NOT-TO-SAVE list (`git log`-recoverable / code invariant / session-local / clean-root-cause bug) applies even when user says "save / 记一下 / remember this". Activity logs, PR rundowns, step lists, deploy walkthroughs lower signal density. Compliance = ASK what was *surprising* or *non-obvious*, save only that.

### Auto-memory decision tree (top-down, first match wins)

**Step 1 — Global-state hard** (MUST any level, skip judgment): `~/.claude/` writes across ≥2 files in one task (plugin install/uninstall / settings migration / marketplace edits / statusline / hook / MCP config) → save `project`/`feedback` memory naming what + why. **Self-describing artifact exemption**: edit produces durable in-artifact "what + why" a future session can grep without loading memory (versioned spec with `## Recent changes` / `CHANGELOG.md` / migration comment) → skip `mem_save`. Test: opaque state (plugin / marketplace JSON / hook / MCP) fails the test, still save.

**Step 2 — L2+ retrospective** (MUST L2+, overrides Step 3): (a) preventable-error pattern (>2 wasted tool iterations OR hypothesis falsified in a reusable way), OR (b) non-default decision / non-obvious sequencing (spec-skill conflict resolved with non-default tradeoff, OR ship/release/env step not derivable from docs). Body: `[context]` + `[what to do differently]` + `[trigger words]`, ≤8 lines.

**Step 3 — Judgment** (L0/L1, and L2+ when Steps 1-2 miss): durable project artifact (overview / phase / plan / retrospective / completion) whose insight would have changed a decision this session AND has ≥1 future-reuse probability → save; else skip.

**Always skip regardless of step**: `git log`-recoverable, code invariant (→ inline comment), session-local (→ `tasks/`), clean-root-cause bug (→ `mem_save` bugfix type, not this tree).

After any `memory/*.md` write: refresh `MEMORY.md` index line.

### MEMORY.md tag syntax

- Optional `- [Title](file.md) [tag1, tag2] — description`. Agent matches task keywords against tags before Read.
- **Untagged lines** = agent-driven full content scan from title/description; hook does NOT auto-block.
- **Tag specificity (SHOULD)**: tags ≥4 chars AND specific to the topic. Avoid generic single-word EN tags (`hook` / `plugin` / `test` / `cli` / `audit` / `done` / `spec` / `ship` when memory not actually about ship-flow) that substring-match incidental occurrences. Prefer multi-word phrases (`hook-fail-open` / `cli-flag-shape` / `audit-pipeline-filter`). The hook applies word-boundary matching with 0-2 char declension tolerance (`hook` → `hooks` / `hooked`; `cli` ≠ inside `clippy`); generic exact-word tags still fire — fix at authoring time.
- Rule of thumb: if removing the tag wouldn't change agent's decision quality on a typical command match, the tag is too generic.
- **Ship-runbook consolidation (SHOULD)**: per project, ship-trigger tags (`ship / release / deploy / 发布 / 发版 / 打tag`) belong to exactly ONE memory file — the project's ship runbook, holding the full release flow (pre-ship checks → atomic steps → post-ship). Flow changes edit that file; other ship-adjacent lessons keep their topical tags and get `[[links]]` from the runbook instead of own ship tags. Effect: §11 read-the-file at ship costs one predictable Read instead of tag fan-out.

## §0.2-EXT Mid-task feedback (continued)

Core §0.2 keeps Refinement / Quality slider / Scope-expansion; the rest:

- **Continuation** (e.g. "继续/next"): same SPINE.
- **Cancel** (e.g. "停/算了"): close; snapshot `tasks/<slug>-paused.md` if non-trivial.
- **Switch** (e.g. "先做X再做Y"): new SPINE; `paused.md` only under context pressure or non-trivial.

## §11-EXT-MAC macOS shell portability (cross-ref)

Implementation discipline (BSD-vs-GNU `stat`, `wc -l` padding, missing `timeout`, `mktemp` symlink, exec-bit) lives in memory anchors, not spec rules: `feedback_macos_shell_portability.md` + `feedback_hook_platform_lib_source.md` (silent fallthrough — must `source` `hooks/lib/platform.sh`; a `command -v` guard alone falls silently false).
