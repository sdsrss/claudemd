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
- **Tier promotion/demotion thresholds** (moved from core §0.1 in v6.15.1 — Agent core keeps tier structure, Tier-2 default landing, hard cap + net-delete only): Tier 2 → Tier 1 when the same trigger fires ≥3 sessions in 30d; Tier 1 → Tier 0 (core) only after rule-hits ≥5 sessions in 30d where the rule fired AND its elaboration wasn't consulted; `/claudemd-rules` recommends demotion for core entries with 0 hits in 30d. Promotion/demotion is an operator decision made from audit data, not an Agent runtime action.
- **Patch-release batching** (2026-06-03 maturity audit): the ≥20-task rule above governs minors, not patches — and patch cadence was the maintenance-treadmill signal the audit flagged (43 days → 117 release commits ≈ 2.7/day; 41% carried `fix`/`hotfix`/`fp`/`drift`/`regression`). Batch related patch fixes into one release rather than shipping each hotfix individually (the `0.23.1`→`0.23.7` chain is the anti-pattern). Reserve a same-day standalone patch for a live enforcement regression (e.g. a §8 hook broken on a platform), not for doc/telemetry polish. Goal: fewer, higher-confidence releases.
- **Size budget** (soft ceilings, v6.9.0 baseline): core ≤ 25k chars, extended ≤ 50k chars. Rationale: every byte in core loads every turn; extended loads every L3/ship/Override turn. Unchecked accretion silently trades user-instruction context for spec-rule context. Over ceiling → next version MUST net-delete (removal bytes > addition bytes) or refuse the addition. Track current size in the `Sizing` line of `CLAUDE-changelog.md` / `Recent changes` entry so the ceiling is a live signal, not a historical aspiration.

## §13.2 batch-review cadence (operator-facing slice)

The agent-executable HARD-rule budget rule (logging incidents to `tasks/rule-candidates-<YYYY-MM>.md`, promotion eligibility gates) stays in `CLAUDE-extended.md §13.2`. The operator-side review activity lives here:

- **Cadence**: every 20 L2+ tasks OR 30 days (whichever first) — merge overlapping `rule-candidates-*.md` entries, promote eligible candidates per §13.2 gates, prune stale entries.
- **Promotion gates** (cross-ref to extended §13.2): require BOTH ≥3 repros across distinct sessions AND ≥20 real L2+ tasks since the last HARD addition. Either missing → log-only, no promotion.
- **Evidence-rebuttal shortcut**: existing HARD shown (in session evidence) to produce wrong behavior → fix the existing rule (downgrade/remove), do not wrap a new rule around it.

## §13.3 promotion-criteria audit (operator-facing slice)

Hook-layer advisory→enforce promotion gates are defined in `CLAUDE-extended.md §13.3`. The operator-side activity is reviewing `/claudemd-audit` output against those gates on the §13.2 cadence above.

## §13.4 `tasks/` filename conventions (reference table)

Spec sections reference `tasks/<slug>` files across 7 different sections (§0.2 / §2-EXT / §2.S / §10-R / §11-O / §12 / §13.2). Collected here so operators and Agent can find the right home without cross-section search. None are auto-created by the plugin — Agent or operator writes them per the cited spec section.

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
