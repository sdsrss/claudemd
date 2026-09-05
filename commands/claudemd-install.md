---
name: claudemd-install
description: Bootstrap claudemd in the CURRENT Claude Code session (copy spec into ~/.claude/, install hook manifest, evict legacy entries). Use right after `/plugin install claudemd@claudemd` to skip the wait-for-next-session restart.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/install.js`

This wraps `scripts/install.js` exactly the same way `SessionStart` does on the next session — copies `spec/CLAUDE*.md` + `OPERATOR.md` into `~/.claude/`, writes the hook manifest to `~/.claude/.claudemd-manifest.json`, and evicts any legacy claudemd hook entries from `~/.claude/settings.json`. Idempotent — safe to re-run.

Backup is conditional, not universal: only genuine USER content is moved aside, into `~/.claude/backup-<ISO>/`. An existing `~/.claude/CLAUDE.md` that is already a claudemd spec is overwritten with no backup — that is the v0.23.11 data-loss fix, so the personal backup stays the sole entry in that namespace and `CLAUDEMD_SPEC_ACTION=restore` cannot return a spec instead of the user's own file. Pre-plugin hand-installed hook files go to their own `handhook-backup-<ISO>/` namespace.

Surface the JSON output as a one-line human summary:

- `spec`: `fresh` (no prior files) | `backup-and-overwrite` (existing files moved to `backup-<ISO>/`).
- `backupDir`: path to the backup directory when applicable.
- `userContentDetected: true` — flag this loudly: the existing `~/.claude/CLAUDE.md` did not look like a claudemd spec; the user's hand-written content is in `backupDir/CLAUDE.md`. To bring it back on uninstall, run `CLAUDEMD_SPEC_ACTION=restore /claudemd-uninstall`.
- `entries.length`: number of registered hooks.
- `cachePruned.removed`: list of older cache version dirs reclaimed (best-effort; install succeeds regardless).

**When to use**: right after `/plugin install claudemd@claudemd`, to get the SPEC into `~/.claude/` without waiting for a restart. Claude Code does not honor `postInstall`, so without this command `install.js` first runs on the next `SessionStart`, and until then `/claudemd-status` reports `plugin.hint == "cache-present-bootstrap-pending"`.

What this does **not** gate is hook enforcement. The hooks are registered by the plugin's own `hooks/hooks.json`, which Claude Code loads directly, and every pattern file they match against lives in the plugin root — so all of them are live from the moment the plugin activates, whether or not `install.js` has ever run. (`settings.json` carries no claudemd hook entries at all; the `entries` array this command prints is the manifest's record, not the registration.) What bootstrap delivers is the spec text itself at `~/.claude/CLAUDE.md` — the half of claudemd that works by being read rather than by blocking a tool call. Since v0.75.0 the fresh-install SessionStart runs the bootstrap inline so that file lands before Claude Code assembles context; this command is the way to skip the intervening restart entirely.

**Not for routine upgrades** — `/claudemd-update` is the right command for refreshing the spec into `~/.claude/` after a `/plugin marketplace update` + reinstall cycle; that command also diffs first and asks before overwriting.
