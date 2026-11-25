---
module: ship
loads-on: before tagging, releasing, publishing or deploying
triggers: 发版|发布(新)?版本|(?<![开触研出批激散引])发\s*v?[0-9]+(\.[0-9]+)+|(推送|合并)\S{0,4}\s*发布|打\s*(个|一个)?\s*tag|(?<![A-Za-z0-9_])ship(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])cut a release(?![A-Za-z0-9_])|create-release|merge-and-push|(?<![A-Za-z0-9_])release(?![A-Za-z0-9_]).{0,40}(?<![A-Za-z0-9_])to npm(?![A-Za-z0-9_])|npm publish|gh release|(?<![A-Za-z0-9_])deploy(?![A-Za-z0-9_])|上线
trigger-window: whole
---

# AI-CODING-SPEC v9.0.0 — module: ship

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §12 Ship

Run a release from the project's ship runbook or a listed ship skill. Neither → ship by hand against this checklist and write `manual ship because <reason>` as the report's first line: version sites in sync, CHANGELOG entry, release notes from that entry, the release artifact (GitHub Release or bare tag), CI green on the pushed SHA.

- **CI baseline**: before a push that fires CI, read the newest completed run on the branch (`gh run list --branch "$(git branch --show-current)" --limit 5`, skipping GitHub's own `Dependabot Updates`). Red → fix it, or write `known-red baseline: <reason>` in the commit body, or ask. The ship-baseline hook enforces this.
- **Released default behaviour**: a change that users of a published package feel by default gets a non-patch version bump, a migration note at the top of the CHANGELOG and a way back (a flag, a setting, or the previous version).
- **One run**: one ship request covers commit, push, tag, the release artifact and the CI check. Do them back to back in one turn; stop only at a failure (push rejected, tag collision, CI red) or to wait for a reviewer. A deploy needs its own approval.
- **Batch**: release at once only for a broken install or publish, a gate that misses or wrongly blocks, or a destructive path; batch everything else, at most two releases a week.

### Pre-tag review: only when the release carries risk

Before the tag, a fresh-subagent reviewer (`review.md`) reviews the release when it changes any of: a delete or cleanup path; auth, secrets or permissions; install, update, publish or release scripts; a gate's allow or deny decision; a data format, schema or migration; the default behaviour of a published package. Otherwise skip the review and name the changed areas in the release notes. The user can ask for a review of any release.
