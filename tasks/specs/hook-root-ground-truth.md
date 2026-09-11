---
status: implemented
revision: 3
---

# Hook-fired plugin root as ground truth

**Implemented, pending release.** The work is complete and committed on
`worktree-hook-root-ground-truth`; nothing is pushed, tagged or released, and the
version sites carry 0.85.0 as a release candidate rather than a shipped artifact.
Tasks 1-4 landed the basis in `3715e73`, `b856276`, `f1d3cab`, `ccc72f1`,
`85eaeec`, `10a1dd9`, `083577d` and `f3354cb`; Task 5 — the `ADVISORY` flip, the
six-site version cascade, the CHANGELOG entry and the tracking of this file — is
the commit at the head of that branch. All seven success criteria were met;
criterion 7's `npm run check` re-run on the committed tree is what caught this
header's absence, because the gate below reads TRACKED specs and this file was
untracked until that commit.

## Goal

Give `doctor` a measured answer to "which directory did Claude Code actually load
this plugin from", so `hook-drift` stops asking a question it cannot scope and can
move the exit code again.

## Background (verified 2026-09-11, not recalled)

- `scripts/doctor.js:79` — `PLUGIN_ROOT` is doctor's own tree, from `import.meta.url`.
- `scripts/doctor.js:513-534` — `hook-drift` is `compareHooks(PLUGIN_ROOT, ACTIVE.root)`.
- `scripts/doctor.js:163-164` — `ADVISORY` carries `hook-drift`; `isAdvisoryCheck` is exported.
- `scripts/lib/paths.js:310-395` — `activePluginRoot()` resolves, in order:
  `installed_plugins.json` (constrained to this home's cache) → newest versioned
  cache dir → marketplace clone → `none`. **Every branch resolves a cache path.**
- `scripts/doctor.js:498-507` records the measurement that `CLAUDE_PLUGIN_ROOT` is
  not a usable discriminator: CC expands the token textually into the command
  string and exports nothing (`process.env.CLAUDE_PLUGIN_ROOT` undefined,
  `env | grep -c CLAUDE_PLUGIN` = 0 in a live session).
- `hooks/session-start-check.sh:68` — `PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`,
  resolved **after** the `source == "compact"` early exit at line 63.
- 16 hook scripts resolve their own root from `BASH_SOURCE`.
- `hooks/lib/hook-common.sh:244,393` — existing `.claudemd-state` write helpers
  (`hook_record_failopen`, `hook_install_sentinel_write`) establish the idiom.
- **`ACTIVE` has five consumers, not one** (rev 2, found in the pre-flight scan):
  `scripts/doctor.js:236` (`readPluginVersion`), `:468-473` (`registeredVer` +
  `staleRegistration`, which gates on `inCache(ACTIVE.root)`), `:515-531`
  (`hook-drift`), `:554` (`hook-drift:upstream`'s left argument). Repointing the
  shared const would put a non-cache path through `inCache()` and permanently
  retire the `plugin-root:stale-registration` row.
- **The self-compare skip already exists** (rev 2): `scripts/lib/install-drift.js:44`
  returns `{skipped:true, skippedReason:'self-compare'}` when both roots
  `realpathSync` to the same directory, and `tests/scripts/doctor.test.js:1548`
  already depends on it. Feeding `compareHooks` the right root is the whole
  change — the skip is emergent, and a second lexical copy in `doctor.js` would
  duplicate a rule and mis-handle symlinks.

### The three callers the row cannot currently separate

| Caller | `PLUGIN_ROOT` | `ACTIVE.root` | Today's row |
|---|---|---|---|
| Maintainer checkout + separate install | checkout | cache install | real signal |
| Ordinary marketplace install | cache install | same cache install | self-compare, always green, says nothing |
| In-place load (`--plugin-dir`, skills-dir, synced) | the loaded dir | an unrelated leftover cache dir, or none | wrong, permanently |

Row 3 is why 0.84.1 made the row advisory. It is a defect in the *basis*, not in
the comparison.

## Non-goals

- Changing what `compareHooks` compares, or the `hook-drift:upstream` axis.
- Making `hook-drift:upstream` counted — its red is a legitimate steady state
  between releases (`scripts/doctor.js:126-139`), and that reasoning is unaffected.
- Using process ancestry. Already considered and rejected in 0.84.0: it is
  `/proc`-shaped, sees only `--plugin-dir`, and the probe matched its own command line.
- Reviving `.claudemd-manifest.json.pluginRoot` as the answer. It is written only
  when `install.js` runs, so it goes stale on a same-version move between a cache
  install and a dev tree — the exact case that needs the answer.

## Constraints

- **bash 3.2** (macOS floor). `tests/lib/bash32-*.sh` gate the hooks; no bash 4+ constructs.
- **Hook budget**: `tests/hooks/hook-budget.test.sh` bounds blocking-path cost. The
  writer must not land on `pre-bash-safety-check.sh` or any other blocking hook.
- **Fail-open**: a hook that cannot write the record exits 0 and records nothing.
  An absent record must degrade to today's `activePluginRoot()` behaviour, not to an error.
- **§8**: no unvalidated `rm -rf $VAR`; state writes go through `mkdir -p` + a
  charset-constrained value, matching `hook_install_sentinel_write`.
- `~/.claude/` write → core §7 residue count is owed in the report.
- New state file must survive as a **persistent** record, so the `state-dir-orphans`
  row and `/claudemd-clean-residue` must not reap it as a per-session sentinel.
- **Do not repoint the shared `ACTIVE` const** (rev 2). Add a second const for the
  running-root question and leave the cache-registration rows reading the cache.
- Released-artifact checklist (§EXT §2-EXT) applies to the advisory flip: minor
  bump, CHANGELOG migration note, revert path, one-time discoverability signal.

## Design

`~/.claude/.claudemd-state/hook-root.json`:

```json
{"root":"/abs/path/to/loaded/plugin","ts":"2026-09-11T04:00:00Z","version":"0.84.1","sid":"<session-id>"}
```

Written unconditionally by `hooks/session-start-check.sh` (moved above the compact
early exit) and `hooks/session-end-check.sh`, both non-blocking. Rewritten on every
write — that is what keeps it from going stale the way the manifest's `pluginRoot`
does. Rev 2 correction: an earlier draft of this line said "at most twice per
session", which is a floor rather than a ceiling — SessionStart can fire more than
once for one session id (resume, clear). The count was never load-bearing; the
writers are.

`runningPluginRoot()` in `scripts/lib/paths.js`: read the record; if `root` parses
and still exists on disk, return `{root, source:'hook-fired', ts, sid}`; otherwise
fall through to `activePluginRoot()` unchanged.

`hook-drift` then becomes:

- `PLUGIN_ROOT === RUNNING.root` → `skipped (self-compare)`. Covers callers 2 and 3.
- otherwise → compare and **count**. This is caller 1, the row's actual subject.

## Success criteria

1. A sandbox `HOME` where hooks fire from root A while `installed_plugins.json`
   names cache root B: `hook-root.json` records A, and doctor's `hook-drift` row
   names A as the running root. Today it names B.
2. In-place shape (doctor's own tree == the hook-fired root, with an unrelated
   leftover cache dir present): row reports `skipped (self-compare)` and does not
   move the exit code. Today it compares against the leftover dir.
3. Maintainer shape (checkout ≠ hook-fired root, hooks differ): row is red **and
   moves the exit code** — verified by `$?`, not by reading the row.
4. No `hook-root.json` present (fresh install, hooks never fired, SessionStart
   disabled): every row behaves exactly as on v0.84.1. Pinned by a test that
   deletes the record.
5. `state-dir-orphans` does not count the record; `/claudemd-clean-residue --apply`
   does not delete it; `CLAUDEMD_PURGE=1` uninstall does.
6. `hook-drift:upstream`, `spec-cache-drift` and `plugin cache:staleness` produce
   byte-identical detail strings on a fixture where the record is absent.
7. `npm run check` exit 0, read from `$?`. Baseline for this change: exit 0, all
   suites passed, 2026-09-11.

## Open questions

- **Concurrent sessions from different roots** (a maintainer dev-tree session
  beside an ordinary one): last writer wins, so doctor answers "whichever fired
  most recently". The row will name `ts` and `sid` so the reader can see which
  session it came from. Not solved, and stated rather than hidden.
- ~~Should `hook-drift` counted-ness be gated behind an env kill switch
  (`DISABLE_HOOK_DRIFT_EXIT`)? §EXT §2-EXT wants an opt-out path for a
  user-visible default change; a marketplace pin may be enough, since the flip
  only reaches maintainers by construction. Decide before the flip task.~~
  **Resolved before Task 5: no kill switch.** After Task 3 the row skips for
  every caller but a maintainer checkout, so the flip has no ordinary install to
  reach and a switch nobody can need would rot unexercised. Recorded in the
  0.85.0 CHANGELOG entry rather than left implicit. One correction to the
  reasoning above, found while writing that entry: `docs/ROLLBACK.md` does **not**
  document a marketplace pin — its way-back section is
  `CLAUDEMD_ALLOW_DOWNGRADE=1 node scripts/install.js` from a checkout of the old
  tag, and that is what the entry names. Earlier CHANGELOG entries (0.84.0,
  0.84.1) point at a pin procedure that file has never carried.

# Change log

- rev 1 (2026-09-11): initial draft. Facts verified against the tree at `86f49cd`.
- rev 2 (2026-09-11): pre-flight scan, before any dispatch. Two facts added to
  Background and one to Constraints. Neither goal nor success criteria changed —
  criterion 6's "on a fixture where the record is absent" qualifier already made
  it true under the narrowed design, because an absent record falls through to
  `activePluginRoot()`. `hook-drift:upstream` moves from the "prove unchanged"
  list to "deliberately repointed", which is a plan-level move, not a criterion
  change: the criterion only ever claimed the no-record case.
- rev 3 (2026-09-11): status → implemented on the Task 5 commit. The
  kill-switch open question is resolved in place (no switch) rather than deleted,
  and the `docs/ROLLBACK.md` correction is recorded beside it.
