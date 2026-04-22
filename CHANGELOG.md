# Changelog

All notable changes to the `claudemd` plugin. This changelog tracks plugin artifact changes (hooks, scripts, commands). Spec content changes live in `spec/CLAUDE-changelog.md`.

## Versioning policy (set in v0.2.1)

- **Plugin manifest `description` fields** carry spec version at **major.minor only** (e.g. `"AI-CODING-SPEC v6.10 …"`). Patch-level spec updates (v6.10.0 → v6.10.1) do NOT re-bump manifest descriptions. Rationale: description is marketplace-list tagline — user absorbs version family, not full semver; churn across 3 manifests every patch has no signal.
- **Canonical spec version source**: `spec/CLAUDE.md` top-line title (`# AI-CODING-SPEC vX.Y.Z — Core`) + `spec/CLAUDE-changelog.md` top `##` entry.
- **Plugin semver vs spec semver** are independent: plugin patch (0.2.0 → 0.2.1) may ship when spec is unchanged (this release); plugin minor (0.1.9 → 0.2.0) ships when spec minor updates (v0.2.0 shipped spec v6.10.0).

## [0.2.2] - 2026-04-23

Patch. Ships at spec v6.10.0 (unchanged). Fixes `/claudemd-status` spec-version drift and adds bounded cache retention to prevent unbounded version-dir accumulation under `~/.claude/plugins/cache/`.

### Fixed — `/claudemd-status` spec version extraction

`scripts/status.js` read spec version with regex `^Version:\s*(\S+)` — a format retired in v6.10.0 when the spec header consolidated into `# AI-CODING-SPEC vX.Y.Z — Core`. Since v0.2.0 (which shipped spec v6.10.0), every healthy install returned `spec.installed: ""`, directly contradicting the "Versioning policy" set in v0.2.1 which declares the H1 title the canonical spec-version source.

- New extraction: H1-title match first (`/^#\s*AI-CODING-SPEC\s+v([\d.]+)/m`), legacy `Version:` fallback for pre-v6.10.0 installs.
- Test-reality drift repaired: `tests/scripts/status.test.js` fixture rewritten from fake `Version: 6.9.2` to real H1 format `# AI-CODING-SPEC v6.10.0 — Core`. The old fixture matched the broken regex, so unit tests passed while production silently returned empty. A single test assertion at the integration boundary would have caught this; added comment referencing v0.2.1 policy source to prevent re-drift.

### Added — Cache version pruning (keep newest 3)

New `scripts/lib/cache-prune.js` (`pruneCache`) called at end of `install.js`. Keeps the 3 newest semver version dirs under `~/.claude/plugins/cache/<plugin>/<plugin>/`, always retaining the currently-installed version even if older than the top-3 (rollback scenario). Previously cache dirs accumulated unbounded across upgrades — observed in the field after 8 releases: 6 stale version dirs (0.1.1 / 0.1.4 / 0.1.6 / 0.1.7 / 0.1.9 / 0.2.1) totalling ~2 MB per install cycle × N releases.

- **Scope-gated**: only dirs matching `^\d+\.\d+\.\d+$` are candidates; `scratch-notes/` and other non-semver siblings stay untouched.
- **Dev-mode safe**: when `pluginRoot` basename is non-semver (source repo checkout via `node scripts/install.js`), prune returns `{skipped: 'non-semver-plugin-root'}` — no scan of repo parent.
- **Best-effort**: prune wrapped in try/catch; an FS error does not void the preceding install success.
- **Coverage**: 7 new unit tests in `tests/scripts/cache-prune.test.js` — newest-3 keep, rollback retains current, non-semver siblings ignored, dev-mode skip, missing parent dir, multi-digit semver (0.10.0 > 0.9.5).

### Manifest version bumps

- `package.json` 0.2.1 → 0.2.2. Description unchanged (`v6.10` per policy).
- `.claude-plugin/plugin.json` 0.2.1 → 0.2.2. Description unchanged.
- `.claude-plugin/marketplace.json` both version fields 0.2.1 → 0.2.2. Descriptions unchanged.

### Required migration

**NONE.** Cache pruning triggers on next `install.js` run (any plugin upgrade path). No settings.json change, no spec content change, no hook behavior change.

### Test totals

