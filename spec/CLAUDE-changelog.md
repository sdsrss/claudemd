# AI-CODING-SPEC — Version history

Canonical history for `~/.claude/CLAUDE.md` + `~/.claude/CLAUDE-extended.md`. Moved out of `CLAUDE-extended.md` in v6.9.0 to reduce per-turn token cost of the L3/ship load path (v6.8.1 Recent-changes block was ~6k chars).

Current version + sizing live in `CLAUDE-extended.md` (Recent changes section). New minor/major bumps MUST prepend an entry here.

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
