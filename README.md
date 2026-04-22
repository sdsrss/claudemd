# claudemd

Claude Code plugin that enforces **AI-CODING-SPEC v6.9 HARD rules** through shell hooks and ships the spec as part of the plugin.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What it installs

| Layer | Contents |
|---|---|
| 5 shell hooks | `banned-vocab-check` · `ship-baseline-check` · `residue-audit` · `memory-read-check` · `sandbox-disposal-check` |
| 5 slash commands | `/claudemd-status` · `/claudemd-update` · `/claudemd-audit` · `/claudemd-toggle` · `/claudemd-doctor` |
| Spec v6.9.2 | `~/.claude/CLAUDE.md` · `CLAUDE-extended.md` · `CLAUDE-changelog.md` (backup-before-overwrite) |

If you already have `~/.claude/CLAUDE.md`, install moves your existing files to `~/.claude/backup-<ISO>/` (last 5 kept automatically) before writing the plugin version. Uninstall offers `keep / delete / restore`; `delete` requires an extra confirmation.

---

## Install

Run **both** slash commands inside Claude Code. First registers the GitHub marketplace, second installs the plugin:

```
/plugin marketplace add sdsrss/claudemd
/plugin install claudemd@claudemd
```

After the install finishes, run the plugin's install script once to copy the spec files into `~/.claude/` and evict any stale claudemd hook entries from `settings.json`:

```bash
node ~/.claude/plugins/cache/claudemd/claudemd/0.1.5/scripts/install.js
```

> Since v0.1.5, hook registration lives in the plugin's own `hooks/hooks.json` — the Claude Code harness expands `${CLAUDE_PLUGIN_ROOT}` there automatically on every invocation, so hooks track the active plugin version without manual re-registration. `install.js`'s remaining jobs are (1) copy `spec/CLAUDE*.md` into `~/.claude/` (with backup-before-overwrite), (2) evict any legacy claudemd hook entries from prior installs (≤0.1.1 absolute-path form, 0.1.2-0.1.4 `${CLAUDE_PLUGIN_ROOT}`-in-settings.json form), and (3) write the installed manifest. It never touches other-plugin hooks.

### Verify

```
/claudemd-status
/claudemd-doctor
```

`status` reports plugin version, shipped vs installed spec version, kill-switch state, and rule-hits row count. `doctor` runs 9+ health checks with `[✓] / [△] / [✗]` markers.

---

## Daily use

Once installed, the hooks run silently in the background:

| Trigger | Hook | What happens |
|---|---|---|
| `git commit` with banned vocab (e.g. `significantly`, `70% faster`, `should work`) | `banned-vocab-check` | Blocks the commit with a message pointing to §10-V spec rule. |
| `git push` while base-branch CI is red | `ship-baseline-check` | Blocks the push (2-second `gh run list` timeout; fail-open if `gh` absent or times out). |
| Session end with `~/.claude/tmp/` growth > 20 entries | `residue-audit` | Advisory stderr warning; never blocks. |
| Bash command matching ship/push/deploy/release with an unread matched `MEMORY.md` entry | `memory-read-check` | Blocks the command with a list of memory files to Read first. |
| Session end with fresh `tmp.XXXXXX`-style directories | `sandbox-disposal-check` | Advisory stderr warning. |

### Commands

| Command | Purpose |
|---|---|
| `/claudemd-status` | Plugin version + spec version + kill-switch state + logs line count. |
| `/claudemd-update` | Interactive diff against plugin-shipped spec, then apply-all / select-per-file / cancel. |
| `/claudemd-audit [--days N]` | Aggregate rule-hits over last N days (default 30). Top banned-vocab patterns, per-hook deny counts. |
| `/claudemd-toggle <hook-name>` | Enable/disable a specific hook by toggling `DISABLE_*_HOOK` in `settings.json` env. |
| `/claudemd-doctor [--prune-backups=N]` | Health checks; optionally prune `~/.claude/backup-*` dirs older than N. |

---

## Kill-switches (three tiers)

All visible in `/claudemd-status`.

**1. Plugin-wide.** All 5 hooks short-circuit before any logic:

```bash
export DISABLE_CLAUDEMD_HOOKS=1
```

**2. Per-hook.** Disable one hook, leave others active:

```bash
export DISABLE_BANNED_VOCAB_HOOK=1       # or
export DISABLE_SHIP_BASELINE_HOOK=1      # or
export DISABLE_RESIDUE_AUDIT_HOOK=1      # or
export DISABLE_MEMORY_READ_HOOK=1        # or
export DISABLE_SANDBOX_DISPOSAL_HOOK=1
```

**3. Per-invocation escape hatches** (no env var needed; embed in the command itself):

| Escape | Where | Bypasses |
|---|---|---|
| `[allow-banned-vocab]` | commit message | `banned-vocab-check` |
| `known-red baseline: <reason>` | commit body | `ship-baseline-check` |
| `[skip-memory-check]` | bash command string | `memory-read-check` |

---

## Uninstall

```
/plugin uninstall claudemd
```

Then, for the spec files in `~/.claude/`:

