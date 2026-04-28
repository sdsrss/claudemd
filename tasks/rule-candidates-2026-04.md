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
