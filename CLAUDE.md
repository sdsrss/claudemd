Solo OSS maintainer running with `bypassPermissions`. Ship runbook: memory `feedback_claudemd_ship_from_main_atomic.md` (one turn: commit, push, tag, push tag, `gh release create`; the turn yields only while a pre-tag reviewer runs). `main` is what users install (marketplace auto-update follows it on a version bump; `/claudemd-refresh` installs its HEAD), so commits that change shipped files (`hooks/`, `spec/`, `commands/`, `scripts/`, `bin/`, `.claude-plugin/`) wait on the `next-release` branch, and a release is a draft PR from `next-release` to `main` that reaches `main` only together with its tag.

Hooks are frozen: bug fixes and removals only (`spec/OPERATOR.md` §13.3). A spec rule change needs an outcome run first (`spec/OPERATOR.md` §13.1).

Layout: `docs/` and `tasks/` are gitignored; the tracked exceptions are listed in `.gitignore`. A file is tracked only when shipped text, a script or a test reads it; working notes stay local.