- Unit: 101 → 108 (+7 cache-prune tests; +0 net on status since the failing case was fixed in place)
- Full suite (shell hooks + Node + full-lifecycle integration): PASS

## [0.2.1] - 2026-04-23

Patch. Loose-end cleanup from the v0.2.0 ship. No spec content change, no hook/script behavior change, no user-visible behavior difference — ships at spec v6.10.0 as in v0.2.0.

### Fixed — Test sentinel drift-proneness

- `tests/scripts/spec-structure.test.js` A15 `MEMORY.md tag syntax`: dropped the `/tag syntax/i` literal-phrase match. The `[tag1, tag2]` literal (user-copy-paste anchor) is the structural sentinel and was already asserted; the `/tag syntax/i` match was redundant and fragile — spec could rename "Optional tag syntax" → "Tag annotation syntax" (or similar) and silently keep passing against unrelated contexts, while the copy-paste example is the real stability invariant. Post-change: 2 assertions per test (MEMORY.md + `[tag1, tag2]`), down from 3. Full suite: 94/94 Node + full-lifecycle integration PASS.

### Fixed — Repo hygiene

- `.gitignore`: entry `.claude/settings.local.json` broadened to `.claude/`. The whole `.claude/` directory is Claude Code workspace state (sessions / permission grants / local hook caches) — entirely user-specific, entirely transient. Prior narrow rule left `?? .claude/` in every contributor's `git status` whenever CC created any sibling file (which it does now during normal session use). `.claude/settings.local.json` stays covered by the broader rule.

### Docs — Versioning policy

- `CHANGELOG.md`: new "Versioning policy" section (above) codifies the manifest-description-at-major.minor rule and documents independence between plugin semver and spec semver. Future reviewers see the rule without spelunking git log.

### Manifest version bumps

- `package.json`: 0.2.0 → 0.2.1. Description unchanged (`v6.10` per policy above).
- `.claude-plugin/plugin.json`: 0.2.0 → 0.2.1. Description unchanged.
- `.claude-plugin/marketplace.json`: both `metadata.version` and `plugins[0].version` 0.2.0 → 0.2.1. Descriptions unchanged.

## [0.2.0] - 2026-04-23

**Minor bump — ships spec v6.9.3 → v6.10.0**. Per AI-CODING-SPEC §2 "released-artifact user-visible default behavior change → L3 regardless of LOC" and §EXT §2-EXT "SemVer non-patch bump". User-facing behavior UNCHANGED (0 new HARD, 0 rule semantic modification, §5 AUTH table verbatim, all Iron Laws preserved) — bump chosen to signal the structural spec refresh, not a behavior contract change.

### Spec v6.10.0 — data-driven net contraction

Grounding: external audit of 6-week history across `projects--mem` / `projects--code-graph-mcp` / `projects--claudemd` flagged v6.9.3 core at 95% of §13.1 size ceiling (24.9k/25k), evidence rule scattered across §0 / §7 / §10 / §EXT §7-EXT / B.2, and dual routing tables (§2.2 core + §EXT §4 FLOW) with tie-breaker adding cognitive cost every task.

- **§2.1 ROUTE unified** — original §2.1 skill soft-triggers + §2.2 ROUTE (L0–L2 subset) + §2.3 TOOLS (orchestration) merged into one §2.1 ROUTE table + escalation principles + soft-trigger clause. Dual-routing tie-breaker dropped; §EXT §4 FLOW still authoritative on L3/ship. `~−1.4k chars` in core.
- **§5 AUTH compaction** — 14-row hard/soft column table → hard-default enum + soft list + none-case. 12 ops verbatim; no AUTH-level semantic change. `~−400 chars`.
- **§8 Verify-before-claim** — 8.V1–V4 bodies tightened to 1–2 lines; historical incident grounding (v0.8.3 leak count etc.) externalized to `spec/CLAUDE-changelog.md` v6.7.1 / v6.7.4 entries. `~−500 chars`.
- **§7 / §10 / §11 DRY sweep** — Iron Law #2 good-examples 3 → 2; Specificity clause tightened (full banned-vocab at §EXT §10-V); session-exit HARD preserved with v0.11.4 anecdote trimmed to changelog. `~−600 chars`.
- **Misc sweep** — Fast-Path / depth-triggers / TOC cross-ref tightened; obsolete `§EXT §8-EXT` pointer dropped. `~−200 chars`.
- **Recent-changes hygiene** — `spec/CLAUDE-changelog.md` v6.9.0 entry backfilled (chain was v6.9.3 → v6.9.2 → [gap] → v6.8.1; now continuous).

