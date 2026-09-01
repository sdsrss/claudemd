# AI-CODING-SPEC — Operator handbook (human-facing)

**Not loaded into Agent context.** This file holds the spec-maintenance rules that govern the human operator, not the Agent. Extracted from `CLAUDE-extended.md §13.1` in v6.13.0 so Agent attention is not spent on directives it cannot execute. Agent may Read this file when collaborating on spec releases, version bumps, or audit cadence questions — but routine task loops do NOT pull it in.

Companion files:
- `CLAUDE.md` — always-loaded Agent core (per-turn gates).
- `CLAUDE-extended.md` — Agent-loaded on L3 / ship / Override / review.
- `CLAUDE-changelog.md` — historical changelog (Agent reads on demand).
- `OPERATOR.md` (this file) — human-only spec-maintenance handbook.

## §13.1 OPERATOR RESPONSIBILITIES

These govern the human maintaining the spec. Separated from Agent rules so Agent attention is not allocated to directives it cannot execute.

- **Self-audit cadence**: every ~50 L2+ tasks OR 4 weeks, whichever first — review `tasks/lessons.md`, count rule invocations where captured, prune never-used rules, promote frequently-repeated lessons.
- **Drift monitoring**: watch for silent spec violations — Agent claiming "Done" without inline evidence tying the claim to tool output, or using §10 banned vocabulary. Each instance signals a rule misunderstood or too burdensome.
- **Version discipline**: let a minor version run through ≥20 real L2+ tasks before the next. Adding rules without invocation data is how specs bloat.
- **Tier promotion/demotion thresholds** (moved from core §0.1 in v6.15.1; v6.17.0 C5 further shrank core §0.1 to Tier-2-default + hard cap + net-delete + pointer — tier definitions now live ONLY in the Rationale table below): Tier 2 → Tier 1 when the same trigger fires ≥3 sessions in 30d; Tier 1 → Tier 0 (core) only after rule-hits ≥5 sessions in 30d where the rule fired AND its elaboration wasn't consulted; `/claudemd-rules` recommends demotion for core entries with 0 hits in 30d. Promotion/demotion is an operator decision made from audit data, not an Agent runtime action. Tier-2 anchor filename patterns: `feedback_*.md` / `recall_*.md` / `reference_*.md` / `project_*.md`, keyword-loaded via MEMORY.md tags.
- **Patch-release batching** (2026-06-03 maturity audit): the ≥20-task rule above governs minors, not patches — and patch cadence was the maintenance-treadmill signal the audit flagged (43 days → 117 release commits ≈ 2.7/day; 41% carried `fix`/`hotfix`/`fp`/`drift`/`regression`). **Metric caveat (2026-07-25 audit)**: that subject-keyword grep is broken as a treadmill gauge — release subjects stopped using the words (`release(0.54.0): … detector calibration closure` = two FP fixes, matches nothing); it re-measured 15-20% over windows where content classification puts fix-primary releases at ~60-70%. Judge treadmill by classifying release CONTENT (CHANGELOG entries), not by grepping subjects. Batch related patch fixes into one release rather than shipping each hotfix individually (the `0.23.1`→`0.23.7` chain is the anti-pattern). Reserve a same-day standalone patch for a live enforcement regression (e.g. a §8 hook broken on a platform), not for doc/telemetry polish. Goal: fewer, higher-confidence releases.
- **Size budget** (HARD caps, v6.9.0 baseline; units are BYTES — core §0.1 is the single source and this line restates it): core ≤ 25K bytes, extended ≤ 50K bytes. Rationale: every byte in core loads every turn; extended loads every L3/ship/Override turn. Unchecked accretion silently trades user-instruction context for spec-rule context. Over ceiling → next version MUST net-delete (removal bytes > addition bytes) or refuse the addition. Track current size in the `Sizing` line of `CLAUDE-extended.md`'s `Recent changes` entry so the ceiling is a live signal, not a historical aspiration.
- **Tier-2 index budget** (2026-07-11 spec-audit R2): each project's `MEMORY.md` SHOULD stay ≤ 12KB — the index loads into context every session of its project (the audit measured claudemd's at 19.8KB = 80% of core, with 3 more projects over budget on first scan). `doctor` check `memory-index-size` flags overruns. Remedy: prune closed-loop `project_*` entries, compress fat descriptions/tag lists; memory FILES stay on disk (removing an index line only stops the every-session load + hook tag-matching). Never auto-trim — index edits are §5-scoped writes.

