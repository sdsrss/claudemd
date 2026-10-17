---
module: review
loads-on: when reviewing work or spawning a reviewer, including the pre-ship review
triggers: 评审|审查|审核一下|code review|(?<![A-Za-z0-9_])review (the|this|my|it)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])PR review(?![A-Za-z0-9_])
trigger-window: head
---

# AI-CODING-SPEC v8.2.0 — module: review

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §12 PLUGINS

### Hard cooperation rules
- **Author ≠ reviewer (HARD)**: reviewer = fresh subagent, empty context, with or without a review skill installed. No self-review in costume. No subagent can be spawned, or a harness or tool setting blocks it → name the block and ASK once; refused or impossible → L2: report the review as could not run, naming the block; L3 not executable: escalate.
- **Blind brief**: an empty context is not independence — the spawn prompt carries the author's view in. Give the artifact (commit range / paths), the contract (spec / issue / acceptance criteria) and the questions; withhold the author's rationale, its verdict (`fixed` / `correct`), earlier rounds' findings and any expected count. Author claims worth checking go in a separate `claims to falsify` list. Each finding cites file:line plus a reproducing command or quoted evidence; unexamined scope goes under `NOT CHECKED`. Spawn the reviewer without a name and ask for the whole report in its final message (§11-O Long reports). A re-review after repair is a new spawn, never a message to the reviewer who found the defect.
- **L3 two-tier review**: a fresh-subagent review per sub-task, then one pre-ship review across the whole change.
- **Ship order**: branch finished → pre-ship review → ship → deploy → monitoring checklist.

## §12 PLUGINS

### Review-finding repair
- **Receiving a review** (any source): verify each finding against the code before implementing it.
- **Critical/High**: repair as L2. Iron Law #1 applies — failing test first.
- **Security (any severity)**: failing test must reproduce vulnerability (not just touch code path). No "added a check" without RED test.
- **Medium**: L2 if ship-blocking; L1 if isolated.
- **Low**: user discretion. Default skip with reason logged.
- **Resume**: re-review the repair commit only (delta scope, a new spawn). Green → resume the ship. Depth limit 2; third miss → escalate with full context.
- **Mature-solution check**: many findings in one round, a repair outgrowing the change it repairs, or immature tech underneath → before another patch round, search established open-source projects / libraries solving the same problem (web search / context7) and recommend adopt vs build, citing sources and trade-offs.
