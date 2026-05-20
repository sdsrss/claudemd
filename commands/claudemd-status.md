---
name: claudemd-status
description: Show claudemd plugin version, installed spec version, kill-switch state, and rule-hits summary. Pass --verbose for full kill-switch + escape-token reference.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js` (no flag) for the default summary, or `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js --verbose` when the user wants the full kill-switch + escape-token table.

Surface the JSON output as a human-readable summary.

- If `plugin.installed` is `false` and `plugin.hint == "cache-present-bootstrap-pending"`: tell the user the plugin is staged on disk (list `plugin.cacheVersions`) but `install.js` has not run yet — Claude Code does not fire `postInstall`, so either start a fresh Claude Code session (the `SessionStart` hook bootstraps it) or run `node ~/.claude/plugins/cache/claudemd/claudemd/<latest-version>/scripts/install.js` now.
- If `plugin.installed` is `false` and no hint is set: suggest `/plugin marketplace add sdsrss/claudemd` followed by `/plugin install claudemd@claudemd`.
- When `--verbose` is passed: the JSON includes a `verbose` block with `verbose.killSwitches.perHook` (env var name + event + effective vs persisted state for every shipped hook) and `verbose.escapeTokens` (the 5 per-invocation bypass tokens with their target hook + spec section). Use this when the user asks "which env var disables hook X" or "what's the bypass token for §Y" without having them grep README.
