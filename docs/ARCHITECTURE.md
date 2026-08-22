# Architecture

For full design rationale, see `docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md`. This file is the post-implementation reference.

## Four layers

1. **L1 Hooks** (`hooks/*.sh`) — deterministic shell, <3s nominal, fail-open on any internal error. Invoked directly by Claude Code. Shared bash helpers live in `hooks/lib/` (`hook-common.sh`, `rule-hits.sh`, `platform.sh`).
2. **L2 Management scripts** (`scripts/*.js`) — Node.js ≥20, handle install/uninstall/update/status/audit/toggle/doctor/hard-rules-audit/clean-residue/sampling-audit/…. Share a `scripts/lib/` module set (acyclic, rooted at `paths.js`).
3. **L3 Slash commands** (`commands/*.md`) — markdown stubs that tell the agent which L2 script to invoke.
4. **Standalone CLI** (`bin/claudemd-lint.js`) — the npm-published `claudemd-cli` (`lint` + `audit` for §10-V banned-vocab / transcript scanning in git hooks, CI, or other agents). Imports `scripts/lib/lint.js` (downward dependency only — no duplication of the matcher).

Dependency flow is strictly downward: L1 never imports L2; `bin/` imports `scripts/lib/` but never the reverse. A broken plugin install leaves hooks functional (or fail-open). Broken hooks leave commands functional.

## Positioning: §8 is a guardrail, not a security boundary

The `pre-bash-safety-check.sh` §8 gate (rm -rf $VAR / unpinned npx / curl|sh) steers the agent away from its **own** mistakes and makes rule-adherence observable — it is NOT an anti-injection security boundary. Any `DISABLE_*` env var or in-command `[allow-*]` escape token bypasses it by design, and it matches command shapes with a heuristic (normalized then blocklisted), so a motivated adversary can evade it. Investment goes to closing false-negatives for *natural* command shapes (e.g. `/bin/rm`, `${IFS}`-split), not to becoming a sandbox. Treat it as discipline tooling with a kill-switch.

## Invariants

- **Append-only on settings.json**: install/update never delete or reorder other-plugin entries.
- **settings.json writes are lock-free, idempotent, last-writer-wins**: read-modify-write with atomic tmp+rename (no torn file possible) but no cross-process lock. Two concurrent sessions racing an install can drop one writer's mutation; that is accepted because every mutation (legacy-hook eviction, statusline adopt) is idempotent and re-applied next session, and the spec-copy path fails loudly on its post-copy SHA256 check instead of corrupting (install.js).
- **L1 may spawn — never import — L2**: on version mismatch, `hook_spawn_install` (hooks/lib/hook-common.sh) runs `node scripts/install.js` detached, guarded by `command -v node`, a 10s timeout, and the `bootstrap-failed.json` failure sentinel; any failure is fail-open. The *import* dependency direction stays strictly downward (four-layers rule above).
- **Spec is artifact, not code**: hooks do not Read `~/.claude/CLAUDE.md` at runtime.
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
- `~/.claude/logs/claudemd.jsonl` — rule-hits append log (size-capped rotation at 5 MB → `.1` and `.2`)
- `~/.claude/logs/claudemd-bootstrap.log` — session-start install bootstrap log (rotated at 64 KiB → tail 32 KiB)
- `~/.claude/backup-<ISO>/` — spec backups (last 5 retained)
- `$TMPDIR/claudemd-sync-<scope>` — `version-sync.sh` once-per-session sentinel (`<scope>` = `CLAUDE_SESSION_ID`, else the CC process PPID). Self-GC'd past 24h by the hook itself; `/claudemd-clean-residue` reaps the rest.
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
