---
name: claudemd-status
description: Show claudemd plugin version, installed spec version, kill-switch state, and rule-hits summary. Pass --verbose for full kill-switch + escape-token reference.
disable-model-invocation: true
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js` (no flag) for the default summary, or `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js --verbose` when the user wants the full kill-switch + escape-token table.

Surface the JSON output as a human-readable summary.

- If `plugin.installed` is `false` and `plugin.hint == "cache-present-bootstrap-pending"`: tell the user the plugin is staged on disk (list `plugin.cacheVersions`) but `install.js` has not run yet — Claude Code does not fire `postInstall`, so either start a fresh Claude Code session (the `SessionStart` hook bootstraps it) or run `node ~/.claude/plugins/cache/claudemd/claudemd/<latest-version>/scripts/install.js` now.
- If `plugin.installed` is `false` and no hint is set: suggest `/plugin marketplace add sdsrss/claudemd` followed by `/plugin install claudemd@claudemd`.
- If `plugin.manifestError` is `unparseable`: an install manifest is on disk but could not be read. Relay `plugin.detail`, which names `/claudemd-install` as the fix, and do not suggest `/plugin install`. `plugin.hint` is `manifest-unparseable` unless the cache hint above applies, which keeps its own hint and `cacheVersions`; then give both.
- If `settings.settingsError` is `unparseable`: `settings.settingsPath` (the user `settings.json`) is on disk but is not valid JSON, so the kill switches it sets are left out of `pendingKillSwitches` and the `persisted` values. Relay `settings.detail` and do not describe the kill-switch state as complete.
- When `--verbose` is passed: the JSON includes a `verbose` block with `verbose.killSwitches.perHook` (env var name + event, `alsoOn` for the other events a hook is registered on, + effective vs persisted state for every shipped hook), `verbose.killSwitches.subFeature` (toggles that silence one feature of a hook without disabling the hook), and `verbose.escapeTokens` (every per-invocation bypass token with its target hook + spec section — read the count off the list rather than quoting one here). Use this when the user asks "which env var disables hook X" or "what's the bypass token for §Y" without having them grep README.
