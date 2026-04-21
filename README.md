# claudemd

Enforce AI-CODING-SPEC v6.9 HARD rules via Claude Code hooks + ship the spec as part of the plugin.

## What it is

`claudemd` is a Claude Code plugin that installs:
- 5 hooks that block spec violations (banned vocab in commits, pushing to red CI, forgetting to read MEMORY.md entries, tmp-dir residue leaks, mkdtemp disposal)
- 5 slash commands (`/claudemd-status`, `/claudemd-update`, `/claudemd-audit`, `/claudemd-toggle`, `/claudemd-doctor`)
- AI-CODING-SPEC v6.9.2 (core + extended + changelog) into `~/.claude/`

On install, if you already have `~/.claude/CLAUDE.md`, your existing files are moved to `~/.claude/backup-<ISO>/` before the plugin version is written. Restore anytime via `/plugin uninstall claudemd` → `[r]estore`.

## 30-second install

```bash
# 1. Register this marketplace in ~/.claude/settings.json (one-time).
#    If you don't have a settings.json yet, this creates a minimal one.
jq '.extraKnownMarketplaces = (.extraKnownMarketplaces // {}) + {
  "claudemd": {"source": {"source": "github", "repo": "<user>/claudemd"}}
}' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json

# 2. In Claude Code:
/plugin install claudemd@claudemd
```

Then verify:

```
/claudemd-status
/claudemd-doctor
```

## Kill-switches

Three tiers. All visible in `/claudemd-status`.

- `DISABLE_CLAUDEMD_HOOKS=1` — plugin-wide.
- `DISABLE_BANNED_VOCAB_HOOK=1` / `DISABLE_SHIP_BASELINE_HOOK=1` / `DISABLE_RESIDUE_AUDIT_HOOK=1` / `DISABLE_MEMORY_READ_HOOK=1` / `DISABLE_SANDBOX_DISPOSAL_HOOK=1` — per-hook.
- Per-invocation escapes: `[allow-banned-vocab]` in commit message; `known-red baseline: <reason>` in commit body; `[skip-memory-check]` in bash command.

## Uninstall

`/plugin uninstall claudemd` prompts for spec disposition (keep / delete / restore). Delete requires an extra confirmation because `~/.claude/CLAUDE.md` may contain your local unsynced edits.

## License

MIT. See LICENSE.
