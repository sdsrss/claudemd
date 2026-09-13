---
status: implemented
revision: 3
---

# §5 Safe-paths — write the two halves that were only ever cited

## goal

Give `NEVER-covers` and the `SAFE_DELETE_PATHS:` extension rule actual content,
in the one section core already points at, so that `SAFE_DELETE_PATHS:` — named
by core §3 as one of exactly three channels that can move a §5 AUTH gate — has a
ceiling.

## non-goals

- Changing what the prefix list contains. The twelve prefixes stay as they are.
- Touching core. `spec/CLAUDE.md:136` already delegates correctly, and core has
  60 bytes of headroom; a core edit would owe §0.1 a net-delete.
- Building a hook that enforces any of this. The §5 AUTH layer is self-enforced
  by design (audit round 14 SPEC-H4 recorded that and it is not this change).

## constraints

- **Core byte budget**: core must end at 24940 bytes, unchanged.
- **Extended budget**: 45341 → 46371, leaving 3629 bytes. Within cap.
- **§2.2**: L0–L2 must not load extended, but a targeted Read of a
  core-referenced §EXT section is allowed at any level, and the prefix list this
  sits beside is already extended-only. So the content is reachable where it is
  needed without changing which file an agent loads.
- **Version cascade**: editing `spec/` without a bump makes CI red. Spec
  v6.29.1 → v6.30.0 (minor: rule added, per §EXT §13 META), plugin 0.86.0 →
  0.87.0, six sites.
- **Golden pins**: the two existing whole-line pins that mention
  `SAFE_DELETE_PATHS:` (core §3 User relaxation, §EXT §13 Drift check) are on
  different lines and must stay byte-identical.

## success-criteria

1. `NEVER-covers` and `SAFE_DELETE_PATHS:` resolve to content in §EXT §5-EXT;
   neither points back at core.
2. A new whole-line golden pin covers the ceiling clause — the one that makes a
   project entry covering a NEVER item ignored rather than honoured — and fails
   RED before the text lands.
3. `spec-coherence-audit --strict` reports `unresolvedCount=0` and a Sizing line
   accurate to ±20B.
4. `version-cascade-check` reports v6.30 across 3 files and 0.87.0 across 6 sites.
5. `npm run check` exit 0.
6. Pre-ship review by a fresh subagent with empty context, per §EXT §12
   Author ≠ reviewer; findings repaired before the tag.

## why the NEVER closed set excludes what it excludes

Recorded because the next editor will test the closure against a concrete path.
The six §5 Hard rows left out are NOT left out because they "name no path" — that
reason is false for three of them and falsifies in seconds:

- `auth/payment/crypto` — credential material IS path-shaped and lands in `.cache/`
  and `tmp/` constantly. It is safely excluded because credential material is a
  **secret**, and the secret arm is already in the set: `tmp/stripe-key.json` is
  hard through it. What is left outside the secret arm under this row is auth /
  payment *logic*, and compiled auth logic in `dist/` is regenerable from source —
  `dist/auth.js` is the next path an editor reaches for, so it is answered here.
- `deps add/remove/bump (prod)` — `node_modules/**` is a safe prefix, but the
  manifest is not, and the tree is regenerable.
- `Δ-contract on public API` — `dist/` IS the published artifact, but it is
  regenerable and publishing is gated by §EXT §12.

The "names no path" reason holds as stated only for `cross-module refactor`,
`L3 enter implementation` and `NPX unknown script`.

## open-questions

None outstanding. Three were put to the maintainer before drafting and all three
were approved as proposed: that this is a rule addition (minor, L3) rather than a
clarification; that a bare prefix with no subpath stays hard AUTH even though
`rm -rf dist/` is a common spelling; and that a safe prefix cannot launder a path that is
itself a §5 Hard subject. The wording approved in outline was open-ended; the
shipped clause is a closed set excluding the delete, because the open reading
swallowed the carve-out — pre-ship review H-1, repaired before the tag.

# Change log

- r1 (2026-09-13): drafted from audit round 16 §6.4, approved in outline.
- r2 (2026-09-13): pre-ship review H-1 — the approved NEVER item 5 wording was
  open-ended ("anything §5 Hard names in its own right") and swallowed the
  carve-out it sits inside, since `delete file/dir` is §5 Hard's first item.
  Narrowed to a closed set excluding the delete. Exclusion reasons recorded above
  after the review falsified the first ones. H-2: three further copies of the
  rejected wording (both changelogs and this document's own open-questions)
  repaired.
- r3 (2026-09-13): status approved -> implemented. `spec-status-drift` treats an
  open status with fewer than two `- Produces:` artifacts as unevaluable and
  fails, and it was right to: the work had landed while the frontmatter still
  said approved. Caught only because the gates were re-run AFTER `git add` —
  this file is newly tracked, so `git ls-files` judged a different set before
  and after staging (feedback_rerun_gates_after_git_add).
