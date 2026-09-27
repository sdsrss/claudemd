---
module: skills
loads-on: when choosing which skill to invoke for a task
triggers: 
trigger-window: head
---

# AI-CODING-SPEC v6.36.0 — module: skills

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §4 FLOW

### Routing

| Request type | Candidates (pick per §12 Skill routing table) | Notes |
|---|---|---|
| code/logic bug | sp (L1: reproduce→§7; L2+: sp:systematic-debugging) | gs:/investigate only for env/staging/deploy |
| env/staging/deploy bug | gs:/investigate | → sp if root cause is code |
| UI/visual bug | gs:/browse → route per cause | |
| feat | sp (L0-L1: edit→§7; L2: sp:TDD→§9→§7; L3: §4.FULL or §4.FULL-lite) | L2-additive (new branch/field/endpoint/optional param, no prior failing path): RED-first short evidence per §7-EXT Additive exception — skip full sp:TDD ceremony. Bugfix always needs prior reproduction. |
| bootstrap / scaffold | sp — L2; bundle deps one AUTH; skip §4.FULL | |
| ship L2 | gs — sp:finishing → gs:/review → gs:/ship → gs:/land-and-deploy | Skip /autoplan, /codex. /qa: skip unless user-facing. |
| ship/deploy/PR | gs — gs:/review → gs:/ship → gs:/land-and-deploy → monitoring checklist | |
| prod incident | gs — [EMERGENCY] → revert or flag-off | |
| QA on staging | gs:/qa (fix) or gs:/qa-only (report) | |
| review | per-task: sp:requesting-code-review; pre-ship: gs:/review; from user: sp:receiving-code-review | One entry point per context |
| 2nd-opinion (opt-in) | gs:/codex | User request only; never auto |
| browser/web verify | gs:/browse, through the `gstack` router | Not `mcp__claude-in-chrome__*` or computer-use (gstack: slow, unreliable) |
| design/UI | gs:/design-consultation → gs:/design-review | |
| perf check | gs:/benchmark (before/after) | |
| security audit | gs:/cso | |
| Q&A (no code) | direct answer; docs-lookup for API claims (e.g. context7, if available) | |
| product/biz clarify | gs:/office-hours | |
| tech/arch clarify | sp:brainstorming | |
| mixed product+tech | combined ask, tag `[product]`/`[tech]` | |
| 2+ independent tasks | `Agent` tool (fork / general-purpose); sp:dispatching-parallel-agents as optional wrapper | |
| low-freq utilities | gs:/freeze, /careful, /guard, /retro; support ops | |

### Composite requests
Primary verb: "更快"→perf; "挂了/500"→bug; "好看"→design; "也加"→expansion.
Chain: clarify → primary → secondary only if needed → ship. Do NOT flatten to one row.
Example: "登录页又慢又报 500" → bug first (resolve 500), then perf only if slowness persists after fix.

### Skill invocation
Routing keyword / task type / user names skill; WHICH skill is the §12 Skill routing table's question, answered by fit. No precedence among plugins.

## §12 PLUGINS

### Skill routing table

Judgment by fit; no precedence among skills. Each candidate's criterion is taken from that skill's own `description` — the text the model already sees — so this table adds no second vocabulary. Two candidates both fitting → take the more specific criterion; one skill per stage, never stacked. Any subset of the three plugins absent → drop to the last column: no error, no ASK. Core §2.1 points here for skill routing.

