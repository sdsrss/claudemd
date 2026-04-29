# claudemd

Claude Code plugin that enforces **AI-CODING-SPEC v6.11 HARD rules** through shell hooks and ships the spec as part of the plugin.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## What it installs

| Layer | Contents |
|---|---|
| 8 shell hooks | `banned-vocab-check` · `pre-bash-safety-check` · `ship-baseline-check` · `residue-audit` · `memory-read-check` · `sandbox-disposal-check` · `session-start-check` · `version-sync` |
| 6 slash commands | `/claudemd-status` · `/claudemd-update` · `/claudemd-audit` · `/claudemd-toggle` · `/claudemd-doctor` · `/claudemd-uninstall` |
| Spec v6.11.3 | `~/.claude/CLAUDE.md` · `CLAUDE-extended.md` · `CLAUDE-changelog.md` (backup-before-overwrite) |

If you already have `~/.claude/CLAUDE.md`, install moves your existing files to `~/.claude/backup-<ISO>/` (last 5 kept automatically) before writing the plugin version. Uninstall offers `keep / delete / restore`; `delete` requires an extra confirmation.

> ⚠️ **`~/.claude/CLAUDE.md` is shared real estate.** Claude Code reads this file as your user-global instructions across every project. If you've hand-written personal instructions there (`Always reply in 中文`, `My name is X`, etc.), install will back them up to `~/.claude/backup-<ISO>/CLAUDE.md` and replace them with the spec. Since v0.5.3, install prints a `[claudemd] WARN: …` line to stderr when the existing file does not look like a claudemd spec. To bring your personal instructions back on uninstall, run `CLAUDEMD_SPEC_ACTION=restore /claudemd-uninstall`.

---

## Prerequisites

| Tool | Required | Why |
|---|---|---|
| `node >= 20` | yes | install / status / doctor / update scripts (`package.json` engines) |
| `jq` | yes | every hook parses Claude Code event JSON via `jq` — without it hooks silently fail-open |
| `git` | yes | `ship-baseline-check` reads HEAD body; `session-start-check` runs `git ls-remote`; manual upgrade fallback |
| `gh` | recommended | `ship-baseline-check` calls `gh run list` — if absent, the hook fail-opens silently and shipping on red CI is no longer blocked |
| `coreutils` | macOS only | hooks need GNU `timeout`. Install with `brew install coreutils`, then prepend `$(brew --prefix coreutils)/libexec/gnubin` to your `PATH` |

Verify in one command (Linux): `node --version && jq --version && gh --version && git --version && timeout --version | head -1`. macOS users can swap `timeout` for `gtimeout` if `coreutils` is bottle-installed without the `gnubin` shim.

---

## Install

Run **both** slash commands inside Claude Code. First registers the GitHub marketplace, second installs the plugin:

```
/plugin marketplace add sdsrss/claudemd
/plugin install claudemd@claudemd
```

That's it for normal use. The plugin's own `hooks/hooks.json` is registered by Claude Code immediately, and the `SessionStart` hook bootstraps `install.js` in the background on your **next** Claude Code session — copying `spec/CLAUDE*.md` into `~/.claude/` (backup-before-overwrite) and writing the install manifest. Verify with `/claudemd-status` after the next session.

