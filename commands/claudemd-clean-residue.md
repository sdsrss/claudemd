---
name: claudemd-clean-residue
description: Clean up leftover claudemd-sync-* sentinels and historical claudemd-(mockgh|work).* test sandbox dirs from $TMPDIR. Default is dry-run; pass `--apply` to delete.
---

Default is dry-run — the user must opt into deletion explicitly. Accepts `--apply` (do delete) and `--age-days=N` (override the default 1-day staleness threshold).

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/clean-residue.js $ARGS`

Format the JSON output: report `sentinels` and `sandboxes` counts, the `tmpDir` scanned, dry-run vs apply mode, and per-path age. If invoked without `--apply` and the dry-run shows >0 candidates, suggest `/claudemd-clean-residue --apply` as the next step.
