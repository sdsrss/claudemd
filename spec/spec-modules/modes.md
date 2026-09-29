---
module: modes
loads-on: for HACK, EMERGENCY or AUTONOMOUS work, mid-task merge thresholds, and when a task is cancelled or switched
triggers: 
trigger-window: head
---

# AI-CODING-SPEC v7.2.0 — module: modes

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

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

## §0.2-EXT Mid-task feedback (continued)

Core §0.2 keeps the one-line defaults; the rest:

- **Quality slider** ("更严 / make rigorous"): <30% LOC + explicit direction → inline merge.
- **Scope-expansion**: cross-level → serial; same-level → inline.
- **Continuation** (e.g. "继续/next"): same SPINE.
- **Cancel** (e.g. "停/算了"): close; snapshot `tasks/<slug>-paused.md` if non-trivial.
- **Switch** (e.g. "先做X再做Y"): new SPINE; `paused.md` only under context pressure or non-trivial.