| Task class (§2) | Candidates, each with its fit criterion | All missing |
|---|---|---|
| L0 / L1 | none — invoke no skill. A LEVEL rule, not a trigger rule: core §2.2's ship triggers and the receiving-review row below fire at any level, L0 included | — |
| L2 bug | `matt:diagnosing-bugs`: hard to reproduce / perf regression / intermittent · `sp:systematic-debugging`: ordinary bug, test failure or wrong behaviour, BEFORE proposing a fix · `gs:/investigate`: env / staging / deploy side | §6 + Iron Law #3 inline |
| L2 feature (additive) | `matt:tdd`: user asked for test-first / red-green-refactor / integration tests · `sp:test-driven-development`: ordinary RED-first | §7 ladder by hand, RED→GREEN |
| L2 / L3 design | `matt:domain-modeling`: terminology / CONTEXT.md / ADR · `matt:codebase-design`: module interface, seam, testability · `sp:brainstorming`: creative work whose intent is not yet settled · `matt:prototype`: a throwaway answering one design question · gs:/design-consultation, /design-review: a UI surface to design or review | self-ask: intent → constraints → options → recommend |
| review (per-task / pre-ship) | `matt:code-review`: a fixed base (commit / branch / merge-base) and both axes, standards and spec · `sp:requesting-code-review`: ordinary task-complete or pre-merge review · `gs:/review`: web-project pre-ship | fresh subagent + review brief. Author ≠ reviewer does not degrade |
| receiving review | `sp:receiving-code-review` | verify each finding before implementing; §12 Review-finding repair |
| web-visible behaviour | gs:/browse, /qa, /qa-only | browse: request a screenshot / log from the user. qa: a browse pass over the changed user-facing surface, reported per §7 L2 evidence and repaired via §12 Review-finding repair. Neither reachable → `[PARTIAL: no-browser]` |
| ship / deploy / release notes | gs:/ship, /land-and-deploy, /document-release | `manual ship because <reason>` in REPORT; manual push + `[AUTH REQUIRED op:manual-deploy]`; release notes by hand from the CHANGELOG top entry, naming the substitution |
| branch finish | `sp:finishing-a-development-branch` | manual: rebase, squash, changelog, clean tree |
| plan / execute (L3) | `sp:writing-plans`: a spec exists and needs decomposing · `sp:executing-plans`: a written plan exists · `sp:subagent-driven-development`: sub-tasks are independent | inline `tasks/<n>.md`, user reviews; main + a fresh subagent review per sub-task. No subagent at all → L3 not executable, escalate (HARD) |
| plan review | `gs:/autoplan` | inline 3-view self-critique (CEO / design / eng) |
| parallel work | `sp:dispatching-parallel-agents` | direct `Agent` spawns; serial if that tool is absent too |
| isolated workspace | `sp:using-git-worktrees` | single tree + branch; stash before switching |
| merge conflict | `matt:resolving-merge-conflicts` | by hand |
| product / biz clarify | gs:/office-hours: the fuzziness is product-side, not technical | combined ask, tagging `[product]` / `[tech]` |
| research | `matt:research`: high-trust primary sources, captured as a repo md file | context7 / WebFetch inline, citing the lookup source |
| perf | `gs:/benchmark` | hyperfine / time / native; `tasks/perf-<n>.md` |
| security | `gs:/cso` | manual STRIDE over auth / payment / crypto paths |
| second opinion | `gs:/codex` — user request only, never automatic | skip; note "no second-opinion review" in §10 |
| API docs lookup | context7 | WebFetch the official docs; cite the lookup source in the answer |
| scope / process utilities | gs:/freeze, /careful, /guard, /retro | inline scope-lock; retro in `tasks/retro-<date>.md` |

`matt:to-spec`, `to-tickets`, `implement` and `wayfinder` are **user-only**: never model-routed, at any level.

Detection: first call fails → session flag → auto-degrade. Flag expires after 5 turns or env change. **Absent-from-listing = missing**: a skill switched off via `skillOverrides` or never installed produces no failing call — it is simply not in the session's skill list, so call-failure detection never fires. Check the routed skill is listed before invoking; unlisted → take its last-column fallback and name the substitution in one prose line. No row for it → say so in REPORT under Uncertain; do not silently improvise a substitute.
**Gated = missing**: capability listed and callable but blocked by a lower-precedence layer (harness `unless the user requested it`, tool switched off) — neither detector above fires. §3 ranks that layer below this spec, so the gate may not win SILENTLY: name it, then treat as missing → take the fallback. Where the fallback itself needs the gated capability (`sp:subagent-driven-development`, the review row) there is nothing to degrade to: ASK once; refused → L2 `[PARTIAL: no independent review]`, L3 not executable, escalate. Rows carrying a written non-subagent degrade (`gs:/autoplan`, `gs:/codex`, `gs:/qa`) take it as written.
**Batch confirmation**: ≥3 fallbacks needing user input → consolidate into ONE message.
