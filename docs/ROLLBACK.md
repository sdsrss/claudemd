# Release rollback runbook

The atomic ship pipeline (commit → push → tag → push tag → `gh release create` → CI watch)
can fail at any step, and the two distribution channels are asymmetric: npm publish is
gated by `needs: test` in `npm-publish.yml`, while the **marketplace channel serves the
pushed commit immediately — CI validates after the fact** (no branch protection). The
v0.58.1 / v0.59.1 macOS hotfixes are recorded instances of releases crossing that window.
Per failure point:

## Push landed, CI red, tag NOT pushed
Forward-fix (hotfix commit) or `git revert <sha> && git push`. Users who installed from
the bad window get the upgrade banner at their next SessionStart.

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
