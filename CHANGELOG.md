# Changelog

All notable changes to the `claudemd` plugin. This changelog tracks plugin artifact changes (hooks, scripts, commands). Spec content changes live in `spec/CLAUDE-changelog.md`.

## [0.1.6] - 2026-04-22

### Changed — Spec

- Ships AI-CODING-SPEC v6.9.3 (patch). New §12 paragraph "Manual-ship atomicity (HARD, clarification)" codifies that the `manual ship because <reason>` override is one atomic turn: enumerate remaining steps up-front, execute back-to-back, no turn-ending between clean green steps. Grounding: a manual-ship session stopped after `git commit` and required user prompt to continue — the single `[AUTH]` on ship already covered the full pipeline per §5 per-task-per-scope. See `spec/CLAUDE-changelog.md` v6.9.3 entry for full rationale.
- Fixes `spec/CLAUDE-extended.md` header version drift (was stuck at v6.9.0 while core had advanced through v6.9.1 / v6.9.2). Now matches at v6.9.3.

### Fixed — Docs

- `README.md` troubleshooting: replaces misleading "Since 0.1.4..." note (0.1.2-0.1.4 were broken — `${CLAUDE_PLUGIN_ROOT}` never expanded in `settings.json`). New entry documents the `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin` symptom (5 errors per Bash call on 0.1.2-0.1.4) and the v0.1.5 upgrade path.
- `README.md` install/uninstall command paths: `0.1.4` → `0.1.5` (3 sites).
- `README.md` Project layout: `hooks/hooks.json` is no longer "intentionally empty" — it's the authoritative hook registration site post-v0.1.5.

### Changed — Hygiene

- `.gitignore` now excludes `.claude/settings.local.json` (per-session CC permission grants; user-specific + transient; should never ship).

## [0.1.5] - 2026-04-22

### Fixed — Critical

