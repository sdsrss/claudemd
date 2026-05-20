---
name: claudemd-install
description: Bootstrap claudemd in the CURRENT Claude Code session (copy spec into ~/.claude/, install hook manifest, evict legacy entries). Use right after `/plugin install claudemd@claudemd` to skip the wait-for-next-session restart.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/install.js`

This wraps `scripts/install.js` exactly the same way `SessionStart` does on the next session — copies `spec/CLAUDE*.md` + `OPERATOR.md` into `~/.claude/` (backing up any pre-existing files into `~/.claude/backup-<ISO>/`), writes the hook manifest to `~/.claude/.claudemd-manifest.json`, and evicts any legacy claudemd hook entries from `~/.claude/settings.json`. Idempotent — safe to re-run.

Surface the JSON output as a one-line human summary:

- `spec`: `fresh` (no prior files) | `backup-and-overwrite` (existing files moved to `backup-<ISO>/`).
- `backupDir`: path to the backup directory when applicable.
- `userContentDetected: true` — flag this loudly: the existing `~/.claude/CLAUDE.md` did not look like a claudemd spec; the user's hand-written content is in `backupDir/CLAUDE.md`. To bring it back on uninstall, run `CLAUDEMD_SPEC_ACTION=restore /claudemd-uninstall`.
- `entries.length`: number of registered hooks.
- `cachePruned.removed`: list of older cache version dirs reclaimed (best-effort; install succeeds regardless).

**When to use**: right after `/plugin install claudemd@claudemd` so hooks fire in THIS session. Claude Code does not honor `postInstall`, so without this command (or restarting the session) `install.js` runs on the next `SessionStart` and the current session sees `/claudemd-status` reporting `plugin.hint == "cache-present-bootstrap-pending"`.

**Not for routine upgrades** — `/claudemd-update` is the right command for refreshing the spec into `~/.claude/` after a `/plugin marketplace update` + reinstall cycle; that command also diffs first and asks before overwriting.
