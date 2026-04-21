---
name: claudemd-audit
description: Aggregate claudemd rule-hits over the last N days. Shows top banned patterns, hook deny counts, and residue warnings.
---

Default window is 30 days. If the user passes a number (e.g. `/claudemd-audit 90`), set `CLAUDEMD_AUDIT_DAYS=$ARGS` before invocation.

Run: `CLAUDEMD_AUDIT_DAYS=${ARGS:-30} node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.js`

Format the JSON into per-hook sections with the top banned-vocab patterns table.
