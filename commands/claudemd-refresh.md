---
name: claudemd-refresh
description: Update the installed claudemd plugin to the latest release in one step (marketplace update, uninstall, install). Use when the SessionStart banner or /claudemd-doctor reports a newer version; restart Claude Code afterwards.
---

Usage: `/claudemd-refresh`

Run: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-plugin.sh"`

On success, tell the user: **restart Claude Code** (or `/reload-plugins`). Nothing else is needed — the first new session auto-runs `install.js` (SessionStart bootstrap / version-sync hook) to sync `~/.claude` spec + manifest; `/claudemd-install` is NOT part of this flow. Suggest verifying afterwards with `/claudemd-status` (installed == latest).

If the user has **other Claude Code windows open**, tell them to run `/reload-plugins` in each one too. The refresh removes the old versioned plugin-cache dir, but every already-running session pinned its hook paths to that dir at startup — those sessions error on every hook event (claudemd enforcement is absent) until they reload or restart.

If the script fails with `'claude' CLI not found`, have the user paste the manual sequence one line at a time:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```
