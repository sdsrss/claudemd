---
name: claudemd-refresh
description: Refresh the installed claudemd plugin to the latest released version in one shot (marketplace update → uninstall → install via the claude CLI). Use when the SessionStart banner reports a newer version, or /claudemd-doctor flags a stale plugin cache. Restart Claude Code afterwards — spec + manifest then sync automatically.
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
