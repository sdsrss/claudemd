# AI-CODING-SPEC — Version history

Canonical history for `~/.claude/CLAUDE.md` + `~/.claude/CLAUDE-extended.md`. Moved out of `CLAUDE-extended.md` in v6.9.0 to reduce per-turn token cost of the L3/ship load path (v6.8.1 Recent-changes block was ~6k chars).

Current version + sizing live in `CLAUDE-extended.md` (Recent changes section). New minor/major bumps MUST prepend an entry here.

---

## v6.19.0 — 2026-07-13

Minor: §2.2 **Runbook fast-path** — when extended would load solely because of ship/release (incl. released-artifact L3) and the project's ship-runbook memory carries a current-version coverage stamp (`covers: §EXT §12 … @ v<spec>`), the ship reads the runbook + targeted-reads the stamped §EXT sections instead of the full file. Stamp missing/stale/doubtful → full load + stamp refresh (self-healing, one full re-read per spec release). Bounds in §EXT §12: ship-trigger only — architecture/breaking-schema/migration/prod/infra L3, Override modes, and three-strike still full-load; a stamp is void unless the runbook inlines the §12 obligations it waives; every §12 HARD obligation binds unchanged. Paired net-delete per §0.1: **C4 consumed** — §2.1 Model-tiering Sonnet/Opus category enumeration → new §EXT §2.1-EXT (safety invariants stay in core). Operator-requested token-efficiency relaxation: closes the extended side of the ship read cost after v6.16.0 closed the memory side. Core/extended Δ: extended Sizing line.

## v6.18.0 — 2026-07-13

