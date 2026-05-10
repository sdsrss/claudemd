---
name: claudemd-doctor
description: Run health checks on claudemd installation. Flags missing deps, spec drift, settings.json issues, hook drift, backup inventory, rule-usage health, MEMORY.md tag specificity. Supports --prune-backups=N.
---

Usage: `/claudemd-doctor` or `/claudemd-doctor --prune-backups=5`

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js $ARGS`

Surface the checks list with [✓] / [△] / [✗] prefixes based on the `ok` field. If `pruned` is non-empty, list the removed backup directories.

For `memory-tag-specificity` check (added v0.9.35): when `ok=false`, present the candidate list, group by memory file, and cite spec §11-EXT Tag-specificity (SHOULD, v6.11.11). Suggest the rename pattern shown in the detail (`impact`→`impact-analysis`, etc.). Advisory only — operator decides per case.
