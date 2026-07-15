# HARD-rule candidates (2026-04)

§13.2 budget log. Candidates here are SHOULD-level or unlanded rules awaiting promotion to HARD. Promotion eligibility: **≥3 repros across distinct sessions** AND **≥20 real L2+ tasks since the last HARD addition**. Patch-level wording fixes do not transit this file.

---

## [candidate] §9 Parallel-path completeness → HARD L2+

**Proposed rule text** (currently shipping as SHOULD in core §9 from v6.11.0): change touching a node with multiple parallel implementation paths (fallback / feature flag / `match` default arm / SQL `ORDER BY` + `LIMIT` combo / early-return branch / FTS-vs-LIKE fallback / multi-language `config.name` dispatch) MUST enumerate every path and verify each. Main-path green + silent siblings = not evidence.

**Repro-count: 4** (across 2 projects, 5 days)

1. **code-graph-mcp v0.14.x** — `ast_search` `ORDER BY f.path LIMIT 60` silently truncated late-alphabet files. User-facing result looked complete ("60 rows returned") but `src/storage/queries.rs` (54 Result-fn) and `src/mcp/server/tools.rs` (20 Result-fn) entirely absent because cli.rs / embedding / indexer / mcp / server/mod.rs exhausted the LIMIT first. Parallel path: the SQL `ORDER BY` + `LIMIT` pair is one logical path per sort-key. Ranking-by-relevance path existed in a sibling query; the edited query missed it. Anchor: `~/.claude/projects/-mnt-data-ssd-dev-projects-code-graph-mcp/memory/feedback_ast_search_ranking.md`.

2. **code-graph-mcp v0.15.0 → v0.15.1** — TSX added to `matches!(config.name, ... | "tsx")` but `lang_config.rs::for_language` default arm returned `"unknown"`, so `config.name == "tsx"` was permanently false. Parallel path: new-language checklist has 4 sync points (Cargo.toml + `languages.rs::get_language` + `utils/config.rs::detect_language` + **`lang_config.rs::for_language` static_name match**); the fourth was skipped. Single unit test passed because Rust/JS/TS tests used their own names. Anchor: `feedback_lang_config_default_name.md`.

3. **code-graph-mcp v0.16.x** — `dead-code --json` silently emitted nothing on empty filter result. Parallel path: every `--json` CLI subcommand has two output branches (empty-result early-return + happy-path `if json_mode`); `dead-code`'s empty-result branch at top of function skipped the `writeln!("[]")` guard. Six sibling commands (search / grep / callgraph / show / trace / overview) had been fixed earlier in the same codebase. Anchor: `feedback_cli_json_empty_contract.md`.

4. **mem v2.49.0 → v2.49.1** — CJK precision bundle fixed FTS path, but the LIKE fallback (sibling code branch not in original plan) was the real CJK leak source. E2E green on FTS inputs; LIKE-path inputs still leaked. Parallel path: query execution has two dispatch branches (FTS5 sanitized query vs CJK LIKE fallback); the bundle edited only the first. Anchor: `~/.claude/projects/-mnt-data-ssd-dev-projects-mem/memory/feedback_mid_bundle_scope_auth.md` + `project_non_obvious.md` (CJK search pipeline).

**Repro-bar met**: 4 ≥ 3. **Promotion status**: BLOCKED by §13.2 20-task counter — v6.10.2 added §11 Mid-SPINE turn-yield HARD on 2026-04-23, so the counter is at ~1 L2+ task of 20. Re-evaluate after 20 more L2+ tasks complete. If SHOULD-presence from v6.11.0 suppresses recurrence (no new repros in the next 20 tasks) → close candidate as "SHOULD sufficient, no HARD promotion needed." If ≥1 new repro occurs despite SHOULD → escalate regardless of counter (evidence-override path per §13.2 rebuttal shortcut).

**Tracking cadence**: check at every ship (`/claudemd-audit` recommended monthly).

---

## [candidate] §9 Shared-symbol edit guard → SHOULD L2+ (trial)

**Proposed rule text**: editing an exported symbol / shared schema constant / cross-file enum SHOULD `Grep` (or `find_references` / `get_call_graph`) for all callers in the same task before commit, and verify each in the same evidence sentence. Search-before-write applies to read-side, not just write-side.

**Repro-count: 1** (cross-project, mem only)

1. **mem v2.45.0+** — `OBS_FTS_COLUMNS` exported from `utils.mjs` was edited but desynced from references in `scoring-sql` / `synonyms.mjs` / test files. FTS5 virtual table recreated without column-list sync; `react/hook` keyword queries silently returned `None` instead of result set. Migration logic existed but column references across scoring/search modules were not verified together. Anchor: mem observation #8155 (`feedback_fts5_column_drift.md` if filed).

