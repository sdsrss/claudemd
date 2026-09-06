---
name: claudemd-uninstall
description: Pre-uninstall cleanup. Run BEFORE `/plugin uninstall claudemd@claudemd` to clear the plugin manifest and legacy settings.json hook entries. Spec files in ~/.claude/ are kept by default, and so are the state dir + rule-hits log unless CLAUDEMD_PURGE=1 is passed. Required because Claude Code's marketplace lifecycle does not fire `preUninstall`, so without this step `/plugin uninstall` leaves orphan state behind.
---

Usage:

- Default (keep spec, keep state + log):
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`

- Also drop `~/.claude/.claudemd-state/` and the rule-hits log — opt-in, and NOT recoverable (the log is the §13.1 demote-review corpus):
  `CLAUDEMD_PURGE=1 node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`

- Restore your pre-claudemd `~/.claude/CLAUDE*.md` from the most recent backup:
  `CLAUDEMD_SPEC_ACTION=restore node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`
  This restores; it does not remove. `CLAUDE-extended.md`, `CLAUDE-changelog.md` and `OPERATOR.md` — spec files claudemd added that you never had — are left in place, because removing spec files is `CLAUDEMD_SPEC_ACTION=delete` and that path is gated behind `CLAUDEMD_CONFIRM=1`. Claude Code does not auto-load those three, so they are inert; delete them by hand if you want them gone.

- Full removal (delete spec files; requires hard-AUTH confirm):
  `CLAUDEMD_SPEC_ACTION=delete CLAUDEMD_CONFIRM=1 node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`

After this command finishes, run `/plugin uninstall claudemd@claudemd` to remove the plugin cache itself.

**Two-step rationale**: `${CLAUDE_PLUGIN_ROOT}` and `scripts/uninstall.js` only exist while the plugin is still installed. `/plugin uninstall` deletes them along with the cache, so the cleanup MUST run first. Reversing the order leaves the manifest, `~/.claude/.claudemd-state/`, and `~/.claude/logs/claudemd.jsonl` orphaned with no in-tree tool to remove them.

**Note**: hooks remain registered until you also run `/plugin uninstall`. This command only clears the user-global state; the plugin's `hooks/hooks.json` is the authoritative registration site, removed when the cache is deleted.

Surface the script's JSON output to the user: `specAction`, plus — when present — `warning` (`already-uninstalled` or `restore-empty`), `settingsWarning`, and a `statusline.action` of `error`. On a restore, `restored` lists the files actually copied back; `warning: "restore-empty"` means that list is empty and the spec files are still in place — report that as a FAILED restore and point at `ls -l` on the backup dir, because `specAction: "restore"` is printed either way. The last two mean `~/.claude/settings.json` could not be parsed, so anything claudemd owns inside that file (legacy hook entries, the statusLine) was left in place: say so and tell the user to fix the JSON and re-run. `specAction: "keep"` on its own does NOT mean the uninstall was complete.
