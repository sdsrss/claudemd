---
name: claudemd-rules
description: Audit the HARD-rules manifest. Cross-references spec/hard-rules.json with rule-hits.jsonl bySection data over the last N days (default 30). Surfaces §13.1 demote candidates (hook-enforced rules with 0 hits in window) and stale-review entries.
---

Default window is 30 days (per §0.1 v6.11.15 — lowered from 90d because the 90d gate was structurally unreachable under typical rule-hits log retention; with 30d the audit can actually produce demote candidates instead of always reporting `insufficientData`).

**$ARGS parsing**: split `$ARGS` into a numeric day-count and a `--verbose` agent-presentation flag (NOT a script flag — the script ignores it):

| `$ARGS` value | `CLAUDEMD_RULES_DAYS` env | Agent output |
|---|---|---|
| (empty) | unset (script uses default 30) | summary only |
| `90` | `90` | summary only |
| `--verbose` | unset | summary + full `rules` array |
| `90 --verbose` | `90` | summary + full `rules` array |

Passing `--verbose` (or any non-numeric token) directly to `CLAUDEMD_RULES_DAYS` would crash the script with `--days requires a positive integer (got '--verbose')` — always strip the flag before setting env.

Run: `CLAUDEMD_RULES_DAYS=<numeric-from-$ARGS-or-30> node ${CLAUDE_PLUGIN_ROOT}/scripts/hard-rules-audit.js`

The JSON contains:

| Field | Meaning |
|---|---|
| `byScope` | core vs extended HARD-rule counts (§13.1 size budget cross-check) |
| `byEnforcement` | hook / self / external / both — which rules are mechanically gated vs agent self-discipline |
| `byConfidence` | high / medium / low — author's pre-data assessment of rule reliability |
| `demoteCandidates` | hook-enforced rules with 0 hits in window — §13.1 demotion review queue |
| `staleReviews` | rules whose `last_demote_review` is null or older than window — operator's demote-review queue |
| `rules` | per-rule rows with `hits: {total, deny, bypass, warn}` (null for self/external — agent text not yet captured; R-N8 transcript scan is the fix path) |

Format: surface `byEnforcement` + `byConfidence` summary first, then list `demoteCandidates` and `staleReviews` as action items. Suppress full `rules` array unless `$ARGS` contained `--verbose` (per the parsing table above).