**Repro-bar status**: 1 / 3 — below promotion bar. Log-only per §13.2. Watching for second-repro signal in code-graph-mcp `cross-file static_name` paths (e.g. lang_config.rs vs detect_language.rs vs Cargo.toml — already partly covered by §9 Parallel-path completeness).

**Candidate scope vs §9 Parallel-path completeness**: distinct trigger surface. Parallel-path covers "this node has multiple branches; main + silent siblings" (intra-symbol). Shared-symbol covers "this symbol has multiple callers; edit + silent dependents" (inter-symbol). Could merge into one HARD if both reach 3 repros and merging doesn't lose precision.

**Tracking cadence**: re-evaluate at next ship OR if `feedback_fts5_column_drift.md`-class observation surfaces in another project.

---

## Batch-review checklist (§13.2, every 20 L2+ tasks OR 30 days)

- [ ] Merge overlapping candidate entries
- [ ] Promote eligible (repro ≥ 3 AND counter ≥ 20)
- [ ] Prune stale (candidate silent for 60 days with no new repros → close as "not a systemic pattern")
- [ ] Next batch-review: 2026-05-24 OR after 20 L2+ tasks from 2026-04-23, whichever first

---

## Batch review — 2026-05-10 (early, triggered by counter saturation)

**Trigger**: 20-task counter saturated ahead of 2026-05-24 cadence.

**L2+ task counter status** (since 2026-04-23 v6.10.2 §11 Mid-SPINE HARD addition, source: `git log --since="2026-04-23"`):

- **Spec patches (each = L2 per §13)**: v6.11.0, v6.11.1, v6.11.2, v6.11.3, v6.11.4, v6.11.5, v6.11.6, v6.11.7, v6.11.8, v6.11.9 = 10
- **Plugin L2+ releases (feat / refactor / multi-file fix)**: v0.8.2, v0.8.3, v0.8.4, v0.8.5, v0.9.0, v0.9.3, v0.9.4, v0.9.6, v0.9.7, v0.9.10, v0.9.11, v0.9.19, v0.9.22, v0.9.23, v0.9.24 = 15
- **Hotfixes (L1 mostly, conservative count = 0 in counter)**: v0.9.5, v0.9.8, v0.9.9, v0.9.12–v0.9.18, v0.9.20–v0.9.21 — excluded from counter
- **Total L2+ counter: ~25** ≥ 20 ✓

### Candidate-by-candidate verdict

#### §9 Parallel-path completeness — **PROMOTION ELIGIBLE**
- Repro count: 4 ≥ 3 ✓
- L2+ counter: 25 ≥ 20 ✓
- **Both conditions met. Action: next spec patch (v6.11.10) promotes core §9 from SHOULD to HARD L2+.** Hard-rules.json gets 13th core entry. Spec wording: drop the trailing `(SHOULD now; §13.2 candidate for HARD promotion — logged in tasks/rule-candidates-2026-04.md.)` clause; promote `MUST enumerate every path and verify each` from soft-prose to HARD-anchored.
- Plugin-side: no hook needed yet (rule is self-enforcement; no mechanical detection feasible without per-language AST). hard-rules.json `enforcement: "self"` like §iron-law-2.

#### §9 Shared-symbol edit guard — **CONTINUE LOG-ONLY**
- Repro count: 1 (unchanged from 2026-04 entry)
- No new repros in 11 days. Below promotion bar.
- Watching for second repro signal in code-graph-mcp `cross-file static_name` paths.

### New candidates surfaced this batch

