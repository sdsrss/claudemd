---
name: claudemd-toggle
description: Enable or disable a specific claudemd hook (stored as DISABLE_*_HOOK in settings.json env).
disable-model-invocation: true
---

Usage: `/claudemd-toggle <hook-name>`

Valid hook names: `session-start-check`, `version-sync`, `spec-module-inject`, `pre-bash-safety`, `banned-vocab`, `ship-baseline`, `memory-read-check`, `sandbox-disposal-check`, `reply-language`, `memory-index-lines`, `tmp-sweep`, `session-end-check`.

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/toggle.js $ARGUMENTS`

Surface the new state (`enabled` or `disabled`) to the user, and the `note` when the output has one: an opt-in hook stays inactive until its opt-in variable is set, whatever the toggle says.