- **Demote-loop coverage** (measured 2026-09-01, `node scripts/hard-rules-audit.js`): **`demoteCandidates` can only ever hold 4 of the 25 HARD rules** — `§7-ship-baseline`, `§7-user-global-state`, `§10-specificity`, `§11-memory-read`. The pipeline starts from the 8 `hook`/`both` rules and then exempts the 4 §8 safety-class ones, which are §5.1 Never-downgrade and sparse by design. Read `demoteCandidates: []` as **"none of those 4 went silent"** — it says nothing about the other 21.
  - Two separate reasons a rule is outside that set, worth keeping apart: **12 rules have no hit channel at all** (11 `self` + the 1 `external`), so "0 hits in 30d" is not even measurable for them; and **5 `self` rules DO emit rows** (via `rule_hits_section`, observed by the Stop-time advisory scan) yet are still excluded from the candidate set by enforcement type. Silence from an instrumented `self` rule is therefore invisible to this loop even though the data exists.
  - Widening the loop means adding a detector or changing which enforcement classes the pipeline accepts — not lowering a threshold.
- **§8 Never-list inclusion criterion** (written down 2026-09-01; the list had 7 bullets and 3 manifest rows with no stated rule for the split): a `§8 Never` bullet earns a `hard-rules.json` row when **a hook arm can decide it from the command string alone**. Today that is `rm -rf $VAR` (`§8-rm-rf-var`) and execute-scripts-of-unknown-origin (`§8-npx`, `§8-curl-sh`). Four bullets are self-enforced *by construction* — whether a string is a secret, whether data is sensitive, whether a `DELETE` lacks a `WHERE` in the statement the tool will actually send, whether disabling cert verification is intended — none is decidable from the invocation text. The `~/.claude/` deep-traversal bullet is the exception worth naming: it **is** decidable from the command string and simply has no hook arm, so it is a detector candidate rather than a structural exclusion. Do not add manifest rows for rules no detector can ever move; a row that cannot change state is indistinguishable from a rule nobody uses.

## §13.2 batch-review cadence (operator-facing slice)

The agent-executable HARD-rule budget rule (logging incidents to `tasks/rule-candidates-<YYYY-MM>.md`, promotion eligibility gates) stays in `CLAUDE-extended.md §13.2`. The operator-side review activity lives here:

- **Cadence**: every 20 L2+ tasks OR 30 days (whichever first) — merge overlapping `rule-candidates-*.md` entries, promote eligible candidates per §13.2 gates, prune stale entries.
- **Promotion gates** (single source here since v6.25.0; extended §13.2 keeps only the agent logging duty): require BOTH ≥3 repros across distinct sessions AND ≥20 real L2+ tasks since the last HARD addition. Either missing → log-only, no promotion.
- **Evidence-rebuttal shortcut**: existing HARD shown (in session evidence) to produce wrong behavior → fix the existing rule (downgrade/remove), do not wrap a new rule around it.

## §13.3 promotion-criteria audit (hook-layer gates — single source since v6.25.0)

Behavior-layer hooks ship default-OFF for FP signal collection (≥30d). Promotion advances through two gates, operator-judged from `/claudemd-audit` data on the §13.2 cadence above (the criteria are entry gates, not auto-execution; `CLAUDE-extended.md §13.3` holds the agent-facing pointer only):

**Gate 1: default-OFF → default-ON (still advisory)**:
- ≥30 days observed since opt-in shipped
- Total fires ≥20 in 30d window (signal exists)
- `bypass-escape-hatch` rate <10% of fires (rule not routinely overridden)
- No operator `revert:` / `relax:` CHANGELOG entry against the rule
- Cross-project coverage ≥2 distinct projects (not single-repo accident)

