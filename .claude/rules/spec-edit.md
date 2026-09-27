---
paths:
  - "spec/**"
---

# Editing the spec in this repo

- `spec/CLAUDE*.md` is the text every user's agent reads. A change to it is L3 (core §2, LLM-visible metadata) and follows §EXT §13 META: show the diff and get the user's go-ahead, unless the current plan already authorizes it.
- A spec edit is not finished until the tree is consistent: the spec version bumped (`node scripts/version-cascade-check.js` names every stale site), an entry in `spec/CLAUDE-changelog.md` and in extended's Recent changes, and the Sizing line solved to its fixed point (`node scripts/spec-coherence-audit.js --strict` shows no drift).
- `spec/spec-modules/*.md` are build outputs of `spec/CLAUDE-extended.md`: edit the source, then run `node scripts/build-spec-modules.js` (`tests/scripts/spec-modules.test.js` fails `npm run check` when the committed modules differ from the build).
- `tests/scripts/spec-structure.test.js` pins each section by hash. Read each changed section's diff and confirm its pinned rules still mean what they meant, then update `PINNED_BLOCKS` / `HEADING_INVENTORY` in the same commit.
- A rule is often written in several places: core, §EXT §4 and §12, `spec/OPERATOR.md`, `spec/hard-rules.json`, `commands/*.md`, README. Grep the old wording across all of them before committing; a copy you did not change is a contradiction you shipped.
