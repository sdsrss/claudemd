---
module: review
loads-on: when reviewing work or spawning a reviewer, including the pre-tag review
triggers: 评审|审查|审核一下|code review|(?<![A-Za-z0-9_])review (the|this|my|it)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])PR review(?![A-Za-z0-9_])
trigger-window: head
---

# AI-CODING-SPEC v9.0.2 — module: review

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §12-R Review

- **Author ≠ reviewer**: the reviewer is a fresh subagent with an empty context, never yourself. Give it the artifact (commit range as SHAs, or paths), the contract (release notes, issue or acceptance criteria) and the questions; withhold your rationale, your verdict and earlier rounds' findings. Ask for the whole report in its final message.
- **Findings**: each cites file:line and a reproducing command or quoted evidence; unexamined scope goes under `NOT CHECKED`. High = wrong behaviour users hit; Medium = wrong behaviour on a reachable but rare path; Low = everything else, wording included.
- **Receiving findings** (any source): verify each against the code first. High: fix with a failing test first. Medium: fix before the release when it is on the released path, else list it. Low: skip, unless it is a wrong statement users read in the release notes or docs; fix that inline.
- **Re-review** only the repair commit, with a new spawn, and only after a High or a code repair. A second miss on the same item: stop and ask the user, with the history.
