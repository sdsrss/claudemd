---
name: claudemd-toggle
description: Enable or disable a specific claudemd hook (stored as DISABLE_*_HOOK in settings.json env).
---

Usage: `/claudemd-toggle <hook-name>`

Valid hook names: `banned-vocab`, `pre-bash-safety`, `ship-baseline`, `residue-audit`, `memory-read-check`, `sandbox-disposal-check`, `session-start-check`, `version-sync`.

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/toggle.js $ARGS`

Surface the new state (`enabled` or `disabled`) to the user.
