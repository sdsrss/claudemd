---
name: claudemd-doctor
description: Run health checks on claudemd installation. Flags missing deps, spec drift, settings.json issues, hook drift, backup inventory, rule-usage health, §4 Routing primaries disabled via skillOverrides, MEMORY.md tag specificity, cross-layer memory maintenance (promote/repatriate/stale candidates). Supports --prune-backups=N.
---

Usage: `/claudemd-doctor` or `/claudemd-doctor --prune-backups=5`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js $ARGS`

Surface the checks list with [✓] / [△] / [✗] prefixes based on the `ok` field. If `pruned` is non-empty, list the removed backup directories. If `pruneSkippedLegacy` is non-empty, say so separately: those are pre-0.68.3 spec-shaped dirs sitting in the personal backup namespace — the prune deliberately neither deleted them nor counted them toward N, and the `backup-namespace-legacy` check above explains why the user has to sort them by hand. Reporting only `pruned` hides the half of the story that needs a decision.

For `memory-tag-specificity` check (added v0.9.35): when `ok=false`, present the candidate list, group by memory file, and cite spec §11-EXT Tag-specificity (SHOULD, v6.11.11). Suggest the rename pattern shown in the detail (`impact`→`impact-analysis`, etc.). Advisory only — operator decides per case.

For `memory-index-size` (added v0.35.0): each `MEMORY.md` is judged against the 12KB soft default, or against a budget it declares itself with a whole-line HTML comment — `<!-- index-budget: 32KB -->` — anywhere outside a code block (added v0.74.2). Declare one when the overage is a decision rather than a backlog: the tags are the routing keys the §11 hint hook matches on, so compressing them buys bytes by spending recall, and `feedback_*` entries with no recent hits are usually safety rules whose quiet is normal. The declared number is printed in the line it makes green, so raising it stays visible; it is capped at 16× the default, and a malformed declaration (`28` with no unit, `28 KB` with a space, an unclosed comment) **fails the check** rather than reverting to the default in silence.

For the three `memory-maintenance:*` checks (added v0.30.0, plan E2 — wrong-layer memory placement fails silently): `promote` lists claude-mem-lite lessons cited ≥3× and alive ≥30d (high-frequency recall = de-facto durable knowledge → candidate MEMORY.md entry); `recall-repatriation` lists durable `recall_*.md` plugin-absent fallback files older than 30d (migrate into mem-lite or delete); `stale` lists durable files >90d with zero keyword mentions in the telemetry window (review tags per §11-EXT or retire). **All three are candidates only — never migrate/delete automatically; migration is a §5-scoped write and the operator's call.** `promote` degrades gracefully (`skipped: …`) when the mem-lite DB or `node:sqlite` is unavailable.
