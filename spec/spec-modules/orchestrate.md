---
module: orchestrate
loads-on: before spawning subagents or running work in parallel
triggers: 并行|子代理|(?<![A-Za-z0-9_])subagents?(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])in parallel(?![A-Za-z0-9_])|fan out
trigger-window: head
---

# AI-CODING-SPEC v8.3.0 — module: orchestrate

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §11-O ORCHESTRATE

Universal session rules live in core §11 SESSION — they bind whether or not this module is loaded. The rules below apply to orchestration contexts specifically.

### Defaults
- **Overlapping edits run serially**: two subagents whose edit surfaces may intersect (grep-guessed files overlap) are not run in parallel.

### Subagent rules
- **1 task = 1 subagent**, briefed fully the first time.
- **Worktree spawn**: an `isolation: "worktree"` agent's prompt gives paths relative to its worktree, never the main checkout's absolute path — the harness rejects those.
- Subagent output uses §7 evidence format.
- **Output reaches main only at turn end**: inside a cycle you are blind to a subagent's report, so the default is to yield per core §11. A cycle that genuinely cannot yield gives the spawn an output path and polls that file; the notification channel itself is not pollable.
- **Long reports**: a spawn given a `name` reports through an idle notification that the harness cuts at 4000 chars; an unnamed spawn's final message arrives whole. Spawn every review or audit without a name and ask for the full report in its final message. A named spawn's report cut anyway → ONE message asking for the rest, never for a resend; once a report has landed, send its author nothing — each message wakes it into another completion event.
- **Integration re-verify**: after a subagent reports done with evidence, main runs integration check (integration / e2e / cross-module smoke) on merged state before claiming its own done. Do not duplicate unit tests.
- **A subagent has nobody to ASK**: §0's ambiguity ASK and §5's `[AUTH REQUIRED]` both block on a user, and a spawned agent has none — the harness says so in its own system text. So inside a subagent: pick a reading per §0 and state it in the report, and STOP at a §5 hard-AUTH boundary — finish the in-scope non-hard work, list the boundary under open items as `<op> needs AUTH`, and leave the operation to main. Never self-authorize, never wait for an answer that cannot arrive.
- **Subagent non-convergence (HARD)**: 3× similar-signature failure on one sub-task → pull back to main; no 4th spawn.
- L3 build: `plan.md` §4.FULL step 6.
- Impact analysis before structural modifications; module overview before changes to unfamiliar code.

### Cross-session reference
User says "上次/之前/yesterday" → scan `tasks/` and `tasks/specs/` mtime <7d, confirm "你说的是 `<slug>`?"; ASK only if no match.
**Multi-candidate**: ≥2 matches → list as `<slug> (<date>) — <goal>` and ASK; never guess.
