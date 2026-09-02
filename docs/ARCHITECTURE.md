# Architecture

For full design rationale, see `docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md`. This file is the post-implementation reference.

## Four layers

1. **L1 Hooks** (`hooks/*.sh`) — deterministic shell, <3s nominal, fail-open on any internal error. Invoked directly by Claude Code. Shared bash helpers live in `hooks/lib/` (`hook-common.sh`, `rule-hits.sh`, `platform.sh`, `memory-tags.sh`).
2. **L2 Management scripts** (`scripts/*.js`) — Node.js ≥20, handle install/uninstall/update/status/audit/toggle/doctor/hard-rules-audit/clean-residue/sampling-audit/…. Share a `scripts/lib/` module set (acyclic, rooted at `paths.js`).
3. **L3 Slash commands** (`commands/*.md`) — markdown stubs that tell the agent which L2 script to invoke.
4. **Standalone CLI** (`bin/claudemd-lint.js`) — the npm-published `claudemd-cli` (`lint` + `audit` for §10-V banned-vocab / transcript scanning in git hooks, CI, or other agents). Imports `scripts/lib/lint.js` (downward dependency only — no duplication of the matcher).

Dependency flow is strictly downward: L1 never imports L2; `bin/` imports `scripts/lib/` but never the reverse. A broken plugin install leaves hooks functional (or fail-open). Broken hooks leave commands functional.

## Module inventory

