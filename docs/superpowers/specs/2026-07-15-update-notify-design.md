# Update-refresh UX design — one-command refresh behind the existing upgrade banner

status: approved
revision: 2
date: 2026-07-15
level: L3 (released-artifact user-visible behavior change + LLM-visible command metadata, core spec §2)

## Goal

Cut the plugin update flow from "4 pasted commands + /claudemd-install" to
"one command + restart". Target UX:

```
SessionStart banner: [claudemd] v0.48.0 available (you have v0.47.4). Run /claudemd-refresh, then restart Claude Code.
user: /claudemd-refresh        # runs scripts/refresh-plugin.sh via claude CLI
user: restart Claude Code      # CC platform requirement to load new hook code
(spec/manifest sync then happens automatically via existing hooks)
```

## r2 scope correction (what already exists)

r1 assumed the notify layer had to be built. Verification against source showed
most of the pipeline already ships:

- **Notify**: `hooks/session-start-check.sh` `upstream_check()` (v0.4.0) already
  emits a SessionStart "upgrade available" banner — 24h sentinel throttle
  (`~/.claude/.claudemd-state/upstream-check.lastrun`), `git ls-remote --tags`
  with 3s timeout, fail-open, `DISABLE_UPSTREAM_CHECK=1` kill switch. The
  4-command list the user pastes today IS this banner's current text.
- **Post-refresh sync**: `hooks/version-sync.sh` (UserPromptSubmit) +
  session-start bootstrap already auto-run `install.js` on version mismatch —
  `/claudemd-install` is never needed in the update flow.
- **One-shot refresh**: existed only as a local untracked `update.sh`
  (`.git/info/exclude`), never shipped. User confirmed dropping it (deleted
  2026-07-15) in favor of a shipped equivalent.

Remaining gap = ship the one-command refresh + point all "how to update" copy
at it. No new hook, no new state file, no GitHub API.

## Non-goals

- **No auto-install from hooks.** No background `claude plugin uninstall/install`,
  no tarball self-update into CC's plugin cache. claudemd is marketplace-installed;
  the cache is CC infrastructure. Mutating CC-global plugin state from a hook is
  §5 hard-AUTH-class action performed silently, plus a concurrent-session race.
  (The `plugin-auto-update` skill's downloadAndInstall pattern targets
  install.mjs-distributed plugins, not marketplace ones — per its own notes.)
- No new SessionStart hook and no GitHub Releases API — `upstream_check()`
  already covers detection via `git ls-remote`.
- No change to the release pipeline / marketplace layout.

## Design

### 1. New shipped script `scripts/refresh-plugin.sh`

Tracked, tested replacement for the local `update.sh`: `claude plugin
marketplace update claudemd` → `claude plugin uninstall claudemd@claudemd -y`
→ `claude plugin install claudemd@claudemd`, `set -euo pipefail` so a failed
step stops the pipeline. Loud failure when the `claude` CLI is not on PATH.

### 2. New command `commands/claudemd-refresh.md`

Thin wrapper: run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-plugin.sh"`,
then tell the user to restart (or `/reload-plugins`); spec+manifest sync is
automatic afterwards. Includes the manual 4-command fallback for machines
without the `claude` CLI on PATH.

### 3. Banner + message copy sweep (parallel-path completeness, §9)

Every site that teaches the 4-command sequence points to `/claudemd-refresh`
first (manual sequence stays documented in README as fallback):

- `hooks/session-start-check.sh:182` upstream banner → "Run /claudemd-refresh,
  then restart Claude Code."
- `hooks/session-start-check.sh:258` stale-registration banner Fix line.
- `commands/claudemd-update.md` canonical-refresh block.
- `scripts/install.js:85` refusing-downgrade message.
- `scripts/doctor.js:100` staleness fix + `:161` hook-drift fix (keep
  `/reload-plugins` wording — `tests/scripts/doctor.test.js:51` pins it).
- `README.md`: feature-table count (15 → 16 slash commands), commands table row,
  §Project layout commands count (pinned by `readme-drift.test.js`), Update
  section lead, `/plugin update` troubleshooting entry.

## Constraints

- Tests hermetic: no real network, no real `~/.claude`, no real `claude` CLI —
  PATH shim + `CLAUDEMD_LS_REMOTE_CMD`/`CLAUDEMD_CACHE_PARENT` overrides
  (existing pattern in `tests/hooks/session-start.test.sh`).
- Controls-first harness (feedback_probe_harness_controls_first): refresh-script
  test opens with two cases that must produce opposite outcomes.
- No new `~/.claude` writes (existing sentinel reused) → no uninstall.js change.
- Released-artifact checklist (§EXT §2-EXT): minor bump 0.48.0; CHANGELOG note
  at top; opt-out unchanged (`DISABLE_UPSTREAM_CHECK=1`); the banner itself is
  the discoverability signal.

## Success criteria

1. Mocked newer remote tag → SessionStart banner names both versions and
   `/claudemd-refresh` (Case 8 updated, RED→GREEN).
2. Stale-registration banner names `/claudemd-refresh` (Case 18 extended).
3. `refresh-plugin.sh` with success shim: exactly 3 `claude plugin` calls in
   order, exit 0. With step-1-failing shim: non-zero exit, no uninstall call.
   Without `claude` on PATH: exit 1 + stderr message.
4. `npm test` green including drift suites (readme-drift, help-discoverability).
5. On this machine post-release: `/claudemd-refresh` + restart →
   `node scripts/status.js` shows installed == repo.

## Open questions

- None blocking. Deferred: `skipVersion` (ignore a specific release) — YAGNI.

## Change log

- r2 (2026-07-15): scope corrected after source verification — notify layer
  already shipped (v0.4.0 `upstream_check`); design shrinks to shipped refresh
  script + command + copy sweep. Local `update.sh` deleted per user.
- r1 (2026-07-15): initial approved design (notify-only tier chosen over
  background pre-pull and docs-only status quo).