- Hook registration moved from `~/.claude/settings.json` to the plugin's own `hooks/hooks.json`. The 0.1.2-0.1.4 releases wrote commands like `bash "${CLAUDE_PLUGIN_ROOT}/hooks/…"` into `settings.json`, but the CC harness only expands `${CLAUDE_PLUGIN_ROOT}` for hooks defined in a plugin's `hooks/hooks.json` — never in `settings.json`. Result: every Bash-tool call and every session-end fired 5 hook errors of the form `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin`, and no claudemd hook actually ran. (V1)
- `scripts/install.js` now evicts ALL claudemd hook commands from `settings.json` on install — both the legacy absolute-path form (≤0.1.1) and the broken `${CLAUDE_PLUGIN_ROOT}`-literal form (0.1.2-0.1.4). Upgrading from any prior version leaves `settings.json` free of claudemd entries; `hooks/hooks.json` is now the sole registration site.
- Installed-manifest `entries` still contains the 5 shipped hook descriptors (sourced from the plugin's `hooks/hooks.json`), so `/claudemd-status` keeps showing `entries: 5` and `scripts/uninstall.js` keeps its precise-command match path alongside the `HOOK_BASENAMES` fallback.

### Docs

- `docs/ADDING-NEW-HOOK.md` step 3 now directs new-hook registration into `hooks/hooks.json` + `HOOK_BASENAMES`, not the deleted `HOOK_SPECS` array.

### Added — Tests

- `install.test.js`: 2 regression cases replace the old settings.json-count assertions — `fresh install leaves settings.json with NO claudemd hook entries (v0.1.5)` and `upgrade evicts ALL stale claudemd hook entries from settings.json (v0.1.5)`. The M4 env-var-literal check now asserts against `manifest.entries` instead of `settings.json`.
- `integration/full-lifecycle.test.sh` Phase 3 rewritten: asserts `settings.json` has zero claudemd residue AND `.claudemd-state/installed.json` carries 5 manifest entries.
- Script tests: 90/90 pass. Hook suites + full-lifecycle integration: PASS.

## [0.1.4] - 2026-04-22

Post-review hardening (full audit 2026-04-22). 0.1.3 was never tagged; this rolls the 0.1.3 pre-review fix set forward.

### Fixed — High

- `scripts/uninstall.js`: `--purge` no longer `rm -rf`s `~/.claude/logs/` (shared with other plugins, e.g. claude-mem-lite). Now only deletes `claudemd.jsonl` and removes the directory iff it becomes empty. (H1)
- `hooks/memory-read-check.sh`: project-dir encoding now replaces BOTH `/` and `.` with `-` (Claude Code's real scheme). Slash-only encoding silently missed any CWD containing a dot (`~/.config/*`, `my.project/`, etc.), turning the §11 HARD rule into a fail-open no-op. (H2)

### Fixed — Medium

- `hooks/ship-baseline-check.sh`: `gh run list` now filters by current branch (`--branch $(git branch --show-current)`). Previously an unrelated scheduled-cron failure on `main` could block a feature-branch push. Detached HEAD falls back to the old unfiltered query. (M1)
- `hooks/lib/platform.sh`: `platform_find_newer` adds `-maxdepth 1`. Fixes self-inconsistency with spec §8 "no recursive `~/.claude/` traversal" and speeds up scanning when `tmp/` accumulates. (M2)
- `scripts/update.js`: removed unreachable `choice=select` branch (no CLI path to pass `selected`). `select` now throws `unknown choice` with the existing error path. (M3)
- `scripts/install.js` + `scripts/uninstall.js`: hook commands written into `settings.json` now use literal `${CLAUDE_PLUGIN_ROOT}` (expanded by the CC harness at hook invocation per hooks docs). `/plugin update claudemd` surviving version-dir bumps no longer requires manual re-registration. `install.js` evicts any stale absolute-path entries left by ≤0.1.3 installs before merging the new env-var form. `uninstall.js` fallback matcher updated to catch both formats via a shared `HOOK_BASENAMES` list. (M4)

### Fixed — Low

- `scripts/audit.js`: CLI now accepts `--days=N` (parity with `doctor.js --prune-backups=N`) and rejects non-numeric / zero / negative with a usage hint. Previously `parseInt('garbage') → NaN` silently filtered every row to zero. (L1)
- `hooks/banned-vocab-check.sh`: git-commit detection regex now uses POSIX `[[:space:]]` / `[^[:space:]]+` instead of `\s` / `\S+` (not reliable under BSD grep on macOS). (L2)
- `scripts/doctor.js`: `logs` check now reports file size (MB) and fails at ≥5 MB with a truncation hint. `audit.js` reads the whole file into memory; oversize logs slow `/claudemd-audit`. (L5)

### Added — Tests

- 12 new regression cases across 9 files: purge-preserves-foreign-logs, dot-cwd encoding, branch-aware mock + filter test, maxdepth nested-tmp isolation, env-var hook command form, upgrade-from-absolute-path migration, audit CLI rejection pairs, doctor log-size threshold pair, unknown-choice throws.
- New fixture: `tests/fixtures/mock-gh/branch-aware/gh` — returns green/red based on `--branch` arg.
- Test total: 81 script + 12 post-review additions → **90 script tests**; hook suites **3** new cases across memory-read-check (7→8) / ship-baseline (8→9) / sandbox-disposal (4→5); integration 1/1.

## [0.1.3] - 2026-04-22

### Fixed
- `scripts/lib/backup.js`: `isoStamp()` now includes milliseconds (`YYYYMMDDTHHMMSSmmmZ`). Two installs within the same second previously shared a backup directory and silently overwrote the user's original spec backup via `renameSync`, losing data. A numeric suffix (`-1`, `-2`, …) is appended as a belt-and-braces guard for same-millisecond collisions. `listBackups` accepts both old and new stamp formats so pre-0.1.3 backups still sort correctly.
- `scripts/uninstall.js`: `delete` (without `CLAUDEMD_CONFIRM=1`) and `restore` (with no backups) now abort **before** mutating `settings.json` or the manifest. Previously the hook entries were silently removed before the abort return, so users saw "abort" but their hooks were already disabled.
- `scripts/lib/spec-diff.js`: replaced Set-based line diff with LCS. Reordered spec sections now show a nonzero `+N/-N` summary in `/claudemd-update` instead of the misleading `+0/-0`.
- `scripts/doctor.js`: `--prune-backups=N` now requires `N ≥ 1`. `--prune-backups=0` used to delete every backup (the retain-count semantic was surprising); it now errors with a usage hint.
- `scripts/toggle.js`: running with no argument now prints usage + valid hook names instead of the confusing `unknown hook: undefined` error.
- `package.json`: removed the `bin` field pointing at a non-existent `scripts/cli.js`. The plugin is distributed via the Claude Code marketplace, not npm, so the declaration was a landmine (`npm i -g` silently skipped creating the bin symlink).

### Added
- Regression tests covering each fix (F1, F2, F9, F10, F14, F18) under `tests/scripts/`.

## [0.1.2] - 2026-04-22

### Fixed
- `scripts/install.js` CLI invocation (`node scripts/install.js`) now auto-derives `pluginRoot` from its own file location via `import.meta.url`. Previously required `CLAUDE_PLUGIN_ROOT` env var and crashed with `install: pluginRoot missing` when users followed the README one-liner.
- `scripts/update.js` CLI invocation gains the same self-derivation fallback.
- `installed.json` manifest now records the actual plugin version (read from `<pluginRoot>/package.json`) instead of a hardcoded `'0.1.0'`. `/claudemd-status` and `/claudemd-doctor` now report correct version after install.

### Added
- `tests/scripts/install.test.js`: CLI smoke test that spawns `node scripts/install.js` with no env and no args, proving self-derived `pluginRoot` path works end-to-end.
- `scripts/lib/paths.js`: `resolvePluginRoot(importMetaUrl)` + `readPluginVersion(pluginRoot)` helpers.

## [0.1.1] - 2026-04-21

### Fixed
- `marketplace.json` moved from repo root to `.claude-plugin/marketplace.json` (correct Claude Code plugin layout).
- `marketplace.json` `plugins` field changed from object-keyed-by-name to array of objects (schema compliance).
- `plugin.json` stripped of explicit `commands` / `hooks` paths (auto-scanned by Claude Code); these caused install-time schema validation failure.
- Added `hooks/hooks.json` stub (`hooks: {}`) to prevent any auto-load double-execution when the install script registers hooks in `~/.claude/settings.json`.
- macOS CI: install `coreutils` for `timeout`; add GNU gnubin to PATH.
- macOS: `tests/hooks/rule-hits.test.sh` strips BSD `wc -l` whitespace padding.
- Git index: set executable bit (`100755`) on all shell scripts so CI mock-gh PATH invocation works.
- README rewritten with correct `/plugin marketplace add` + `/plugin install` flow.

## [0.1.0] - 2026-04-21

### Added
- Five hooks:
  - `banned-vocab-check` (PreToolUse:Bash) — blocks commits with §10-V banned vocabulary
  - `ship-baseline-check` (PreToolUse:Bash) — blocks `git push` on red base-branch CI (2s gh timeout)
  - `residue-audit` (Stop) — advisory warn when `~/.claude/tmp/` grows beyond threshold (default 20)
  - `memory-read-check` (PreToolUse:Bash) — denies ship/push when matched MEMORY.md entry unread in session
  - `sandbox-disposal-check` (Stop) — warns on mkdtemp residue at session end
- Five slash commands: `/claudemd-status`, `/claudemd-update`, `/claudemd-audit`, `/claudemd-toggle`, `/claudemd-doctor`.
- Seven Node.js management scripts with idempotent settings.json merge, backup-and-overwrite spec install (last 5 backups retained), 3-way uninstall (keep/delete/restore with hard-AUTH on delete).
- Ships spec v6.9.2 (adds §0.1 Core growth discipline + §2.3 TOOLS; reduces core from ~6,200 to ~5,330 tokens).
- CI matrix: ubuntu-latest + macos-latest × node 20.

### Notes
- First release.
