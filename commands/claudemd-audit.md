---
name: claudemd-audit
description: Aggregate claudemd rule-hits over the last N days. Shows top banned patterns, hook deny counts, per-spec-section heatmap, and bypass-escape-hatch usage.
---

Default window is 30 days. If the user passes a number (e.g. `/claudemd-audit 90`), set `CLAUDEMD_AUDIT_DAYS=$ARGS` before invocation.

Run: `CLAUDEMD_AUDIT_DAYS=${ARGS:-30} node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.js`

The JSON contains:

| Field | Meaning |
|---|---|
| `byHook` | per-hook total + event breakdown — answers "which hook is firing" |
| `bySection` | per-spec-section total + event/hook breakdown — answers "which spec rule is firing" (drives §0.1/§13.1/§13.2 promotion/demotion accounting; rows written before v0.7.0 land under `(unset)`) |
| `byBypass` | per-token bypass-escape-hatch usage — high counts signal a rule that's too strict and is being routinely overridden |
| `topPatterns` | banned-vocab matched-word ranking |

Format per-hook sections, the bySection heatmap (sorted by total desc), and call out any `byBypass` token with ≥3 occurrences as "review candidate" per §0.1 demotion principle.
