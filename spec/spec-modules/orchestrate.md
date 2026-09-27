---
module: orchestrate
loads-on: before spawning subagents or running work in parallel
triggers: 并行|子代理|\bsubagents?\b|\bin parallel\b|fan out
trigger-window: head
---

# AI-CODING-SPEC v6.36.0 — module: orchestrate

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §11-O ORCHESTRATE

Universal session rules live in core §11 SESSION — they bind whether or not this module is loaded. The rules below apply to orchestration contexts specifically.

### Defaults
- **Delegate only large, independent work**: a subagent re-establishes context and main re-reads its report. Delegate ≥2 sizeable tasks with disjoint scope and no shared mutable state (in parallel), a wide multi-file investigation, or a review that needs an empty context (§12). Keep the rest in main, a whole small task included: a fix or change a handful of tool calls finishes is not handed to a worker, and no subagent re-checks your own work beyond the reviews §12 requires. One subagent where one suffices. File-scope overlap possible (grep-guessed edit surfaces intersect) → serial.
- **Automate-first**: reversible + below AUTH-soft → execute with one-line reason.

### Subagent rules
- **1 task = 1 subagent**, briefed fully the first time.
- **Worktree spawn**: an `isolation: "worktree"` agent's prompt gives paths relative to its worktree, never the main checkout's absolute path — the harness rejects those.
- Subagent output uses §7 evidence format.
- **Output reaches main only at turn end**: inside a cycle you are blind to a subagent's report, so the default is to yield per core §11. A cycle that genuinely cannot yield polls the report file below; the notification channel itself is not pollable.
- **Report by file**: the harness cuts a teammate's reported result at 4000 chars. Any spawn whose report can run longer — every review or audit — gets an absolute output path in its spawn prompt for the full report, and ends on a message of ≤1500 chars: verdict, count per severity, one line per blocking finding, the path. Cut anyway → ONE message asking for the file, never for a resend; once a report has landed, send its author nothing — each message wakes it into another completion event.
- **Integration re-verify**: after a subagent reports done with evidence, main runs integration check (integration / e2e / cross-module smoke) on merged state before claiming its own done. Do not duplicate unit tests.
- **A subagent has nobody to ASK**: §0's ambiguity ASK and §5's `[AUTH REQUIRED]` both block on a user, and a spawned agent has none — the harness says so in its own system text. So inside a subagent: take §0's option (b), state the chosen reading in the report, and STOP at a §5 hard-AUTH boundary — finish the in-scope non-hard work, report the boundary as `[PARTIAL: <op> needs AUTH]`, and leave the operation to main. Never self-authorize, never wait for an answer that cannot arrive.
- **Subagent non-convergence (HARD)**: 3× similar-signature failure on one sub-task → pull back to main; no 4th spawn.
- L3 → sp:subagent-driven-development (built-in 2-stage review).
- Impact analysis before structural modifications; module overview before changes to unfamiliar code.

### Cross-session reference
User says "上次/之前/yesterday" → scan `tasks/` and `tasks/specs/` mtime <7d, confirm "你说的是 `<slug>`?"; ASK only if no match.
**Multi-candidate**: ≥2 matches → list as `<slug> (<date>) — <goal>` and ASK; never guess.
