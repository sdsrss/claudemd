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
| `bySection` | per-spec-section total + event/hook breakdown — answers "which spec rule is firing" (drives §0.1/§13.1/§13.2 promotion/demotion accounting). Null-section rows split by cutoverTs (v0.9.37): `(unset-historical)` = pre-v0.7.0 legacy (will age out), `(unset-current)` = post-cutover null-section (mix of intentional housekeeping events + instrumentation gaps). |
| `byBypass` | per-token bypass-escape-hatch usage — high counts signal a rule that's too strict and is being routinely overridden |
| `uniqueInvocations` | per-hook dedup view (v0.9.34): `rows` = raw row count; `unique_invocations` = distinct `(ts, hook, session_id, tool_use_id)` quadruples; `duplicate_rows` = rows−unique; `legacy_rows` = rows with both session_id+tool_use_id null (pre-v0.9.33). When `duplicate_rows > 0` and the affected hook is PreToolUse/PostToolUse with non-null `tool_use_id`, that's a true single-invocation double-fire — registration / lib bug |
| `dataIntegrity.cutoverTs` | ISO-8601 UTC of the earliest row carrying a non-null `spec_section`; null when log is entirely pre-v0.7.0. Drives the `bySection` cutover-split. |
| `topPatterns` | banned-vocab matched-word ranking |

Format per-hook sections, the bySection heatmap (sorted by total desc), and call out any `byBypass` token with ≥3 occurrences as "review candidate" per §0.1 demotion principle. Surface `uniqueInvocations.<hook>.duplicate_rows > 0` for any PreToolUse/PostToolUse hook as a candidate bug.

For `bySection['(unset-historical)']`: note as pre-v0.7.0 legacy data — will age out of the window naturally; do NOT include in the heatmap leader.

For `bySection['(unset-current)']`: subtract by-design housekeeping events (`session-start` `bootstrap` / `upstream-banner`, `user-prompt-submit` `version-sync`) before judging — the residual is the actual instrumentation-gap signal. List the residual hook+event combos as "post-cutover null-section, expected vs gap" so the operator can spot which hooks still emit without a section despite running v0.9.33+.
