---
name: claudemd-rules
description: Audit the HARD-rules manifest. Cross-references spec/hard-rules.json with rule-hits.jsonl bySection data over the last N days (default 30). Surfaces §13.1 demote candidates (hook-enforced rules with 0 hits in window) and stale-review entries.
---

Default window is 30 days (per §0.1 v6.11.15 — lowered from 90d because the 90d gate was structurally unreachable under typical rule-hits log retention; with 30d the audit can actually produce demote candidates instead of always reporting `insufficientData`). If the user passes a number (e.g. `/claudemd-rules 90`), set `CLAUDEMD_RULES_DAYS=$ARGS` before invocation.

Run: `CLAUDEMD_RULES_DAYS=${ARGS:-30} node ${CLAUDE_PLUGIN_ROOT}/scripts/hard-rules-audit.js`

The JSON contains:

| Field | Meaning |
|---|---|
| `byScope` | core vs extended HARD-rule counts (§13.1 size budget cross-check) |
| `byEnforcement` | hook / self / external / both — which rules are mechanically gated vs agent self-discipline |
| `byConfidence` | high / medium / low — author's pre-data assessment of rule reliability |
| `demoteCandidates` | hook-enforced rules with 0 hits in window — §13.1 demotion review queue |
| `staleReviews` | rules whose `last_demote_review` is null or older than window — operator's demote-review queue |
| `rules` | per-rule rows with `hits: {total, deny, bypass, warn}` (null for self/external — agent text not yet captured; R-N8 transcript scan is the fix path) |

Format: surface `byEnforcement` + `byConfidence` summary first, then list `demoteCandidates` and `staleReviews` as action items. Suppress full `rules` array unless `$ARGS --verbose` is set.
