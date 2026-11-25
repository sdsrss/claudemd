# AI-CODING-SPEC — Operator handbook (human-facing)

**Not loaded into Agent context.** This file holds the spec-maintenance rules for the human who maintains the spec. The Agent may Read it when working on a spec release; routine tasks never pull it in.

Companion files:
- `CLAUDE.md` — the core, loaded every turn.
- `CLAUDE-extended.md` — source of the `ship` and `review` modules (`spec-modules/`), plus §13 META and the current change note.
- `CLAUDE-changelog.md` — version history.
- `OPERATOR.md` (this file).

## §13.1 OPERATOR RESPONSIBILITIES

- **Outcome run before a rule change** (v9.0.0, extended §0.1): a new or stricter rule ships only after an outcome A/B shows it changes results enough to pay for its cost. Harness: `tasks/claudemd-value-2026-11-25/run.mjs` (nine coding tasks with hidden tests, `check-fixtures.mjs` proves each hidden test fails before and passes after a reference fix). Arms: a vanilla arm with no spec and no hooks, the current spec, the candidate. Deliver the spec under test outside the repo (`--append-system-prompt-file` with Claude Code's CLAUDE.md framing, hooks via `--settings`): an in-repo `CLAUDE.md` gets `cat`-ed and skews cost. Write the pass criteria down before the run, judge code by hidden tests rather than by whether the rule was followed, and report cost as the geometric mean of per-task median ratios against the vanilla arm.
- **Size budget** (HARD caps, bytes; extended §0.1 is the single source and this line restates it): core ≤ 4,000, extended ≤ 12,000. Every core byte loads every turn. Track the current size in the `Sizing` line of extended's `Recent changes`.
- **Release discipline**: batch spec changes; at most two non-urgent releases a week (extended §12 Ship, Batch). A same-day patch is for a live enforcement regression, not for wording.
- **Demote-loop coverage** (`node scripts/hard-rules-audit.js`): **`demoteCandidates` can only ever hold 4 of the 15 HARD rules** — `§7-ship-baseline`, `§10-specificity`, `§11-memory-read`, `§11-session-exit`. The pipeline starts from the 8 `hook`/`both` rules and then exempts the 4 §8 safety-class ones, which are sparse by design. Read `demoteCandidates: []` as **"none of those 4 went silent"** — it says nothing about the other 11.
  - Two separate reasons a rule is outside that set: **5 rules have no hit channel at all** (4 `self` + the 1 `external`), so "0 hits in 30d" is not measurable for them; and **2 `self` rules DO emit rows** (via `rule_hits_section`) yet are excluded from the candidate set by enforcement type.
  - Widening the loop means adding a detector or changing which enforcement classes the pipeline accepts — not lowering a threshold.
- **§8 Never-list inclusion criterion**: a core §8 bullet earns a `hard-rules.json` row when **a hook arm can decide it from the command string alone**: `rm` on an empty-able variable (`§8-rm-rf-var`) and unknown-origin execution (`§8-npx`, `§8-curl-sh`). Secrets, SSL, `WHERE` and temp-file placement are self-enforced by construction. The `~/.claude/` deep-scan bullet is decidable from the command string and has no hook arm: a detector candidate, not a structural exclusion.

## §13.3 promotion criteria for hook-layer gates

Hooks are frozen as of v9.0.0: bug fixes only. A new gate, or an opt-in gate turned on by default, needs field evidence of a real failure it would have stopped (as `ship-baseline` has: 31 of the 33 runs it denied pushes onto, 10-04..11-25, had really failed, checked with `gh run view`), then:

- **Default-OFF → default-ON advisory**: ≥30 days observed; ≥20 fires in 30 days; bypass rate < 10%; no `revert:` / `relax:` CHANGELOG entry against it; ≥2 projects.
- **Advisory → deny**: a further ≥30 days on; the same gates; ≥3 projects; ≥1 `feedback_*.md` memory citing the rule as load-bearing.

## Standing decisions

- **2026-11-25, v9.0.0**: the v8 core (24 KB, nine modules, 26 HARD rules) was cut to a 2.8 KB core and two modules after the outcome A/B (`docs/claudemd-value-assessment-2026-11-25.md`): v8 gave the same or lower correctness than no spec at 1.8–2.4× the cost. Do not restore removed rules without a new outcome run.
- **Banned-vocab deny gate**: kept as a hook (frozen) though its spec text is gone; 13 non-probe denies in 30 days had 0 true positives (2026-11-03). Taking it off is a gate change that needs its own decision.
- **The size cap stays in bytes** (2026-09-26): core and extended measured within 3% of each other in bytes per token, so bytes track tokens.

## §13.4 `tasks/` files the plugin writes or reads

| Filename pattern | Written by | Purpose |
|---|---|---|
| `tasks/session-end-<sid>-paused.md` | `session-end-check` hook | Unvalidated changes at session end, with the verify command to run |
| `tasks/sampling-audit-<YYYY-MM-DD>.md` | `scripts/sampling-audit.js` | Retrospective transcript scan output |
| `tasks/specs/<slug>.md` | Agent, when a project asks for one | Design record of a task |

## Rationale

| Tier | File | Loaded by Agent? | Content |
|---|---|---|---|
| 0 (always) | `CLAUDE.md` | every turn | language, ask-first list, commit and verify, safety lines, report shape |
| 1 (triggered) | `spec-modules/ship.md`, `review.md` | on a ship or review prompt, or when core §12 sends it there | release checklist, risk-triggered pre-tag review, reviewer rules |
| operator | `OPERATOR.md` (this file) | **never auto-loaded** | spec maintenance |

v9.0.0 keeps only what the model does not do by default and the user wants; everything a strong model already does without being told is cost without effect.
