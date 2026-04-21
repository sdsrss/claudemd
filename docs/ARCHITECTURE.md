# Architecture

For full design rationale, see `docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md`. This file is the post-implementation reference.

## Three layers

1. **L1 Hooks** (`hooks/*.sh`) — deterministic shell, <3s nominal, fail-open on any internal error. Invoked directly by Claude Code.
2. **L2 Management scripts** (`scripts/*.js`) — Node.js 20, handle install/uninstall/update/status/audit/toggle/doctor. Share a `scripts/lib/` module set.
3. **L3 Slash commands** (`commands/*.md`) — markdown stubs that tell the agent which L2 script to invoke.

L1 never imports L2. A broken plugin install leaves hooks functional (or fail-open). Broken hooks leave commands functional.

## Invariants

- **Append-only on settings.json**: install/update never delete or reorder other-plugin entries.
- **Spec is artifact, not code**: hooks do not Read `~/.claude/CLAUDE.md` at runtime.
- **`${CLAUDE_PLUGIN_ROOT}` is a hint**: scripts derive their own base path from `__dirname` / `${BASH_SOURCE[0]}` (cross-version safe).

## Data flow

```
User action / session end
  └─> Claude Code harness
      └─> settings.json hook entries
          └─> bash hooks/<name>.sh   (exit 0 silent, or deny JSON)
                └─> hook_record → ~/.claude/logs/claudemd.jsonl (audit trail)
```

## State locations

- `~/.claude/.claudemd-state/installed.json` — manifest of injected entries (command string + SHA256)
- `~/.claude/.claudemd-state/tmp-baseline.txt` — residue-audit last end-of-session count
- `~/.claude/.claudemd-state/session-start.ref` — sandbox-disposal session reference timestamp
- `~/.claude/logs/claudemd.jsonl` — rule-hits append log
- `~/.claude/backup-<ISO>/` — spec backups (last 5 retained)
