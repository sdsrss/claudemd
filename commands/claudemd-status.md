---
name: claudemd-status
description: Show claudemd plugin version, installed spec version, kill-switch state, and rule-hits summary.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js`

Surface the JSON output as a human-readable summary.

- If `plugin.installed` is `false` and `plugin.hint == "cache-present-bootstrap-pending"`: tell the user the plugin is staged on disk (list `plugin.cacheVersions`) but `install.js` has not run yet — Claude Code does not fire `postInstall`, so either start a fresh Claude Code session (the `SessionStart` hook bootstraps it) or run `node ~/.claude/plugins/cache/claudemd/claudemd/<latest-version>/scripts/install.js` now.
- If `plugin.installed` is `false` and no hint is set: suggest `/plugin marketplace add sdsrss/claudemd` followed by `/plugin install claudemd@claudemd`.
