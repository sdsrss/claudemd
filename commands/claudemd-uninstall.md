---
name: claudemd-uninstall
description: Pre-uninstall cleanup. Run BEFORE `/plugin uninstall claudemd@claudemd` to clear the plugin manifest, state dir, and rule-hits log. Spec files in ~/.claude/ are kept by default. Required because Claude Code's marketplace lifecycle does not fire `preUninstall`, so without this step `/plugin uninstall` leaves orphan state behind.
---

Usage:

- Default (keep spec, drop state + log):
  `CLAUDEMD_PURGE=1 node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`

- Restore your pre-claudemd `~/.claude/CLAUDE*.md` from the most recent backup:
  `CLAUDEMD_SPEC_ACTION=restore CLAUDEMD_PURGE=1 node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`

- Full removal (delete spec files; requires hard-AUTH confirm):
  `CLAUDEMD_SPEC_ACTION=delete CLAUDEMD_CONFIRM=1 CLAUDEMD_PURGE=1 node ${CLAUDE_PLUGIN_ROOT}/scripts/uninstall.js`

After this command finishes, run `/plugin uninstall claudemd@claudemd` to remove the plugin cache itself.

**Two-step rationale**: `${CLAUDE_PLUGIN_ROOT}` and `scripts/uninstall.js` only exist while the plugin is still installed. `/plugin uninstall` deletes them along with the cache, so the cleanup MUST run first. Reversing the order leaves the manifest, `~/.claude/.claudemd-state/`, and `~/.claude/logs/claudemd.jsonl` orphaned with no in-tree tool to remove them.

**Note**: hooks remain registered until you also run `/plugin uninstall`. This command only clears the user-global state; the plugin's `hooks/hooks.json` is the authoritative registration site, removed when the cache is deleted.

Surface the script's JSON output (specAction, optional warning) to the user.
