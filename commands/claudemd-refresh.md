---
name: claudemd-refresh
description: Update the installed claudemd plugin to the latest release in one step (marketplace update, uninstall, install). Use when the SessionStart banner reports a newer version or /claudemd-doctor flags a stale plugin cache; restart Claude Code afterwards.
disable-model-invocation: true
---

Usage: `/claudemd-refresh`

Run: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-plugin.sh"`

On success, tell the user: **restart Claude Code** (or `/reload-plugins`). Nothing else is needed — the first new session auto-runs `install.js` (SessionStart bootstrap / version-sync hook) to sync `~/.claude` spec + manifest; `/claudemd-install` is NOT part of this flow. Suggest verifying afterwards with `/claudemd-status` (installed == latest).

If the user has **other Claude Code windows open**, tell them to run `/reload-plugins` in each one too. The refresh removes the old versioned plugin-cache dir, but every already-running session pinned its hook paths to that dir at startup — those sessions error on every hook event (claudemd enforcement is absent) until they reload or restart.

If the script exits non-zero after its uninstall step succeeded, its stderr says the plugin is NOT installed now: relay that and the reinstall commands it prints — `claude plugin install claudemd@claudemd` in a shell, or `/plugin install claudemd@claudemd` and then `/reload-plugins` inside Claude Code. Do not report the refresh as done.

If the script fails with `'claude' CLI not found`, have the user paste the manual sequence one line at a time:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```
