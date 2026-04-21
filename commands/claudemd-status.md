---
name: claudemd-status
description: Show claudemd plugin version, installed spec version, kill-switch state, and rule-hits summary.
---

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/status.js`

Surface the JSON output as a human-readable summary. If the `plugin.installed` field is false, suggest `/plugin install claudemd@claudemd` to the user.