Minor: §1 Language-contract refinement — **reasoning moves to English** (was user's-language), plus an explicit docs split: local analysis/audit docs follow the user's language while shipped reference/contract docs (ARCHITECTURE / HOOK-PROTOCOL / RULE-HITS-SCHEMA / ADDING-NEW-HOOK / cross-project-pilot) stay English for adopters. Done narrative made explicit in the user's-language bucket. Code / comments / commits / CHANGELOG / PR / log-strings / config-keys / CLI-labels unchanged (English). Core Δ ≈ +79B (within headroom, no net-delete required).

## v6.17.0 — 2026-07-11

Minor: four-method spec-audit letter-fix batch — 7 core fixes from verified red-team findings + C5/C6 net-delete (core Δ −91B). Audit dossier: `tasks/spec-audit-2026-07-11.md`.

- `[change]` **§3 stricter-reading scoped** (audit #3): applies to safety/AUTH-relevant ambiguity; explicit whitelists/skip-lists stay effective. Root cause of the S1 probe fork and the "letter-stricter voids relaxations" leak class — the only deviation direction the 12-probe cold-start suite found.
- `[change]` **§2.2 targeted-Read exception** (audit #6): targeted Read of a core-referenced §EXT section OK at any level (full-file load stays L3/ship). Un-strands §5.1-EXT / §7-EXT relaxations that govern L1/L2 but were unreachable there.
- `[add]` **8.V1 + test-runner pass-fail count** (audit #1): Iron Law #2's most typical confabulation shape ("7 passed" from memory) now inside the anti-hallucination list; channel widened to Read/Grep/tool output.
- `[add]` **§2 self-reference resolution** (audit #5): LLM-visible-metadata L3 clause points spec self-edits at §EXT §13 META — the v6.16.0 changelog had to argue this from §13 alone.
- `[change]` **§7 residue-check example §8-conformant** (audit #2): `find <explicit-path> -maxdepth 2 -newer <baseline>` / `du -sh <explicit-path>` — two HARDs (one immutable) no longer collide on `~/.claude/`.
- `[delete]` **Fast-Path "pre-classified follow-up"** (audit #10): self-referential unbounded L0 authorization out of the whitelist.
- `[delete]` **§1.5 LOC "excl. blank/comment-only"** (audit #8): not computable from `git diff --stat`; raw counts were always the operating definition.
- `[move]` **C5 — §0.1 tier definitions → `OPERATOR.md §13.1`** (≈ −185B derived): core keeps Tier-2 default landing + hard cap + net-delete + pointer.
- `[delete]` **C6 — §9 Parallel-first compressed** (−116B measured): the harness parallelizes independent tool calls natively; one-line rule retained.
- Deferred: audit #4 (§0↔§12 ship parenthetical — status quo: ship always loads extended; §12 manual-ship-atomicity + runbook memory cover it) and audit #7 (§1.5 Module fallback — external-adoption-facing, internal freeze).

### Background

2026-07-11 four-method audit (first-person use / 12 pre-registered cold-start probes / red-team + main-context verification / 30d telemetry). Headline: 0 safety failures, 0 honesty failures, retrieval quiz 5/5; every confirmed drift points toward over-strictness (attention cost), never under-enforcement. Red-team yield after cross-layer verification: 8 confirmed / 2 partial / 1 rejected — this batch executes the confirmed letter-level set. Plugin-side siblings shipped in v0.35.0 (R1 hint source-filter + dedupe, R2 MEMORY.md 12KB doctor budget, R3 mem-lite defer D#65).

### §13.2 budget cost

No HARD added (letter fixes patch-exempt; two relaxations are minor-level). Rule *removals* add budget back per §13.2. Core net-delete −91B: paired adds ≈ +264, deletes #8+#10 −54, C5 ≈ −185, C6 −116. Same-day second minor after v6.16.0: both under the one operator-requested audit session, every change backed by probe/telemetry invocation data — the evidence class §13.1 minor-spacing protects.

## v6.16.0 — 2026-07-11

Minor: §11-EXT ship-runbook consolidation (SHOULD).

- `[add]` **§11-EXT MEMORY.md tag syntax → Ship-runbook consolidation**: per project, ship-trigger tags (`ship / release / deploy / 发布 / 发版 / 打tag`) belong to exactly ONE memory file — the project's ship runbook holding the full release flow (pre-ship checks → atomic steps → post-ship). Flow changes edit that file; ship-adjacent lessons keep topical tags and are `[[linked]]` from the runbook. Effect: the §11 read-the-file HARD gate at ship costs one predictable Read instead of tag fan-out.

### Background

2026-07-11 user request: ship-time memory reads felt slow and token-expensive ("每次发版都要被拦住读一堆记忆文件"). memory-read-check telemetry 2026-05-20 → 2026-07-10 (~20 deny events) showed modal match_count=1 but recurring generic-tag FP fan-out (bypass reasons "residual keyword tag hits are FPs") plus repeat re-reads of the same atomic-ship memory. The user proposed a per-project single ship.md; this rule lands that as a MEMORY.md convention on the existing tag mechanism — no hook change. Shipped in plugin v0.34.0; claudemd's own runbook is `feedback_claudemd_ship_from_main_atomic.md` (rewritten same day).

### §13.2 budget cost

SHOULD-level, not HARD — no budget cost. `OPERATOR.md §13.1` ≥20-task minor-spacing overridden by explicit operator request; acceptable because the rule is telemetry-derived (7 weeks of rule-hits), which is the failure mode the spacing rule guards against.

## v6.15.1 — 2026-07-10

Patch: §0.1 operator-threshold relocation to `OPERATOR.md §13.1` (Candidate 3, no rule change).

- `[move]` **§0.1 tier promotion/demotion thresholds** (core → `OPERATOR.md §13.1`): promotion gates ("≥3 sessions in 30d" / "≥5 sessions + elaboration wasn't consulted") and the `/claudemd-rules` demotion recommendation relocated — enforcement is operator-side (`external`), the Agent cannot act on them at runtime. Core keeps Tier-2 default landing zone, tier structure, hard cap + net-delete clause, Sizing tracking. Candidate 3 of `tasks/core-net-delete-candidates-v6.14.md`; −239B measured (core 24978 → 24739, headroom 261B).

### Background

2026-07-10 user-requested core-attention review ("核心规范占上下文多不多、有没有分散注意力、能不能压缩"). Data path re-confirmed demote closed (`hard-rules-audit.js` `demoteCandidates=[]`); the review instead identified an audience mismatch — operator-executed thresholds living in Agent-loaded core. Executed as user-authorized standalone compression (paired-with-addition default overridden by explicit instruction). Shipped in plugin v0.32.3.

### §13.2 budget cost

No rule added/removed/relaxed — `[move]` only. Core −239B; OPERATOR.md +528B (human-only, unbudgeted).

## v6.15.0 — 2026-07-10

Minor: §2.1 Model tiering rule (spawned-agent model selection) + Candidate-1 net-delete.

- `[add]` **§2.1 Model tiering** (core, after Tool escalation): spawned agents default to inheriting the session model (omit `model` when unsure); whitelist downgrade — sonnet for mechanical fan-out (search / fetch / extract / classify / enumerate) + lint-or-test-gated bulk edits (pair `effort:'low'`), opus for test-gated plan-step code. NEVER downgrade decision-shaped stages: orchestrate / synthesize / verify / judge / root-cause debug / L3 / §5-hard / §8 content. Invariants: verifier tier ≥ generator; anomalous downgraded output → one re-run at inherited tier; evidence bar is tier-independent (Iron Law #2). SHOULD-level guidance, NOT HARD (`hard-rules.json` untouched). Design: `tasks/specs/model-tiering.md` — tier by error shape, not task difficulty.
- `[net-delete]` **§7 metric-coupled row examples** (core): 6 project-specific examples removed per Candidate 1 (`tasks/core-net-delete-candidates-v6.14.md`), −169B measured. Category names + "Metric-coupling typical triggers" sentence remain the anchors.

## v6.14.2 — 2026-07-10

Patch: trigger-list `e.g.` markers + EXT-header load-scope alignment + context7 conditionalized (no rule change).

- `[clarify]` **Extended header load-scope**: "review" → "pre-ship review", aligning the extended file header with core §2.2's trigger list — per-task code review does not load extended (stricter reading per §3 resolved a 2-way drift).
- `[clarify]` **Trigger-word lists marked non-exhaustive**: core §0.2 quality-slider, core §2 depth-triggers, extended §2-EXT HACK/EMERGENCY entries, §6 three-strike manual trigger, §0.2-EXT continuation/cancel/switch — all literal phrase lists now carry `e.g.`. Detector definitions (core §11 mid-SPINE tell) intentionally stay exact-list because transcript detectors consume them.
- `[clarify]` **context7 conditionalized**: core §2.1 + extended §4 Q&A rows now say "docs-lookup for API claims (e.g. context7, if available)"; extended §12 fallback table gains a context7 row (WebFetch official docs).

### Background

2026-07-10 consumer-perspective spec review (P6 small-drift findings) → `docs/spec-optimization-plan-2026-07-10.md`. Shipped in plugin v0.27.0 together with the P6/F4 post-compaction §11 re-read reminder (hook behavior, not spec text).

### §13.2 budget cost

No rule added/removed/relaxed — `[clarify]` only. Core Δ ≈ +48B (`e.g.` ×2 + docs-lookup wording).

## v6.14.1 — 2026-06-03

Patch: §2.1 skill-MUST-invoke override clarified (no rule change).

- `[clarify]` **§2.1 skill collision** (core, Δ +136B): the "this spec wins for L0–L2" clause is now bolded and carries a concrete example — superpowers / gstack `MUST invoke` wording (`sp:test-driven-development` "before writing implementation code", `gs:investigate` "do NOT debug directly") does NOT force a clear-scope L1 bug out of fix→test-direct into TDD / investigate ceremony. The precedence was already stated, just buried mid-paragraph.

### Background

A 2026-06-03 cross-project impact audit (workflow `claudemd-impact-audit`) flagged an instruction-collision: superpowers `using-superpowers` ("invoke skill before ANY response") and TDD ("before writing implementation code") create MUST-invoke pressure that competes with §2.1's L0–L2 proceed-without default — a model facing the louder "MUST" tends to add the very ceremony §2.1 sheds. The fix is prominence + one worked example, not a behavior change. Shipped in plugin v0.23.4.

### §13.2 budget cost

No rule added/removed/relaxed — `[clarify]` only. Core +136B (447B headroom remains, 98.21%). Headroom note (corrected v0.23.6): impact-audit #4 (the proposed ~12.6K core→extended demote) was investigated 2026-06-03 and **rejected** as a category error — `0 telemetry` on §0/§1/§1.5/§2/§3/§5/§9 means "read-and-follow foundational, fires no hook," not "unused" (`hard-rules-audit.js` → `demoteCandidates=[]`). Core has no safe demotion target, so **net-zero / net-delete is the permanent posture**, not a wait-for-#4 measure. Do NOT re-attempt #4.

## v6.14.0 — 2026-05-24

Minor: §10 REPORT template defaults relaxed + §10 banned-vocab inline list trimmed.

- `[relax]` **§10 L1-bugfix template** (core, Δ ≈ +90B): "four-section always" → "single-line `Done:` with bugfix anchor by default; four-section when Failed/Uncertain ≥2 OR scope ≥2 files". Iron Law #2 bugfix anchor (cite prior-failing state) preserved — only the structural shell relaxes. ~80% of L1-bugfix tasks are single-file single-failure-mode where four-section was over-applied. Stop hook `transcript-structure-scan.sh:13–15` already gates four-section-order detection on ALL-four-present, so single-line Done passes through silently.
- `[change]` **§10 Banned-vocab inline list trimmed to top-5 quick-check** (core, Δ ≈ -320B): full enumeration (10 EN adjectives + 7 中文 + baseline-less ratios) already cross-referenced to §EXT §10-V; core inline now lists 5 EN + 3 中文. Full list lives in §EXT §10-V (unchanged) + new memory anchor `reference_banned_vocab_examples.md`. Positive rule unchanged.

### Background

User-driven optimization audit (turn series 2026-05-24, "claude 编程结合度" thread) surfaced two cumulative frictions: (a) L1-bugfix four-section template was over-applied to single-file single-failure-mode fixes — `feedback_done_section_chinese_prose.md` flagged the over-formatting pattern; (b) banned-vocab inline list in core §10 was already cross-referenced to §EXT §10-V, with each new synonym adding inline bytes without changing the underlying positive rule. **Measured impact**: core delta -15B (R4 +89B, R5 -104B — R5 yielded less than the ~320B initial estimate because the original line was ~400B not ~600B); extended delta -1071B (v6.13.x Recent-changes evictions to `CLAUDE-changelog.md`). The real headroom win was extended-side.

Initial scope explored a larger R1 (add `instrumentable` field to `hard-rules.json` + cross-layer `hookId` mapping); on read-through of existing manifest + `scripts/hard-rules-audit.js` the work was discovered to be ~95% already shipped via existing `enforcement` + `rule_hits_section` fields. Pivoted to R4+R5 as the next-leverage step. R-N8 self-enforced transcript scan (audit script comment names it as the actual remaining gap) deferred to a dedicated spike.

### Why minor (not patch)

`[relax]` on L1-bugfix default = behavioral change to default REPORT shape per §13 META ("rule added/relaxed → minor"). R5 alone would be patch (wording slim with cross-ref preserved); combined with R4 the bump is minor.

### §13.2 budget cost

R4 relax adds budget back (per §13.2 "Rule removal and HARD→SHOULD downgrades explicitly encouraged — no budget cost; they *add* budget back"). R5 is content-move within §10 Specificity HARD, no rule change. Net: +0 added rules, headroom freed.

### Ship target

Plugin v0.22.0 — minor bump tracking spec minor.

### Reviewer notes

- No tests assert on the exact `**Banned-vocab quick-list**` body string or the literal phrase `four-section always` (verified via `grep -rln` across `tests/` `scripts/` `hooks/` `bin/`).
- `tests/integration/upgrade-lifecycle.test.sh` `NEW_SPEC_VER` bumped to `v6.14.0`; `NEW_RULE_NEEDLE="Memory routing"` still present in v6.14.0 (no change needed).
- `spec/hard-rules.json` `spec_version` bumped to `v6.14.0`; manifest content (rule list / enforcement classifications) unchanged.
- Stop hook `transcript-structure-scan.sh` design already accommodates partial reports — its four-section-order detection requires ALL FOUR of `Done:` `Not done:` `Failed:` `Uncertain:` to appear within a 50-line window (`transcript-structure-scan.sh:13`). Single-line Done (the new L1-bugfix default) passes through without firing.
- New memory file `reference_banned_vocab_examples.md` follows CC built-in `reference` type — content lookup table, not external-system pointer; canonical source remains §EXT §10-V.

---

## v6.13.2 — 2026-05-24

Patch: terminology disambiguation for `claude-mem-lite` plugin vs `MEMORY.md` durable layer. Identical Agent behavior.

- `[clarify]` **§11-EXT Memory operations — Terminology bullet** (extended, ~+625B): names `claude-mem-lite` (recall plugin) and `MEMORY.md` (durable layer) as distinct, bans bare `mem` in new spec/hook text. Scopes existing `mem_*` / `mem-audit` identifiers so renames are not triggered. Driven by user audit: hook prefix `[mem-hint]` from `memory-prompt-hint.sh` and claude-mem-lite's own `[mem]` startup output collided in agent-visible context — disambiguation at terminology layer is the lowest-blast-radius fix.
- `[change]` **`[mem-hint]` → `[claudemd] §11 memory-hint:`** (hook output, not spec): `memory-prompt-hint.sh:169` brought into the existing `[claudemd] §<section> <hook-name>:` prefix convention used by `mem-audit.sh:173/181`. No semantic change; LLM still sees same payload + same instructions.
- `[clarify]` **§11 SPINE Mid-SPINE turn-yield — `[mem]` annotation** (core, +21B): inline qualifier `(claude-mem-lite)` after the bare `[mem]` token in the mid-turn context example.
- `[clarify]` **§13 META — HARD ≠ always hook-blocked** (extended, +545B): one bullet pointing Agent at `spec/hard-rules.json#rules[].enforcement` so the 22 HARD rules' enforcement partition (6 hook / 14 self / 1 both / 1 external) is reachable from the L3/ship/Override load path. Prevents "I assumed the hook would block X" miscalibration on `self`-enforced HARDs.
- `[add]` **OPERATOR.md §13.4 `tasks/` filename conventions table** (operator-only, not Agent-loaded, +2450B in OPERATOR.md): single reference for the 11 `tasks/<slug>` filename patterns scattered across §0.2 / §2-EXT / §2.S / §10-R / §11-O / §12 / §13.2. No Agent-context cost.

### Why patch (not minor)

All five changes are clarify/change (additive context + hook-output rename) with no rule add/remove or behavior change. Per §13 META: `patch (wording / clarification, identical behavior)`.

### Ship target

Plugin v0.21.x — patch tracking spec patch.

---

## v6.13.0 — 2026-05-21

Minor: three-tier architecture made explicit + operator content evicted from Agent context.

- `[change]` **§0.1 Three-tier default** (core, Δ +284B net): new rules default to Tier 2 (MEMORY.md anchor, keyword-loaded), not Tier 1 (extended). Promotion path: Tier 2 → Tier 1 (≥3 sessions in 30d on same trigger) → Tier 0 (≥5 sessions in 30d, rule fired without elaboration consult). Previously, `§0.1` said "new rule defaults to extended §X-EXT" — that defaulted patches into Agent-loaded context. Tier 2 default routes new rules out of the load path entirely until usage justifies promotion.
- `[move]` **§13.1 OPERATOR RESPONSIBILITIES → `OPERATOR.md`** (extended, Δ −1418B for §13.1 removal + small pointer): human-only spec-maintenance handbook (self-audit cadence / drift monitoring / version discipline / size budget rationale) extracted into new top-level `OPERATOR.md` (3955B), not loaded by the Agent. Spec marked these "Not Agent rules" since v6.9.0 — Agent attention was burned loading directives it could not execute. `§13.1` anchor name persists in code/hook telemetry (`§13.1-extended-read`, `bySection` audit accounting) as a stable label; section text now lives in `OPERATOR.md §13.1`. Operator-side slices of §13.2 (batch-review cadence, promotion gates summary) and §13.3 (audit cadence) also have pointers in `OPERATOR.md` — agent-executable parts (incident logging, gate definitions) stay in extended §13.2 / §13.3.
- `[deferred]` **§5.1 NEVER-downgrade vs §8 SAFETY dedupe** (analyzed, NOT executed): initial scoping called them duplicates; rereading showed distinct enforcement semantics — §5.1 names the AUTH-gate floor under AUTONOMY_LEVEL, §8 names operations banned entirely. Not actually overlapping content; merge would conflate two roles. Deferred indefinitely.

### Background

External question: "can we apply the MEMORY.md index model to CLAUDE.md itself?" Answer: partially. MEMORY.md is informational (lookup-on-demand); CLAUDE.md is procedural (per-turn gates that must fire). The right analogy isn't "make CLAUDE.md like MEMORY.md" — it's "ensure CLAUDE.md contains ONLY per-turn gates, push everything else down the tier ladder." This release encodes the three-tier architecture that was implicit since v6.11.14's macOS-portability eviction:

| Tier | File | Loaded by Agent? | Content |
|---|---|---|---|
| 0 (always) | `CLAUDE.md` | every turn | per-turn gates (SPINE / AUTH / VALIDATE / SAFETY / Iron Laws) |
| 1 (triggered) | `CLAUDE-extended.md` | L3 / ship / Override / review | conditional rules (FLOW / evidence ladder / plugin fallback / META) |
| 2 (keyword) | `MEMORY.md` + `*.md` anchors | on keyword/path match | recall-on-demand (`feedback_*.md` / `project_*.md` / `reference_*.md`) |
| operator | `OPERATOR.md` | **never auto-loaded** | human spec-maintenance handbook |

Before v6.13.0, the default for new rules was Tier 1. Result: extended grew ~6.8K bytes across v6.11.4–v6.11.7 (logged in `CLAUDE-changelog.md` Sizing lines) before v6.11.14 reclaimed via consolidation refactor. New default = Tier 2 closes that loop at source instead of via post-hoc cleanup releases.

### Why minor (not patch)

`§0.1` default rule change is a policy shift — `feedback_*.md` rule placement was previously informal, now codified as the entry point. The §13.1 file move is mechanical, but the surface area touched (every code/hook/command/test reference to `§13.1`) makes it minor-worthy for downstream version pinning.

### Ship target

Plugin v0.19.0 — minor bump tracking spec minor. CHANGELOG cross-references `OPERATOR.md` as a new top-level artifact in the plugin payload (synced to `~/.claude/OPERATOR.md` alongside `CLAUDE.md` + `CLAUDE-extended.md` via `/claudemd-update`).

### Reviewer notes

Hook telemetry stability: `§13.1-extended-read` event tag in `hooks/session-extended-read.sh` (and asserted in `tests/hooks/session-extended-read.test.sh:25`) preserved. Tag is a stable log marker, not a content cross-reference — content move does not invalidate it. `bySection` audit accounting (`hooks/lib/rule-hits.sh`, `scripts/hard-rules-audit.js`, `scripts/doctor.js`, `scripts/sparkline.js`, `commands/claudemd-rules.md`, `commands/claudemd-audit.md`, `commands/claudemd-sparkline.md`) preserves `§13.1` as the conceptual anchor for "operator audit data" — those references describe operator review activity, not the spec section's location.

`§13.2` rationale still cites "§13.1 Version discipline (≥20 real L2+ tasks between minor bumps) was violated" — historical reference to a rule that now lives in `OPERATOR.md §13.1`. Reference retained verbatim (anchor still resolves conceptually).

`spec/hard-rules.json` `spec_version` bumped to `v6.13.0`. Manifest has no `§13.1` entry (it was never a HARD rule — operator responsibilities are SHOULD-level guardrails for the human, not Agent-enforceable HARDs); manifest content unchanged.

---

## v6.12.0 — 2026-05-20

Minor: two §EXT additions.

- `[relax]` **§11-EXT Body-structure scope**: `project_*.md` exempted from `mem-audit` hook's `**Why:**` / `**How to apply:**` body-structure scan. Hook now scans `feedback_*.md` only. CC `memoryTypes.ts` still recommends Why/How for the project type, but the audit no longer warns when authors omit it.
- `[add]` **§13.3 Advisory → enforce promotion** (NEW): two-gate criteria advancing hook-layer rules from default-OFF → default-ON → `deny`. Driven by `/claudemd-audit` data (fire count ≥20, bypass rate <10%, cross-project coverage ≥2/≥3, operator-feedback gate). Companion to §0.1 (spec-text promotion).

**§13.2 budget cost: 0** (project_*.md exemption is SCOPE narrowing of an advisory hook, not a HARD rule change; §13.3 is META, not HARD).

### Background

Cross-project mem-audit warnings (5/20) flagged 16 `project_*.md` files across 4 projects (daagu 12, sdscc 2, mem 1, gsd 1) missing `**Why:**` / `**How to apply:**` body markers. Inspection showed all 16 are incident-log pattern (`project_<topic>_<date>.md`) — fact-only recordings of what happened (scheduler ghost completion 2026-05-19, stock prediction outcome 2026-05-18, etc.). The CC memoryTypes "project = fact + Why + How" template assumes deliberate decision-record style ("we moved the merge freeze because X"); incident-log style doesn't fit that shape naturally, and 5+ days of advisory pressure produced 0 cleanup. Spec signal: design too strict. Path forward: narrow the hook to `feedback_*.md` (true behavioral rules), let `project_*.md` follow whatever fact-record shape suits the project's pattern.

§13.3 is the companion question: hook-layer rules currently ship default-OFF for ≥30d FP collection (per §EXT §12 "behavior-layer hooks ship default-off"), but the spec had no documented criteria for advancing them past advisory. Without explicit gates, advisory rules either silently stay advisory forever (mem-audit warn 5 days = 0 cleanup) or get promoted by gut feel without operator-visible data. §13.3 formalizes the path: fire count ≥20 / bypass rate <10% / cross-project coverage / operator-feedback gates, all measurable from `/claudemd-audit`. Companion to §0.1 (extended → core spec text promotion; §13.3 is the enforcement-layer analog).

### Why minor (not patch)

Backward-compatible additions both. `mem-audit` exemption is a scope narrowing of an advisory hook (no false-positives, fewer warnings — strict relaxation). §13.3 introduces a new META rule (META = process around HARD rules, not a HARD rule itself). Minor version per §13 META: "Spec changes: patch (wording/clarification) = L2; minor (rule added/relaxed) / major (protocol shift) = L3." Both items qualify as `minor (rule added/relaxed)`.

### Ship target

Plugin v0.18.0 — minor bump tracking spec minor.

## v6.11.17 — 2026-05-20

Patch: §11-EXT Layer routing — explicit plugin-absent fallback paragraph added; routing matrix + lesson disambiguation externalized to `feedback_memory_layer_routing.md` per v6.11.14 "operational discipline → memory anchors" pattern. No HARD add/remove/downgrade, no behavior change for plugin-present sessions. **§13.2 budget cost: 0 (core), +~300B (extended)**.

### Background

User-observed drift: "lesson" content routing inconsistently between `claude-mem-lite` plugin and durable MEMORY.md. Two root causes — (1) spec assumed plugin present (`e.g. claude-mem-lite`) with no documented fallback; (2) "lesson" overloaded bugfix postmortems (recall) and trap rules (durable). Design rationale: `docs/superpowers/specs/2026-05-20-memory-layer-routing-design.md`.

### Changes

- `[refactor]` **§11-EXT Layer routing +1 paragraph** — "Plugin-absent fallback" paragraph added between "Picking the home" and "User-override filter". Documents tool-list detection (no `mem_save`/`mem_search` → plugin unloaded) and `recall_<topic>_<YYYYMMDD>.md` fallback target with `[fallback]` tag. Cross-refs new memory anchor for the routing matrix.
- `[memory-anchor]` **`feedback_memory_layer_routing.md`** — new memory file carries 6-row routing matrix, lesson disambiguation (bugfix postmortem vs trap rule), promotion path, and `What does NOT change` invariants. Pattern: v6.11.14 macOS-portability externalization.

### Cross-ref preservation

- "One home per fact" rule (§11-EXT) unchanged — no mirroring introduced.
- Auto-memory decision tree (3 steps in §11-EXT) unchanged.
- WHAT-NOT-TO-SAVE filter unchanged.
- §11 core "MEMORY.md read-the-file" HARD rule unchanged — new memory file gains a tagged index line so the rule resolves it correctly.

### Sizing impact

Core unchanged at 24134 bytes (headroom 866B). Extended 44901 → 45214 bytes (Δ +313B, headroom 5099B → 4786B). Both files inside v6.11.14 envelope.

### Migration / agent impact

- Plugin-present sessions: zero behavior change. Agent continues routing per existing rules.
- Plugin-absent sessions: agent now has a documented fallback path instead of silent ambiguity.
- "Lesson" decision: agent has explicit postmortem-vs-trap-rule criterion before save.

---

## v6.11.16 — 2026-05-11

Patch: §2.1 ROUTE single-source collapse — 13-row routing table reduced to 8 rows; L3 / composite / specialized-clarify routes evicted to §EXT §4 FLOW via single catch-all dispatcher; "Tool escalation" 5-principle list compressed; "Anti-patterns" line merged in (unique warning preserved as suffix). No rule change, no behavior change. Same terminal skill for all 5 hand-walked routing scenarios. **§13.2 budget cost: 0**.

### Background

`tasks/specs/routing-single-source.md` (committed 8f26e37 in plugin v0.16.0 cycle) captured the design rationale. Driver: core spec headroom at 396B / 25000B (98.42% utilization) — one bad version away from the §0.1 net-delete forced. §2.1 ROUTE was the largest hot-path table that duplicated content with §EXT §4 FLOW (21-row routing matrix already exhaustive in extended).

### Changes

- `[refactor]` **§2.1 ROUTE table 13 → 8 rows** — removed `env/staging/deploy bug` (merged into `code/logic bug` row's note: `env/staging/deploy → gs:/investigate`), `L3 / auth-payment / migration`, `ship / deploy / PR / release`, `large design / plugin design / architecture`, `plan review (CEO/eng/design/devex)`, `perf / security / design / product-biz clarify`. New single catch-all row enumerates all 6 evicted triggers as keywords: `L3 / ship / deploy / PR / release / migration / design / plan-review / perf / security / specialized-clarify → Load extended → §EXT §4 FLOW`. Agent-facing semantics unchanged: same terminal skill in all 5 hand-walked scenarios (bug / ship / plan-review / migration / Q&A) per the plan's verification table.
- `[refactor]` **§2.1 Tool escalation compress** — 5-principle numbered list (386 chars) → compact heuristic form (235 chars, −151B). Preserves all 5 mappings (literal/exact → Grep; concept → semantic; export-surface edit → impact-analysis; unfamiliar module → module-overview before 3+ Reads; "did we / why / past decisions" → memory tool first).
- `[refactor]` **§2.1 Anti-patterns merge** — 3-item paragraph (215 chars) dropped; sole unique warning (`parallel-dispatch mem + code-graph on same question`) merged into Tool escalation paragraph as `Anti-pattern:` suffix. The 3 dropped items were textual inverses of escalation principles (Grep-for-concepts inverse of #2; semantic-for-literals inverse of #1; one-by-one Read of unknown module inverse of #4) — information preserved through the positive form.
- `[refactor]` **§2.1 lead-in expanded** — added `/ specialized-clarify` to the "Full L3 / composite matrix → §EXT §4" pointer, signaling the catch-all row's coverage.

### Cross-ref preservation

`§EXT §12` was referenced in §2.1 line 98 (`ship / deploy / PR / release` row's note: `manual override per §EXT §12`). Eviction removed that ref. Verified still alive at 3 other core locations: §0 line 5 (`L3/ship: fallback in §EXT §12`), §2.1 Skill soft-triggers line (`Ship-pipeline skills NOT soft (see §EXT §12)`), §2.2 Ship-pipeline hardening line (`Full → §EXT §12`). `spec-coherence-audit ext-cross-refs` check expected to PASS.

### Sizing impact

Core 24604 → 24134 bytes (Δ −470B, **headroom 396B → 866B**, 98.42% → 96.54% utilization — ~2.2× safety margin). Extended 43982 → 44901 bytes (Δ +919B, Recent-changes turnover only). Both files inside ±20B drift envelope on the Sizing line itself.

### Migration / agent impact

- Agent loads core every turn → ~−10 token cost per turn (471B / ~3.5 bytes per token).
- Routing scenarios 2/3/4 (ship / plan-review / migration) gain one indirection hop: catch-all row → §EXT §4 FLOW table lookup. Cost: one additional paragraph read for the agent that was already loading extended per §2.2 EXT LOADING (ship + L3 + benchmark + security audit independently trigger extended load).
- Hand-walked verification table in `tasks/specs/routing-single-source.md` confirms all 5 scenarios land on the same terminal skill pre/post-edit.

## v6.11.15 — 2026-05-11

Patch: §0.1 demote-evaluation window 90d → 30d. Wording fix only — no HARD add/remove/downgrade; agent behavior unchanged (the 90d gate was structurally unreachable, so the rule was already a no-op in practice). **§13.2 budget cost: 0**.

### Background

P3 task from P2/P3 phase plan (P3 #2). The earlier spec audit (v0.12.1 → v6.11.14) surfaced this finding:
- `scripts/hard-rules-audit.js` enforced `logSpanDays >= 90` before emitting demote candidates. Real-world rule-hits log span: 18.4 days (current session) — never reached 90d under normal retention.
- Result: `demoteSuppressed.reason: "log spans 18.4d; §0.1 HARD requires 90d of history to evaluate demotion"` fired every audit run. `wouldHaveBeen: ["§8-npx"]` was real signal that the spec contract gated against acting on.
- §0.1 wording also mixed cadence ("Quarterly") with window size (90d) — operator review cadence and audit window are different concerns.

### Changes

- `[fix]` **§0.1 wording**: "Quarterly `/claudemd-audit` recommends demotion for core entries with 0 hits in 90d." → "`/claudemd-rules` recommends demotion for core entries with 0 hits in 30d." Drops the "Quarterly" qualifier (cadence is operator-controlled) and swaps to the canonical slash-command name (`claudemd-rules`; `claudemd-audit` is a different command).
- `[fix]` **`scripts/hard-rules-audit.js`**: `DEFAULT_WINDOW_DAYS = 90` → `30`. USAGE help text, `cadenceWarning` template, and CLI error example all updated to match. Behavior preserved: `insufficientData` still gates on `logSpan < days`; now the threshold is reachable.
- `[fix]` **`commands/claudemd-rules.md`**: frontmatter description + run-line + body all reflect 30-day default.

### §13.2 budget cost

0 (wording fix, no rule add/remove/downgrade). HARD tally unchanged: 13 core + 4 §EXT-side. 20-task counter preserved.

### Sizing

Live numbers in `CLAUDE-extended.md §Recent changes` Sizing line. Single post-content-edit `wc -c` per `feedback_spec_sizing_recursive_rewrite.md` option 1 (±20B drift envelope).

### Operator carry-forward

None. Audit can now produce demote candidates after 30d of log accrual (vs 90d). The first such candidates surface a real signal: `§8-npx` was flagged `wouldHaveBeen` in the v6.11.14 audit; expect it to move into `demoteCandidates` proper at the next audit run with sufficient log span.

---

## v6.11.14 — 2026-05-11

Patch: extended compression release. §11-EXT cluster consolidated (5 sub-sections → 2 + 1 cross-ref), Appendix B trimmed to canonical high-reuse examples (B.1 + B.2 kept; B.3–B.6 removed as covered by §10-R / §2-EXT / §2.S normative text). No rule add/remove/downgrade, no behavior change. **§13.2 budget cost: 0**.

### Background

Audit-driven trim (user request `分析一下我们的CLAUDE.md...能不能精炼和压缩`). Two structural findings:
- **§11-EXT was 6 sibling sub-sections** (Session maintenance / Memory-system routing / Execution heuristics / Auto-memory decision tree / MEMORY-tag-syntax / macOS shell portability) covering overlapping topics — Session + Execution were both advisory session-level guardrails; Routing + Decision tree + Tag-syntax were all memory-operation rules. Fragmentation increased lookup cost without semantic gain.
- **Appendix B had 6 examples** but only B.1 (AUTH format) + B.2 (evidence valid/invalid) carry reuse load — B.3–B.6 were illustrative restatements of normative text already in §10-R / §2-EXT / §2.S.

### Changes

- `[refactor]` **§11-EXT consolidated**: 4 sub-sections (Session maintenance + Execution heuristics + Memory-system routing + Auto-memory decision tree) merged into 2 (`§11-EXT Session heuristics (advisory)` + `§11-EXT Memory operations`). MEMORY-tag-syntax folded into Memory operations as a subsection. macOS shell portability replaced with a one-paragraph cross-ref pointer to its memory anchors (`feedback_macos_shell_portability.md` + `feedback_hook_platform_lib_source.md`) — implementation discipline lives in memory where it ages with code.
- `[refactor]` **Appendix B trimmed**: B.1 + B.2 retained; B.3 (L3 summary formats) + B.4 (EMERGENCY incident report) + B.5 (auto-decision one-liners) + B.6 (L3 spec example) removed. Header note documents the move.

### §13.2 budget cost

0 (compression only — no rule additions, no semantic change). HARD tally unchanged: 13 core + 4 §EXT-side. 20-task counter preserved.

### Sizing

Live numbers in `CLAUDE-extended.md §Recent changes` Sizing line. Discipline: single post-content-edit `wc -c` (`feedback_spec_sizing_recursive_rewrite.md` option 1) — accept ±20B drift attributable to the Sizing line's own rewrite.

### Operator carry-forward

None. Extended back well under ceiling; future bumps may add content within budget. §13.2 ratchet and §0.1 demote-candidate audit cadence unchanged.

---

## v6.11.13 — 2026-05-11

Patch: compression-only release. Discharges v6.11.12's `MUST net-delete or migrate` carry-forward. Two redundancy removals in extended; no rule add/remove/downgrade, no behavior change. **§13.2 budget cost: 0**.

### Background

v6.11.12 left extended at 99.67% utilization (165 bytes headroom) — the recursive Sizing-rewrite cost (Δ +378) consumed most of v6.11.11's recovered headroom. Carry-forward mandated `first addition of any size MUST net-delete or migrate`. User request `精炼和压缩一下` aligned exactly with the mandate.

### Changes

- `[refactor]` **§1.5-EXT GLOSSARY consolidated** (extended, −~620 bytes). Full-table dropped 5 entries (`LOC / Module / Local-Δ / Evidence / Task`) that core §1.5 already inlines (since v6.11.5 + v6.11.9). §1.5-EXT keeps only the extended-only material: `Assumption` + a `Local-Δ note` (co-located = test-path mirrors source-path — clarification not in core). The dropped entries were verbatim or near-verbatim duplicates of core; core §1.5 cross-ref `Assumption → §EXT §1.5-EXT` continues to resolve.
- `[refactor]` **§10-V OK examples trimmed** (extended, −~80 bytes). `OK (absolute)` 5→3 examples; `OK (中文 with baseline)` 3→2. Banned-vocab enumeration (adjectives/hedges/baseline-less ratios EN+中) entirely unchanged — those are normative, the trimmed lines were illustrative.

### §13.2 budget cost

0 (compression only — no rule additions, no semantic change). HARD tally unchanged: 13 core + 4 §EXT-side. 20-task counter preserved.

### Sizing

Measured via `wc -c` after content edits + Recent-changes block turnover:

- **Core**: 24614 → 24614 bytes (header version digit only — `v6.11.12` and `v6.11.13` are identical char count). Headroom 386 / 25000 (98.46%, unchanged).
- **Extended**: 49835 → 48384 bytes (−1451, −2.91%). Composition: content compression −728 bytes (§1.5-EXT, §10-V); Recent-changes block turnover −723 bytes (v6.11.12 entry replaced by shorter v6.11.13 entry). Headroom 1616 / 50000 (96.77%) — recovered from v6.11.12's 99.67% ceiling-grazing.

Drift discipline: `feedback_spec_sizing_recursive_rewrite.md` option 1 — single post-content-edit `wc -c`, accept ±20B drift attributable to the Sizing line's own corrective rewrite. The correction-rewrite cost in this release is bounded; the compression dominates.

### Operator carry-forward

DISCHARGED. Extended back to ~96.77% utilization. v6.11.13 mandate satisfied via §1.5-EXT redundancy removal alone (the long-standing `core §1.5 inlines L1/L2 terms; §1.5-EXT duplicates them` overlap). Future bumps may add content within budget; §11-EXT MEMORY-* cluster remains a long-term migration candidate but is no longer urgent — keep it for when extended next approaches the ceiling.

---

## v6.11.12 — 2026-05-11

Patch: Tier-1 dogfood fixes from in-session simulation pass. Two fresh-agent literal-misread spots in core §7 + §11; one observation entry on Sizing-claim drift (repro=2 of `tasks/rule-candidates-2026-04.md` candidate). No new HARD; **§13.2 budget cost: 0**.

### Background

Mid-session dogfood pass simulating "fresh agent applies spec strict-literal" surfaced two reader-side traps in v6.11.11 core that survived the v6.11.8/v6.11.9 dogfood batches:

1. **§7 Iron Law #2 L1 example reused `typo`** — the canonical L0 Fast-Path whitelist case. Strict reading concluded "typo is L1" → escalated L0 typo fixes to L1 evidence form (extra ceremony for no gain).
2. **§11 MEMORY.md `agent-driven full content scan`** — phrase reads as "scan the linked memory file's full content"; intent is "scan the index entry's title/desc to decide". Strict reading would Read every untagged memory file at every ship — exactly the FP class v0.9.28 word-boundary fix targeted to suppress.

### Changes

- `[fix]` **§7 Iron Law #2 L1 example replaced** (core, +~58 bytes net) — see Background §1. New example exercises the Bugfix-anchor rule (cite prior-failing state) on a true L1 bugfix; no longer crosses with §0 Fast-Path L0 typo whitelist.
- `[fix]` **§11 MEMORY.md untagged-fallback wording** (core, +8 bytes net) — see Background §2. Same semantics, removes literal misread.

### Companion observations (no spec changes)

- `[observe]` **Sizing-claim drift repro=2** — v6.11.11 Recent-changes claimed extended `~49850 bytes`; in-session `wc -c` measured 49457 (Δ −393, 2nd repro). First repro: v6.11.8 → v6.11.9 (Δ −1526). Promotion bar (≥3 repros across distinct sessions) not yet met; release-time `wc -c` self-check candidate retained at log-only in `tasks/rule-candidates-2026-04.md`.

### §13.2 budget cost

0 (wording fixes only). HARD tally unchanged: 13 core + 4 §EXT-side. 20-task counter preserved.

### Sizing

core 24550 → 24614 bytes (+64, +0.26%); extended 49457 → 49835 bytes (+378, +0.76%). core 24614/25000 (386 bytes headroom, 98.46%); extended 49835/50000 (165 bytes headroom, 99.67%). **All numbers measured via `wc -c` AFTER all edits landed** — including the recursive Sizing-rewrite cost itself (see §In-session repro #3 below).

**Operator carry-forward — NOT discharged, escalated**: v6.11.11 mandated `MUST net-delete or refuse the addition` because it claimed extended at 99.7% utilization. Real pre-v6.11.12 measurement was 98.9% (49457/50000, 543 bytes headroom) — the mandate was itself a Sizing-claim-drift artifact. v6.11.12's first-cut block replacement was actually ≈ size-neutral (+28 bytes), but rewriting the Sizing block + Operator-carry-forward paragraphs to use real numbers added another ~350 bytes (recursive cost). Final delta +378. v6.11.13 inherits a *stronger* carry-forward: extended at 99.67% real utilization, 165 bytes headroom; first addition of any size MUST net-delete or migrate.

### In-session Sizing-drift repro #3 (this very release)

Pre-edit, this changelog claimed extended `−897 bytes net-delete` (estimated from old vs new block char counts). Post-edit `wc -c` showed +28 bytes. Then the corrective Sizing/carry-forward rewrite *itself* added ~350 bytes, landing at +378. **Two-level drift**: (1) initial estimate off by 925 bytes vs first-cut measurement; (2) the rewrite to fix (1) added recursive cost not captured in the rewrite's own size projection. Consistent with v6.11.8 (Δ −1526) and v6.11.11 (Δ −393) episodes. Promotion bar (≥3 repros) NOW MET via this release. Counter (≥20 L2+ tasks since 2026-05-10 reset) at 2 — promotion BLOCKED. Eligibility flagged in `tasks/rule-candidates-2026-04.md` for next batch review; release-time `wc -c` self-check candidate (~30 LOC bash) escalated to "ship-blocking SHOULD before v6.11.13" — discipline-only approach demonstrably insufficient when the discipline itself perturbs the metric.

### Plugin companion (claudemd v0.9.29)

Spec-only patch — version pin in `tests/scripts/spec-structure.test.js` + `spec/hard-rules.json` `spec_version` + manifest sync (`package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`). No hook / runtime behavior change.

---

## v6.11.11 — 2026-05-11

Patch: companion to claudemd v0.9.28 hook fix for §11 MEMORY.md read-the-file FP rate. **Spec-side adds Tag-specificity SHOULD** in §11-EXT codifying the authoring discipline that complements the v0.9.28 word-boundary hook fix. No new HARD; **§13.2 budget cost: 0**.

### Background

`/claudemd-audit` over the v0.9.27 release session showed 5 hook trips on push/release commands; only 1 was a true positive (`macos` tag → memory about macOS shell portability — relevant). The remaining 4 fell into two FP classes:

1. **Substring match** (`cli` tag inside `clippy` literal) — mechanical bug, fixed in claudemd v0.9.28 hook.
2. **Multi-line `^release` anchor** firing on commit-msg heredoc body lines starting with conventional-commit verbs — also fixed in v0.9.28 hook (collapse `\n` → space before regex).
3. **Generic exact-word tags** (`audit` matching bare word `audit` anywhere in body, `dead-code` matching CLI subcommand name in citation) — authoring-discipline issue. Spec-side fix below.

### Changes

- `[change]` **§11-EXT Tag-specificity (SHOULD)** (extended, +~1080 bytes — new sub-section under existing §11-EXT MEMORY-tag-syntax). Tags SHOULD be ≥4 chars AND specific to the memory's topic — generic single-word English tags (`hook`, `plugin`, `test`, `cli`, `lint`, `audit`) substring-match incidental occurrences in commit bodies and produce high FP rates. Prefer multi-word phrases (`hook-fail-open`, `cli-flag-shape`, `audit-pipeline-filter`). Hook (claudemd v0.9.28+) applies word-boundary + 0-2 char declension tolerance, so plurals still match without substring-collisions in longer words; but generic exact-word tags still need authoring-time discipline. Rule of thumb: if removing the tag would not change the agent's decision quality on a typical command match, the tag is too generic.

### Companion plugin work (claudemd v0.9.28)

- `[fix]` **`hooks/memory-read-check.sh` word-boundary tag match** — replaces `grep -iF` (literal substring) with `grep -iE -- "(^|[^a-zA-Z0-9])${ESC_TAG}[a-zA-Z]{0,2}($|[^a-zA-Z0-9])"` (word-boundary + 0-2 char declension tolerance + regex-meta escape). Eliminates `cli ⊂ clippy` class.
- `[fix]` **`hooks/memory-read-check.sh` multi-line trigger collapse** — `tr '\n' ' '` before applying TRIGGER_RE so the `^` anchor only matches actual start-of-command, not start-of-each-heredoc-body-line. Eliminates `git commit -m "$(cat <<EOF\nrelease(v0.9.27): ...\nEOF\n)"` false trigger.
- `[test]` **4 new test cases** in `tests/hooks/memory-read-check.test.sh` (Cases 20-23): cli vs clippy substring rejection, hook → hooks plural via declension tolerance, heredoc-body release(...) line not triggering, regex-meta tag (v6.9) escaping vs v6X9. 23/23 passing.
- `[chore]` **`~/.claude/projects/<encoded>/memory/MEMORY.md` operator-side cleanup** — dropped 12 generic single-word tags across 11 entries; promoted 6 generic tags to multi-word specific phrases (e.g. `[hook]` → `[plugin-root, hook-expansion]`, `[test]` → `[test-fixture, fixture-drift]`, `[cli]` → `[cli-positional, sibling-symmetry]`). User-global state — operator-managed, not shipped via `/claudemd-update`.

### §13.2 budget cost

0 (new SHOULD, no new HARD). HARD tally unchanged: 13 core + 4 §EXT-side.

### Sizing

core 24550 → 24550 bytes (0% — header bump only); extended 48815 → ~49850 bytes (+1035, new SHOULD section + Recent-changes turnover). core 24550/25000 (450 bytes headroom, 98.20%); extended ~49850/50000 (**~150 bytes headroom, 99.7%** — at-ceiling; v6.11.12 MUST net-delete or migrate marginal content per §13.1).

**Operator carry-forward (HARD for v6.11.12)**: extended hit 99.7% utilization. v6.11.12 MUST net-delete. Migration candidate: §11-EXT MEMORY-* cluster (4 sub-sections covering memory routing / auto-memory tree / tag-syntax / tag-specificity) — largest contiguous plugin-specific block whose content is implementation discipline rather than spec-canonical contract.

---

## v6.11.10 — 2026-05-10

Patch: first batch-review-driven HARD promotion since v6.10.2 (2026-04-23). §9 Parallel-path completeness elevated SHOULD → HARD after `tasks/rule-candidates-2026-04.md` 2026-05-10 batch review confirmed both promotion conditions met (4 distinct repros across 2 projects ≥ 3-bar; ~25 L2+ tasks since last HARD addition ≥ 20-task counter). New §EXT SHOULD documenting macOS CI shell portability (3 lessons.md repros). **§13.2 budget cost: 1** (one new HARD); 20-task counter resets to 0.

- `[change]` **§9 Parallel-path completeness: SHOULD → HARD L2+** (core, −89 bytes — promotion *saves* bytes by dropping the trailing candidate-tracking clause). Repros: (1) code-graph-mcp `ast_search ORDER BY f.path LIMIT 60` silently truncated late-alphabet files; (2) code-graph-mcp v0.15.0 `lang_config.rs::for_language` default arm returned `"unknown"` so new-language match silently always-false; (3) code-graph-mcp v0.16 `dead-code --json` empty-result silently emitted nothing; (4) mem v2.49.0 CJK precision bundle fixed FTS path but missed sibling LIKE fallback. Self-enforced (no per-language-AST mechanical detection feasible at hook layer); `hard-rules.json` `enforcement: "self"` like Iron Law #2.
- `[change]` **§11-EXT macOS CI shell portability (SHOULD)** (extended, +~870 bytes — new section). Codifies the implementation contract behind `hooks/lib/platform.sh` + `feedback_macos_shell_portability.md` memory + `feedback_hook_platform_lib_source.md` memory. Triggers: 3 repros from `tasks/lessons.md` 2026-04-29 (`bsd-vs-gnu-stat`, `macos-tmp-essentially-empty`, `macos-ci-tmp-flake`). SHOULD not HARD because failure surfaces in CI red, not silent prod. Rule covers the five recurring traps: `stat`/`find -newer` wrapper sourcing, `timeout` GNU-coreutils-via-brew, BSD `wc -l` padding, `mktemp -d` `/var→/private/var` symlink, post-`git add` `chmod +x` mode preservation.

**§13.2 budget cost**: 1 new HARD (§9 Parallel-path). HARD tally: 13 core + 4 §EXT-side. 20-task counter resets to 0 from ~25.

**Sizing** (v6.11.10, 2026-05-10, measured via `wc -c`): core 24643 → 24550 bytes (−93); extended 47747 → 48815 bytes (+1068). core 24550/25000 (450 bytes headroom, 98.20%); extended 48815/50000 (1185 bytes headroom, 97.63%). Runtime L0/L1/L2 ≈ 6.10k tokens.

**Plugin companion (claudemd v0.9.26)**: spec content + version-pin + hard-rules.json 13th core entry + manifest-sync. No hook / runtime behavior change.

---

## v6.11.9 — 2026-05-10

Patch: fresh-agent-adherence release. Three reader-side ambiguities surfaced in a second dogfood pass (simulating "first time touching this spec, strict-literal execution"), plus the v6.11.8 carry-forward `MUST net-delete or migrate marginal core bullets` honored via two §EXT migrations. No behavior change, no rule add/remove. **§13.2 budget cost: 0.**

- `[fix]` **§2 LEVEL "new tests" trigger vs §1.5 Local-Δ "co-located test = one"** (core, +~85 bytes) — literal reading of `L2 trigger: new tests` promoted every L1-bugfix that wrote a regression RED test to L2, contradicting §1.5 Local-Δ ("source + co-located test = one") and §7 L1-bugfix workflow ("reproduce-once → fix → re-run repro"). Reworded as `new test surface (new file/suite — not L1-bugfix RED, which is co-located per §1.5)`. Bugfix-with-regression stays L1.
- `[fix]` **§1.5 GLOSSARY missing Contract / Δ-contract at L1/L2** (core, +~220 bytes) — `Contract` / `Δ-contract` were defined only in §EXT §1.5-EXT (L3+ load only), but core §2 L2 trigger uses `contract-Δ` and core §5 hard-AUTH uses `Δ-contract on public API`. At L1/L2 a fresh agent classifying could not resolve the term in core. Same class as v6.11.5's L1/L2-resident-term inlining; this entry slipped through. Inlined a single-bullet definition that also distinguishes additive (→ L2) from breaking (→ L3), folding F4-class clarity (additive-vs-breaking carve-out) into the same fix.
- `[fix]` **§13 META "Spec changes = L2 minimum" vs §2 LLM-visible metadata → L3** (extended, +~50 bytes) — literal reading of `Spec changes = L2 minimum` defaulted spec edits to L2, contradicting §2 LLM-visible-metadata-→-L3 (which spec files most directly are). Reworded: `patch (wording) = L2; minor (rule add/relaxed) / major (protocol shift) = L3 per §2`. Aligns spec wording with how the maintainer has actually been classifying spec patches.
- `[refactor]` **§0.2 Mid-task feedback split** (core −~175 bytes; extended +~280 bytes) — Continuation / Cancel / Switch (predictable common-sense cases) migrated to new §0.2-EXT; core retains the three non-obvious cases (Refinement / Quality slider / Scope-expansion) plus a one-line pointer. Honors v6.11.8 operator carry-forward.
- `[refactor]` **§11 MEMORY.md tag-syntax footnote split** (core −~320 bytes; extended +~720 bytes) — operational summary stays in core (one line); detail rationale + v0.5.0 over-trigger history moved to new §11-EXT MEMORY-tag-syntax section. Same v6.11.8 carry-forward.

**§13.2 budget cost**: 0 (no new HARD; all three fixes are wording/clarification of existing rules + 2 structural migrations). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.9, 2026-05-10, measured via `wc -c`): core 24672 → 24643 bytes (−29, −0.12%); extended last-recorded-v6.11.8 46690 → 47747 bytes (+1057, +2.26%). Size budget (§13.1): core 24643/25000 (357 bytes headroom, 98.57% utilized — ceiling-grazing); extended 47747/50000 (2253 bytes headroom, 95.49% utilized — tightening). Runtime L0/L1/L2 ≈ 6.13k tokens.

**Plugin companion (claudemd v0.9.25)**: spec-only patch — no plugin-side hook / script / test changes beyond the version-pin updates in `tests/scripts/spec-structure.test.js`.

---

## v6.11.8 — 2026-05-10

Patch: clarity release. Two wording fixes addressing real reader-side ambiguity surfaced during a dogfood pass simulating fresh-user spec adherence. No behavior change, no rule add/remove. **§13.2 budget cost: 0.**

- `[fix]` **§10 Four-section order — "Lead with incomplete" disambiguated** (core, +~125 bytes net) — original line read literally as "put incomplete first" which contradicts the HARD structural order Done → Not done → Failed → Uncertain. The `transcript-structure-scan` Stop hook enforces the structural order; the original sentence's intent was prose emphasis, not section reorder. New wording separates structural order (Stop hook enforces) from emphasis rule (prose body weights incomplete sections heavier than Done). A fresh agent following the literal reading would have triggered the very §10-four-section-order hit it's meant to prevent.
- `[fix]` **§7 L2 evidence example — "tests 1453 → 1490" annotated** (core, +~25 bytes net) — bare numbers were ambiguous between "test count growth" and "pass rate". Added `suite test count` qualifier + absolute-delta inline (`+37`). Aligns with §10 Specificity HARD: "absolute number OR ratio+baseline" — the example now models both.

**Sizing** (v6.11.8, 2026-05-10, measured via `wc -c`): core 24558 → 24672 bytes (+114, +0.46%); extended 46568 → 46690 bytes (+122, +0.26%, no extended content change — `## v6.11.8` Recent-changes pointer carries the diff). Size budget (§13.1): core 24672/25000 (**328 bytes headroom, 98.69% utilized — ceiling-grazing, next bump MUST net-delete or migrate marginal core bullets to §EXT per v6.11.7's operator note**); extended 46690/50000 (3310 bytes headroom, 93.38% utilized). Operator carry-forward: v6.11.7 said "v6.11.8 should net-delete or migrate marginal core bullets" — this patch did not (clarity fixes were judged higher-value than the byte cost), so the directive moves to v6.11.9. Runtime L0/L1/L2 ≈ 6.14k tokens (+0.03k vs v6.11.7).

**Plugin companion (claudemd v0.9.22)**: new `hook-drift` doctor check + new lib `scripts/lib/install-drift.js`. Surfaces the silent-drift class where source repo ships v0.9.21 but `~/.claude/plugins/marketplaces/claudemd/` still runs v0.9.11 hook code (because `/plugin update` is a silent no-op in current CC versions). Real symptom that triggered this work: `~/.claude/logs/claudemd.jsonl` simultaneously holding `-mnt-data-ssd-...` (new tr `'/._'` encoding, post-v0.9.15) and `-mnt-data_ssd-...` (stale tr `'/.'` encoding, pre-v0.9.15) for the same cwd — silently splitting telemetry across two project keys AND making the §11-memory-read hook a no-op for `_`-bearing project paths. The drift was undetectable by the prior `spec-hash` check, which only compared the spec MD files, not hook scripts.

---

## v6.11.7 — 2026-05-10

Patch: CC-source comparative audit release. Side-by-side analysis of upstream `sdscc/src/constants/prompts.ts` + `src/memdir/memoryTypes.ts` vs AI-CODING-SPEC v6.11.6 → five additions where CC's eval-validated rules were stronger or absent in spec. No rule removals or downgrades. No new HARD (§13.2 budget cost = 0).

- `[fix]` **§10 Specificity No-baseline fallback boundary** (core, +~70 bytes net) — closes a defensive-PARTIAL drift: PARTIAL applies to **numeric/quantitative claims w/o baseline** only, NOT to pure process-completion (commit landed / file created / config applied) when V1-verified. Source: CC `prompts.ts:183` ("do not hedge confirmed results... downgrade finished work to 'partial'"). Failure mode addressed: agent producing `[PARTIAL: <missing-baseline>]` on a task that had no quantitative claim to begin with — turning the honesty signal into noise.
- `[change]` **§11 Memory routing** (core +~95 bytes pointer; full body §EXT §11-EXT +~810 bytes) — distinguishes durable layer (CC built-in 4 types under `~/.claude/projects/<enc>/memory/`, identity-level, session-spanning) from time-sensitive recall layer (e.g. `claude-mem-lite` FTS5 + timeline, days-weeks, rolls off). Picking the home: "will this be true 6 months from now?" Yes → durable. No → recall. Conflict: durable wins as long-term anchor; recall ages out naturally. New rule defaults to §EXT per §0.1.
- `[change]` **§11-EXT user-override filter (HARD-equivalent)** (extended, included in routing block ~290 bytes) — extends CC's `## What NOT to save` discipline: WHAT-NOT-TO-SAVE list applies even when user explicitly says "save / 记一下 / remember this". Activity logs, PR rundowns, step lists, deploy walkthroughs are noise. Compliance with explicit save = ASK what was *surprising* or *non-obvious*, save only that. Source: CC `memoryTypes.ts:189` H2 eval (0/2 → 3/3 with this filter).
- `[change]` **§11-EXT Execution heuristics (CC-borrowed)** (extended, +~960 bytes) — three non-HARD guardrails:
  - **Read-before-propose**: don't propose changes to code you haven't Read/Grep'd this session. §1 Search-before-write covers writes; this covers recommendations + AUTH-eligible proposals. Difference matters because `[AUTH REQUIRED]` citing unread code is a false-claim incident on its own. CC `prompts.ts:175`.
  - **Diagnose-before-pivot**: failed once → diagnose (read error, check assumption, focused fix), don't blind-retry AND don't abandon after a single failure. §6 Three-strike (3× same signature) is the upper bound, not the trigger. Pivot too early on a viable approach burns context the same way thrashing does. CC `prompts.ts:178`.
  - **Existing-comment protection**: don't remove old comments unless removing the code they describe OR you've verified them wrong this session. May encode constraint or past-bug lesson invisible in current diff. §1 "default no comments" addresses *new* comments, not pruning. CC `prompts.ts:161`.
- `[refactor]` **§10 Banned-vocab quick-list compaction** (core, −~50 bytes) — `(no baseline)` redundant annotations folded into single `baseline-less ratios` clause. Full enumeration unchanged in §EXT §10-V.

**Plugin companion (claudemd v0.9.4)**:
- New Stop hook `mem-audit.sh` — scans `~/.claude/projects/*/memory/feedback_*.md` + `project_*.md` for missing `**Why:**` / `**How to apply:**` body-structure markers (per CC `memoryTypes.ts:58/76/132/149`); warn-only via `additionalContext`, never blocks. Registered in `hooks/hooks.json` + `scripts/lib/hook-registry.js` + `commands/claudemd-toggle.md`.

**§13.2 budget cost**: 0 (no new HARD; user-override-filter is a clarification of CC's existing `## What NOT to save` rule, not a new gate). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.7, 2026-05-10, measured via `wc -c`): core 24351 → 24558 bytes (+207, +0.85%); extended 41999 → 46568 bytes (+4569, +10.88%). Size budget (§13.1): core 24558/25000 (**442 bytes headroom, 98.23% — tight; next minor bump MUST net-delete or refuse addition per §0.1**); extended 46568/50000 (3432 bytes headroom, 93.14% — tightening). Runtime L0/L1/L2 ≈ 6.11k tokens (+0.05k vs v6.11.6). L3/Override/ship ≈ 14.9k tokens (+0.9k from §11-EXT additions). Operator note: this puts both files into the upper third of their budgets — v6.11.8 should net-delete or migrate marginal core bullets to §EXT before adding new content.

---

## v6.11.6 — 2026-05-10

Patch: size hygiene release. Two fixes consolidated into one bump (originally planned as v6.11.6 + v6.11.7 split — merged for review economy since both target the same `Sizing` line):

- `[fix]` **Recent-changes rule violation in extended** (extended, −~6800 bytes) — `CLAUDE-extended.md` Recent-changes section had accumulated v6.11.3 + v6.11.4 + v6.11.5 entries, despite the line-523 rule "Only the current version's entry lives here" (rule introduced when changelog was externalized in v6.9.0). Each prior version-bump round prepended without removing the previous entry → ~7000 bytes of historical narrative duplicated between extended and changelog. v6.11.6 cleans Recent-changes to just the current version's entry. Canonical history is and remains in this file (`CLAUDE-changelog.md`).
- `[refactor]` **Core prose compaction at 5 sites** (core, −~470 bytes) — five places tightened, no rule loss:
  - **§0 Fast-Path**: 1 long line collapsed (one-line summary; wordy `"L0 short-circuits to single-line report"` → `"single-line report"`; `"behavior-describing ('returns Z on null') → L1 (Read implementation to confirm)"` → `"behavior-describing → L1 (Read to confirm)"`). Whitelist preserved verbatim.
  - **§1 Principles**: 3 bullets trimmed of redundant tails — `Search-before-write` drops `"never guess paths or symbols"` (covered by §8.V1); `Zero-assume` drops `"never assume silently"` (covered by the rule name); `Reuse-first` drops `"/config"` (lib coverage retained).
  - **§3 canonical-artifact** (added v6.11.5): expanded prose collapsed to a tighter precedence statement. Same triggers, same conflict-resolution paths, same cross-source list.
  - **§5 Obvious-follow-on**: 2nd-order explanation `"The intuition making it feel obvious is the same intuition that hides behavior tradeoffs in the sibling path"` (descriptive, not actionable) trimmed to `"feels obvious ≠ safe — same intuition hides sibling tradeoffs"`. Rule + exception preserved.
  - **§10 Specificity**: descriptive prose tightened. `"banned-vocab quick-list catches surface forms, this clause closes the 'switch synonym to escape' path"` → `"closes the 'switch synonym to escape' path"`. Banned-vocab quick-list (operationally critical) untouched.

**§13.2 budget cost**: 0 (no new HARD; rule preservation verified by `hard-rules-drift.test.js` — every existing `section_anchor` substring still resolves). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.6, 2026-05-10, measured via `wc -c`): core 24823 → 24351 bytes (−472, −1.90%); extended 46672 → 41930 bytes (−4742, −10.16%; cleanup recovered ~6.8KB from v6.11.3+v6.11.4+v6.11.5 historical entries, partially re-spent on the v6.11.6 entry itself). Size budget (§13.1): core 24351/25000 (**649 bytes headroom, 97.40% utilized — recovered from v6.11.5 ceiling-grazing 99.29%**); extended 41930/50000 (8070 bytes headroom, 83.86% utilized). Runtime L0/L1/L2 ≈ 6.06k tokens (−0.12k vs v6.11.5).

---

## v6.11.5 — 2026-05-10

Patch: three additive/structural improvements informed by ultrathink self-audit of v6.11.4. One new content rule (§3 canonical-artifact precedence), one L1 self-containment fix (§1.5 inline definitions), one §0 readability split. No rule removals or downgrades.

- `[change]` **§3 TRUST: canonical artifact > derived prose** (core, +~395 bytes) — adds explicit precedence rule for cross-source data conflicts. `code / diff / CI output > commit message / PR description / issue body / Slack / wiki / docstring`. Canonical decides *behavior* (what is); prose decides *intent* (what was meant). Conflict on behavior → trust canonical, flag prose as stale. Conflict on intent → ASK or verify with author. Fills the gap §3 had between "Read vs memory: trust Read" (one binary case) and the broader reality of multi-source conflict (PR text vs diff, issue body vs CI logs, docstring vs code, etc.). No HARD label; ranks at spec-rule level per §3 ordering.
- `[fix]` **§1.5 GLOSSARY inline definitions for L1/L2-resident terms** (core, +~740 bytes) — fixes correctness issue: `Local-Δ` and `LOC` are referenced in §2 LEVEL's L1 boundary, but until v6.11.5 their full definitions lived only in §EXT §1.5-EXT, which §2.2 EXT LOADING explicitly does NOT load at L1/L2. Strict reading of L1 task entry had no in-core definition for "Local-Δ only". v6.11.5 inlines five terms used in L1/L2 routing: `LOC / Local-Δ / Module / Evidence / Task`. `Assumption / Contract / Δ-contract` (L3+ usage) stay Extended-only.
- `[refactor]` **§0 split: Mid-task feedback → §0.2** (core, ~+50 bytes net) — §0 was carrying 7 distinct concepts. Mid-task feedback was the largest sub-block (5 indented bullets). Extracted to §0.2 placed after §0.1 Core growth discipline. §0 prose references it via one-liner. No semantic change; pure structural lift to reduce §0 cognitive load.

**§13.2 budget cost**: 0 (no new HARD; canonical-artifact rule is descriptive precedence not gating). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.5, 2026-05-10, measured via `wc -c`): core 23732 → 24823 bytes (+1091, +4.60%); extended 43601 → 46565 bytes (+2964, +6.80% — verbose Recent-changes entry; baseline includes v6.11.4 entry which is preserved). Size budget (§13.1): core 24823/25000 (**177 bytes headroom, 99.29% utilized — tight; next minor bump MUST net-delete or refuse addition per §0.1**); extended 46565/50000 (**3435 bytes headroom, 93.13% utilized — tightening**). Runtime L0/L1/L2 ≈ 6.18k tokens (+0.25k vs v6.11.4). L3/Override/ship ≈ 17.6k tokens.

---

## v6.11.4 — 2026-05-09

Patch: structural reorganization in core, no rule additions/removals/downgrades. Three changes informed by self-audit on a 1M-context Opus session that exercised the spec end-to-end:

- `[refactor]` **§EXT LOADING RULE → §2.2 EXT LOADING** (core, ±0 net chars on body, −1 trailing footer line) — relocated from end-of-file to immediately after §2.1 ROUTE. Rationale: load triggers are a routing decision; placement next to §2 LEVEL / §2.1 ROUTE makes the load policy visible before readers encounter `§EXT §X-EXT` cross-references in §3+. End-of-file footer reduced to a one-line pointer (`EXT loading rule → §2.2.`) plus version-history line.
- `[refactor]` **§7 sub-rules → "Evidence beyond green tests" trigger table** (core, net −~120 chars) — `### Ship-baseline check`, `### User-global-state audit`, `### Metric-coupling check` (3 prose subsections) collapsed into one section with a 3-row table (Trigger / Severity / Check / Evidence in REPORT). All three triggers, severities (HARD/HARD/SHOULD), commands, and remediation paths preserved verbatim. Shared failure-mode footer ("`mkdtempSync` leaks invisible to exit code; vibe-check is not metric-neutral evidence") consolidates the duplicated reasoning. `spec/hard-rules.json` `section_anchor` for `§7-ship-baseline` and `§7-user-global-state` updated to substrings stable in the new table form.
- `[change]` **§0.1 Core growth discipline cap reference** (core, +~150 chars) — explicitly cross-references §13.1 size budget: "Hard cap (per §EXT §13.1): core ≤25K chars / extended ≤50K chars; over ceiling → next version MUST net-delete (removal > addition) or refuse the addition. Track headroom in `CLAUDE-changelog.md` Sizing line." The "≥5 sessions in 30d" promotion rule alone lacked a script-able number — this closes the audit loop.

**§13.2 budget cost**: 0 (no new HARD; §7 table preserves the 2 existing HARD rules + 1 SHOULD verbatim). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.4, 2026-05-09, measured via `wc -c`): core 23643 → 23732 bytes (+89, +0.38%); extended 42170 → 43601 bytes (+1431, mostly Recent-changes + this changelog). Size budget (§13.1): core 23732/25000 (1268 bytes headroom, 94.93% utilized — flat ceiling distance); extended 43601/50000 (6399 bytes headroom, 87.2% utilized). Runtime L0/L1/L2 ≈ 5.93k tokens (core only). L3/Override/ship ≈ 16.6k tokens (no change).

---

## v6.11.3 — 2026-04-30

Patch: §11 MEMORY.md read-the-file footnote clarified to document the hook/agent split. No rule additions, removals, or downgrades. Resolves over-trigger pattern observed in `claudemd` v0.5.0 where untagged MEMORY.md entries forced N unrelated Reads on every push and the trigger regex `(release|deploy|ship)` matched anywhere in the command body (commit messages, MR descriptions, file paths) → false-positive denials on `git commit -m "release notes"`, `glab mr create --description "fix release"`, etc.

- `[fix]` **§11 footnote wording** (core, +249 chars) — `Ungaged lines = full-scan` was ambiguous; the v0.5.0 hook implementation read it as "block on every untagged entry", contradicting the same paragraph's "Index is a router, not a substitute". v6.11.3 makes the footnote explicit: untagged lines = **agent-driven** full content scan (decide via title/description); the hook does NOT auto-block. Operational rule: tag lines you want hook-enforced; leave the rest for agent judgment.
- `[fix]` **plugin-side cross-reference** — companion fix in `claudemd` v0.5.1 (`hooks/memory-read-check.sh`): untagged-fallback removed, trigger regex anchored to command-segment-start (`^` or after `;` / `&` / `|`). Tests `tests/hooks/memory-read-check.test.sh` Cases 12–16 lock both halves.

**§13.2 budget cost**: 0 (footnote clarification + version-field bump; no HARD delta). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.3, 2026-04-30): core 23394 → 23643 chars (+249, +1.1%); extended 42302 → ~42050 chars (block compaction). Size budget (§13.1): core 23643/25000 (1357 chars headroom, 94.6% utilized); extended ~42050/50000 (~7950 chars headroom, ~84% utilized). Runtime L0/L1/L2 ≈ 5.91k tokens (core only, +0.06k vs v6.11.2). L3/Override/ship ≈ 16.6k tokens (no change).

---

## v6.11.2 — 2026-04-29

Patch: §EXT TOC paragraph trimmed from core (dead-weight per `claudemd` v0.4.1 self-audit Section 2) + extended-title alignment to core (v6.10.0 → v6.11.2; closes silent-drift bug v6.11.1 demonstrated when core was bumped without extended). No rule additions, removals, or downgrades. From v6.11.2 forward, spec trio (CLAUDE.md / CLAUDE-extended.md / CLAUDE-changelog.md) ships with synced version numbers.

- `[del]` **§EXT TOC line** (core, -357 chars) — the `**Extended TOC**:` paragraph that listed §1.5-EXT through Appendix B was operator-routing metadata, not agent-actionable content. Loaded every L0-L2 turn (5.8k token core baseline) for zero per-task value. Grounding: spec self-audit (`claudemd` v0.4.1 dispatched 3 audit agents 2026-04-29; Agent C identified the line as bottom-5 lowest-value-per-byte in core). §1.5/§5.1/§7/§11 EXT pointers retained at their semantic-reference call-sites (§1.5 line 57, §5.1 line 130, §7 lines 162/168/174, §11 lines 229-230); A14 spec-structure assertions intact.
- `[fix]` **spec-trio version alignment** — `spec/CLAUDE-extended.md` title bumped from `v6.10.0` to `v6.11.2`. Pre-fix: each minor/patch was supposed to bump only the file actually touched, but v6.11.1 patch bumped core without extended → trio desynced silently for 5 days (no test caught it). v6.11.2 introduces sync policy: trio always ships with the same version number going forward; per-file content-vs-version accuracy gives way to whole-trio consistency.

**§13.2 budget cost**: 0 (deletion + version-field correction; no HARD delta). HARD tally unchanged (12 core + 4 §EXT-side). 20-task counter preserved.

**Sizing** (v6.11.2, 2026-04-29): core 23751 → 23394 chars (-357, -1.5%); extended 45678 → 42302 chars (-3376, -7.4% — `## Recent changes` block trimmed from v6.11.0 verbose 8-bullet entry to v6.11.2 concise 2-bullet entry per the "current version's entry only" policy at the top of that block). Size budget (§13.1): core 23394/25000 (1606 chars headroom, 93.6% utilized — recovered 1.4 percentage points from v6.11.1's 95.0%); extended 42302/50000 (7698 chars headroom, 84.6% utilized — recovered 6.7 percentage points). Runtime L0/L1/L2 ≈ 5.85k tokens (core only, -0.05k vs v6.11.1). L3/Override/ship ≈ 16.6k tokens (-0.8k vs v6.11.1's 17.4k).

---

## v6.11.1 — 2026-04-29

Patch: §7 Iron Law #2 Bugfix-anchor + §10 Specificity wording tightening (no new HARD; evidence-rebuttal shortcut per §13.2 — fixing existing HARDs shown to allow hedge-evasion). HARD tally unchanged (12 core + 4 §EXT-side).

- `[fix]` **§7 Iron Law #2 Bugfix anchor** (core, wording) — appended explicit banned-phrasing list (`should work / 应该可以 / 看上去 ok / 跑过了 / 能跑 / it runs / 没问题了`) with replace-with-failing-state-token instruction. Grounding: 2026-04-23 user prompt P#4984「为什么没严格按 §7 Iron Law #2 该做的就是查日志，不是凭印象」. Existing rule "'Fixed' without 'was broken' = not evidence" did not enumerate the most-frequent escape phrasings, leaving the rule effectively unfalsifiable for hedge-style claims. v6.11.1 closes the door per §13.2 evidence-rebuttal shortcut (fix existing HARD; do not wrap a new rule around it).
- `[fix]` **§10 Specificity** (core, wording) — appended `No-baseline fallback` clause requiring `[PARTIAL: <missing-baseline>]` when no absolute number or baseline ratio is available, instead of softening with synonyms (`much / notably / clearly / markedly / 较为 / 比较`). Grounding: 30d `claudemd` audit (188 rule-hits across 4 projects) — banned-vocab hook 13/14 deny rate; top patterns `significantly` ×6, `70% faster` ×4, `显著改善` ×4, `should work` ×3, `Comprehensive` ×1. Hook catches surface forms but agent retries with synonyms not in the quick-list. Closes the "switch synonym to escape" path per §13.2 evidence-rebuttal shortcut.

**§13.2 budget cost**: 0 (both edits are wording fixes to existing HARD rules per evidence-rebuttal shortcut). HARD tally unchanged. 20-task counter preserved from v6.10.2.

**Sizing** (v6.11.1, 2026-04-29): core 23212 → 23751 chars (+539, +2.3%); extended 45678 chars (unchanged this PR). Size budget (§13.1): core 23751/25000 (1249 chars headroom — tight, 95.0% utilized; next minor MUST net-delete); extended 45678/50000 (4322 chars headroom). Runtime L0/L1/L2 ≈ 5.9k tokens (core only, +0.1k vs v6.11.0). L3/Override/ship ≈ 17.4k tokens (+0.1k vs v6.11.0). A13 token test (≤5500) — verify in CI.

**§13.2 candidate update**: `tasks/rule-candidates-2026-04.md` gains a second candidate — Shared-symbol edit guard (proposed §9 SHOULD trial). Repro-count: 1 (mem #8155 FTS5 `OBS_FTS_COLUMNS` desync across utils.mjs / scoring-sql / synonyms.mjs); below promotion bar — log-only.

---

## v6.11.0 — 2026-04-24

Minor: ROI-ranked optimization across §1 / §2 / §5 / §5.1 / §7 / §9 / §10 / §11, driven by 5-day retrospective over `projects--mem` + `projects--code-graph-mcp` session history. §13.2-compatible: 0 new HARD. HARD tally unchanged (12 core + 4 §EXT-side).

- `[add]` **§9 Parallel-path completeness** (core, SHOULD L2+) — change touching a node with multiple parallel paths (fallback / feature flag / match default / SQL `ORDER BY`+`LIMIT` / early-return / FTS-vs-LIKE / multi-dispatch) MUST enumerate and verify each. 4 grounded repros in 5 days logged as HARD candidate in `tasks/rule-candidates-2026-04.md`; promotion blocked by §13.2 20-task counter until SHOULD presence fails to suppress recurrence.
- `[add]` **§2 LLM-visible metadata → L3** (core, classification) — MCP tool descriptions / MCP `instructions` / adoption-memory files / shipped prompt templates / plugin skill descriptions → L3 regardless of LOC. Prior wording ("released-artifact user-visible default behavior change") didn't trigger on metadata edits that silently re-route Claude Code.
- `[add]` **§7 Metric-coupling check** (core, SHOULD L2+) — changes coupled to an existing metric / bench / oracle / compile-time budget MUST cite before-and-after. Triggers: tool descriptions, adoption-memory, field compression, prompt templates, compile-time assert guards.
- `[add]` **§5 Obvious-follow-on not exempt** (core, clarifies §0 Hard-AUTH override — no new HARD) — mid-bundle adjacent-bug discovery requires individual re-AUTH even when the fix feels obvious. Source: `feedback_mid_bundle_scope_auth.md`.
- `[add]` **§1 Recommend-first single-option** (core, clarifies principle) — single-obvious-option execute directly without preamble. Source: `feedback_autonomous_fixes.md`.
- `[add]` **§5.1 aggressive skip-list** (core) — explicit list of ceremony items `aggressive` mode skips (soft-trigger announcement / single-option preamble / bugfix proposal). Never-downgrade set unchanged.
- `[add]` **§10 banned-vocab quick-list** (core) — 10 most-frequent EN + 中文 offenders inlined; full enumeration stays at §EXT §10-V. Grounding: §EXT reference lost after compaction.
- `[move]` **§11 Re-Read / Correction / Context pressure** (core → §11-EXT) — three non-HARD maintenance heuristics demoted. Core pointer line retained. 0 grounded-incident hits in 30-day session history.

**Sizing** (v6.11.0, 2026-04-24): core 20299 → 23212 chars (+2913, +14.3%); extended 42604 → 45428 chars (+2824, +6.6%). Size budget (§13.1): core 23212/25000 (1788 chars headroom — tight, 92.8% utilized, next minor MUST net-delete); extended 45428/50000 (4572 chars headroom). Runtime L0/L1/L2 ≈ 5.8k tokens (core only). L3/Override/ship ≈ 17.2k tokens. §13.2 budget cost = 0; 20-task counter preserved from v6.10.2. A13 token test (≤5500) still green.

---

## v6.10.2 — 2026-04-23

Patch: §11 Mid-SPINE turn-yield (new HARD, all levels). HARD tally +1 in core (12 core + 4 §EXT-side).

- `[add]` **§11 Mid-SPINE turn-yield** (core, HARD) — placed immediately before `Session-exit mid-SPINE` as the turn-boundary sibling to its session-boundary rule. Once a turn has executed ≥1 tool call inside an active SPINE cycle, MUST continue planned steps through VALIDATE; `<system-reminder>` blocks (hook output / mid-turn `[mem]` context / PostToolUse flushes) are explicitly NOT turn boundaries. Only three legal mid-cycle yields: `[AUTH REQUIRED]`, genuinely-ambiguous direction, or §11 Context pressure checkpoint. "Natural-feeling" pause points and single-Edit completion do not qualify. Silent yield followed by next-turn "done" claim = Iron Law #2 violation. Self-diagnostic tell: user's next message is `继续 / next / 怎么停了 / why did you stop` → treat as confirmed prior yield.
- **Grounding**: two user-reported mid-turn stops on 2026-04-22 / 04-23 in plugin-adjacent sessions. Root-cause split: (1) `<system-reminder>` injection from `UserPromptSubmit` hook read as new-turn boundary even when prompt was empty/continuation; (2) single-Edit completion felt like task-done when plan had ≥3 remaining steps. Hook-side mitigation (short-prompt silent-exit + continuation labels) is plugin-side work, already landed on the hook that drove incident 1; this spec rule covers the model-side habit that hook fixes cannot reach (incident 2).
- **Core vs §EXT decision**: §EXT loads only at L3/ship/Override/3-strike, but mid-turn yields happen at L1/L2 (both grounded incidents were L1-L2). Rule in §EXT would never bind at the levels where it fires. §11 is already the "universal · binds every task" section, so placement here is the natural home and does not require a §0.1 core-growth exception.

HARD tally: 11 → 12 in core (+1). §13.2 budget cost: 1 new HARD.

---

## v6.10.1 — 2026-04-23

Patch: §7 Ship-baseline wording alignment (no rule change, no behavior change). §13.2 budget cost: 0.

- `[fix]` **§7 Ship-baseline** (core) — "check base-branch pipeline color" → "check pushed-branch pipeline color (fallback latest-any on detached HEAD)". Grounding: `claudemd` hook enforcement since v0.1.0 has filtered `gh run list --branch $(git branch --show-current)` precisely so that an unrelated scheduled workflow failing on `main` cannot block a feature-branch push whose own CI is green. Prior wording implied a broader check than any implementation actually performed, so §3 TRUST (strictest reading) made the rule effectively unfalsifiable. Same single-line fix applied to §EXT §7-EXT rationale paragraph for consistency.

HARD tally unchanged. Zero HARD added, zero removed, zero semantic change.

---

## v6.10.0 — 2026-04-23

Minor: data-driven net contraction. Grounding: external audit vs 6-week history of `projects--mem` / `projects--code-graph-mcp` / `projects--claudemd` flagged core at 95% of §13.1 ceiling (24.9k/25k), evidence rule scattered across §0/§7/§10/§EXT §7-EXT/B.2, and dual routing tables (§2.2 core + §EXT §4 FLOW) with tie-breaker adding cognitive cost every task. §13.2-compatible: 0 new HARD; rule consolidation + rationale externalization only.

- `[merge]` **§2.1 ROUTE unified** (core) — §2.1 skill soft-triggers + §2.2 ROUTE + §2.3 TOOLS → one §2.1 ROUTE table + escalation-principles + soft-trigger clause. Dual-routing tie-breaker dropped. §EXT §4 FLOW unchanged (still authoritative on L3/ship). ~−1.4k chars.
- `[compress]` **§5 AUTH** (core) — 14-row hard/soft column table → hard-default enum + soft list + none-case. 12 ops verbatim; semantics unchanged. ~−400 chars.
- `[compress]` **§7 Iron Law #2 examples** (core) — Good-example set 3 → 2 (L1 + L2); 中文 explainer consolidated to one trailing line. Bugfix anchor rule unchanged. ~−250 chars.
- `[compress]` **§8 Verify-before-claim** (core) — 8.V1–V4 body tightened to 1–2 lines each; v0.8.3 leak-count and similar historical grounding removed from core (preserved in v6.7.1 / v6.7.4 changelog entries). ~−500 chars.
- `[compress]` **§10 Specificity** (core) — Scope clause tightened; full banned-vocab list kept at §EXT §10-V. ~−200 chars.
- `[compress]` **§11 session-exit** (core) — rule binding unchanged; v0.11.4 anecdote moved to CLAUDE-changelog v6.7.4 reference. ~−150 chars.
- `[fix]` **§EXT §8-EXT pointer removed** (core) — section never existed; core §8 short rationale + CLAUDE-changelog fulfills the role.
- `[sweep]` **§0 / §EXT TOC / cross-ref** (core) — Fast-Path tightened, depth-triggers shortened, TOC updated. ~−200 chars.
- `[archive]` **v6.9.0 entry backfilled to CLAUDE-changelog.md** (below, between v6.9.2 and v6.8.1) — extended `§Recent changes` invariant is "current entry only"; v6.9.0 was left stranded during the v6.9.2 / v6.9.3 patches.

HARD tally unchanged (11 in core + 4 §EXT-side). Zero HARD added, zero removed, zero semantic change. §13.2 budget cost = 0; 20-task counter reset per "rule consolidation" allowance.

---

## v6.9.3 — 2026-04-22

Patch: §12 clarification (no new HARD rule, no behavior change). Identical §13.2 budget cost: 0.

- `[clarify]` §12 PLUGINS Ship-pipeline hardening — new paragraph "Manual-ship atomicity (HARD, clarification)". Codifies that the `manual ship because <reason>` override is still **one atomic turn**: enumerate remaining steps up-front (commit → push → tag → release-artifact → CI verify), execute them back-to-back, no turn-ending between clean green steps. Green CI is Iron Law #2 evidence; intermediate tool exits are not stopping points. Exception: hard failure (push rejected / tag collision / CI red) — stop at the failure with full context. Grounding: a manual-ship session stopped after `git commit` and required user prompt to continue; root cause was treating commit as a natural pause point when the user's single `[AUTH]` on ship already covered the full pipeline per §5 per-task-per-scope.
- `[fix]` `spec/CLAUDE-extended.md` header was stuck at `v6.9.0` while core had advanced through v6.9.1 / v6.9.2. Bumped to v6.9.3 to match.

---

## v6.9.2 — 2026-04-21

**Core size**: ~6,200 → ~5,330 tokens (−14%). Policy lives in new §0.1 to prevent re-accrual.

- `[add]` §0.1 Core growth discipline (HARD) — defaults new rules to extended; rule-hits data drives promotion/demotion.
- `[add]` §2.3 TOOLS (~21 lines) — cross-tool orchestration: Grep / semantic / call-graph / impact / memory routing with plugin bindings.
- `[add]` §2.1 three skill rows: `sp:brainstorming` for large design, `gs:ship`, `gs:plan-*-review` series.
- `[move]` §1.5 GLOSSARY definitions → §1.5-EXT (core keeps index).
- `[move]` §5.1 AUTONOMY_LEVEL effect table → §5.1-EXT (core keeps description + never-downgrade list).
- `[move]` §7 TMP_RETENTION detail → §7-EXT.
- `[move]` §11 auto-memory decision tree → §11-EXT (core keeps three triggers).
- `[dedup]` §5 Safe-paths prefix list — core references existing §5-EXT; duplicate description removed.
- `[tweak]` §11 MEMORY.md index line gains optional `[tag]` suffix. Ungaged lines fall back to full-scan.

---

**v6.9.0 (minor, 2026-04-21)** — net contraction + meta-rule stabilization. 7 changes: zero new HARD rule, 4 HARD rules merged (semantics preserved), 1 HARD relaxed at boundary, spec version-history externalized, 1 operator-facing size budget added. Compatible with v6.8.0 §13.2 (rule *removal* / consolidation / downgrade explicitly encouraged; no new HARD added).
- **A4 §2 released-artifact exclusion** (core) — "bugfix restoring documented/intended behavior (CHANGELOG `fix:` not `change:` / `feat:`) → L2 max". Closes over-escalation where any bug-fix in a published CLI auto-read as L3.
- **A2 §2.2 ROUTE trimmed 9 → 6 rows** (core) — UI / design / perf / security / product-biz / tech-clarify rows moved to §4 FLOW prose. §2.2 stays as the L2 subset; §4 FLOW is authoritative once extended loads (v6.8.1 tie-breaker unchanged).
- **A3 §8 Verify-before-claim consolidation** (core) — former 4 standalone HARD subsections (Anti-hallucination / Tool-noise vs ground-truth / Destructive-smoke / Sandbox-artifact disposal) folded into one §8 "Verify-before-claim" section with sub-rules 8.V1-V4. Semantics identical; the 4 rules bind unchanged. Drops "how many HARD gates am I checking?" cognitive count from 4 to 1.
- **B6 §11 Memory decision tree** (core) — former bullets 5/6 (auto-memory + global-state hard trigger) and the separate §11.1 Retrospective section merged into one top-down decision tree inside §11. Step 1 global-state hard trigger; step 2 L2+ retrospective; step 3 judgment test. §11.1 section deleted. Classification cost dropped from 3 independent tests to ordered evaluation.
- **A1 §13.2 HARD-budget (permanent)** (extended) — v6.8.0 freeze window (2026-04-21 → 2026-05-21) replaced by a rolling permanent budget: promotion requires ≥3 repros AND ≥20 L2+ tasks since last HARD addition. Rule removal/downgrade adds budget back and resets the counter. Evidence-rebuttal shortcut preserved.
- **B5 §13.1 Size budget** (extended) — operator-responsibility bullet: core ≤ 25k chars, extended ≤ 50k chars (v6.9.0 baseline). Over ceiling → next version MUST net-delete (removal bytes > addition bytes) or refuse the addition.
- **B7 Recent changes externalized** — v6.8.1 and earlier entries moved to `~/.claude/CLAUDE-changelog.md`. Extended keeps only the current entry + Sizing line + pointer. Runtime reduction on L3/ship turns: ~−14k chars ≈ ~−3.5k tokens.

Sizing (v6.9.0 measurement, 2026-04-21): core 24903 chars ≈ 6.2k tokens; extended 37434 chars ≈ 9.4k tokens; runtime when both loaded 62337 chars ≈ 15.6k tokens.

**v6.8.1 (patch, 2026-04-21)** — post-v6.8.0 audit surfaced structural-tension / definition-gap issues; all fixes patch-level (no new HARD rules), compatible with §13.2 freeze. Zero rule semantic change; zero rule added; zero rule removed.
- **Section-anchor disambiguate**: extended §10-EXT / §11 collided across core/extended. Renamed: extended `§10-EXT Banned-vocab` → `§10-V`; extended `§10-EXT COMPLETE` → `§10-R`; extended `§11 ORCHESTRATE` → `§11-O`. Core cross-refs updated (§10 Specificity → §10-V; §10 closing pointer → §10-R; §11 closing pointer → §11-O; Extended TOC). Historical `§10-EXT` / `§11 ORCHESTRATE` strings in v6.7.4 / v6.8.0 Recent-changes entries preserved (describe past state accurately).
- **§1.5 Module definition tightened**: ambiguous "top-level package dir OR bounded-context folder" replaced with decisive rule — single-package repo: each `src/<subdir>/` is a Module; monorepo: each workspace/package root is a Module; sub-folders inside a Module do NOT count. Resolves e.g. `src/{mcp,parser,indexer,...}` → 9 Modules (was: 1 or 9 depending on reading).
- **§5.1 Published-client definition lifted into core**: "published = consumer outside this repo (external SDK user / npm consumer / MCP client incl. Claude Code / CLI end-user via npx / cargo install / release binary); internal = same-repo module-to-module only; uncertainty → treat as published". Previously only defined in project CLAUDE.md (code-graph-mcp), not extensible across projects.
- **§11.1 hierarchy explicit**: first line rewritten as "Upgrade of §11 Auto-memory for L2+: always save when either trigger applies, overriding §11's judgment test". Resolves ambiguity about whether §11.1 was additive to §11 or an override.
- **§2.2 vs §4 FLOW tie-breaker**: appended to §2.2 — "§EXT §4 FLOW is authoritative when extended is loaded; conflicts default to §4 FLOW; §2.2 is the high-frequency subset, not an override". Prevents drift-induced conflict between the two routing tables.

**v6.8.0 (minor, 2026-04-21)** — audit-driven prune + one new opt-in feature. Review origin: deep analysis flagged `edge-of-utility` signals in v6.7.5 (core 5.8k tokens; ≈10% is reference-list content loaded every turn; ship routing lived in extended so L2 tasks had no authoritative ROUTE table; AUTH tuned for pair-programming, not solo `bypassPermissions`). Changes, all backward-compatible:
- **NEW §2.2 ROUTE (core)** — concrete routing table (11 rows) promoted from extended §4 FLOW. L2 tasks now have authoritative SPINE-step-3 guidance without loading extended. Full composite-request / L3.FULL routing still in §4 FLOW.
- **NEW §5.1 AUTONOMY_LEVEL (core)** — opt-in `AUTONOMY_LEVEL: aggressive | default | careful` in project `CLAUDE.md`. `aggressive` relaxes cross-module refactor, internal-only Δ-contract, dev-only deps for solo + `bypassPermissions` workflows. NEVER-downgrade list protects §8 SAFETY, Iron Law #2, Anti-hallucination, Destructive-smoke, Session-exit, User-global-state audit, `.env`/secrets, migration, auth/payment/crypto, user-global settings, L3 enter.
- **Compressed §10 Specificity (core)** — kept trigger rule + scope + 1 OK example + 1 banned-category pointer; moved full EN/中文 banned-vocab list to NEW §10-EXT Banned-vocab.
- **Compressed §5 Safe-paths (core)** — kept NEVER clauses + `SAFE_DELETE_PATHS:` override + uncertainty rule; moved 12-prefix concrete list to NEW §5-EXT Safe-paths whitelist (detail).
- **Simplified §2 Fast-Path (core)** — removed pure-wording-vs-semantic-claim dichotomy for comments/docstrings (judgment cost ≈ L1 cost). Comments/docstrings now route to §7 L1-copy (pure wording) or L1 proper (behavior description, Read-to-confirm). §7 L1-copy definition widened to include code comments.
- **Simplified §11.1 Retrospective memory (core)** — merged 4 triggers into 2: (a) preventable-error pattern (former a+c), (b) non-default decision / non-obvious sequencing (former b+d). Same coverage, lower classification cost.
- **NEW §13.2 HARD-rule freeze (extended)** — 30-day moratorium 2026-04-21 → 2026-05-21 on new HARD rules. Incidents log to `tasks/rule-candidates-*.md`; promote only at ≥3 repros post-freeze. Enforces §13.1 Version discipline.
Measured: core 23086 → 23901 chars (+815, +3.5%) — additions (§2.2 ROUTE +~700, §5.1 AUTONOMY_LEVEL +~700) net outweighed migrations (§10 banned-vocab −~700, §5 Safe-paths −~200, §2 Fast-Path −~200, §11.1 merge −~250). Extended 41292 → 47244 (+~5.9k) absorbing migrations + §13.2 freeze block. Net runtime cost: L0/L1/L2 +~200 tokens/turn (core grew); L3/ship +~1.6k (extended grew). Structural wins (L2 gets ROUTE without loading extended; solo-dev `aggressive` opt-in; §13.2 operator commitment) judged worth it. Zero HARD rule removed; 1 rule relaxed (Fast-Path comment/docstring — merged into existing L1-copy/L1 paths); §13.2 adds meta-rule bounding future growth. Exit §13.2 freeze before next minor bump.

**v6.7.5 (patch, 2026-04-21)** — spec compression pass. No rule semantic change. Core in-place tightening across §0 Batch re-AUTH / §0 Quality slider / §1 Language contract / §2 Fast-Path / §2 Override modes / §3 Persisted memory / §5 Safe-paths prose / §7 User-global-state audit + retention / §8 recursive-bash + Sandbox disposal / §11 all 4 new bullets + exemption / §11.1 body+skip / §EXT LOADING; extended in-place at §2-EXT universal / §4.EMERGENCY Intervention priority / §7-EXT L2 line / §11 ORCHESTRATE enumeration (dropped stale parenthetical, future-proof). Changelog section collapsed: v6.7.3 / v6.7.2 / v6.7.0 retroactive entries summarized; pre-v6.5 history (v6.5.0/v6.3.0/v6.2.0/v6.1.0) collapsed to 3-line summary with git-log pointer. Rule text verbatim-preserved; only rationale prose / duplicated phrasing / restated terms tightened. Measured: core 25471 → 23086 chars (−9.4%); extended 51888 → 41292 chars (−20.4%); total 77359 → 64378 chars (−16.8%).

**v6.7.4 (patch, 2026-04-21)** — 9 surgical rule tightenings in core + 1 extended alignment fix, driven by same-session audit of recent work logs (plugin marketplace cleanup, `match_confidence` comment edits #7914/#7917, v0.11.4 ship regression memory) + `tmp/` hygiene gap + language-contract gray zones. No §EXT semantic change beyond the §11 ORCHESTRATE enumeration update.
- **§2 Fast-Path split** (core L40-41): `comment / docstring` removed from L0 whitelist. Pure-wording comment/docstring stays L0; **semantic-claim comment/docstring** (asserts "X does Y" / "returns Z on null" / "uses FTS vs vector") → L1 minimum + MUST Read cited implementation to confirm the claim. Rationale: current-session `match_confidence` docstring edits spent iterations because comment claims had to match actual scoring behavior; L0 "exists + syntax check" cannot verify semantic correctness. Wrong semantic comments poison future readers and survive refactors.
- **§3 TRUST persisted memory precedence** (core L112): `memory/feedback_*.md` and `memory/user_*.md` rank at current-turn user-instruction level — **explicitly above §2.1 soft-trigger defaults** (e.g. `feedback_autonomous_fixes.md` overrides default "L2 bugfix → investigate"). `memory/project_*.md` / `memory/reference_*.md` rank at inferred-context level (verify current state first; they go stale). Fresh Read vs memory conflict → trust Read + update memory. Previously ambiguous: §3 TRUST listed only 3 tiers (spec / current-turn / inferred-context) with no slot for persisted memory files.
- **§8 recursive-bash broadening** (core L183): Never-list entry for `~/.claude/` expanded from `grep -r / find / rg` to any recursive / deep-traversal bash (`ls -R` / `du -a` / `tree` / `fd` / any descent without explicit depth cap), + explicit `-maxdepth 1` fallback. Rationale: harness captures bash stdout to `~/.claude/tmp/<id>.output`; the exponential-amplification trap applies to all directory traversal, not just the original 3 commands.
- **§11 Auto-memory hard trigger + self-describing-artifact exemption** (core L241, MUST at any level, skip judgment test): modifying `~/.claude/` global state across ≥2 files in one task (plugin install/uninstall, settings migration, marketplace edits, statusline chain swaps, hook registration, MCP config) → save `project`/`feedback` memory. Rationale: current-session plugin marketplace cleanup + `known_marketplaces.json` init both had future-reuse but neither generated memory; §11 judgment test is too lenient for global-state writes. **Exemption**: if the edit produces a durable, in-artifact record of "what changed + why" a future session can grep without loading memory (versioned spec with `## Recent changes`; `CHANGELOG.md`; migration file with comment), that record satisfies the trigger — no separate `mem_save`. Test: can rationale be recovered from the artifact alone? Opaque state (plugin install / marketplace JSON / hook registration / MCP config) fails (the file says *what* is configured, not *why*) and still requires `mem_save`. Exemption added to keep the rule self-consistent for spec-edit sessions (this v6.7.4 edit itself).
- **§11 MEMORY.md read-the-file rule** (core L242, HARD on ship / release / destructive-path / L3): task keywords matching any `MEMORY.md` index entry → MUST Read the referenced file before proceeding. One-line descriptions silently drop load-bearing constraints — v0.11.4 shipped broken because prior session read only the index line for `feedback_ship_baseline_and_flakes.md`, not the body. That file's description field itself flags the gap ("Pre-push Read this file — index alone failed v0.11.4"). Index is a router, not a substitute.
- **§11 Session-exit mid-SPINE** (core L243, HARD at all levels): `/exit`, user-initiated termination, or `<session-handoff>` emission with any step past CLASSIFY but before VALIDATE → MUST NOT list those steps under "Completed" in any handoff / exit-summary / memory write. Write `tasks/<slug>-paused.md` naming each un-VALIDATE'd item + exact verify command still owed. Rationale: current-session plugin marketplace cleanup handoff reported deletion as Completed while "verify `installed_plugins.json` syntax / test remaining plugins load" was un-VALIDATE'd — Iron Law #2 was bypassed at exit. "Ran the step" ≠ "verified the step".
- **§7 `~/.claude/tmp/` retention policy** (core, appended to User-global-state audit): harness SHOULD configure SessionStart purge of entries with `mtime > 7d`; if unconfigured and residue check observes ≥100 stale entries → agent surfaces recommendation inline, no auto-clean without AUTH. Debug-heavy workflows widen via `TMP_RETENTION_DAYS: 30` in project `CLAUDE.md`. Rationale: residue check alone (v6.7.1 rule) reports leaks but doesn't prevent accumulation.
- **§8 Sandbox-artifact disposal** (core, appended to Destructive-smoke guard, HARD): task creating sandbox artifacts (`mkdtempSync` / scratch fixtures / HACK `tmp/` output) MUST delete on task exit — creating-task responsibility, not timer-based. HACK exit = promotion prerequisite. Exception: `.keep`-marked fixtures or those referenced by open `tasks/<slug>-paused.md`. Rationale: carryover voids next task's residue-check baseline (fresh count unknowable if prior leftovers exist).
- **§1 Language contract** (core, replaces 1-line `code English; user-facing follows user's language`): 3-clause split — user's language (default 中文) for chat prose + explanations + plans + summaries + `tasks/*.md` bodies; **English** for all machine-readable / persistent-in-tooling artifacts (code + comments + commits + CHANGELOG + PR titles & bodies + file names & paths + branches + log strings + config keys + CLI output labels); **hybrid** for `memory/feedback_*.md` + `memory/user_*.md` (bilingual keyword preservation), English-only for `memory/project_*.md` + `memory/reference_*.md` (search consistency). Rationale: prior 1-liner left commit messages / `tasks/` sidecars / `memory/` bodies / PR prose ambiguous; de facto practice already diverged across these, spec codifies the actual split + lines up with §3 TRUST's memory-file grouping.
- **§EXT §11 ORCHESTRATE enumeration** (extended L276): updated stale 4-rule parenthetical to reflect core §11's 8 bullets (was `Redundant Re-Read / Correction pressure / Context pressure / Post-compaction`; now includes Auto-memory + MEMORY.md read-the-file + Session-exit).

**v6.7.3 (patch, 2026-04-17)** — in-place prose tightening + 4 accuracy fixes (NPX pick-order ambiguity; §11 Post-compaction concrete signal list; §EXT §6 cross-ref; §EXT L2 colloquial opener). Core only, no semantics. Core 20962 → 20458 chars (−2.4%); L2 runtime 5.2k → ~5.1k tokens. Details in git history.

**v6.7.2 (patch, 2026-04-17)** — L2 runtime reduction via migration + in-place compression. Migrated: `§EXT Ship-pipeline hardening` → `§12`; `§7 Ship-baseline rationale` + `§2 Released-artifact checklist` → extended. Compressed: §7 examples / §8 Destructive-smoke / §11.1 bullets. Core 22720 → 20962 chars (−7.7%); L2 budget 5.7k → 5.2k tokens (−9%). Rationale: v6.7 core had grown +35% vs v6.5 baseline; ~2k chars of ship/release-only content was loading every turn.

**v6.7.1 (patch, 2026-04-17)** — §5 / §7 precision fixes driven by same-day plugin v0.8.3 release audit evidence. Core only.
- **§5 AUTH**: added `~/.claude/settings.json` / user-global hooks / MCP config → **hard**. Rationale: edits here affect all sessions across all projects — blast-radius parity with `.env` / config schema. Prior omission let experimental hook flags get silent-edited with no AUTH signal (mem #7738).
- **§7 User-global-state audit (HARD, L2+)**: code writing to `~/.claude/`, `~/.cache/`, `~/.config/`, `os.tmpdir()`, `/tmp/`, or cross-project state MUST run a post-green residue check (`find <path> -newer <baseline> | wc -l` / `ls -la` / `du -sh`) and report the count in evidence. Rationale: release declared "Verified" on 78/78 green tests (mem #7763) while the same runs had leaked 488+ tmp dirs to `~/.claude/tmp/` — bugs surfaced only by a manual audit (mem #7766), not by spec.
- No rule removed. L0/L1 unaffected. L2+ gets one extra filesystem check when writing to qualifying paths.

**v6.6.0 → v6.7.0 (minor, 2026-04-17, retroactive)** — two same-day bumps reconstructed from diff vs v6.5.1 (violated §13 META; v6.7.1 §5 AUTH tightening is the corrective). Added: §0 Mid-task feedback 6-class table · §0 Initial-prompt ambiguity (a)/(b) · §2 Depth triggers (reasoning-budget ≠ level upgrade) · §2.1 Skill soft-triggers + name-at-entry (resolves `using-superpowers` 1%-MUST vs spec-soft) · §7 Ship-baseline check HARD · §8 Anti-hallucination + Tool-noise + Destructive-smoke HARD · §11.1 Retrospective memory trigger MUST · §EXT Ship-pipeline hardening HARD · §2 Released-artifact → L3 + SemVer/CHANGELOG/opt-out/discoverability requirements. Incidents threaded: v2.33.2 version-sync, v2.6.3~v2.8.0 tag-without-release, v0.8.3 audit (mem #7738 / #7763 / #7766).

**v6.5.1 (patch, 2026-04-16)** — relocated core Recent-changes → extended (core every-turn byte reduction). No behavioral change.

**v6.5.0 (2026-04-16)** — audit-driven prune + additions (3-session sgc-project log review, ~2800 JSONL lines). Prunes: signals 5 → 2 (`[AUTH REQUIRED]` + `[PARTIAL]` only; dropped `[VERIFIED]` / `[RE-CLASSIFY]` / `[BLOCKED]` / `[MODE:]`); §7 evidence block dropped for inline prose; §8 ⚠ tags removed; L2 auto-load of extended removed (§7-EXT L3-only); Appendix B rewritten inline. Additions: §1 Recommend-first, §11 Auto-memory trigger + MEMORY.md refresh.

**Pre-v6.5 history** — full entries in git log. Highlights: v6.3.0 additive-L2 exception at routing + §7-EXT L1 inline-evidence equivalence + §6 three-strike signature simplified; v6.2.0 §7-EXT enforcement tightened + §5 safe-paths whitelist + §10 CN banned-vocab + §11 compaction Re-Read MUST; v6.1.0 8-extension → 2-file layout + §7 L1-copy + §4.FULL-lite + [AUTONOMOUS] + Batch re-AUTH + §2.S progressive spec + §10 Lessons cap 30.
