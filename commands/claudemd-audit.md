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
| `uniqueInvocations` | per-hook dedup view (v0.9.34, dupe-split v0.21.7): `rows` = raw row count; `unique_invocations` = distinct `(ts, hook, session_id, tool_use_id, event, extra)` tuples (v0.23.21 — was a 4-field key; multi-emit hooks like pre-bash-safety log one row per matched pattern in a compound command, so event+extra are needed to separate legit multi-emit from a real double-fire); `duplicate_rows` = rows−unique (back-compat sum); `duplicate_rows_real` = dupes where colliding row has non-null `tool_use_id` AND is byte-identical (same event+extra) to an earlier row in the same invocation (= true single-invocation double-fire signal — registration/lib bug candidate when on PreToolUse/PostToolUse, but see the multi-emit caveat below); `duplicate_rows_legacy` = dupes where colliding row has null `tool_use_id` (= seconds-precision collision noise from pre-v0.9.34 legacy rows OR expected Stop/SessionStart-class same-second-same-session hits); `legacy_rows` = rows with both session_id+tool_use_id null (pre-v0.9.33 noise floor). |
| `dataIntegrity.cutoverTs` | ISO-8601 UTC of the earliest row carrying a non-null `spec_section`; null when log is entirely pre-v0.7.0. Drives the `bySection` cutover-split. |
| `dataIntegrity.testSessionsFiltered` | v0.17.7 — count of test-sentinel rows stripped from every view: `session_id='t'/'test'` (hook unit-test sentinels) plus, since v0.23.20, any non-null session_id ≤7 chars (ad-hoc manual-debug sentinels like `'s'`/`'probe'`; real CC ids are 36-char UUIDs). Lets the operator confirm filter ran + quantify test traffic; raw byHook/bySection numbers in the same payload are post-filter, real-session-only. |
| `topPatterns` | banned-vocab matched-word ranking |
| `denyByProjectClass` | v0.23.8 — per-hook **blocking-deny** (`deny`/`deny-repeat`/`deny-prose`; excludes `deny-prose-dry-run`) split into `self` (the plugin dogfooding itself — project path ends in `-claudemd`) / `external` (real downstream repos) / `unknown` (no project field). Raw deny counts overstate enforcement value when claudemd's own repo dominates traffic (banned-vocab ~498/516 historically self). |
| `selfCompliance` | v0.28.0 — self-enforced-rule compliance from the retrospective transcript scan of the CURRENT project (same window; wraps `scripts/sampling-audit.js`, 8 detectors). Per rule: `opportunities` / `violations` / `rate` / `precision` / `status`. **`rate` is null until the rule's detector is hand-labeled to precision ≥ 0.8** (pre-registered A4 gate) — `status` says `collecting` until then. |

For `denyByProjectClass`: report each hook's deny split as `<external> external / <self> self / <unknown> unknown` and **lead with the `external` count as the real downstream-interception signal** — do NOT present the raw deny total as the enforcement value (most of it is the plugin's own dogfood; see the 498/516 banned-vocab finding).

Format per-hook sections, the bySection heatmap (sorted by total desc), and call out any `byBypass` token with ≥3 occurrences as "review candidate" per §0.1 demotion principle. Surface `uniqueInvocations.<hook>.duplicate_rows_real > 0` for any PreToolUse/PostToolUse hook as a candidate registration/lib bug — EXCEPT for multi-emit hooks (pre-bash-safety logs one row per matched pattern in a compound command), where a residual `_real` can come from one command repeating the SAME pattern (`rm -rf $D; …; rm -rf $D`); telemetry can't distinguish that from a double-registration, so confirm against the source command before reporting a bug. **Do NOT report bare `duplicate_rows`** — that number includes legacy collision noise (`duplicate_rows_legacy`) which is expected for pre-v0.9.34 rows and Stop/SessionStart-class hooks. Always read the `_real` / `_legacy` split, never the bare sum.

For `bySection['(unset-historical)']`: note as pre-v0.7.0 legacy data — will age out of the window naturally; do NOT include in the heatmap leader.

For `selfCompliance`: report `violations/opportunities` per rule verbatim (denominators are mandatory — a bare hit count is not evidence). While `status` is `collecting`, do NOT present the ratio as a compliance rate or draw conclusions from it — say "collecting, precision uncalibrated" instead. Only rules with `rate != null` may be cited as measured compliance.

For `bySection['(unset-current)']`: subtract by-design housekeeping events (`session-start` `bootstrap` / `upstream-banner`, `user-prompt-submit` `version-sync`) before judging — the residual is the actual instrumentation-gap signal. List the residual hook+event combos as "post-cutover null-section, expected vs gap" so the operator can spot which hooks still emit without a section despite running v0.9.33+.