**Gate 2: default-ON advisory → `deny` enforcement**:
- Further ≥30d in default-ON state; same fire / bypass / operator-feedback gates
- Cross-project coverage ≥3 distinct projects
- ≥1 `feedback_*.md` memory citing the rule as load-bearing (durable utility evidence)

## Standing carry-forward decisions (relocated from extended `Recent changes` in v6.25.0)

Operator bookkeeping formerly appended to each extended release entry; agent runtime never needed it. Standing items:

- **Net-zero / net-delete default posture**: impact-audit #4 demote rejected as category error — do NOT re-attempt (`project_impact_audit_followups_v0233.md`). Core net-delete candidate pool: `tasks/core-net-delete-candidates-v6.14.md` C7/C8/C10/C12 ≈ −600B (largely consumed by v6.25.0).
- **A4 measurement track CLOSED** (2026-07-24 full-population hand-labeling, pooled precision ≤0.17, record `tasks/sampling-detector-labeling-2026-07-24.md`) — do NOT re-open; self-enforced-rule compliance judgments require manual review, not detector rates.
- **Settled — banned-vocab deny-gate bypass rate**: carried here from 2026-07-25 (16/31 = 51.6%, 30d, 8 projects), **adjudicated 2026-08-24: no demote**. Record: `tasks/banned-vocab-demote-evaluation-2026-07-25.md`. Kept as a decision, not a queue item; re-open only on a codified demote-by-bypass-rate rule.
- **Settled — §4 Routing primaries `off` in `skillOverrides`**: carried from 2026-07-25 as "6 primaries, re-enable-vs-rewrite", re-queued 2026-09-01 after it appeared in no batch-review record — neither adjudicated nor re-carried, i.e. it fell off the loop silently. **Adjudicated 2026-09-01: no change to §4 or §12; the machine stays as configured and degrades through the fallback table.** Measured, not counted from the carry note: **8**, not 6 (`gs:/qa`, `/qa-only`, `/design-consultation`, `/benchmark`, `/office-hours`, `/freeze`, `/careful`, `/guard`), against 24 primaries total; across 81 transcripts since 2026-08-01 the Skill tool was invoked 12 times, 5 of them §4 primaries — and all 5 were *enabled* ones (`sp:systematic-debugging` ×2, `sp:dispatching-parallel-agents` ×2, `gs:/ship`). The eight disabled primaries account for **none** of the 12. That split, not the raw total, is the evidence: §4 routing is live and used, and the part of it that is switched off is the part nothing reaches for. The reason it is not a spec defect: all 8 already own §12 Fallback rows, and §12's Detection paragraph names `skillOverrides`-off as the case it handles — so the spec's answer is complete by design, and `spec/` is a *shipped* artifact whose §4 must keep naming the best tool for users who do have gstack installed. Rewriting it to match one machine's local disables would degrade it for everyone else. **Standing detector** (this is what was actually missing — the 2026-07-24 discovery was an accident during an unrelated `/doctor` run): `doctor`'s `routing:skills-enabled` reads the INSTALLED extended spec against `skillOverrides` every run and names the offenders. Re-open only if the fallback path proves insufficient in practice, or if the two sets diverge for a *new* reason the detector surfaces.
- **Phase B of the v6.25.0 compression** (deeper cuts: IL2 example externalization, §10 quick-check removal, turn-yield Tell removal, batch re-AUTH detail): gated on ≥30d / ≥20 L2+ tasks post-v6.25.0 + manual violation review; per-clause record `tasks/spec-lean-cut-candidates-2026-08-09.md`.

## §13.4 `tasks/` filename conventions (reference table)

