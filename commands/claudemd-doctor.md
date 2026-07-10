---
name: claudemd-doctor
description: Run health checks on claudemd installation. Flags missing deps, spec drift, settings.json issues, hook drift, backup inventory, rule-usage health, MEMORY.md tag specificity, cross-layer memory maintenance (promote/repatriate/stale candidates). Supports --prune-backups=N.
---

Usage: `/claudemd-doctor` or `/claudemd-doctor --prune-backups=5`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js $ARGS`

Surface the checks list with [✓] / [△] / [✗] prefixes based on the `ok` field. If `pruned` is non-empty, list the removed backup directories.

For `memory-tag-specificity` check (added v0.9.35): when `ok=false`, present the candidate list, group by memory file, and cite spec §11-EXT Tag-specificity (SHOULD, v6.11.11). Suggest the rename pattern shown in the detail (`impact`→`impact-analysis`, etc.). Advisory only — operator decides per case.

For the three `memory-maintenance:*` checks (added v0.30.0, plan E2 — wrong-layer memory placement fails silently): `promote` lists claude-mem-lite lessons cited ≥3× and alive ≥30d (high-frequency recall = de-facto durable knowledge → candidate MEMORY.md entry); `recall-repatriation` lists durable `recall_*.md` plugin-absent fallback files older than 30d (migrate into mem-lite or delete); `stale` lists durable files >90d with zero keyword mentions in the telemetry window (review tags per §11-EXT or retire). **All three are candidates only — never migrate/delete automatically; migration is a §5-scoped write and the operator's call.** `promote` degrades gracefully (`skipped: …`) when the mem-lite DB or `node:sqlite` is unavailable.
