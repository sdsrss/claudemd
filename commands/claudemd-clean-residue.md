---
name: claudemd-clean-residue
description: Clean up leftover claudemd-sync-* / claudemd-memtags-hay-* sentinels and claudemd-(mockgh|work).* test sandbox dirs from $TMPDIR, stale tool-exhaust (session scratchpads, old fixtures) from ~/.claude/tmp per the spec §7-EXT retention window (mtime > TMP_RETENTION_DAYS, default 7), and orphaned per-session sentinels from ~/.claude/.claudemd-state (ext-read-*, vocab-scan-*, failopen-*, mem-coverage-*). Default is dry-run; pass `--apply` to delete.
---

Default is dry-run — the user must opt into deletion explicitly. Flags:

- `--apply` — do delete.
- `--age-days=N` — $TMPDIR staleness threshold (default 1). Applies only to the claudemd-* patterns.
- `--retention-days=N` — ~/.claude/tmp retention window, and the window for the unowned class below. Resolution: this flag > `TMP_RETENTION_DAYS:` in the project's CLAUDE.md > 7 (spec §EXT §7-EXT).
- `--include-unowned` — also delete $TMPDIR entries with the DEFAULT `mktemp` name shape (`tmp.` + 10 alphanumerics) older than the retention window. Needs `--apply` to delete anything.

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/clean-residue.js $ARGS`

The ~/.claude/tmp pass purges depth-1 entries older than the retention window; for per-UID dirs (`claude-<uid>`) it purges their depth-1 children instead of the shell. Dirs carrying a `.keep` marker are exempt (§8.V4 deliberately-retained fixtures).

The `~/.claude/.claudemd-state` pass (v0.65.0) reaps seven ephemeral classes past the retention window — `ext-read-*` and `vocab-scan-*` (per-session sentinels that leak when a session never reaches SessionEnd), `failopen-*` (60s rate-limit markers), `mem-coverage-*` (written by a hook removed in v0.23.12), and the three per-session window refs: `session-start-<sid>.ref` (sandbox-disposal) and `tmp-baseline-<sid>.txt` (residue-audit), both from v0.67.0, plus `session-summary-<sid>.lastrun` (session-summary). Deletion is allowlist-by-pattern: live singleton state in the same directory — including the sid-less legacy `session-start.ref` and `tmp-baseline.txt`, plus `l2-task-counter` and friends — is never touched however old it is.

The `unowned` pass (v0.72.0) covers what a bare `mktemp` / `mktemp -d` produces — `tmp.XXXXXXXXXX`, which matches none of the `claudemd-` prefixes above. That was this recycler's blind spot: on 2026-09-02 the maintainer's $TMPDIR held 2.4 GB of it, none visible to this command (audit R11-38). Nothing can prove those entries were created by claudemd, so they are **counted and sized on every run but never deleted without `--include-unowned`** — widening what plain `--apply` destroys is not something a cleanup tool should do quietly. The name shape is matched exactly, so `tmp.backup` / `tmp.lock` and anything else a person named that way are out of scope. `tests/lib/mktemp-template.sh` keeps this repo from producing more.

Format the JSON output: report `sentinels`/`sandboxes` counts, the `unowned` block (`scanned`, `stale`, `bytes`, `included`) and the `tmpDir` scanned, then the `claudeTmp` section (`dir`, `retentionDays`, `candidates`, `deleted`, worst per-path ages), then the `stateDir` section (`dir`, `candidates`, `deleted`, `byKind`), and dry-run vs apply mode. Under `--apply`, `remaining` is the number of targets still on disk and the command exits 3 when it is non-zero — say so plainly rather than reporting a clean sweep; the per-path lists show which ones. If invoked without `--apply` and any scope shows >0 candidates, suggest `/claudemd-clean-residue --apply` as the next step. Note for the user: an active session older than the retention window could have its scratchpad purged — scratchpads are disposable tool-exhaust by definition, but mention it if `candidates` includes a path under a project dir modified today.
