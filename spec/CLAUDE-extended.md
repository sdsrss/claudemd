# AI-CODING-SPEC v9.0.1 — Extended

Loaded on demand: core §12 points at the ship module, and the review module loads when reviewing. Version history: `~/.claude/CLAUDE-changelog.md`. Operator handbook (human-facing, not auto-loaded): `~/.claude/OPERATOR.md`.

<!-- module: ship -->
## §12 Ship

Run a release from the project's ship runbook or a listed ship skill. Neither → ship by hand against this checklist and write `manual ship because <reason>` as the report's first line: version sites in sync, CHANGELOG entry, release notes from that entry, the release artifact (GitHub Release or bare tag), CI green on the pushed SHA.

- **CI baseline**: before a push that fires CI, read the newest completed run on the branch (`gh run list --branch "$(git branch --show-current)" --limit 5`, skipping GitHub's own `Dependabot Updates`). Red → fix it, or write `known-red baseline: <reason>` in the commit body, or ask. The ship-baseline hook enforces this.
- **Released default behaviour**: a change that users of a published package feel by default gets a non-patch version bump, a migration note at the top of the CHANGELOG and a way back (a flag, a setting, or the previous version).
- **One run**: one ship request covers commit, push, tag, the release artifact and the CI check. Do them back to back in one turn; stop only at a failure (push rejected, tag collision, CI red) or to wait for a reviewer. A deploy needs its own approval.
- **Batch**: release at once only for a broken install or publish, a gate that misses or wrongly blocks, or a destructive path; batch everything else, at most two releases a week.

### Pre-tag review: only when the release carries risk

Before the tag, a fresh-subagent reviewer (`review.md`) reviews the release when it changes any of: a delete or cleanup path; auth, secrets or permissions; install, update, publish or release scripts; a gate's allow or deny decision; a data format, schema or migration; the default behaviour of a published package. Otherwise skip the review and name the changed areas in the release notes. The user can ask for a review of any release.

<!-- module: review -->
## §12-R Review

- **Author ≠ reviewer**: the reviewer is a fresh subagent with an empty context, never yourself. Give it the artifact (commit range as SHAs, or paths), the contract (release notes, issue or acceptance criteria) and the questions; withhold your rationale, your verdict and earlier rounds' findings. Ask for the whole report in its final message.
- **Findings**: each cites file:line and a reproducing command or quoted evidence; unexamined scope goes under `NOT CHECKED`. High = wrong behaviour users hit; Medium = wrong behaviour on a reachable but rare path; Low = everything else, wording included.
- **Receiving findings** (any source): verify each against the code first. High: fix with a failing test first. Medium: fix before the release when it is on the released path, else list it. Low: skip, unless it is a wrong statement users read in the release notes or docs; fix that inline.
- **Re-review** only the repair commit, with a new spawn, and only after a High or a code repair. A second miss on the same item: stop and ask the user, with the history.

<!-- module: none -->
## §13 META

### §0.1 Core growth discipline (HARD)

Core ≤ 4,000 bytes, extended ≤ 12,000 bytes. A new or stricter rule ships only after an outcome run (hidden tests, vanilla arm included; `OPERATOR.md` §13.1) shows it changes results enough to pay for its cost; "the spec is more complete" is not a reason. Removing a rule needs the same evidence or none.

`spec/hard-rules.json` partitions the 15 HARD rules by how they are checked. Today: 7 hook / 6 self / 1 both / 1 external.

### Hook-enforced rules

The core does not restate these; each hook explains itself when it fires.

- **Banned vocabulary (HARD, hook)**: `banned-vocab-check` denies a `git commit` whose message, or a ship-flow command (commit, push, PR, release, publish) whose preceding assistant turn, uses a word from `hooks/banned-vocab.patterns` as an unmeasured claim (`robust`, `significantly`, a bare `N× faster`).
- **MEMORY.md read-the-file (HARD, hook)**: `memory-read-check` denies a push, PR, release, publish or deploy command until the MEMORY.md entries its keywords match have been Read in this session.
- **Session-exit checkpoint (HARD, hook)**: `session-end-check` writes `tasks/session-end-<sid>-paused.md` when a session ends with file changes after its last check; a later session re-runs the project's checks before calling that work done.

## §10-V Banned-vocab (reference list)

The banned-vocabulary gate (hook-enforced, above) reads `hooks/banned-vocab.patterns`; this list is the fix recipe its deny message points to. When a word is banned, strip it and state the case with an absolute number or a ratio with its baseline.

**OK (absolute)**: "reduced p99 580ms → 140ms" / "12/12 tests pass".

**OK (ratio with baseline)**: "1453 → 1490 tests (+2.5%)" / "FTS 查询 380ms → 95ms（4×）".

## Recent changes

Full version history: `~/.claude/CLAUDE-changelog.md`. Only the v9 entries live here.

**v9.0.1 (patch, 2026-11-30)** — no rule text changed. `hard-rules.json`: the two self-checked rules whose telemetry came from hooks plugin 0.123.0 removed (`evidence-gate`, `transcript-structure-scan`) no longer name a log section. `OPERATOR.md`: the demote-loop note and the `Sizing` line are gone with the scripts that served them; hooks are frozen to bug fixes and removals. `CLAUDE-changelog.md` keeps the v9 entries only; older ones are in git history.

**v9.0.0 (major, 2026-11-25)** — core cut from 24,218 bytes (v8.6.0, the last release) to about 2.8 KB, modules from nine to ship and review. The first outcome A/B (hidden tests, 432 runs, `docs/claudemd-value-assessment-2026-11-25.md`) found the v8 spec gave the same or lower correctness than no spec at 1.8–2.4× the cost; the lean text kept correctness (66/72 vs 65/72) at 1.2–1.3×, with a local commit and a `## 汇报` report in 41 to 72 of 72 runs, depending on how the spec was delivered. It missed two bars set before the run, cost ≤ 1.15 (1.17 and 1.26) and ≥ 46/72 commits and reports (41/72 with the spec in the repo); the user accepted that. Pre-tag review now runs only on risky releases. HARD rules: 11 removed with that evidence as the rationale, the §13 30-day grace waived by the user; the rest keep their IDs. Design record `tasks/specs/spec-v9-lean-2026-11-25.md`.
