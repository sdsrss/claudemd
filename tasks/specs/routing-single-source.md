---
status: draft
revision: 1
---

# Routing single-source — §2.1 ↔ §EXT §4 reconciliation

## goal

Collapse core spec §2.1 ROUTE (13 data rows, 1262 bytes) to 8 rows by evicting L3+ / composite / specialized-clarify routes to §EXT §4 FLOW via a single catch-all dispatcher row. Reclaim ~700-900 bytes of core headroom — currently 396B left in the 25K core ceiling per `spec/CLAUDE-extended.md` Sizing line (98.42% utilization, one bad version away from the §0.1 net-delete forced).

## non-goals

- NOT changing §EXT §4 FLOW table content. Extended already has the comprehensive 21-row matrix.
- NOT renaming sections (§2.1, §EXT §4 stay).
- NOT changing AUTH (§5) / SAFETY (§8) / VALIDATE (§7) rules.
- NOT touching §2.2 EXT LOADING (its triggers — L3 / ship / Override — still fire load behavior independently).
- NOT a multi-step plan: this is a single-edit spec patch followed by atomic ship.

## constraints

- Core size MUST drop by ≥700 bytes (24604 → ≤23904). Target: ≤23800 (~800B reclaimed).
- Extended size growth MUST be ≤200 bytes (only Sizing-line rewrite + any §EXT §4 lead-in clarification).
- `tests/scripts/spec-coherence-audit.test.js` MUST pass — every remaining §EXT cross-ref in core resolves.
- `tests/scripts/spec-structure.test.js` / `spec-diff.test.js` / `spec-hash.test.js` / `spec-pattern-drift.test.js` MUST pass.
- 5 hand-walked routing scenarios MUST route to the same skill stack pre- and post-edit.
- §0.1 Core growth discipline: net-delete (removal bytes > addition bytes) — binds because over-ceiling risk is real.
- §EXT §13.2 budget: 0 cost (no rule add/remove/downgrade — pure routing-table compression).
- L3 spec edit → atomic ship per `feedback_claudemd_ship_from_main_atomic.md` (commit + push + tag + push tag + `gh release create` in one turn).
- `feedback_spec_sizing_recursive_rewrite.md`: Sizing-line rewrite itself adds ~300-400B; absorbed by the ±20B accepted-drift envelope, OR pre-tag mechanical check. Plan defers to envelope (simpler).

## success-criteria

1. `wc -c spec/CLAUDE.md` returns < 23904 (ideally ≤ 23800).
2. `wc -c spec/CLAUDE-extended.md` growth ≤ 200B vs current 43982.
3. `node --test tests/scripts/spec-coherence-audit.test.js` — all 3 checks (ext-cross-refs / sizing-accuracy / structured-report) PASS.
4. Full JS suite + hook suite + integration green (same gate as v0.16.0 ship).
5. Hand-walk 5 routing scenarios pre/post-edit (table below) — same terminal skill in both columns.
6. Sizing line in `spec/CLAUDE-extended.md §Recent changes` updated; ±20B envelope respected.
7. CHANGELOG.md `[0.17.0]` entry documenting the compression + cited byte deltas.
8. `spec/CLAUDE.md` top-line spec version bumped (v6.11.15 → v6.11.16 patch — compression-only refactor per §13 META: patch when "wording / clarification, identical behavior").
9. `spec/CLAUDE-changelog.md` entry for v6.11.16.

## open-questions

1. **Keep "2+ disjoint tasks" core or evict to extended?**
   - Core: meta-orchestration fires at any level; sp:dispatching-parallel-agents saves 30%+ wall-clock at L1 (e.g. parallel Read+Grep on independent files).
   - Evict: belongs with §11-O ORCHESTRATE in extended.
   - **Recommendation**: KEEP core. Single short row; high-frequency primitive.
2. **Should the catch-all row enumerate trigger keywords (ship/migration/design/plan-review/perf/security) or stay generic ("L3 / composite / specialized-clarify")?**
   - Enumerated: agent matches trigger words even when L3 classification not yet decided. ~+30B.
   - Generic: shorter, but agent must already have classified to L3.
   - **Recommendation**: enumerated. Trigger-word match is the routing mechanism for non-classified-yet requests (e.g. user says "ship v0.17" — agent matches "ship" before deciding L3). Spending 30B here saves wrong-routing at task entry.

