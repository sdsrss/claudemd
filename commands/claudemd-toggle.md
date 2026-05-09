---
name: claudemd-toggle
description: Enable or disable a specific claudemd hook (stored as DISABLE_*_HOOK in settings.json env).
---

Usage: `/claudemd-toggle <hook-name>`

Valid hook names: `session-start-check`, `version-sync`, `pre-bash-safety`, `banned-vocab`, `ship-baseline`, `memory-read-check`, `residue-audit`, `sandbox-disposal-check`, `mem-audit`, `session-summary`, `transcript-vocab-scan`, `transcript-structure-scan`.

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/toggle.js $ARGS`

Surface the new state (`enabled` or `disabled`) to the user.
