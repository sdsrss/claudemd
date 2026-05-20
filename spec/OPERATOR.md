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
- **Size budget** (soft ceilings, v6.9.0 baseline): core ≤ 25k chars, extended ≤ 50k chars. Rationale: every byte in core loads every turn; extended loads every L3/ship/Override turn. Unchecked accretion silently trades user-instruction context for spec-rule context. Over ceiling → next version MUST net-delete (removal bytes > addition bytes) or refuse the addition. Track current size in the `Sizing` line of `CLAUDE-changelog.md` / `Recent changes` entry so the ceiling is a live signal, not a historical aspiration.

## §13.2 batch-review cadence (operator-facing slice)

The agent-executable HARD-rule budget rule (logging incidents to `tasks/rule-candidates-<YYYY-MM>.md`, promotion eligibility gates) stays in `CLAUDE-extended.md §13.2`. The operator-side review activity lives here:

- **Cadence**: every 20 L2+ tasks OR 30 days (whichever first) — merge overlapping `rule-candidates-*.md` entries, promote eligible candidates per §13.2 gates, prune stale entries.
- **Promotion gates** (cross-ref to extended §13.2): require BOTH ≥3 repros across distinct sessions AND ≥20 real L2+ tasks since the last HARD addition. Either missing → log-only, no promotion.
- **Evidence-rebuttal shortcut**: existing HARD shown (in session evidence) to produce wrong behavior → fix the existing rule (downgrade/remove), do not wrap a new rule around it.

## §13.3 promotion-criteria audit (operator-facing slice)

Hook-layer advisory→enforce promotion gates are defined in `CLAUDE-extended.md §13.3`. The operator-side activity is reviewing `/claudemd-audit` output against those gates on the §13.2 cadence above.

## Rationale

Three-tier separation (v6.13.0):

| Tier | File | Loaded by Agent? | Content |
|---|---|---|---|
| 0 (always) | `CLAUDE.md` | every turn | per-turn gates (SPINE, AUTH, VALIDATE, SAFETY) |
| 1 (triggered) | `CLAUDE-extended.md` | L3 / ship / Override / review | conditional rules (FLOW, evidence ladder, plugin fallback) |
| 2 (keyword) | `MEMORY.md` + `*.md` anchors | on keyword/path match | recall-on-demand (`feedback_*.md` / `project_*.md` / `reference_*.md`) |
| operator | `OPERATOR.md` (this file) | **never auto-loaded** | human spec-maintenance rules |

Putting operator content in Tier 1 burned Agent context on directives it couldn't execute. This file is the dedicated home so the Tier 1 file shrinks and the operator handbook can grow without budget impact on Agent runtime.