## design — proposed new §2.1 ROUTE table

```
### §2.1 ROUTE (unified)

SPINE step 3. MCP-injected per-tool instructions are authoritative; this table covers cross-tool routing. Full L3 / composite / specialized-clarify matrix → §EXT §4.

| Trigger | Primary | Note |
|---|---|---|
| code/logic bug | L1: reproduce→fix→§7; L2+: `sp:systematic-debugging` | env/staging/deploy → `gs:/investigate` |
| feat L0/L1 | direct edit → §7 | |
| feat L2 (additive) | `sp:test-driven-development` RED-first → §7; bundle deps one AUTH | no prior failing path |
| 2+ disjoint tasks | `sp:dispatching-parallel-agents` | |
| UI/visual verify | `gs:/browse` ONLY | never `mcp__chrome` / computer-use |
| tech/arch clarify (no code) | `sp:brainstorming` | |
| Q&A no code | direct answer; context7 for API claims | |
| L3 / ship / deploy / PR / release / migration / design / plan-review / perf / security / specialized-clarify | Load extended → §EXT §4 FLOW | full routing table + §4.FULL / §4.FULL-lite chains in extended |
```

Estimated table-block byte cost: ~860B (vs current 1262B). Net reduction: ~400B.

**Why only 400B and not 800?** Catch-all row is fat (enumerated triggers) — but it must be, per open-question 2. Real savings come from collapsing 6 rows into 1. Combined with paragraph-prose tightening (§2.1's "Anti-patterns" + "Skill soft-triggers" lines are not the target — they stay).

To hit the ≥700B target, the §2.1 edit pairs with one of:

- **(opt A) drop the "Ambiguous trigger" mini-line** (line 113 — already covered by §0 SPINE classify-ambiguity rule). −40B.
- **(opt B) collapse "Tool escalation" 5-principle list into 2 sentences** (line 107). Currently 320B; can compress to ~200B without losing the 5 principles. −120B.
- **(opt C) move "Anti-patterns" line to extended §EXT §4** (line 109). Currently 220B; replaced with one-line cross-ref ~50B. −170B.

**Combined savings**: table ~400B + opts (A+B+C) ~330B = ~730B core reduction. Hits target.

Recommended execution order: do opts (A) (B) (C) together with the table rewrite in one diff — they're the same conceptual edit (compress §2.1).

## hand-walked routing scenarios

| # | User input | Expected terminal skill | Pre-edit route | Post-edit route |
|---|---|---|---|---|
| 1 | "Fix bug in src/foo.js" | `sp:systematic-debugging` (L2) or inline L1 | row 1 (code/logic bug) | row 1 (code/logic bug) |
| 2 | "Ship v0.16.1" | `gs:/ship` per §EXT §4 ship row | row 6 (ship/deploy) → §EXT §4 chain | catch-all row → §EXT §4 FLOW → ship row |
| 3 | "Review this design plan" | `gs:/plan-design-review` per §EXT §4 review row | row 9 (plan review) → `gs:plan-*-review` | catch-all row → §EXT §4 FLOW → review row |
| 4 | "L3 migration: add 2FA column" | `§EXT §4.FULL` workflow | row 5 (L3 / migration) → §EXT §4.FULL | catch-all row → §EXT §4 FLOW → §4.FULL |
| 5 | "What does fn calculateTax do?" | direct answer (no code) | row 13 (Q&A no code) | row 7 (Q&A no code) |

All 5 land on the same terminal skill. Routes 2/3/4 add one indirection hop (catch-all → §EXT §4 lookup) — cost is one extra paragraph read for the agent that had to load extended anyway (per §2.2 EXT LOADING, ship / migration / plan-review all trigger extended load independent of §2.1).

## risks

- **R1 Catch-all vagueness** — agent at task entry must match user input against the enumerated trigger words ("ship", "migration", "design", "plan-review", etc.). Mitigated: open-question 2 commits to enumerated triggers, not generic phrasing.
- **R2 Cross-references break** — current §2.1 has 4 explicit §EXT refs (§EXT §4.FULL, §EXT §4 chain, §EXT §12, §EXT §4 FLOW). Post-edit retains only §EXT §4 in the catch-all + lead-in paragraph. Removed refs don't break the audit (which checks core→extended resolution, not extended→core back-refs). §EXT §12 was the only one not pointed at §4; verify it's still referenced from somewhere in core (likely §2.2 EXT LOADING line 123 references "§EXT §12") — keep that reference live.
- **R3 Hot-path agent skips catch-all due to specificity bias** — agent reads top-down; if "ship v0.17" matches "ship" keyword AND there's a more-specific row above, agent might wrong-pick. Mitigated: post-edit, no more-specific row exists; "ship" appears only in catch-all.
- **R4 Sizing-line drift** — `feedback_spec_sizing_recursive_rewrite.md` documents ~300-400B drift envelope. Accepted: ±20B tolerance per spec-coherence-audit's `sizing-accuracy` check; absorb drift inside that.
- **R5 Net byte impact estimate may be off** — if combined savings come in under 700B, fall back to compressing the §0 SPINE or §1.5 GLOSSARY paragraph for the missing bytes. Do NOT ship a §2.1-only edit that doesn't move the needle on headroom.
- **R6 Patch vs minor spec bump** — §13 META says "wording / clarification, identical behavior" = patch. Routing collapse is identical behavior (same terminal skills), so v6.11.15 → v6.11.16 patch. If review surfaces any semantic shift, escalate to minor.

## execution checklist (for the next session)

Pre-edit:
- [ ] Re-read this plan; spot any drift.
- [ ] `wc -c spec/CLAUDE.md spec/CLAUDE-extended.md` — baseline.
- [ ] `git status` — clean tree.
- [ ] Confirm 5 routing scenarios mentally before touching the spec.

Edit (single diff):
- [ ] `spec/CLAUDE.md` §2.1 — replace 13-row table with 8-row table per design above.
- [ ] `spec/CLAUDE.md` §2.1 lead-in paragraph — append "/ specialized-clarify" to "Full L3 / composite matrix" line.
- [ ] Optional: opts A/B/C (drop "Ambiguous trigger" mini-line / compress "Tool escalation" list / move "Anti-patterns" to §EXT §4). Apply as needed to hit ≥700B target.
- [ ] `spec/CLAUDE.md` top-line: `# AI-CODING-SPEC v6.11.15 — Core` → `v6.11.16`.
- [ ] `spec/CLAUDE-extended.md` top-line: same patch bump.
- [ ] `spec/CLAUDE-extended.md` §Recent changes — new v6.11.16 entry + new Sizing line.
- [ ] `spec/CLAUDE-changelog.md` — v6.11.16 entry.

Verify:
- [ ] `node --test tests/scripts/spec-coherence-audit.test.js` — all 3 checks PASS.
- [ ] `node --test tests/scripts/spec-structure.test.js tests/scripts/spec-diff.test.js tests/scripts/spec-hash.test.js tests/scripts/spec-pattern-drift.test.js` — PASS.
- [ ] Full `npm test` — green.
- [ ] `wc -c` confirms byte targets hit.
- [ ] Mentally walk the 5 routing scenarios against the new table — all land on same terminal skill.

Ship:
- [ ] CHANGELOG.md `[0.17.0]` entry.
- [ ] Bump `package.json` / `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` 0.16.0 → 0.17.0.
- [ ] Pre-push CI check: `gh run list --branch main --limit 1` green.
- [ ] Atomic ship: commit + push + tag v0.17.0 + push tag + `gh release create v0.17.0`.
- [ ] Watch CI: `gh run watch <id>` green on ubuntu + macos.

## why not execute this session

Core spec is hot-path; every L0/L1/L2 task reads §2.1 every turn. Cold-context next session reduces drift risk on a high-blast-radius edit. Plan documented here lets the next session execute deterministically. The v0.16.0 ship already consumed this session's spec-edit budget.

## # Change log

- v1 2026-05-11: initial draft after #3 sandbox-disposal diagnosis collapsed to v0.16.0 single-LOC fix; rolling into #5 routing single-source per the carry-forward sequence.
