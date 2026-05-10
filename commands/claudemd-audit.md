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
| `uniqueInvocations` | per-hook dedup view (v0.9.34): `rows` = raw row count; `unique_invocations` = distinct `(ts, hook, session_id, tool_use_id)` quadruples; `duplicate_rows` = rows−unique; `legacy_rows` = rows with both session_id+tool_use_id null (pre-v0.9.33). When `duplicate_rows > 0` and the affected hook is PreToolUse/PostToolUse with non-null `tool_use_id`, that's a true single-invocation double-fire — registration / lib bug |
| `topPatterns` | banned-vocab matched-word ranking |

Format per-hook sections, the bySection heatmap (sorted by total desc), and call out any `byBypass` token with ≥3 occurrences as "review candidate" per §0.1 demotion principle. Surface `uniqueInvocations.<hook>.duplicate_rows > 0` for any PreToolUse/PostToolUse hook as a candidate bug. Treat `bySection['(unset)']` as historical pre-v0.7.0 data (will age out of the window); do not include in the heatmap leader unless the window pre-dates 2026-05-09.