Spec sections reference `tasks/<slug>` files across 10 sections: core §11 (Context pressure + Session-exit → `<slug>-paused.md`), §0.2-EXT, §2-EXT, §2.S, §6 (dead-end record → `lessons.md`), §7-EXT (cold-start justification → `lessons.md`, repro scripts), §10-R, §11-O, §12, §13.2. Collected here so operators and Agent can find the right home without cross-section search.

The count read "7 sections" and omitted core §11, §6 and §7-EXT until 2026-09-01 — core §11 being the one an agent hits most often, since it is the only paused-file rule that binds without loading extended.

**One is auto-created**: `scripts/sampling-audit.js` writes `tasks/sampling-audit-<YYYY-MM-DD>.md` itself (row 3 below says so; this paragraph claimed "none are auto-created" alongside it). Every other pattern is written by Agent or operator per the cited spec section.

| Filename pattern | Spec section | Who writes | Purpose | Retention |
|---|---|---|---|---|
| `tasks/lessons.md` | §10-R Lessons file | Agent | Project-wide pattern lessons | cap 30, newest-first, drop-oldest |
| `tasks/rule-candidates-<YYYY-MM>.md` | §13.2 HARD-rule budget | Agent | Candidate HARD rules pending §13.2 promotion gates | merged + pruned on §13.2 batch-review cadence |
| `tasks/sampling-audit-<YYYY-MM-DD>.md` | `/claudemd-sampling-audit` | `scripts/sampling-audit.js` | Retrospective scan output (§10-V / §iron-law-2 / §10-four-section-order / §10-honesty hits) | manual prune |
| `tasks/<slug>-paused.md` | §11 Context pressure / Session-exit | Agent | Resume context + exact verify command for un-VALIDATE'd work | until resumed and deleted |
| `tasks/autonomous-run-<date>.md` | §2-EXT AUTONOMOUS exit ritual | Agent | Ran / blocked / failed / pending-auth summary | manual prune |
| `tasks/pending-auth-<date>.md` | §2-EXT AUTONOMOUS hard ops | Agent | Op + scope + risk + recommendation, deferred for interactive AUTH | until next interactive session resolves |
| `tasks/auto-approved.md` | §2-EXT AUTONOMOUS whitelist | Operator | One per line, e.g. `op:deps-bump-patch` | hand-curated |
| `tasks/retro-<date>.md` | §12 fallback for `gs:/retro` | Agent | Weekly retro when plugin absent | manual prune |
| `tasks/specs/<slug>.md` | §2.S SPEC ARTIFACT | Agent | L3 mandatory / L2 minimal spec (goal / non-goals / constraints / success-criteria / open-questions) | persists with feature |
| `tasks/perf-<n>.md` | §12 fallback for `gs:/benchmark` | Agent | Perf measurement when plugin absent | manual prune |
| `tasks/<n>.md` | §12 fallback for `sp:writing-plans` | Agent | Inline plan file when plugin absent | until feature complete |

**Override**: project `CLAUDE.md` MAY set `SPEC_DIR:` to relocate `tasks/specs/` only (§2.S Spec file). Other filename patterns are not overridable in current spec.

**Worktree note** (§2.S Worktrees): each worktree has its own `tasks/`; on worktree-finish, merge `lessons.md` to main.

## Rationale

Three-tier separation (v6.13.0):

| Tier | File | Loaded by Agent? | Content |
|---|---|---|---|
| 0 (always) | `CLAUDE.md` | every turn | per-turn gates (SPINE, AUTH, VALIDATE, SAFETY) |
| 1 (triggered) | `CLAUDE-extended.md` | L3 / ship / Override / review | conditional rules (FLOW, evidence ladder, plugin fallback) |
| 2 (keyword) | `MEMORY.md` + `*.md` anchors | on keyword/path match | recall-on-demand (`feedback_*.md` / `project_*.md` / `reference_*.md`) |
| operator | `OPERATOR.md` (this file) | **never auto-loaded** | human spec-maintenance rules |

Putting operator content in Tier 1 burned Agent context on directives it couldn't execute. This file is the dedicated home so the Tier 1 file shrinks and the operator handbook can grow without budget impact on Agent runtime.
