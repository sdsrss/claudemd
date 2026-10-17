# Release rollback runbook

The atomic ship pipeline (commit → push → tag → push tag → `gh release create` → CI watch)
can fail at any step, and the two distribution channels are asymmetric: npm publish is
gated by `needs: [test, static]` in `npm-publish.yml` (the full suite on three Linux Node
legs plus one macOS leg, eslint/prettier/metrics, a tag↔package.json version match and a
tag-is-on-`origin/main` ancestry check), while the **marketplace channel serves the pushed
commit immediately — CI validates after the fact**. The v0.58.1 / v0.59.1 macOS hotfixes
are recorded instances of releases crossing that window.

**The marketplace channel still has no *green-CI* gate**, and by design will not get one.
Two rulesets were added on 2026-09-07 (`gh api repos/sdsrss/claudemd/rulesets` to see them):
`main-integrity` blocks `deletion` and `non_fast_forward` on the default branch, and
`release-tags-immutable` blocks `deletion`, `non_fast_forward` and `update` on `refs/tags/v*`.
The rule names are GitHub's own, spelled as the API spells them, because
`tests/scripts/contributing-rollback-drift.test.js` joins this sentence to
`.github/rulesets.expected.json` — a doc that keeps the ruleset name and quietly drops a
rule from the list is the half-updated shape that join exists to catch.
Both are ref-integrity rules. Neither requires a status check, because GitHub applies
required checks to direct pushes as well, a just-written commit has no check run yet, and
the only account with write access here is the maintainer's — so that rule would not stop
an outside contributor (there are none with push rights), it would end the atomic ship
pipeline and replace it with a PR round-trip.
Nothing stands between a red tag and marketplace consumers, and no release-time step could: pushing the tag IS the marketplace publish.
`hooks/session-start-check.sh` polls `git ls-remote` for the newest upstream tag and banners
it, so a consumer sees the new version the moment the ref lands, whatever `gh release create`
does afterwards. Measured over the last 8 releases: each was published 15-89 s after its own
tag object, while that tag's `ci` run took 10-13 minutes (v0.91.0 — tag 06:54:45Z, release
06:55:14Z, `ci` green 07:07:07Z). The gates that do exist are the runbook's own and both sit
BEFORE the tag: the main-branch CI wait and the pre-tag review, each self-imposed and neither
mechanically enforced. That nothing enforces anything AFTER the tag is not hypothetical:
v0.73.0, v0.74.0 and v0.75.0 all published with their own tag's `ci` run red on the macOS leg
(Round-14 audit REL-H2). What the tag ruleset does buy: a
pushed release tag can no longer be moved or deleted, so the same version string cannot
later serve different code to marketplace consumers. Per failure point:

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
Two things go back, in this order: the plugin Claude Code loads, then the spec in
`~/.claude`. While Claude Code still loads the newer plugin, its SessionStart installs the
newer spec again at the next session start (and an older plugin over a newer spec banners
a stale registration that sends the user to `/claudemd-refresh`). Close every other Claude
Code window before you start: a window still open runs the newer hooks, and its next
prompt installs the newer spec again.

1. Pin the marketplace to the old tag. A GitHub marketplace takes `#<tag>` after the
   repository. Remove the old entry first: Claude Code can refuse to add `claudemd` again
   from a different source while it exists ("its source doesn't match its
   extraKnownMarketplaces entry" for the GitHub entry), and removing it uninstalls the
   plugin. From a shell:

   ```
   claude plugin marketplace remove claudemd
   claude plugin marketplace add sdsrss/claudemd#vX.Y.Z
   claude plugin install claudemd@claudemd
   ```

   A pinned marketplace stays on its tag: `/claudemd-refresh` reinstalls vX.Y.Z, not `main`.
2. Install that version's spec over the newer one. `install.js` refuses downgrades by
   design; the escape hatch is `CLAUDEMD_ALLOW_DOWNGRADE=1`, run from the plugin cache step 1
   filled (or a checkout of the old tag):
   `CLAUDEMD_ALLOW_DOWNGRADE=1 node ~/.claude/plugins/cache/claudemd/claudemd/X.Y.Z/scripts/install.js`.
3. Restart Claude Code.

While the marketplace is pinned, a session start shows a banner that says to run
`/claudemd-refresh`: "stale plugin registration … the marketplace cache holds vNEWER" at
every session start while the newer version's cache directory stays on disk (Claude Code
marks it orphaned and removes it later), then "vNEWER available" once a day.
`/claudemd-refresh` reinstalls the pinned version, so it clears neither.
`DISABLE_UPSTREAM_CHECK=1` in the `env` block of `~/.claude/settings.json` turns both off;
take it out when you go back.

Back to the newest release: the same three `claude plugin` commands with
`sdsrss/claudemd` and no tag, then restart; the next session start installs the newer spec
itself, since that is an upgrade. All of this was run on Claude Code 2.1.302 with `HOME`
pointed at a scratch directory (2026-10-17): v0.112.0 and then v0.111.0 installed from a
pinned marketplace, the add without the remove was refused ("its source doesn't match its
extraKnownMarketplaces entry"), the downgrade install exited 1 without the flag and 0 with
it, and the unpinned add brought back the newest release.

From 0.101.0 (spec v7.0.0) back to 0.100.0: the older installer does not know
`~/.claude/spec-modules/`, so it restores the v6.35.0 core and extended and leaves that
directory in place. No 0.100.0 hook reads it and the v6.35.0 core does not name it; remove
it with `rm -r ~/.claude/spec-modules` if you want it gone. To keep 0.101.0 and only stop
the injection, set `DISABLE_SPEC_MODULE_INJECT_HOOK=1` instead.

## Before any rollback action
Run `node scripts/status.js` (and `node scripts/doctor.js` — the `hook-drift` and
`spec-cache-drift` checks) to establish the REAL current installed/repo state first.
Do not decide from stale telemetry or memory.

---
*Source of truth for the full ship flow (pre-ship checks, atomic pipeline, post-ship
refresh) is the maintainer's ship-runbook memory; this file carries the rollback half
in-repo so it survives outside that memory layer (2026-08-16 audit PROC-1).*
