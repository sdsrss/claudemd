---
paths:
  - "spec/**"
---

# Editing the spec in this repo

- `spec/CLAUDE.md` loads into every turn of every user's agent, and the ship and review modules load on demand. A new or stricter rule ships only after an outcome run (extended §13 §0.1, `spec/OPERATOR.md` §13.1); show the user the diff before committing it.
- A spec edit is finished when `node scripts/version-cascade-check.js` names no stale site after the version bump, and `spec/CLAUDE-changelog.md` and extended's `Recent changes` carry the new entry.
- `spec/spec-modules/*.md` are build outputs of `spec/CLAUDE-extended.md`: edit the source, then run `node scripts/build-spec-modules.js` (`tests/scripts/spec-modules.test.js` fails when the committed modules differ from the build).
- `tests/scripts/spec-structure.test.js` pins sections by hash: confirm each changed section still means what its pin says, then update the pin in the same commit.
- A rule can be written in several places: core, extended §12 and §13, `spec/OPERATOR.md`, `spec/hard-rules.json`, `commands/*.md`, README. Grep the old wording across all of them before committing.
