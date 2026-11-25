AUTONOMY_LEVEL: aggressive

Solo OSS maintainer running with `bypassPermissions`. Atomic-ship convention applies (commit + push + tag + push tag + `gh release create` in one turn, except that the turn yields while the pre-tag reviewer runs, per §EXT §12 and runbook step 7) — see `feedback_claudemd_ship_from_main_atomic.md`. `main` is what users install (marketplace auto-update follows it on a version bump; `/claudemd-refresh` installs its HEAD), so a release is built and reviewed on `release/vX.Y.Z` with a draft PR and reaches `main` only together with its tag, and commits that change shipped files (`hooks/`, `spec/`, `commands/`, `scripts/`, `bin/`, `.claude-plugin/`) wait on the `next-release` branch, not on `main`. §5.1 Never-downgrade set binds as written in core §5.1.

Layout (core §2 **Where files go** defers to this): `docs/` and `tasks/` are gitignored; the tracked exceptions are listed in `.gitignore` (reference docs, `tasks/specs/`, evaluation and provenance files). A dated analysis under `docs/` is committed with `git add -f` once shipped text or a tracked document cites it; working notes stay local.

