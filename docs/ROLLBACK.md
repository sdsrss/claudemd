# Release rollback runbook

The atomic ship pipeline (commit → push → tag → push tag → `gh release create` → CI watch)
can fail at any step, and the two distribution channels are asymmetric: npm publish is
gated by `needs: [test, static]` in `npm-publish.yml` (the full suite on three Linux Node
legs plus one macOS leg, eslint/prettier/metrics, a tag↔package.json version match and a
tag-is-on-`origin/main` ancestry check), while the **marketplace channel serves the pushed
commit immediately — CI validates after the fact**. The v0.58.1 / v0.59.1 macOS hotfixes
are recorded instances of releases crossing that window.

**The marketplace channel still has no gate**, and closing it needs a repo-settings change
this repo cannot make from a file: a ruleset on `main` requiring the `ci` check. Until that
exists, the ship runbook's "wait for the tag's CI to go green before `gh release create`"
step is the only thing standing between a red tag and marketplace consumers — v0.73.0,
v0.74.0 and v0.75.0 all published with their `ci` run red on the macOS leg (Round-14 audit
REL-H2). Per failure point:

## Push landed, CI red, tag NOT pushed
Forward-fix (hotfix commit), or revert **and bump**: `git revert <sha>`, raise the patch
version through all six version sites (`npm run version-check` verifies), commit, tag, push
the tag.

**A bare `git revert <sha> && git push` does not reach anyone who already synced**, which
is what this section claimed until the Round-14 audit (REL-H1). Three mechanisms have to
agree and none of them does after a plain revert:

- `version-sync.sh` compares the plugin-cache version against the installed manifest and
  skips when the cache is *older* ("would downgrade"), so a reverted-but-unbumped tree is
  ignored.
- `install.js` refuses a downgrade outright unless `CLAUDEMD_ALLOW_DOWNGRADE=1`.
- The SessionStart upgrade banner fires on a **newer remote tag**, and a revert produces no
  tag at all.

So the reverted state is invisible to every user already on the bad version; only a version
that is *higher* than the bad one propagates. The version bump is the delivery mechanism,
not bookkeeping.

## Tag pushed, GitHub release missing
Re-run `gh release create vX.Y.Z`. Do NOT delete the tag — npm-publish already fired on
it; deleting the tag desynchronizes npm from git.

## npm published, artifact bad
npm cannot republish a version. `npm deprecate claudemd-cli@X.Y.Z "<reason>; use X.Y.Z+1"`
and ship a patch immediately. Never `npm unpublish` (unavailable outside the 72h window,
and it breaks existing installs).

## Local machine needs the previous version back
`node scripts/install.js` refuses downgrades by design. Escape hatch:
`CLAUDEMD_ALLOW_DOWNGRADE=1 node scripts/install.js` from a checkout of the old tag.

## Before any rollback action
Run `node scripts/status.js` (and `node scripts/doctor.js` — the `hook-drift` and
`spec-cache-drift` checks) to establish the REAL current installed/repo state first.
Do not decide from stale telemetry or memory.

---
*Source of truth for the full ship flow (pre-ship checks, atomic pipeline, post-ship
refresh) is the maintainer's ship-runbook memory; this file carries the rollback half
in-repo so it survives outside that memory layer (2026-08-16 audit PROC-1).*