#### [candidate] macOS CI shell portability → §EXT SHOULD
**Proposed rule**: hooks/*.sh that call platform-divergent shell builtins (`stat -f` BSD vs `stat -c` GNU; `find -E`; `timeout`; `wc -l` whitespace; `mktemp -d` template suffixes) MUST go through `hooks/lib/platform.sh` wrapper or use POSIX-portable form. CI matrix MUST include macos-latest.

**Repro count: 3** (from `tasks/lessons.md` 2026-04-29):
1. `[diagnostic-step-bsd-vs-gnu-stat]` — v0.5.0 §1.A diagnostic used `stat -f %m` (BSD), but CI installs gnubin → GNU `stat` rejects `-f`. macOS CI run 25075330298 errored: `stat: cannot read file system information for '%m'`.
2. `[macos-tmp-essentially-empty]` — v0.5.0 sandbox-disposal Case 8 assumption about `/tmp` churn refuted by macOS GH runner (`find /tmp -maxdepth 1 | wc -l` = 1).
3. `[macos-ci-tmp-flake]` — v0.4.1 sandbox-disposal Case 8 PASSED Linux / FAILED macOS, root cause inconclusive after 3 patch attempts.

Plus existing memory `feedback_macos_shell_portability.md` (2026-04-12) documenting the underlying class.

**Repro-bar status**: 3 ≥ 3 ✓. **Counter**: 25 ≥ 20 ✓. **Action**: candidate eligible for SHOULD promotion at v6.11.10 OR §EXT addition. Tier-2 priority — the existing `hooks/lib/platform.sh` wrapper + `feedback_hook_platform_lib_source.md` memory cover the implementation; spec rule would formalize the design contract. Recommended form: §EXT SHOULD (not HARD — implementation-discipline class, low blast radius).

**Companion plugin work**: claudemd-doctor sub-check that greps `hooks/*.sh` for known BSD-only flags. Rule-promotion is independent of doctor work; either can ship first.

#### [candidate, log-only repro=1] Spec Sizing-claim drift
**Pattern**: spec/CLAUDE-changelog.md Sizing line claims byte-counts for core/extended that diverge from on-disk `wc -c` at session start of next ship.

**Repro count: 3** (v6.11.8→v6.11.9, v6.11.11→v6.11.12, v6.11.12 in-session)

1. v6.11.8 entry claimed extended `46690 bytes`; v6.11.9 session-start measurement showed `45164 bytes` (Δ = −1526). Cause unconfirmed: either (a) Sizing line was estimate-at-write-time not real measure, or (b) intervening plugin patches (v0.9.22-v0.9.24) silently modified extended without bumping spec version. v6.11.9 entry documents the gap.
2. v6.11.11 Recent-changes claimed extended `~49850 bytes`; v6.11.12 in-session `wc -c` measured 49457 (Δ = −393). Tilde qualifier in v6.11.11 was doing some hand-wave work but the gap stayed real. Cause likely (a): Sizing line in v6.11.11 was forward-projected at write-time from v6.11.10 baseline + planned addition (~1100 bytes for Tag-specificity SHOULD), not re-measured post-edit.
3. v6.11.12 in-session: this very release initially wrote Sizing as `extended 49457 → 48560 bytes (−897, −1.81%)` — projected from char-count of old vs new Recent-changes block. Post-edit `wc -c` measured 49485 bytes (Δ +28, off by 925). Pattern identical to (1) and (2): Sizing claims authored from forward projection at edit-plan time, not from real measurement after edits land. Self-corrected before push.

**Repro-bar status**: 3 / 3 ✅ — promotion bar met. **Counter (§13.2)**: 2 / 20 L2+ tasks since 2026-05-10 reset (v6.11.10 §9 Parallel-path HARD addition). PROMOTION BLOCKED by counter saturation rule. Re-evaluate at next batch review. Mechanical-fix candidate (release-time `wc -c` self-check, ~30 LOC bash) is **independent of the HARD-rule track and now ship-blocking SHOULD before v6.11.13** — three distinct repros within 4 days makes the discipline-only approach insufficient.

**Mechanical-fix candidate** (orthogonal to spec rule): release-time pre-tag check that `wc -c` on spec files matches the latest Recent-changes Sizing claim ±50 bytes, fail-tag on mismatch. Cost: ~30 LOC bash. Independent of HARD-rule track.

### Outcomes summary

- §9 Parallel-path: ✅ ELIGIBLE → bundle into v6.11.10 spec patch
- §9 Shared-symbol: ⏸ continue log-only
- macOS CI portability: 🆕 ELIGIBLE-AS-SHOULD → bundle into v6.11.10 §EXT addition
- Sizing-claim drift: 🆕 log-only repro=1 → watch
- Pruning: nothing aged ≥ 60 days silent

### Next batch-review trigger

- Date: 2026-06-10 (30 days from this review, per §13.2 cadence)
- Or: 20 L2+ tasks since 2026-05-10 (today's review reset the counter)
- Whichever first.

---

## Batch review — 2026-07-10 (overdue; cadence was 2026-06-10)

**Trigger**: user-directed spec audit surfaced 22/22 rules in `hard-rules-audit` `staleReviews` (all `last_demote_review: 2026-05-24`, 47 days > 30d cadence).

**L2+ task counter**: 74 release commits since 2026-05-10 (`git log --oneline --since=2026-05-10 | grep -cE "^[0-9a-f]+ release"`) ≥ 20 ✓ — counter saturated; not blocking for any eligible promotion.

### Candidate-by-candidate verdict

#### §9 Parallel-path completeness — **CLOSED (promoted)**
Shipped as core §9 HARD L2+ in spec v6.11.10 per the 2026-05-10 review. Present in current core v6.15.0 (`**Parallel-path completeness** (HARD, L2+)`). Nothing further.

#### §9 Shared-symbol edit guard — **repro 1 → 2, CONTINUE LOG-ONLY**
New repro (2026-07, claudemd v0.26.0): contract-changing edit where `code-graph-mcp impact/callgraph` under-counted callers — `uninstall.js` imported the symbol under an alias (`import { X as Y }`) and was missed; grep-the-importers found it. Same trigger surface (edit shared symbol + silent dependent). Anchor: `feedback_code_graph_impact_aliased_imports.md` (claudemd MEMORY.md). 2/3 — below promotion bar; continue log-only.

#### macOS CI shell portability — **CLOSED (landed as Tier 1/2)**
Disposition changed from the 2026-05-10 "SHOULD in §EXT" plan: v6.11.14 moved the patterns out of spec into memory anchors (`feedback_macos_shell_portability.md` + `feedback_hook_platform_lib_source.md`) with a §EXT §11-EXT cross-ref; CI runs ubuntu+macos matrix. Implementation-discipline class is fully covered without spec bytes. Close.

#### Sizing-claim drift — **CLOSED (mechanically enforced)**
§13.2 evidence-rebuttal shortcut: mechanical fix supersedes rule promotion. `runSpecSizingCheck` (v0.21.6, copy-paste OLD/NEW suggested edits) + `spec-coherence-audit.js` `sizing-accuracy` / `sizing-headroom` gates (v0.23.8) enforce at release time. No spec rule needed; close.

### §13.1 stale-review sweep (22 rules)

Reviewed against 30d rule-hits window (2078 hits, parse 5586/5586): `demoteCandidates = []` — no rule meets demote criteria. Hook-enforced rules all healthy per doctor rule-usage (e.g. §8-rm-rf-var deny=149 bypass=3 (2%), §7-ship-baseline deny=10 bypass=0, §10-V deny=13 bypass=7 (35%)). Self-enforced rules: hits=null is the expected read-and-follow posture (2026-06-03 category-error ruling — do not demote on 0 telemetry); sampling-audit self-compliance detectors (v0.28.0) are collecting, rates withheld until A4 labeling. **Verdict: keep all 22; `last_demote_review` stamped 2026-07-10 in `spec/hard-rules.json`.**

### Outcomes summary

- §9 Parallel-path: ✅ CLOSED (promoted v6.11.10)
- §9 Shared-symbol: ⏸ repro 2/3, continue log-only
- macOS CI portability: ✅ CLOSED (memory anchors + §EXT cross-ref + CI matrix)
- Sizing-claim drift: ✅ CLOSED (mechanical enforcement)
- Pruning: no candidate aged ≥60 days silent (shared-symbol got a fresh repro)
- Open candidates remaining: 1 (shared-symbol edit guard)

### Next batch-review trigger

- Date: 2026-08-09 (30 days), or 20 L2+ tasks from 2026-07-10, whichever first.
- Watch item: §5-hard-auth sampling detector 7/7 raw violations — pre-registered FP-heavy; include in first A4 hand-labeling batch (with §iron-law-2 + §7-bugfix-anchor) before reading as real.

---

## [candidate, log-only, NOT a HARD rule] §2.1 model-tiering observability

**Logged**: 2026-07-15 (提示词五维审核, `docs/prompt-audit-2026-07-15.md` 建议 3).

**Pattern**: §2.1 Model tiering (SHOULD, v6.15.0) has zero telemetry — no rule-hits event records spawned-agent downgrade decisions, so downgrade frequency / anomalous-rerun rate / verifier≥generator compliance are all unobservable. Any future §13.3-style data-driven review of the rule is impossible without a data source.

**Proposed mechanism (if ever justified)**: advisory-only logging (e.g. Stop-hook transcript scan for `model:`/`effort:` in Agent/Workflow calls, or a `model-tiering` rule-hits event) — observability, not enforcement.

**Status**: log-only under internal freeze (`project_internal_freeze_v02312.md`); do NOT build unprompted. Activation trigger: a real incident where a downgraded agent produced wrong output that survived verification, OR external adoption asks for tiering data. Repro-count: 0 (no incident — this is an observability gap, not a scar).