Module → responsibility → external interface. "External" means what a caller outside the module relies on: a CLI shape, exported symbols, or a file/env contract. Hooks are one row here because their interface is uniform; the per-hook purpose table is [Hook taxonomy](#hook-taxonomy) below. Re-derive the import edges with `node scripts/baseline-metrics.js --json` (`cycles` block) rather than trusting this list.

**L1 — hooks (bash)**

| Module | Responsibility | External interface |
|---|---|---|
| `hooks/*.sh` (15 hooks) | Per-event enforcement / advisory (see taxonomy) | Wired by `hooks/hooks.json`; stdin = Claude Code event JSON; stdout = one JSON object (deny / additionalContext) or nothing; always exit 0; per-hook kill-switch `DISABLE_<HOOK>_HOOK=1` (names from `scripts/lib/hook-registry.js`) |
| `hook-common.sh` | Fail-open runtime shared by every hook: event parsing, deny/record emission, readonly fast-path, heredoc stripping, command flattening, background install spawn | `hook_read_event` / `hook_read_bash_fields` / `hook_jq_field` / `hook_deny` / `hook_record` / `hook_record_failopen` / `hook_kill_switch` / `hook_require_jq` / `hook_is_readonly_bash` / `hook_flatten_cmd` / `hook_strip_heredoc_bodies` / `hook_trigger_view` / `hook_spawn_install` |
| `rule-hits.sh` | Append-only JSONL audit log with size-capped rotation | `rule_hits_append` / `hook_encode_project`; writes `~/.claude/logs/claudemd.jsonl` (schema: `docs/RULE-HITS-SCHEMA.md`) |
| `platform.sh` | GNU/BSD abstraction for stat / find / timeout | `platform_stat_mtime` / `platform_find_newer` / `platform_timeout` |
| `memory-tags.sh` | MEMORY.md `[tag]` index parsing + prompt matching in one awk pass | `memtags_match` / `memtags_failopen`; spills past the 128 KiB env cliff to `$TMPDIR/claudemd-memtags-hay-*` |
| `hooks/banned-vocab.patterns` | §10-V pattern list — the single source for the bash hook and the JS engine | One pattern per line; read by `banned-vocab-check.sh`, `transcript-vocab-scan.sh` and `scripts/lib/lint.js` |

**L2 — management scripts (Node ≥20, ESM)**

| Module | Responsibility | External interface |
|---|---|---|
| `scripts/install.js` | Copy spec into `~/.claude/`, merge hook entries into `settings.json`, write manifest, adopt statusLine, prune plugin cache | `node scripts/install.js` (no flags; env `CLAUDEMD_NO_STATUSLINE`, …); wired by the plugin lifecycle and by `hook_spawn_install` |
| `scripts/uninstall.js` | Reverse of install: unmerge hooks, clear manifest, optional `--purge` of state | `node scripts/uninstall.js` (env-driven); exports `CLAUDEMD_STATE_FILE_RE` |
| `scripts/update.js` | Diff installed `~/.claude/CLAUDE*.md` against the shipped spec; apply on request | `node scripts/update.js`; env `CLAUDEMD_UPDATE_CHOICE=apply-all` |
| `scripts/status.js` | Plugin / spec / kill-switch / log status | `node scripts/status.js [--verbose]` → JSON |
| `scripts/doctor.js` | Health checks: deps, spec drift, settings, hook drift, backups, rule usage, routing primaries, memory layers | `node scripts/doctor.js [--prune-backups=N]` |
| `scripts/toggle.js` | Flip one hook's `DISABLE_*` env in `settings.json` | `node scripts/toggle.js <hook-name>` |
| `scripts/audit.js` | Aggregate rule-hits over a window | `node scripts/audit.js [--days=N]` → JSON |
| `scripts/hard-rules-audit.js` | Join `spec/hard-rules.json` with rule-hits → demote candidates | `node scripts/hard-rules-audit.js [--days=N]` |
| `scripts/sparkline.js` | Rule-usage trend across three windows | `node scripts/sparkline.js` → markdown block |
| `scripts/sampling-audit.js` | Retrospective transcript scan for 8 self-enforced HARD rules | `node scripts/sampling-audit.js [--global] [--sample=N] …` |
| `scripts/lesson-bypass-audit.js` | Cite-recall of memory hints vs later transcript activity | `node scripts/lesson-bypass-audit.js [--days=N]` |
| `scripts/spec-coherence-audit.js` | Read-only core ↔ extended ↔ MEMORY.md ↔ patterns coherence audit | `node scripts/spec-coherence-audit.js` |
| `scripts/safety-coverage-audit.js` | Static check that hooks implement every §8 clause they quote | `node scripts/safety-coverage-audit.js` |
| `scripts/clean-residue.js` | Reap sentinels / stale tmp / orphan state past retention | `node scripts/clean-residue.js [--apply] [--age-days=N] [--retention-days=N]` |
| `scripts/statusline-adopt.js` | Manage the statusLine slot in `settings.json` | `node scripts/statusline-adopt.js <detect\|adopt\|remove> [--json] [--force]` |
| `scripts/design-detect.js` | Stateless design-token detector for `/claudemd-design-adopt` | `node scripts/design-detect.js [--json] [--cwd=PATH]` |
| `scripts/lint-argv.js` | Repo gate against argv silent-fallback shapes | `node scripts/lint-argv.js` (exit 1 on hit); `npm run lint:argv` |
| `scripts/version-cascade-check.js` | Pre-tag version / Sizing-line consistency | `node scripts/version-cascade-check.js`; `npm run version-check` |
| `scripts/baseline-metrics.js` | Repeatable code-health baseline (files, long functions, duplication, cycles, coverage, lint) | `node scripts/baseline-metrics.js [--json] [--skip-*]`; `npm run metrics` |
| `scripts/statusline.sh` | PS1-style statusLine renderer | Invoked by Claude Code's `statusLine.command`; stdin = status JSON |
| `scripts/refresh-plugin.sh` | Marketplace update → uninstall → install in one shot | `bash scripts/refresh-plugin.sh` (via `/claudemd-refresh`) |
| `scripts/perf-baseline.sh` | Hook overhead measurement over a fixed command set | `bash scripts/perf-baseline.sh` |

**L2 shared library (`scripts/lib/`, acyclic, rooted at `paths.js`)**

| Module | Responsibility | Exports |
|---|---|---|
| `paths.js` | Every `~/.claude` location, plugin root, manifest, semver; the one shape-preserving JSON writer | `stateDir` `manifestPath` `settingsPath` `logsDir` `backupRoot` `specHome` `pluginCacheDir` `resolvePluginRoot` `readPluginVersion` `readManifest` `writeJsonAtomic` `encodeProjectCwd` `projectDir` `semverCmp` `SPEC_FILES` … |
| `argv.js` | Strict `--key=value` argv parser shared by every script | `parseStrict` `printHelpAndExit` `parsePositiveInt` `validateAndExpandFlags` `ArgvError` |
| `settings-merge.js` | Read `settings.json`; merge and unmerge hook entries (the write itself is `paths.js#writeJsonAtomic`) | `readSettings` `writeSettings` `mergeHook` `unmergeHook` `isClaudemdLegacyHookCommand` |
| `backup.js` | Timestamped backups of spec + settings; prune; legacy detection; restore | `createBackup` `listBackups` `pruneBackups` `backupSettingsFile` `restoreBackup` `findLegacySpecBackups` `BACKUP_LABELS` … |
| `hook-registry.js` | Single source of hook names ↔ `DISABLE_*` env suffixes | `HOOK_REGISTRY` `HOOK_BASENAMES` `HOOK_ENV_SUFFIXES` `HOOK_NAME_TO_ENV` |
| `spec-hash.js` / `spec-diff.js` / `install-drift.js` | Installed-vs-shipped comparison: hash, unified diff, hook-entry drift; the one spec-copy path (verify + rollback) | `sha256File` `compareSpecs` `copySpecFiles` / `diffSpec` / `compareHooks` |
| `lint.js` | §10-V banned-vocab engine + transcript parser (shared with `bin/`) | `readPatterns` `scan` `parseTranscript` `stripIdentifiers` `stripGitCommitComments` `formatHumanReadable` `formatJSON` `DEFAULT_PATTERNS_FILE` … |
| `rule-hits-parse.js` | JSONL reader + every aggregation the audit scripts use | `readHits` `groupBySection` `groupByHook` `topPatterns` `byBypass` `byFailOpen` `byTrend` `blockingDenyCount` … |
| `memory-tags.js` | MEMORY.md index parsing, tag classification, size budget | `parseMemoryIndex` `classifyTag` `scanMemoryTags` `scanMemoryIndexSizes` `MEMORY_INDEX_BUDGET_BYTES` |
| `memory-maintenance.js` | Cross-layer memory promote / repatriate / stale scan (needs `node:sqlite`, self-skips on Node 20) | `memoryMaintenance` + threshold constants |
| `spec-routing.js` | §2.1 routing-table parser | `routingPrimaries` `tableRows` `skillTokens` `SKILL_ALIASES` |
| `runbook-review-check.js` | Ship-runbook review-step scanner (doctor) | `scanRunbookReviewSteps` |
| `statusline.js` / `statusline-hosts.js` | statusLine detect / adopt / remove; host adapters (code-graph guest slot) | `detect` `adopt` `remove` / `detectHost` `HOST_ADAPTERS` `CLAUDEMD_PROVIDER_ID` |
| `cache-prune.js` | Prune older plugin-cache versions (two gates: semver basename **and** realpath under `pluginCacheDir()`) | `pruneCache` |
| `transcript-user-turn.js` | Normalise the two user-turn content shapes (string vs array) | `userTurnText` `isUserTurn` |

**L3 / CLI / spec**

| Module | Responsibility | External interface |
|---|---|---|
| `commands/*.md` (16) | Slash-command stubs; each names the L2 script to run | `/claudemd-<name>` in Claude Code |
| `bin/claudemd-lint.js` | npm `claudemd-cli`: banned-vocab lint + transcript audit | `claudemd-cli lint <text\|--file\|--stdin> [--json] [--commit-msg]`, `claudemd-cli audit <jsonl>`; exit 0 clean / 1 hits |
| `spec/` | Shipped spec (`CLAUDE.md`, `CLAUDE-extended.md`, `OPERATOR.md`, changelog) + `hard-rules.json` mirror | Copied verbatim into `~/.claude/` by install/update; gated by the drift tests |
| `tests/` | 62 node suites, 28 hook suites, 4 integration suites, shared libs under `tests/lib/` | `npm test` (= `bash tests/run-all.sh`); `npm run test:scripts` / `test:hooks` / `test:coverage` |

## Module dependency graph

Static import edges (JS `import` / `import()`, bash `source`), as extracted by `scripts/baseline-metrics.js`. Arrows point at the dependency. There are no cycles; the metrics script's real-tree test asserts that.

```
bin/claudemd-lint.js ──► scripts/lib/lint.js, scripts/lib/argv.js

scripts/install.js ──► lib/{backup, cache-prune, hook-registry, paths, settings-merge, statusline, argv}
scripts/uninstall.js ──► lib/{backup, hook-registry, paths, settings-merge, statusline, argv}
scripts/update.js ──► lib/{backup, paths, spec-diff, argv}
scripts/status.js ──► lib/{hook-registry, paths, settings-merge, spec-hash, argv}
scripts/toggle.js ──► lib/{hook-registry, settings-merge, argv}
scripts/doctor.js ──► scripts/clean-residue.js, lib/{backup, hook-registry, install-drift, memory-maintenance,
                      memory-tags, paths, rule-hits-parse, runbook-review-check, settings-merge, spec-hash,
                      spec-routing, argv}
scripts/audit.js ──► scripts/sampling-audit.js, lib/{paths, rule-hits-parse, argv}
scripts/sampling-audit.js ──► lib/{lint, paths, rule-hits-parse, transcript-user-turn, argv}
scripts/{hard-rules-audit, lesson-bypass-audit, sparkline}.js ──► lib/{paths, rule-hits-parse, argv}
scripts/spec-coherence-audit.js ──► lib/{lint, paths, argv}
scripts/{safety-coverage-audit, clean-residue, version-cascade-check}.js ──► lib/{paths, argv}
scripts/statusline-adopt.js ──► lib/{statusline, paths, argv}
scripts/{design-detect, lint-argv}.js ──► lib/argv
scripts/baseline-metrics.js ──► lib/argv

scripts/lib/statusline.js ──► lib/{backup, settings-merge, statusline-hosts, paths}
scripts/lib/install-drift.js ──► lib/spec-hash ──► lib/paths
scripts/lib/{backup, cache-prune, memory-maintenance, settings-merge, statusline-hosts}.js ──► lib/paths
scripts/lib/{argv, lint, rule-hits-parse, memory-tags, spec-routing, spec-diff, hook-registry,
             runbook-review-check, transcript-user-turn}.js ──► (leaf: node: builtins only)

hooks/<every hook>.sh ──► hooks/lib/hook-common.sh ──► hooks/lib/rule-hits.sh
hooks/{mem-audit, memory-prompt-hint, sandbox-disposal-check, session-start-check, session-summary,
       ship-baseline-check, version-sync}.sh ──► hooks/lib/platform.sh
hooks/{memory-prompt-hint, memory-read-check}.sh ──► hooks/lib/memory-tags.sh
scripts/perf-baseline.sh ──► hooks/lib/rule-hits.sh
```

Two script-to-script edges exist and are deliberate: `doctor.js` reuses `clean-residue.js`'s orphan scan, and `audit.js` reuses `sampling-audit.js`'s self-compliance section. Neither is imported back.

## Main flows

Each flow in at most five steps. File names are the entry points to read.

**1. Bootstrap / version sync (SessionStart)**
1. Claude Code runs `session-start-check.sh` with the session event on stdin.
2. The hook compares the manifest version and `cmp`s the installed spec against the shipped copy.
3. On mismatch it calls `hook_spawn_install`, which runs `scripts/install.js` detached under a 10 s timeout.
4. `install.js` backs up the existing spec, copies the shipped files with a SHA-256 post-check, merges hook entries into `settings.json`, writes the manifest.
5. Failure leaves `bootstrap-failed.json`; the next SessionStart banner reports it.

**2. Bash command gate (PreToolUse:Bash)**
1. Four hooks run in order: `pre-bash-safety-check.sh`, `banned-vocab-check.sh`, `ship-baseline-check.sh`, `memory-read-check.sh`.
2. Each calls `hook_read_bash_fields` (jq parse, heredoc-body strip, line-continuation flatten) and exits early when `hook_is_readonly_bash` classifies the command as read-only.
3. The hook matches its own command shapes (rm -rf $VAR / unpinned npx / curl|sh; git commit -m prose; git push with red base-branch CI; ship verbs without a matched MEMORY.md Read).
4. A hit emits one deny JSON object via `hook_deny` (or is downgraded to a bypass row by an in-command `[allow-*]` token); a miss emits nothing. Exit is always 0.
5. `hook_record` appends the verdict to `~/.claude/logs/claudemd.jsonl` with `spec_section`.

**3. Spec update (`/claudemd-update`)**
1. `scripts/update.js` resolves the plugin root and the installed `~/.claude/CLAUDE*.md`.
2. `diffSpec` produces a per-file unified diff; the default run prints it and exits.
3. With `CLAUDEMD_UPDATE_CHOICE=apply-all`, `createBackup` snapshots the installed files.
4. The shipped files are copied over the installed ones.
5. `session-start-check.sh` sees no drift on the next session and stays silent.

**4. Audit loop (rule-hits → `/claudemd-audit` → `/claudemd-doctor`)**
1. Every hook verdict lands in `claudemd.jsonl` (flow 2, step 5).
2. `scripts/audit.js` reads the window with `readHits`, aggregates `groupBySection` / `topPatterns` / `byBypass`, and appends the sampling-audit self-compliance section.
3. `scripts/hard-rules-audit.js` joins the same rows with `spec/hard-rules.json` to list rules with zero hits.
4. `scripts/doctor.js` surfaces those as demote candidates alongside spec drift, hook drift and backup inventory.
5. A spec edit that follows goes through `spec/` + version bump + ship, never `~/.claude/` directly.

**5. Standalone lint (`claudemd-cli`, npm)**
1. `bin/claudemd-lint.js` validates argv with `validateAndExpandFlags` (space-form flags, auto `--file` for an existing path).
2. `readPatterns` loads `hooks/banned-vocab.patterns`; commit-message mode strips git's `#` template and scissors block.
3. `scan` runs the same matcher the hook uses and reports hits with pattern + context.
4. Output is human-readable or `--json`; exit 1 on any hit so pre-commit hooks and CI can gate on it.

**6. Memory hint and read enforcement**
1. On UserPromptSubmit, `memory-prompt-hint.sh` runs `memtags_match` over the prompt against MEMORY.md `[tag]` entries.
2. Matches are emitted as additionalContext naming the files to Read (advisory).
3. When a later Bash command is a ship verb, `memory-read-check.sh` checks the transcript for a Read of a matched file.
4. No Read → deny with the file list; an in-command `[skip-memory-check: <reason>]` token records a bypass row (reason kept in `extra.bypass_reason`) instead.

## Positioning: §8 is a guardrail, not a security boundary

The `pre-bash-safety-check.sh` §8 gate (rm -rf $VAR / unpinned npx / curl|sh) steers the agent away from its **own** mistakes and makes rule-adherence observable — it is NOT an anti-injection security boundary. Any `DISABLE_*` env var or in-command `[allow-*]` escape token bypasses it by design, and it matches command shapes with a heuristic (normalized then blocklisted), so a motivated adversary can evade it. Investment goes to closing false-negatives for *natural* command shapes (e.g. `/bin/rm`, `${IFS}`-split), not to becoming a sandbox. Treat it as discipline tooling with a kill-switch.

## Invariants

- **Append-only on settings.json**: install/update never delete or reorder other-plugin entries.
- **settings.json writes are lock-free, idempotent, last-writer-wins**: read-modify-write with atomic tmp+rename (no torn file possible) but no cross-process lock. Two concurrent sessions racing an install can drop one writer's mutation; that is accepted because every mutation (legacy-hook eviction, statusline adopt) is idempotent and re-applied next session, and the spec-copy path fails loudly on its post-copy SHA256 check instead of corrupting (install.js). The race window is narrower than this paragraph used to imply: since v0.71.4 `install.js` writes settings.json **only when eviction removed something**, which in steady state is never.
- **Writes into `~/.claude` preserve the file's shape**: every JSON write goes through `paths.js#writeJsonAtomic`, which resolves symlinks before writing (so a `settings.json -> dotfiles/settings.json` setup stays a link and the target gets the content) and carries the existing mode forward (so a 0600 settings.json is not widened to 0664 by the umask). Added v0.71.4 after all three tmp+rename copies were found to do neither. Anything new that writes user JSON uses it rather than `writeFileSync` + `rename`.
- **The spec trio lands all-or-nothing**: `spec-hash.js#copySpecFiles` is the single path for writing `spec/*.md` into `~/.claude` (install and update both use it). Each copy is sha256-verified, and when the caller took a backup — `createBackup` *renames* the originals away — any failure restores every file from it before rethrowing. Added v0.71.4 (R11-09): update.js previously ran a bare `copyFileSync` loop, so a mid-loop ENOSPC left one new file and three missing, the partial state `update.js:37-39` forbids because §EXT cross-references dangle.
- **A gate judges the repo it was asked about**: `ship-baseline-check.sh` resolves the push target (`git -C <dir>`, then a leading `cd <dir>`, then the event cwd) and runs its `git`/`gh` calls there, falling back to the hook's own cwd when the target is not a worktree. Before v0.71.4 it used the hook process's cwd unconditionally, so repo A's CI colour decided a push to repo B.
- **One shell view, one parser**: `hook_trigger_view` strips quotes with a single awk state machine, not chained per-quote-type seds. Two passes cannot see each other's context and will pair the closing quote of one region with the opening quote of the next, deleting the command in between — the v0.47.1 lesson on the §8 side, applied here in v0.71.4 (R11-05).
- **`npm run lint` is an `&&` chain, so a red step hides its successors**: the ship gates (`lint:argv`, `version-check`) run FIRST, ahead of the burn-down-pending `lint:js`. `tests/scripts/lint-argv.test.js` asserts that order.
- **Recursive deletion is gated on location, not on name shape**: `pruneCache` checks the realpath of its scan target against `pluginCacheDir()` in addition to the semver-basename check, because a name shape says nothing about where the scan happens (v0.71.4). Same posture as the basename guard on `uninstall.js`'s purge path.
- **L1 may spawn — never import — L2**: on version mismatch, `hook_spawn_install` (hooks/lib/hook-common.sh) runs `node scripts/install.js` detached, guarded by `command -v node`, a 10s timeout, and the `bootstrap-failed.json` failure sentinel; any failure is fail-open. The *import* dependency direction stays strictly downward (four-layers rule above).
- **Spec is artifact, not code**: no hook parses `~/.claude/CLAUDE.md` to decide what to enforce — rules are compiled into the hook scripts and `hooks/banned-vocab.patterns`. (`session-start-check.sh` does `cmp` the installed spec against the shipped one to raise the drift banner; that reads the file as an artifact to hash, not as instructions.)
- **`${CLAUDE_PLUGIN_ROOT}` is a hint**: scripts derive their own base path from `__dirname` / `${BASH_SOURCE[0]}` (cross-version safe).
- **Spec → hook → audit data plane is closed-loop** (v0.7.0+): `spec/CLAUDE*.md` rules → `hooks/*.sh` enforcement → `~/.claude/logs/claudemd.jsonl` rule-hits with `spec_section` field → `/claudemd-audit` `bySection` aggregation. v0.8.0 closes the spec side: `spec/hard-rules.json` is the machine-readable mirror of every `(HARD)` annotation; `tests/scripts/hard-rules-drift.test.js` and `tests/scripts/spec-pattern-drift.test.js` are the CI gates that prevent silent edits to either side.

## Data flow

```
User action / session end
  └─> Claude Code harness
      └─> hooks/hooks.json (PreToolUse / Stop / SessionStart / UserPromptSubmit)
          └─> bash hooks/<name>.sh   (exit 0 silent, or deny JSON)
                └─> hook_record → ~/.claude/logs/claudemd.jsonl (audit trail)
                                   ├─ spec_section field (v0.7.0)
                                   └─ project field (v0.6.2)
```

Session-summary follows a separate path:

```
Stop hook
  └─> hooks/session-summary.sh
      └─> aggregates ~/.claude/logs/claudemd.jsonl since session-summary.lastrun
          └─> writes ~/.claude/.claudemd-state/last-session-summary.json
              └─> SessionStart hook reads + emits as additionalContext
                  └─> renames to .last-shown (consume-once)
```

## State locations

- `~/.claude/.claudemd-manifest.json` — install manifest (command string + SHA256, hook entries) (v0.1.9+; pre-0.1.9 lived at `stateDir()/installed.json` and is migrated on first read)
- `~/.claude/.claudemd-state/tmp-baseline-<sid>.txt` — residue-audit per-session baseline (2026-08-16 audit CONC-3); orphans reaped by clean-residue.js
- `~/.claude/.claudemd-state/tmp-baseline.txt` — legacy residue-audit baseline, still written by sessions whose event carries no session_id
- `~/.claude/.claudemd-state/session-start-<sid>.ref` — sandbox-disposal per-session window ref (2026-08-16 audit F5); orphans reaped by clean-residue.js
- `~/.claude/.claudemd-state/session-start.ref` — legacy sid-less sandbox-disposal ref (session-summary stopped reading it in v0.9.13 — it owns the `session-summary-*.lastrun` family)
- `~/.claude/.claudemd-state/upstream-check.lastrun` — session-start upstream-check 24h sentinel
- `~/.claude/.claudemd-state/last-session-summary.json` — v0.8.0 R-N4 summary written on Stop, read on next SessionStart
- `~/.claude/.claudemd-state/last-session-summary.json.last-shown` — consume-once rename target after banner emission
- `~/.claude/.claudemd-state/bootstrap-failed.json` — background install.js failure sentinel (v0.50.0; written/cleared by `hook_spawn_install`, read by the SessionStart failure banner, stale copy cleared on version match)
- `~/.claude/.claudemd-state/bootstrap-failed.json.last-shown` — consume-once rename target after the failure banner (`session-start-check.sh:206`, the same idiom as the summary banner above). **Not** matched by clean-residue's state-dir patterns — only `/claudemd-uninstall --purge` removes it, so a machine that hit one background-install failure keeps the file indefinitely (2026-08-29 audit R10-21e)
- `~/.claude/.claudemd-state/ext-read-<sid>.ts` — per-session §13.1-extended-read dedup sentinel (`session-extended-read.sh`). Reaped by `session-end-check.sh` for its OWN session only, so a crash / kill / abnormal exit leaks one; `/claudemd-clean-residue` reaps the rest past the retention window.
- `~/.claude/.claudemd-state/failopen-<hook>-<reason>.ts` — `hook_record_failopen` rate-limit marker (1 row per (hook, reason) per 60s)
- `~/.claude/.claudemd-state/mem-coverage-<sid>.ts` — **dead**: written by the `memory-coverage-scan` Stop hook removed in v0.23.12. No in-tree producer remains; existing copies are reaped by `/claudemd-clean-residue`.
- `~/.claude/.claudemd-state/l2-task-counter` — §13.2 batch-review L2+ session counter (`session-end-check.sh`, reset on advisory trip)
- `~/.claude/.claudemd-state/ship-baseline-recent` — ship-baseline recent-run cache
- `~/.claude/.claudemd-state/mem-audit.lastrun` — `mem-audit.sh` cadence sentinel
- `~/.claude/.claudemd-state/session-summary-<sid>.lastrun` — `session-summary.sh` per-session window ref (audit-2026-08-22 条目 6; one global file meant concurrent sessions shared a window and the banner was decided by whichever stopped first); orphans reaped by clean-residue.js
- `~/.claude/.claudemd-state/session-summary.lastrun` — legacy sid-less session-summary cadence sentinel, still written by sessions whose Stop event carries no session_id
- `~/.claude/.claudemd-state/statusline-prev.json` — prior statusLine command saved by `/claudemd-statusline` so `remove` can restore it
- `~/.claude/.claudemd-state/vocab-scan-<sid>.last` — per-session transcript-vocab-scan content-hash cursor (`transcript-vocab-scan.sh`). Nothing reaps it on session end; `/claudemd-clean-residue` reaps it past the retention window.
- `~/.claude/logs/claudemd.jsonl` — rule-hits append log (size-capped rotation at 5 MB → `.1` and `.2`). Every JS consumer reads all three generations via `rule-hits-parse.js#logGenerations` (oldest → newest); before v0.71.4 they read only the primary, so the first rotation would have silently truncated every window to whatever had accumulated since it.
- `~/.claude/logs/claudemd-bootstrap.log` — session-start install bootstrap log (rotated at 64 KiB → tail 32 KiB)
- `~/.claude/backup-<ISO>/` — spec backups (last 5 retained)
- `$TMPDIR/claudemd-sync-<scope>` — `version-sync.sh` once-per-session sentinel. `<scope>` = `CLAUDE_SESSION_ID` if exported, else `.session_id` read off the hook's own stdin event, else the CC process PPID. The stdin leg was added in v0.71.4: CC does not export `CLAUDE_SESSION_ID` to hooks, so the PPID fallback was the *only* live path and "once per session" was in practice once per prompt. Self-GC'd past 24h by the hook itself; `/claudemd-clean-residue` reaps the rest.
- `$TMPDIR/claudemd-memtags-hay-<rand>` — `hooks/lib/memory-tags.sh` haystack spill past the 128 KiB env-argument cliff (audit-2026-08-22 P1-5). Removed by a trap installed before the mktemp; a SIGKILL at the hooks.json timeout still strands one, which `/claudemd-clean-residue` reaps.

The `~/.claude/.claudemd-state/` and `$TMPDIR/claudemd-*` entries above are gated by `tests/scripts/architecture-drift.test.js`, which extracts state paths from `hooks/**/*.sh` and `scripts/**/*.js` (the `logs/` and `backup-` paths match neither shape and are not gated). Before that gate existed (2026-07-28 audit M1) this list documented 6 of the 15 kinds actually written — the same "doc declares itself source-of-truth with nothing checking it" failure the hook-taxonomy table below had, in the same file. Its first draft then missed `vocab-scan-*` because it keyed on the variable name `$STATE_DIR` while that hook uses `$VS_STATE_DIR`; the extractor now matches any variable whose name ends in `STATE_DIR`. All three matchers still keyed on the state DIRECTORY, so the `$TMPDIR/claudemd-*` sentinel family — `claudemd-sync-*` since v0.3.1, `claudemd-memtags-hay-*` since v0.68.2 — was structurally invisible to a gate written to catch undocumented state; audit-2026-08-22 条目 15 added the prefix-keyed matcher that finds it.

## Hook taxonomy

`spec_section` values below are the literal arguments each hook passes to `hook_record`. `tests/scripts/architecture-drift.test.js` extracts them from `hooks/**/*.sh` and fails if this table omits one — before that gate existed (2026-07-26) the table declared itself source-of-truth while missing `§8-curl-sh` and mislabelling `session-start-check` as `n/a`.

| Event | Hook | Purpose | spec_section |
|---|---|---|---|
| PreToolUse:Bash | `pre-bash-safety-check.sh` | rm -rf $VAR + unpinned npx + curl\|sh | `§8-rm-rf-var` / `§8-npx` / `§8-curl-sh` (`§8` = untagged fallback) |
| PreToolUse:Bash | `banned-vocab-check.sh` | git commit message + ship-flow prose §10-V scan | `§10-V` |
| PreToolUse:Bash | `ship-baseline-check.sh` | git push when base-branch CI is red | `§7-ship-baseline` |
| PreToolUse:Bash | `memory-read-check.sh` | ship/release require matched MEMORY.md Read | `§11-memory-read` |
| PreToolUse | `session-extended-read.sh` | enforce extended-spec Read on L3/ship triggers | `§13.1-extended-read` |
| PostToolUse | `transcript-vocab-scan.sh` | post-hoc §10-V scan of assistant prose | `§10-V` |
| UserPromptSubmit | `memory-prompt-hint.sh` | proactive matched-MEMORY.md recall hint (advisory) | `§11-memory-hint` |
| UserPromptSubmit | `version-sync.sh` | mid-session manifest sync | n/a |
| Stop | `residue-audit.sh` | ~/.claude/tmp/ growth advisory | `§7-user-global-state` |
| Stop | `sandbox-disposal-check.sh` | mkdtemp residue advisory | `§8.V4` |
| Stop | `mem-audit.sh` | MEMORY.md orphan/dangling advisory | `§11-EXT-mem-audit` |
| Stop | `transcript-structure-scan.sh` | REPORT four-section structure scan | `§iron-law-2` / `§10-four-section-order` / `§10-honesty` (dynamic) |
| Stop | `session-summary.sh` | session deny/bypass/warn aggregation | n/a (writes to state file, not jsonl) |
| SessionStart | `session-start-check.sh` | bootstrap on mismatch + upstream banner + session-summary banner | `§11-post-compaction` (compact-reminder); n/a for the lifecycle events |
| SessionEnd | `session-end-check.sh` | batch re-review / session-exit checks | `§11-session-exit` / `§13.2-batch-review` |

A hook may emit BOTH null-section lifecycle rows and spec-section rows — `session-start-check` does, so "emits null" is a property of the event, not of the hook. Rows whose section is null are plugin-internal lifecycle, not spec enforcement. The `session-summary` hook is the only one that does NOT call `hook_record` at all — it writes to a separate state file consumed by `session-start-check`'s banner. See `docs/RULE-HITS-SCHEMA.md` for the full event taxonomy.