**Optional fast-path — activate in the current session without restarting.** If you want the spec files in `~/.claude/` immediately (e.g. you opened Claude Code specifically to install this plugin and don't want to `/exit` first), run the install script directly. Find `<version>` with `ls ~/.claude/plugins/cache/claudemd/claudemd/ | sort -V | tail -1`:

```bash
node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/install.js
```

> Since v0.1.5, hook registration lives in the plugin's own `hooks/hooks.json` — the Claude Code harness expands `${CLAUDE_PLUGIN_ROOT}` there automatically on every invocation, so hooks track the active plugin version without manual re-registration. `install.js`'s remaining jobs are (1) copy `spec/CLAUDE*.md` into `~/.claude/` (with backup-before-overwrite), (2) evict any legacy claudemd hook entries from prior installs (≤0.1.1 absolute-path form, 0.1.2-0.1.4 `${CLAUDE_PLUGIN_ROOT}`-in-settings.json form), and (3) write the installed manifest. It never touches other-plugin hooks. Claude Code's plugin-lifecycle `postInstall` field is not honored, so the script runs from `SessionStart` instead.

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
| Bash command with `rm -rf $VAR` (unvalidated expansion) or unpinned `npx <pkg>` | `pre-bash-safety-check` (v0.5.0+) | Blocks at PreToolUse:Bash per §8 SAFETY. Bypass via `[allow-rm-rf-var]` / `[allow-npx-unpinned]` token in the command, or pin/validate the variable. |
| `git push` while base-branch CI is red | `ship-baseline-check` | Blocks the push (2-second `gh run list` timeout; fail-open if `gh` absent or times out). |
| Session end with `~/.claude/tmp/` growth > 20 entries | `residue-audit` | Advisory stderr warning; never blocks. |
| Bash command matching ship/push/deploy/release with an unread matched `MEMORY.md` entry | `memory-read-check` | Blocks the command with a list of memory files to Read first. |
| Session end with fresh `tmp.XXXXXX`-style directories | `sandbox-disposal-check` | Advisory stderr warning. |
| New session start with GitHub remote tag newer than local cache max version | `session-start-check` (v0.4.0+) | Injects an "upgrade available" banner via `additionalContext` listing the 4-step upgrade sequence. Rate-limited to once per 24h via `~/.claude/.claudemd-state/upstream-check.lastrun` sentinel. 3-second `git ls-remote` timeout, fail-open. |
| First `UserPromptSubmit` after a mid-session `/plugin install` upgrade | `version-sync` (v0.3.1+) | Backgrounds `install.js` once per session when the manifest version diverges from the active plugin's `package.json`, so `~/.claude/CLAUDE*.md` syncs without `/exit`. Sentinel-gated; fail-open. |

### Commands

| Command | Purpose |
|---|---|
| `/claudemd-status` | Plugin version + spec version + kill-switch state + logs line count. |
| `/claudemd-update` | Interactive diff against plugin-shipped spec, then apply-all or cancel (spec trio is lockstep — per-file select would break §EXT cross-references). |
| `/claudemd-audit [--days N]` | Aggregate rule-hits over last N days (default 30). Top banned-vocab patterns, per-hook deny counts. |
| `/claudemd-toggle <hook-name>` | Enable/disable a specific hook by toggling `DISABLE_*_HOOK` in `settings.json` env. |
| `/claudemd-doctor [--prune-backups=N]` | Health checks; optionally prune `~/.claude/backup-*` dirs older than N. |
| `/claudemd-uninstall` | Pre-uninstall cleanup: clears manifest + state + log + legacy `settings.json` hook entries. Run BEFORE `/plugin uninstall claudemd@claudemd` (see [Uninstall](#uninstall)). |

---

## Kill-switches (three tiers)

All visible in `/claudemd-status`.

**1. Plugin-wide.** All 8 hooks short-circuit before any logic:

```bash
export DISABLE_CLAUDEMD_HOOKS=1
```

**2. Per-hook.** Disable one hook, leave others active:

```bash
export DISABLE_BANNED_VOCAB_HOOK=1         # or
export DISABLE_PRE_BASH_SAFETY_HOOK=1      # or
export DISABLE_SHIP_BASELINE_HOOK=1        # or
export DISABLE_RESIDUE_AUDIT_HOOK=1        # or
export DISABLE_MEMORY_READ_HOOK=1          # or
export DISABLE_SANDBOX_DISPOSAL_HOOK=1     # or
export DISABLE_SESSION_START_HOOK=1        # or
export DISABLE_USER_PROMPT_SUBMIT_HOOK=1
```

**2a. Per-sub-feature** (v0.4.0+). Sub-flags inside an enabled hook, named without the `_HOOK` suffix:

```bash
export DISABLE_UPSTREAM_CHECK=1            # only the upstream-tag-check sub-feature
                                           # of session-start-check; bootstrap-on-mismatch
                                           # behavior remains active.
```

**3. Per-invocation escape hatches** (no env var needed; embed in the command itself):

| Escape | Where | Bypasses |
|---|---|---|
| `[allow-banned-vocab]` | commit message | `banned-vocab-check` |
| `known-red baseline: <reason>` | commit body | `ship-baseline-check` |
| `[skip-memory-check]` | bash command string | `memory-read-check` |
| `[allow-rm-rf-var]` | bash command string | `pre-bash-safety-check` (rm-with-var path only) |
| `[allow-npx-unpinned]` | bash command string | `pre-bash-safety-check` (unpinned npx path only) |

---

## Uninstall

CC marketplace lifecycle does not fire `preUninstall`, so `/plugin uninstall claudemd@claudemd` alone leaves orphan state behind (`~/.claude/.claudemd-manifest.json`, `~/.claude/.claudemd-state/`, `~/.claude/logs/claudemd.jsonl`). Use the **two-step flow**:

```
/claudemd-uninstall                    # clear manifest + state + log (plugin still installed)
/plugin uninstall claudemd@claudemd    # CC removes plugin cache itself
```

Reversing the order is the orphan-state vector — `${CLAUDE_PLUGIN_ROOT}` and `scripts/uninstall.js` are gone after `/plugin uninstall`, with no in-tree tool to clean up afterwards. `/claudemd-doctor` flags `[△] plugin cache: orphan manifest …` if you've already hit this.

### Spec disposition

`/claudemd-uninstall` defaults to `keep` (leaves `~/.claude/CLAUDE*.md` in place). Override via env vars before the slash command:

| Option | Env vars | Behavior |
|---|---|---|
| `keep` (default) | (none) | `~/.claude/CLAUDE*.md` left in place; settings.json hook entries cleared. |
| `restore` | `CLAUDEMD_SPEC_ACTION=restore` | Copies the most recent `~/.claude/backup-<ISO>/*.md` back to `~/.claude/`. Use this if your install-time stderr showed `[claudemd] WARN: existing ~/.claude/CLAUDE.md does not look like a claudemd spec` — it means your hand-written user-global instructions are sitting in the backup waiting to be brought back. |
| `delete` | `CLAUDEMD_SPEC_ACTION=delete CLAUDEMD_CONFIRM=1` | Hard-AUTH: removes the three spec files. |

`CLAUDEMD_PURGE=1` (env var) on `/claudemd-uninstall` also drops `~/.claude/.claudemd-state/` and your rule-hits log.

### Direct script invocation (advanced fallback)

If `/claudemd-uninstall` is unavailable (you already ran `/plugin uninstall` first and want to clean up by reaching into the cache before it gets pruned, or you need to script the uninstall outside CC):

```bash
CLAUDEMD_SPEC_ACTION=keep     node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/uninstall.js
CLAUDEMD_SPEC_ACTION=restore  node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/uninstall.js
CLAUDEMD_SPEC_ACTION=delete CLAUDEMD_CONFIRM=1 node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/uninstall.js
```

The slash command and the script are equivalent — the slash command just supplies `${CLAUDE_PLUGIN_ROOT}` for you.

---

## Update

Claude Code has **no** `/plugin update` slash command — it's silently ignored as unrecognized. The canonical upgrade sequence is:

```
/plugin marketplace update claudemd                 # refresh local marketplace clone (git fetch)
/plugin uninstall claudemd@claudemd                 # remove old plugin version
/plugin install claudemd@claudemd                   # install latest from refreshed clone
/reload-plugins                                     # apply changes to current session
```

Or open the interactive UI via `/plugin` → **Installed** tab → select `claudemd` → follow upgrade prompts.

After the plugin upgrade, sync the shipped spec into `~/.claude/`:

```
/claudemd-update
```

The command prints per-file diff summary, then prompts `apply-all` or `cancel`. Per-file select is intentionally not supported — the spec trio (`CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md`) evolves lockstep, and mixing versions would dangle `§EXT §X-EXT` cross-references in Core. Backup is automatic (retained to 5). `/claudemd-update` never fetches from GitHub — it only diffs the plugin-cache spec against your `~/.claude/CLAUDE*.md`. The network fetch is Claude Code's job (via `/plugin marketplace update`).

---

## Troubleshooting

**`Plugin "claudemd" not found in any marketplace`** — you forgot the `/plugin marketplace add sdsrss/claudemd` step. Re-run it, then retry install.

**Hooks don't fire / `~/.claude/CLAUDE*.md` not present after install** — Claude Code's `postInstall` lifecycle is not honored, so `install.js` runs from the `SessionStart` hook on your next session, not at install time. Either start a fresh Claude Code session, or run the script manually right now (replace `<version>` with the installed version dir — see the [Install](#install) section):

```bash
node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/install.js
```

Verify with `/claudemd-status` — the "log.lines" count should increment after the next hook fires.

**`/plugin update claudemd` does nothing / empty stdout** — `/plugin update` is not a valid Claude Code slash command; CC silently ignores unrecognized commands. Use the canonical sequence instead (see **Update** section above): `/plugin marketplace update claudemd` → `/plugin uninstall claudemd@claudemd` → `/plugin install claudemd@claudemd` → `/reload-plugins`. If that also fails (marketplace clone refuses to refresh), manually `git -C ~/.claude/plugins/marketplaces/claudemd fetch origin main --tags && git merge --ff-only origin/main`, then `git archive v<version> | tar -x -C ~/.claude/plugins/cache/claudemd/claudemd/<version>/`, then run that version's `scripts/install.js`.

**`Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin`** (5 errors on every `Bash` tool call + every session end) — you're on claudemd 0.1.2 / 0.1.3 / 0.1.4. Those releases wrote hook commands into `~/.claude/settings.json` under the literal `${CLAUDE_PLUGIN_ROOT}` token, but the CC harness only expands that variable for hooks defined in a plugin's own `hooks/hooks.json` — never in `settings.json`. The fix is v0.1.5+, which moves hook registration into the plugin's `hooks/hooks.json` (where the token expands correctly) and evicts the stale settings.json entries on install. Upgrade via the canonical sequence in the **Update** section above, then restart the Claude Code session to clear the cached hook registry.

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
├── hooks/                    # 8 shell hooks + hooks/lib/ (hook-common, rule-hits, platform)
│   └── hooks.json            # authoritative hook registration (v0.1.5+); CC expands ${CLAUDE_PLUGIN_ROOT} here
├── commands/                 # 5 slash-command markdown files
├── scripts/                  # 7 Node.js management scripts + scripts/lib/
├── spec/                     # shipped v6.11.3 CLAUDE*.md trio
├── tests/                    # hook shell tests + Node.js tests + integration + fixtures
├── docs/                     # ADDING-NEW-HOOK.md + RULE-HITS-SCHEMA.md + superpowers/
└── .github/workflows/ci.yml  # ubuntu + macOS × node 20
```

---

## License

MIT. See [LICENSE](LICENSE).
