---
name: claudemd-rules
description: Audit the HARD-rules manifest against rule-hit telemetry over the last N days (default 30) — demote candidates and entries due for review.
disable-model-invocation: true
---

Default window is 30 days (OPERATOR.md §13.1). When the log spans less than the window, the audit reports `insufficientData` and lists no demote candidates; a 90-day window did that permanently.

**Argument parsing** (the arguments are `$ARGUMENTS`): split `$ARGUMENTS` into a numeric day-count and a `--verbose` agent-presentation flag (NOT a script flag — the script ignores it):

| Argument value | `CLAUDEMD_RULES_DAYS` env | Agent output |
|---|---|---|
| (empty) | unset (script uses default 30) | summary only |
| `90` | `90` | summary only |
| `--verbose` | unset | summary + full `rules` array |
| `90 --verbose` | `90` | summary + full `rules` array |

Passing `--verbose` (or any non-numeric token) directly to `CLAUDEMD_RULES_DAYS` would crash the script with `--days requires a positive integer (got '--verbose')` — always strip the flag before setting env.

Run: `CLAUDEMD_RULES_DAYS=<numeric-from-the-arguments-or-30> node ${CLAUDE_PLUGIN_ROOT}/scripts/hard-rules-audit.js`

The JSON contains:

| Field | Meaning |
|---|---|
| `byScope` | core vs extended HARD-rule counts (§13.1 size budget cross-check) |
| `byEnforcement` | hook / self / external / both — which rules are mechanically gated vs agent self-discipline |
| `byConfidence` | high / medium / low — author's pre-data assessment of rule reliability |
| `demoteCandidates` | hook-enforced rules with 0 fired rows (`hits.fired`) in window — §13.1 demotion review queue |
| `staleReviews` | rules whose `last_demote_review` is null, unparseable, or older than the §13.1 review cadence (28d, per OPERATOR.md) — operator's demote-review queue. Independent of `--days`, which only sets the hit-counting window. |
| `rules` | per-rule rows with `hits: {total, fired, deny, bypass, warn}` (null = the rule declares no `rule_hits_section`, so there is no telemetry to read). `total` counts every row; `fired` leaves out checks that found nothing (`pass`, `pending-no-baseline`, an allowed npx), banners repeating a checkpoint and opt-in dry-run matches nobody was shown (`deny-prose-dry-run`), and is what the demote lists read |

Format: surface `byEnforcement` + `byConfidence` summary first, then list `demoteCandidates` and `staleReviews` as action items. Suppress full `rules` array unless the arguments contained `--verbose` (per the parsing table above).