| Option | Behavior |
|---|---|
| `keep` (default) | `~/.claude/CLAUDE*.md` left in place; plugin hook entries removed from `settings.json`. |
| `delete` | Requires `CLAUDEMD_CONFIRM=1` env var (hard-AUTH). Removes the three spec files. |
| `restore` | Copies the most recent `~/.claude/backup-<ISO>/*.md` back to `~/.claude/`. |

Add `--purge` to also remove `~/.claude/logs/claudemd.jsonl` and `~/.claude/.claudemd-state/`.

Invoking the uninstall script directly:

```bash
CLAUDEMD_SPEC_ACTION=keep     node ~/.claude/plugins/cache/claudemd/claudemd/0.1.5/scripts/uninstall.js
CLAUDEMD_SPEC_ACTION=restore  node ~/.claude/plugins/cache/claudemd/claudemd/0.1.5/scripts/uninstall.js
CLAUDEMD_SPEC_ACTION=delete CLAUDEMD_CONFIRM=1 node ~/.claude/plugins/cache/claudemd/claudemd/0.1.5/scripts/uninstall.js
```

---

## Update

After `/plugin update claudemd` pulls a new plugin version, sync the shipped spec into `~/.claude/`:

```
/claudemd-update
```

The command prints per-file diff summary, then prompts `apply-all / select / cancel`. Backup is automatic (retained to 5). `/claudemd-update` never fetches from GitHub — that's `/plugin update claudemd`'s job.

---

## Troubleshooting

**`Plugin "claudemd" not found in any marketplace`** — you forgot the `/plugin marketplace add sdsrss/claudemd` step. Re-run it, then retry install.

**Hooks don't fire after install** — Claude Code's `postInstall` lifecycle is not guaranteed to execute. Run the install script manually:

```bash
node ~/.claude/plugins/cache/claudemd/claudemd/0.1.5/scripts/install.js
```

Verify with `/claudemd-status` — the "log.lines" count should increment after the next hook fires.

**`Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin`** (5 errors on every `Bash` tool call + every session end) — you're on claudemd 0.1.2 / 0.1.3 / 0.1.4. Those releases wrote hook commands into `~/.claude/settings.json` under the literal `${CLAUDE_PLUGIN_ROOT}` token, but the CC harness only expands that variable for hooks defined in a plugin's own `hooks/hooks.json` — never in `settings.json`. The fix is v0.1.5, which moves hook registration into the plugin's `hooks/hooks.json` (where the token expands correctly) and evicts the stale settings.json entries on install. Upgrade with `/plugin update claudemd`, then restart the Claude Code session to clear the cached hook registry. If `/plugin update` silently no-ops, the marketplace clone is stale — `git fetch + ff` under `~/.claude/plugins/marketplaces/claudemd/`, then unpack the newest tag into `~/.claude/plugins/cache/claudemd/claudemd/<version>/` and re-run `install.js`.

**`ship-baseline-check` silently passes on red CI** — `gh` CLI is not installed, or authentication failed. Install with `brew install gh` / `apt-get install gh` and run `gh auth login`. Check with `/claudemd-doctor` — it reports `gh: missing` if absent.

**CI matrix fails on macOS** — our own CI installs `coreutils` for GNU `timeout`. If you're running hooks outside the bundled CI, ensure `timeout` is on PATH (`brew install coreutils && export PATH="$(brew --prefix coreutils)/libexec/gnubin:$PATH"`).

**`/claudemd-doctor` reports backup growth** — run `/claudemd-doctor --prune-backups=5` to keep only the 5 most recent.

**`PreToolUse:Bash hook error ... No such file or directory`** pointing at `~/.claude/hooks/banned-vocab-check.sh` — Claude Code loaded `settings.json` at session start and cached the old hand-install hook entry in memory. `install.js` migrated the on-disk entry to the cache path and moved the original shell file to `~/.claude/backup-*/hooks/`, but the running session's hook registry is still stale. Exit and restart the Claude Code session — settings.json is re-read from disk, and the error stops. (This applies to any mid-session `settings.json` change, not just claudemd.)

---

## Extending

- **Add a 6th hook**: see `docs/ADDING-NEW-HOOK.md` for the 5-step guide (hook script + test + plugin registration + doc + version bump).
- **Rule-hits log schema**: see `docs/RULE-HITS-SCHEMA.md` for the JSONL row format used by `/claudemd-audit`.
- **Design rationale + decisions log**: `docs/superpowers/specs/2026-04-21-claudemd-plugin-design.md`.

---

## Project layout

```
claudemd/
├── .claude-plugin/
│   ├── plugin.json           # minimal manifest (name, version, author, license, keywords)
│   └── marketplace.json      # marketplace catalog entry
├── hooks/                    # 5 shell hooks + hooks/lib/ (hook-common, rule-hits, platform)
│   └── hooks.json            # authoritative hook registration (v0.1.5+); CC expands ${CLAUDE_PLUGIN_ROOT} here
├── commands/                 # 5 slash-command markdown files
├── scripts/                  # 7 Node.js management scripts + scripts/lib/
├── spec/                     # shipped v6.9.2 CLAUDE*.md trio
├── tests/                    # hook shell tests + Node.js tests + integration + fixtures
├── docs/                     # ADDING-NEW-HOOK.md + RULE-HITS-SCHEMA.md + superpowers/
└── .github/workflows/ci.yml  # ubuntu + macOS × node 20
```

---

## License

MIT. See [LICENSE](LICENSE).
