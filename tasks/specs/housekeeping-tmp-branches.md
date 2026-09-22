---
status: implemented
revision: 2
---

# Housekeeping hooks: vitest tmp sweep + merged-branch prune

## goal

Two leak classes accumulate across every project a user works in, and nothing
in the plugin reclaims them:

1. **vitest tmp dirs.** vitest 5.0.0 creates `join(os.tmpdir(), nanoid())` on the
   root `Vitest` object and never removes it (only the per-project tmpDir is
   `rm`'d, in `close()`, which a killed run never reaches). One
   `/tmp/<21-char id>/ssr/<sha1>` tree per run, 13-45 MB each. On Ubuntu 26.04
   `/tmp` is a RAM-backed tmpfs (50% of RAM), so the leak is unreclaimable
   memory. Measured 2026-09-22: real ENOSPC on 2026-09-07 and 2026-09-08, and
   a manual clean of 627 dirs that regrew by 39 in ~5 hours.
2. **Merged local branches.** Branches whose content is already on the default
   branch stay forever — including `worktree-agent-*` branches left by Claude
   Code's worktree isolation (8 across two repos on 2026-09-22).

## non-goals

- Fixing vitest itself, or setting TMPDIR for the user (per-project `test`
  scripts own that; the sweep covers whichever root they chose).
- Deleting remote branches (GitHub `delete_branch_on_merge` is the platform's
  switch) or running any network git command from a hook.
- Deleting anything whose ownership cannot be proven from its shape.

## constraints

- Both hooks: PostToolUse, matcher `Bash`, fail-open, one kill switch each
  (`DISABLE_TMP_SWEEP_HOOK`, `DISABLE_BRANCH_PRUNE_HOOK`), registered in
  `scripts/lib/hook-registry.js`.
- tmp-sweep deletes ONLY: a directory named `^[A-Za-z0-9_-]{21}$`, owned by
  the current uid, not a symlink, whose children are a non-empty subset of
  `{ssr, client}` (real dirs), whose grandchildren are all regular files named
  `^[0-9a-f]{40}$`, and whose newest mtime is older than the age floor (60
  min; 24 h while a vitest watch-mode process of this uid is alive). Roots:
  `$TMPDIR`, `/tmp`, `~/.cache/tmp`, de-duplicated. Runs detached; rate-limited
  to once per 10 minutes by a stamp file.
- branch-prune fires only on commands naming `git merge|pull|fetch|push` or
  `gh pr merge`; local git only. Candidates exclude the default branch and
  every branch checked out in any worktree. Deletes a branch when its content
  is on the default branch (local or `origin/<default>`): tip is an ancestor,
  or the branch's squashed diff is patch-equivalent to a commit there. An
  ancestor branch that never moved since creation (reflog of one entry) is
  reported, not deleted — it may be a branch someone is about to start —
  except `worktree-agent-*`, which the harness names and no person reuses.
  Every deletion prints the SHA so `git branch <name> <sha>` restores it.

## success-criteria

- `tests/scripts/housekeeping.test.js`: signature positive + each negative
  (wrong name, symlink, extra child, non-hex file, too young, nested dir),
  watch-mode floor, branch classes (ancestor-moved, ancestor-fresh,
  worktree-agent fresh, squash-merged, unmerged, checked-out-in-worktree).
- Hook tests: fast path silent, kill switch, rate limit, trigger match.
- `npm run check` exit 0; hook-registry / kill-switch-doc drift tests green.

## open-questions

- None blocking. Whether to promote the `/tmp` usage advisory into a deny is
  a §13.3 decision for later audit data.

# Change log

- r1 2026-09-22: initial, approved by user in-session ("确认授权").
- r2 2026-09-22: implemented in 0.93.0 (scripts/housekeeping.js, hooks/tmp-sweep.sh, hooks/branch-prune.sh).