**Sizing delta** (vs v6.9.3):
- `spec/CLAUDE.md`: 23823 → 19553 chars (`−4270`, `−17.9%`); headroom 1177 → 5447 chars (`4.6×`).
- `spec/CLAUDE-extended.md`: 42427 → 42602 chars (+175, net flat — v6.9.0 entry archived to changelog offset by v6.10.0 entry + new Sizing line).
- `spec/CLAUDE-changelog.md`: 18716 → 23645 chars (+4929 — v6.10.0 entry + v6.9.0 backfill).
- Runtime L0/L1/L2 load: ~6.0k → ~4.9k tokens (`−1.1k` every turn).
- Runtime L3/ship load: ~16.6k → ~15.5k tokens (`−1.1k` per L3 turn).

**HARD tally unchanged**: 11 in core (§0.1 / §0 Hard-AUTH override / Iron Law #2 / §7 Ship-baseline / §7 User-global-state audit / §8 Verify-before-claim V1–V4 / §10 Four-section order / §10 Honesty rules / §10 Specificity / §11 MEMORY.md read-the-file / §11 Session-exit mid-SPINE). Zero added, zero removed, zero semantic change. §13.2 budget cost = 0; 20-task counter reset per "rule consolidation" allowance.

### Required migration: NONE

Agent behavior is backward compatible. Spec cross-references that external docs / memory files may carry:

- `§2.2 ROUTE` / `§2.3 TOOLS` → now under unified **§2.1 ROUTE**. If your `memory/*.md` or project `CLAUDE.md` cites these subsections by number, re-map to §2.1. Content preserved verbatim; only section numbers changed.
- All other section numbers (§0 / §0.1 / §1 / §1.5 / §2 / §3 / §5 / §5.1 / §7 / §8 / §9 / §10 / §11 / §EXT) unchanged.

### Opt-out / revert

Pin previous version:
- Plugin: `/plugin marketplace update claudemd` (or re-install) and select the `0.1.9` tag, OR from source: `git -C <claudemd-clone> checkout tags/v0.1.9 && node scripts/install.js`.
- Spec only: restore `~/.claude/CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md` from the `~/.claude/.claudemd-backups/<timestamp>/` backup that the 0.2.0 `postInstall` writes before overwriting (see `scripts/install.js` backup flow).

### Discoverability

- GitHub release notes (v0.2.0 tag) summarize the bump rationale.
- `/claudemd-status` now reports plugin 0.2.0 / spec v6.10.0.
- `hooks/session-start-check.sh` first run after upgrade logs the version bump to `~/.claude/logs/claudemd-bootstrap.log`.

### Manifest version bumps

- `package.json` 0.1.9 → 0.2.0; description `v6.9` → `v6.10`.
- `.claude-plugin/plugin.json` 0.1.9 → 0.2.0; description `v6.9` → `v6.10`.
- `.claude-plugin/marketplace.json` both `metadata.version` and `plugins[0].version` 0.1.9 → 0.2.0; both descriptions `v6.9` → `v6.10`.

No plugin code (hooks / scripts / commands / tests) changed in this release; shipping exclusively carries the spec refresh.

## [0.1.9] - 2026-04-23

Follow-on hardening from the 2026-04-23 end-to-end usage audit. 6 warts surfaced during sandbox simulation, all addressed; 4 new regression test cases and 1 new test suite added.

### Fixed — High (state-dir double-duty)

- `scripts/lib/paths.js` + `scripts/install.js` + `scripts/uninstall.js` + `scripts/status.js` + `scripts/doctor.js`: install manifest relocated from `~/.claude/.claudemd-state/installed.json` to `~/.claude/.claudemd-manifest.json`. The pre-0.1.9 location shared the state dir with runtime baselines (`tmp-baseline.txt`, `session-start.ref`); a user running `rm -rf ~/.claude/.claudemd-state/` to reset residue-audit / sandbox-disposal baselines silently erased the install record, and `/claudemd-status` reported `installed:false` even with hooks still firing from `hooks/hooks.json`. Sandbox repro: manifest gone → `{"warning":"already-uninstalled"}` from the next uninstall run. New `readManifest()` helper in `paths.js` transparently migrates legacy `.claudemd-state/installed.json` → new location on first access, so existing 0.1.x users get relocated automatically by any claudemd script (status / doctor / uninstall / install). (P1a)
- `scripts/uninstall.js` `purge` + default paths: unlink both the new manifest AND any pre-0.1.9 legacy file for belt-and-braces cleanup on upgrade→uninstall flows. (P1a)

### Added — Feature (SessionStart self-bootstrap)

- `hooks/session-start-check.sh` (new) + `hooks/hooks.json` SessionStart registration: auto-runs `install.js` in the background (10s ceiling, detached) when the plugin is present but no manifest exists at either location. Saves new users the manual `node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/install.js` step documented in `README.md`. Idempotent — fast-exits in ~5ms on subsequent starts once the manifest is in place. Kill-switch `DISABLE_SESSION_START_HOOK=1` suppresses the bootstrap; `DISABLE_CLAUDEMD_HOOKS=1` suppresses it too. Diagnostic log at `~/.claude/logs/claudemd-bootstrap.log`. `HOOK_BASENAMES` updated so uninstall catches this hook alongside the five enforcement hooks; `status.js` / `toggle.js` surface it under the `session_start` kill-switch key. (P1b)

### Fixed — Hook behavior

- `hooks/residue-audit.sh`: first invocation (no `tmp-baseline.txt` yet) now establishes the baseline silently and returns, mirroring `sandbox-disposal-check.sh`. Previously, a user whose `~/.claude/tmp/` already held >20 entries from other plugins or prior sessions got an immediate false alarm on the very first Stop after install, with `BASELINE=0` producing a misleading "grew by 32 entries" warning. (P2)
- `hooks/sandbox-disposal-check.sh`: trailing blank bullet (` - ` with no path) no longer appears at the end of the warn list. Root cause: the `FOUND` accumulator ended with a `\n`, and `head -n 5 | sed 's/^/  - /'` preserved the blank line as a naked bullet. Replaced with `sed -e '/^$/d' -e 's/^/  - /' | head -n 5` to strip empties before prefixing. (P3a)
- `hooks/banned-vocab-check.sh`: scan scope narrowed from "entire `git commit` command line" to "message body only" (extracted from `-m "..."` / `-m '...'` / `--message=...` / `--message "..."` forms). §10-V is about commit message content, so scanning `COMMIT_FLAG_SIGNIFICANTLY=1 git commit -m "fix: X"` across all tokens used to flag unrelated env/config text. Falls back to full-CMD scan when no `-m` / `--message` is captured (editor commits, `-F file`, unusual quoting) — preserves §10-V coverage without over-matching. BSD-safe: uses octal `\047` for single quote in regex alternation. (P4)

### Fixed — Medium (cosmetic churn in settings.json)

- `scripts/lib/settings-merge.js`: `unmergeHook` now prunes empty event arrays (e.g. `"PreToolUse": []`) and drops the top-level `hooks` key entirely when it becomes empty. Previously every install/uninstall cycle left `"hooks":{"PreToolUse":[]}` scaffolding in `settings.json`, visible as noise in user diffs and accumulating across plugins. (P3b)

### Added — Tests

- `tests/hooks/session-start.test.sh` (new, 6 cases): first-run silent + background install writes manifest, bootstrap log created, manifest-present no-op, kill-switch suppression, legacy-manifest path recognized as installed.
- `tests/hooks/banned-vocab.test.sh`: 5 new cases (16-20) covering message-scope scan — env prefix / `git -c` config / multi `-m` / `--message=` form / `-F file` fallback.
- `tests/hooks/sandbox-disposal.test.sh`: case 6 asserts no trailing blank bullet in warn list.
- `tests/hooks/residue-audit.test.sh`: case 1 now asserts first-run silence (no warn), case 4 seeds a zero baseline before exercising the threshold override.
- `tests/scripts/paths.test.js`: 4 new tests covering `manifestPath()` location outside `stateDir()`, `readManifest()` migration from legacy path, `readManifest()` returns `exists:false` on cold, and preference of new over stale legacy.
- `tests/scripts/settings-merge.test.js` case 17 rewritten: `unmergeHook` now returns `s.hooks === undefined` (not `s.hooks.PreToolUse.length === 0`).
- `tests/scripts/status.test.js` + `install.test.js`: manifest paths updated to `.claudemd-manifest.json`; install-test `hooks.json` fixture bumped to 6 entries (SessionStart included); manifest entry-count assertions `5 → 6`.
- `tests/integration/full-lifecycle.test.sh`: Phase 3 manifest path updated; entry count `5 → 6`.
- Test totals: script tests 90 → 94; hook suites gain a new `session-start.test.sh` (6 cases); `banned-vocab.test.sh` 15 → 20 cases. Running `tests/run-all.sh`: 94/94 Node + all shell hook suites + full-lifecycle integration PASS.

No spec content change — ships at v6.9.3 as in v0.1.8.

## [0.1.8] - 2026-04-23

### Fixed — Hook behavior

- `hooks/banned-vocab-check.sh`: ratio-class patterns now honor a baseline-context exemption. When the commit message carries an explicit baseline anchor (numbers on both sides of `→` / `->` / `=>`, or the literal word `baseline`), ratio hits are suppressed. Previously the hook denied spec-compliant commits like `perf: rendering 240ms → 72ms (70% faster)` even though §10 "ratio with baseline" explicitly permits this form. Non-ratio patterns (hedges, evaluative adjectives) still deny regardless of arrows in the message. Implementation: `banned-vocab.patterns` tags ratio-class lines with `@ratio` in the reason column; the hook parses the tag and gates the hit on a per-command `BASELINE_EXEMPT` check. The prior pattern file header claim `false-positive none` is corrected to `false-positive low` — this bug was the counter-example.
- `hooks/banned-vocab.patterns`: every 中文 pattern now carries its own self-contained reason. Previously four patterns (`显著改善`, `显著优于`, `大幅改善`, `明显优于`) shared the literal string `同上`, so the hook's deny message printed a lone "同上" with no referent.

### Fixed — Docs

- `README.md`: 5 sites hardcoding `0.1.5` in install/uninstall command paths replaced with `<version>` placeholder plus a one-line discovery hint (`ls ~/.claude/plugins/cache/claudemd/claudemd/ | sort -V | tail -1`). Survives future version bumps without doc churn.
- `README.md`: two `Spec v6.9.2` references (What-it-installs table row + Project-layout comment) bumped to `v6.9.3` matching the shipped spec since v0.1.6.

### Added — Tests

- `tests/hooks/banned-vocab.test.sh`: 3 new cases covering the baseline exemption: EN ratio with `→` baseline passes, hedge (`should work`) with `→` in message still denies (exemption is ratio-only), 中文 ratio with `→` baseline passes. Test total: 12 → 15.

No `scripts/` change. Spec content unchanged at v6.9.3. Running `tests/run-all.sh`: shell hook suites + 90 Node script tests + full-lifecycle integration all pass.

## [0.1.7] - 2026-04-22

### Fixed — Docs

- Every reference to `/plugin update claudemd` across `README.md`, `commands/claudemd-update.md`, and `scripts/install.js` comments has been corrected. `/plugin update` is **not** a valid Claude Code slash command — Claude Code silently ignores unrecognized commands (no error, empty stdout), which is why users running `/plugin update claudemd` saw nothing happen and concluded the plugin was broken. The actual root cause sat in our own docs framing, not plugin code.
- `README.md` **Update** section rewritten to list the canonical upgrade sequence (`/plugin marketplace update claudemd` → `/plugin uninstall claudemd@claudemd` → `/plugin install claudemd@claudemd` → `/reload-plugins`) or the `/plugin` UI alternative.
- `README.md` **Troubleshooting** gains a leading entry for the `/plugin update claudemd does nothing / empty stdout` symptom, pointing at the canonical sequence with the manual `git fetch` + `git archive` + `install.js` recipe as last-resort fallback.
- `scripts/install.js` internal comment updated: former "went stale on /plugin update" phrasing replaced with version-neutral "went stale when CC swapped in a new version-dir on upgrade".

No code change in `scripts/` (beyond one comment) or `hooks/`. Spec content unchanged at v6.9.3. Tests unchanged: 90/90 pass + full-lifecycle integration PASS.

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
