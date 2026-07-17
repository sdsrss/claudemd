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
      └─> aggregates ~/.claude/logs/claudemd.jsonl since session-start.ref
          └─> writes ~/.claude/.claudemd-state/last-session-summary.json
              └─> SessionStart hook reads + emits as additionalContext
                  └─> renames to .last-shown (consume-once)
```

## State locations

- `~/.claude/.claudemd-manifest.json` — install manifest (command string + SHA256, hook entries) (v0.1.9+; pre-0.1.9 lived at `stateDir()/installed.json` and is migrated on first read)
- `~/.claude/.claudemd-state/tmp-baseline.txt` — residue-audit last end-of-session count
- `~/.claude/.claudemd-state/session-start.ref` — sandbox-disposal + session-summary session reference timestamp
- `~/.claude/.claudemd-state/upstream-check.lastrun` — session-start upstream-check 24h sentinel
- `~/.claude/.claudemd-state/last-session-summary.json` — v0.8.0 R-N4 summary written on Stop, read on next SessionStart
- `~/.claude/.claudemd-state/last-session-summary.json.last-shown` — consume-once rename target after banner emission
- `~/.claude/.claudemd-state/bootstrap-failed.json` — background install.js failure sentinel (v0.50.0; written/cleared by `hook_spawn_install`, read by the SessionStart failure banner, stale copy cleared on version match)
- `~/.claude/logs/claudemd.jsonl` — rule-hits append log (size-capped rotation at 5 MB → `.1` and `.2`)
- `~/.claude/logs/claudemd-bootstrap.log` — session-start install bootstrap log (rotated at 64 KiB → tail 32 KiB)
- `~/.claude/backup-<ISO>/` — spec backups (last 5 retained)

## Hook taxonomy (16 hooks)

`spec_section` values below are the literal arguments each hook passes to `hook_record` (source-of-truth, not prose — refresh by re-extracting from `hooks/*.sh` rather than hand-editing this table).

| Event | Hook | Purpose | spec_section |
|---|---|---|---|
| PreToolUse:Bash | `pre-bash-safety-check.sh` | rm -rf $VAR + unpinned npx | `§8-rm-rf-var` / `§8-npx` |
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
| Stop | `mid-spine-yield-scan.sh` | mid-SPINE turn-yield detection | `§11-mid-spine-yield` |
| Stop | `transcript-structure-scan.sh` | REPORT four-section structure scan | `§iron-law-2` / `§10-four-section-order` / `§10-honesty` (dynamic) |
| Stop | `session-summary.sh` | session deny/bypass/warn aggregation | n/a (writes to state file, not jsonl) |
| SessionStart | `session-start-check.sh` | bootstrap on mismatch + upstream banner + session-summary banner | n/a |
| SessionEnd | `session-end-check.sh` | batch re-review / session-exit checks | `§11-session-exit` / `§13.2-batch-review` |

Hooks that emit `null` for `spec_section` are plugin-internal lifecycle, not spec enforcement. The `session-summary` hook is the only one that does NOT call `hook_record` at all — it writes to a separate state file consumed by `session-start-check`'s banner. See `docs/RULE-HITS-SCHEMA.md` for the full event taxonomy.
