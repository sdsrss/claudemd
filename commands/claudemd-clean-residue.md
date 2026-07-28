---
name: claudemd-clean-residue
description: Clean up leftover claudemd-sync-* sentinels and claudemd-(mockgh|work).* test sandbox dirs from $TMPDIR, stale tool-exhaust (session scratchpads, old fixtures) from ~/.claude/tmp per the spec §7-EXT retention window (mtime > TMP_RETENTION_DAYS, default 7), and orphaned per-session sentinels from ~/.claude/.claudemd-state (ext-read-*, vocab-scan-*, failopen-*, mem-coverage-*). Default is dry-run; pass `--apply` to delete.
---

Default is dry-run — the user must opt into deletion explicitly. Flags:

- `--apply` — do delete.
- `--age-days=N` — $TMPDIR staleness threshold (default 1). Applies only to the claudemd-* patterns.
- `--retention-days=N` — ~/.claude/tmp retention window. Resolution: this flag > `TMP_RETENTION_DAYS:` in the project's CLAUDE.md > 7 (spec §EXT §7-EXT).

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/clean-residue.js $ARGS`

The ~/.claude/tmp pass purges depth-1 entries older than the retention window; for per-UID dirs (`claude-<uid>`) it purges their depth-1 children instead of the shell. Dirs carrying a `.keep` marker are exempt (§8.V4 deliberately-retained fixtures).

The `~/.claude/.claudemd-state` pass (v0.65.0) reaps only four ephemeral classes past the retention window — `ext-read-*` and `vocab-scan-*` (per-session sentinels that leak when a session never reaches SessionEnd), `failopen-*` (60s rate-limit markers) and `mem-coverage-*` (written by a hook removed in v0.23.12). Deletion is allowlist-by-pattern: live singleton state in the same directory (`tmp-baseline.txt`, `session-start.ref`, `l2-task-counter`, …) is never touched however old it is.

Format the JSON output: report `sentinels`/`sandboxes` counts and the `tmpDir` scanned, then the `claudeTmp` section (`dir`, `retentionDays`, `candidates`, `deleted`, worst per-path ages), then the `stateDir` section (`dir`, `candidates`, `deleted`, `byKind`), and dry-run vs apply mode. If invoked without `--apply` and any scope shows >0 candidates, suggest `/claudemd-clean-residue --apply` as the next step. Note for the user: an active session older than the retention window could have its scratchpad purged — scratchpads are disposable tool-exhaust by definition, but mention it if `candidates` includes a path under a project dir modified today.
