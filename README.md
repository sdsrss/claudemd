# claudemd

> A **personal AI-coding discipline harness**: one developer's **AI-CODING-SPEC v9.0** for Claude Code, plus a thin safety net of shell hooks. Built and dogfooded on my own repos — fork and adapt, don't adopt wholesale.

[![CI](https://github.com/sdsrss/claudemd/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sdsrss/claudemd/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claudemd-cli.svg)](https://www.npmjs.com/package/claudemd-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

claudemd does two things:

1. **Installs a short spec** (`CLAUDE.md`, about 2.8 KB) into `~/.claude/`, where Claude Code reads it as your user-global instructions, plus two modules (`ship`, `review`) that load only when a prompt asks for a release or a review.
2. **Runs 12 shell hooks** that catch a few expensive mistakes: `rm -rf "$VAR"` on an unchecked variable, an unpinned `npx <pkg>`, a push while CI is red, a release command before the relevant `MEMORY.md` entries were read.

Why this little: an outcome A/B with hidden tests (`docs/claudemd-value-assessment-2026-11-25.md`) found that the earlier 24 KB spec gave the same or lower correctness than no spec at 1.8–2.4× the cost, while the hooks alone cost 1.04× with unchanged correctness. Spec v9.0 keeps only what the model does not do by default.

> **Status & scope.** A single-maintainer tool, exercised almost entirely on my own repositories. The defaults reflect my preferences. If you install it, expect to fork `spec/CLAUDE.md`. Issues and PRs are welcome.

---

## Quick start

Run **both** slash commands inside Claude Code:

```
/plugin marketplace add sdsrss/claudemd
/plugin install claudemd@claudemd
```

Then bootstrap the **current** session and check it:

```
/claudemd-install
/claudemd-doctor
```

`install` copies the spec into `~/.claude/` and writes the install manifest; it is idempotent. Claude Code does not fire `postInstall`, so without `/claudemd-install` the same script runs at the next `SessionStart`. `doctor` runs the health checks, including the hooks' own self-tests.

> ⚠️ **`~/.claude/CLAUDE.md` is shared real estate.** If you keep personal instructions there, install moves your file to `~/.claude/backup-<ISO>/` (last 5 kept) before writing the spec, and says so in a banner. To get it back, run `/claudemd-uninstall restore` and then `/plugin uninstall claudemd@claudemd`, or merge the two files by hand.

---

## Prerequisites

| Tool | Required | Why |
|---|---|---|
| `node >= 20` | yes | install, doctor and the other scripts |
| `jq` | yes | every hook parses Claude Code's event JSON with `jq`; without it the hooks fail open |
| `git` | yes | `ship-baseline-check`, `session-start-check`, `session-end-check` |
| `gh` | recommended | `ship-baseline-check` calls `gh run list`; without it shipping on red CI is not blocked |
| `coreutils` | macOS only | GNU `timeout`: `brew install coreutils`, then put `$(brew --prefix coreutils)/libexec/gnubin` on `PATH` |

---

## What it installs

| Layer | Contents |
|---|---|
| 12 shell hooks | `pre-bash-safety-check` · `ship-baseline-check` · `memory-read-check` · `banned-vocab-check` · `session-start-check` · `version-sync` · `spec-module-inject` · `sandbox-disposal-check` · `reply-language-check` · `memory-index-lines` · `tmp-sweep` · `session-end-check` |
| 11 slash commands | `/claudemd-install` · `/claudemd-status` · `/claudemd-update` · `/claudemd-refresh` · `/claudemd-audit` · `/claudemd-toggle` · `/claudemd-doctor` · `/claudemd-uninstall` · `/claudemd-clean-residue` · `/claudemd-design-adopt` · `/claudemd-statusline` |
| 1 standalone CLI | `claudemd-cli lint` · `claudemd-cli audit` ([npm: `claudemd-cli`](https://www.npmjs.com/package/claudemd-cli)) |
| Spec v9.0 | `~/.claude/CLAUDE.md` · `CLAUDE-extended.md` · `CLAUDE-changelog.md` · `OPERATOR.md` · `spec-modules/*.md` |
| StatusLine (opt-out) | `user@host:dir (branch) Model [ctx:N% · 5h:N% · 7d:N%]`, wired into `~/.claude/settings.json` only when the slot is empty. Skip with `CLAUDEMD_NO_STATUSLINE=1`, hide the quota segments with `DISABLE_STATUSLINE_QUOTA=1`, manage with `/claudemd-statusline`. |

A hand-written `~/.claude/CLAUDE.md` (any file without the `# AI-CODING-SPEC` heading) goes to `~/.claude/backup-<ISO>/`, which `restore` reads. An installed claudemd spec that differs from the shipped one goes to `spec-backup-<ISO>/` instead, which `restore` does not read. Both keep the last 5.

Hooks are registered by the plugin's own `hooks/hooks.json`; Claude Code expands `${CLAUDE_PLUGIN_ROOT}` there, so the hooks follow the active plugin version.

---

## Hooks (what fires when)

Every hook fails open: a missing `jq`, malformed event JSON or a timeout lets the tool call through. Decisions are logged to `~/.claude/logs/claudemd.jsonl`; `/claudemd-audit` aggregates them.

| Trigger | Hook | What happens |
|---|---|---|
| Bash: `rm -r`/`-f` (or `find … -delete` / `-exec rm`) on an unchecked variable, an unpinned `npx <pkg>`, a fetch piped into an interpreter (`curl … \| sh`) | `pre-bash-safety-check` | Denies (spec §8). Fix by guarding the variable (`"${DIR:?}/x"`) or pinning the package. Escape tokens below are the user's to give. |
| `git push` while the branch's newest CI run is red | `ship-baseline-check` | Denies. `known-red baseline: <reason>` in the commit body lets it through. Fails open when `gh` is absent or takes over 2 s. |
| A push, PR, release, publish or deploy command whose keywords match a `MEMORY.md` entry not yet Read this session | `memory-read-check` | Denies with the list of memory files to Read first. |
| `git commit` (or a ship command after prose) using a banned word as an unmeasured claim (`significantly`, a bare `N× faster`) | `banned-vocab-check` | Denies with the fix recipe. Reads `-m` and `-F -` messages, not the file of `-F FILE`. |
| Session start | `session-start-check` | Runs the install on a fresh or upgraded plugin; banners for an available upgrade, an edited or missing installed spec, a failed earlier install, and `tasks/*-paused.md` checkpoints; after a compaction, a reminder to re-read the task's plan. |
| First prompt after a mid-session plugin upgrade | `version-sync` | Re-runs the install in the background, once per session. |
| A prompt that asks for a release or a review | `spec-module-inject` | Adds the `ship` or `review` module to context, once per session and again after a compaction. |
| Session stop with fresh test or probe directories left in temp roots | `sandbox-disposal-check` | Advisory on stderr. Opt-in `SANDBOX_DISPOSAL_BLOCK=1` asks the session to remove the ones it created. |
| Session stop whose last reply is English while the human writes 中文 | `reply-language-check` | Asks for the same content in 中文, once per turn. Opt-in: `REPLY_LANGUAGE_CHECK=1`, or `=log` to record only; default OFF. |
| An `Edit`/`Write`/`Bash` that writes a `MEMORY.md` index line over 150 characters | `memory-index-lines` | Advisory naming the lines, so they are shortened in the same turn. |
| Any `Bash` call, at most once per 10 min | `tmp-sweep` | Deletes, detached, the per-run directories vitest leaves in temp roots, and `agent-tmp-*` directories of your uid idle for 72 h (never one with a `.keep` at its top, a socket or FIFO, or a mount inside). Warns when the temp root is ≥ 80% full. |
| Session end with file changes after the last test, build or commit | `session-end-check` | Writes `tasks/session-end-<sid>-paused.md` listing them; the next session start lists it. |

### Execution order (PreToolUse:Bash)

Claude Code runs the four `Bash` PreToolUse hooks in `hooks/hooks.json` order and the first deny stops the call: `pre-bash-safety-check`, `banned-vocab-check`, `ship-baseline-check`, `memory-read-check`. A hook that times out counts as a pass.

**Readonly fast-path**: every PreToolUse:Bash hook exits early on a definitely-read-only command (no shell metacharacters, first word in a safe-reader list such as `ls`, `cat`, `git log`, `git status`, `git diff`). Opt out with `BASH_READONLY_FAST_PATH=0`.

---

## Commands

| Command | Purpose |
|---|---|
| `/claudemd-install` | Copy the spec into `~/.claude/` and write the manifest now, instead of at the next session start. Idempotent. |
| `/claudemd-status [--verbose]` | Plugin and spec versions, kill-switch state, log size. `--verbose` lists every hook's switch and the sub-feature switches. |
| `/claudemd-update` | Diff the installed spec against the plugin's, then apply all or cancel. |
| `/claudemd-refresh` | Update the marketplace clone and reinstall the plugin through the `claude` CLI; restart afterwards. |
| `/claudemd-audit [N]` | Hook decisions over the last N days (default 30): denies, bypasses and fail-opens per hook. |
| `/claudemd-toggle <hook-name>` | Set or clear one hook's `DISABLE_*_HOOK` in `settings.json`. |
| `/claudemd-doctor [--prune-backups=N] [--ack-fail-open]` | Health checks and hook self-tests, including `MEMORY.md` lines that name a missing memory file; optionally keep only the N newest backups per namespace; acknowledge a fixed `hook-fail-open` row. |
| `/claudemd-clean-residue [--apply]` | Dry run by default: stale claudemd sentinels and sandboxes in `$TMPDIR`, old tool exhaust in `~/.claude/tmp`, expired per-session state files, and headless-probe transcript dirs. Exits 3 if `--apply` leaves targets behind. |
| `/claudemd-design-adopt [check\|remove]` | For a UI project, generate a fact-based `DESIGN.md` from its design tokens and point the project `CLAUDE.md` at it. Shows the diff and asks before writing. |
| `/claudemd-statusline [check\|remove] [--force]` | Install, inspect or remove the status line. Shows the diff and asks before writing. |
| `/claudemd-uninstall` | Pre-uninstall cleanup: clears the manifest and legacy `settings.json` hook entries; add `CLAUDEMD_PURGE=1` to also drop `~/.claude/.claudemd-state/` and the log. Run it BEFORE `/plugin uninstall claudemd@claudemd` (see [Uninstall](#uninstall)). |

---

## Standalone CLI

The banned-vocabulary scan as a Node CLI, for git commit-msg hooks, GitHub Actions and agents outside Claude Code. Stateless: text in, findings and an exit code out.

```bash
npx claudemd-cli lint "your commit message here"
npx claudemd-cli lint --stdin < message.txt
npx claudemd-cli audit ~/.claude/projects/<encoded>/<session>.jsonl --json
```

`lint` exits 0 clean, 1 on hits, 2 on bad arguments or unusable input. Given a `COMMIT_EDITMSG`-style path it drops what git drops (the `#` template block and the `-v` diff); for piped input add `--commit-msg`. `--comment-char <c>` matches a non-default `core.commentChar`.

**commit-msg hook (`.git/hooks/commit-msg`)** — git passes the message file as `$1`:

```bash
#!/usr/bin/env bash
npx claudemd-cli lint "$1" || exit 1
```

**GitHub Actions** — pin the version, since a workflow runs unattended:

```yaml
name: commit-msg lint
on: pull_request
permissions:
  contents: read
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
        with:
          fetch-depth: 0
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
        with:
          node-version: 24
      - name: Lint every commit message in the pull request
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          commits=$(git rev-list "$BASE_SHA..$HEAD_SHA")
          status=0
          for c in $commits; do
            echo "commit $c"
            git log -1 --format=%B "$c" | npx --yes claudemd-cli@0.123.0 lint --stdin || status=1
          done
          exit "$status"
```

---

## Kill-switches

`/claudemd-status --verbose` lists them all with their current state.

**Plugin-wide**: `DISABLE_CLAUDEMD_HOOKS=1` turns every hook off.

**Per hook** (or `/claudemd-toggle <hook-name>`):

```bash
export DISABLE_PRE_BASH_SAFETY_HOOK=1
export DISABLE_SHIP_BASELINE_HOOK=1
export DISABLE_MEMORY_READ_HOOK=1
export DISABLE_BANNED_VOCAB_HOOK=1
export DISABLE_SESSION_START_HOOK=1
export DISABLE_USER_PROMPT_SUBMIT_HOOK=1         # version-sync
export DISABLE_SPEC_MODULE_INJECT_HOOK=1
export DISABLE_SANDBOX_DISPOSAL_HOOK=1
export DISABLE_REPLY_LANGUAGE_HOOK=1
export DISABLE_MEMORY_INDEX_LINES_HOOK=1
export DISABLE_TMP_SWEEP_HOOK=1
export DISABLE_SESSION_END_CHECK_HOOK=1
```

**Parts of a hook**:

| Variable | Turns off |
|---|---|
| `DISABLE_UPSTREAM_CHECK=1` | session start's upgrade-available check and stale-registration banner |
| `DISABLE_COMPACT_REREAD_REMINDER=1` | the post-compaction re-read reminder |
| `DISABLE_PAUSED_BANNER=1` | the list of `tasks/*-paused.md` checkpoints at session start |
| `DISABLE_SPEC_DRIFT_BANNER=1` | the edited-or-missing installed spec banner (`/claudemd-doctor` still reports it) |
| `DISABLE_BOOTSTRAP_FAIL_BANNER=1` | the banner about an earlier failed background install |
| `DISABLE_USER_CONTENT_BANNER=1` | the banner naming the backup of a hand-written `~/.claude/CLAUDE.md` |
| `CLAUDEMD_FORCE_ASYNC_BOOTSTRAP=1` | the synchronous first install; the spec then reaches the model one session later |
| `DISABLE_RULE_HITS_LOG=1` | every append to `~/.claude/logs/claudemd.jsonl`; a deny still denies |
| `DISABLE_HOOK_ROOT_RECORD=1` | the rewrite of `~/.claude/.claudemd-state/hook-root.json`, which `DISABLE_RULE_HITS_LOG` does not cover; an existing file is still what `/claudemd-doctor` reads |
| `BANNED_VOCAB_PROSE_SCAN=0` | banned-vocab's scan of the prose before a ship command (the commit-message scan stays) |
| `CLAUDEMD_PATH2_DRY_RUN=1` | that prose scan's deny; it logs `deny-prose-dry-run` instead |

**Per command** — these tokens are the user's exit, not the agent's (spec §8):

| Token | Where | Bypasses |
|---|---|---|
| `[allow-banned-vocab]` | commit message | `banned-vocab-check` |
| `known-red baseline: <reason>` | commit body | `ship-baseline-check` |
| `[skip-memory-check]` | command string | `memory-read-check` |
| `[allow-rm-rf-var]` | command string | `pre-bash-safety-check`, rm on a variable |
| `[allow-npx-unpinned]` | command string | `pre-bash-safety-check`, unpinned npx |
| `[allow-curl-sh]` | command string | `pre-bash-safety-check`, fetch into an interpreter |

---

## Update

Claude Code has no `/plugin update` command. Use:

```
/claudemd-refresh                                   # marketplace update → uninstall → install, then restart
```

Manual fallback (the `claude` CLI is not on `PATH`):

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```

> **Other open Claude Code windows:** run `/reload-plugins` in each of them too. Every already-running session pinned its hook paths to the old versioned plugin-cache dir at startup, so until it reloads or restarts it keeps running the previous version's hooks. Those hooks still work: a refresh does not delete the old dir, which stays for at least 14 days (Claude Code marks it for cleanup).

The next session start syncs the spec into `~/.claude/`. `/claudemd-update` does it now, after showing the diff.

---

## Uninstall

Claude Code does not fire `preUninstall`, so run the cleanup first:

```
/claudemd-uninstall                    # clear manifest (+ state & log with CLAUDEMD_PURGE=1)
/plugin uninstall claudemd@claudemd    # CC uninstalls it; the cache folder goes 14+ days later
```

Reversing the order is the orphan-state vector — after `/plugin uninstall`, `${CLAUDE_PLUGIN_ROOT}` is no longer set (the cache folder stays on disk until Claude Code deletes it, but no command points at it), with no in-tree tool to clean up afterwards. `/claudemd-doctor` flags `[△] plugin cache: orphan manifest …` if you've already hit this.

What happens to the installed spec:

| Ask for | Behavior |
|---|---|
| `/claudemd-uninstall` (keep, the default) | `~/.claude/CLAUDE*.md` stays in place. |
| `/claudemd-uninstall restore` | Puts your newest `~/.claude/backup-<ISO>/` files back; a home file that is not the spec and differs from the backup is kept and listed. Then run `/plugin uninstall`, or the next session start installs the spec again. |
| a full removal | Asks once more, then removes the four spec files and the `spec-modules/*.md` files. |

A purge (add `CLAUDEMD_PURGE=1`) also drops `~/.claude/.claudemd-state/` and the log. It leaves your backups (`backup-<ISO>/`, `spec-backup-<ISO>/`, `settings.json.claudemd-backup-<ISO>`) for you to delete.

Without the plugin, run the script from the cache: `CLAUDEMD_SPEC_ACTION=keep|restore node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/uninstall.js`.

---

## Troubleshooting

**`Plugin "claudemd" not found in any marketplace`** — run `/plugin marketplace add sdsrss/claudemd` first.

**No `~/.claude/CLAUDE.md` after install** — run `/claudemd-install`, or start a new session.

**`ship-baseline-check` passes on red CI** — `gh` is missing, unauthenticated or slow. `/claudemd-doctor` reports `gh: missing`, and `ship-baseline:gh-failed` / `gh-timeout` rows under `hook-fail-open`.

**A hook error naming a path under `~/.claude/hooks/`** — the running session cached an old hand-installed hook entry from `settings.json`. Restart Claude Code.

---

## Project layout

```
claudemd/
├── .claude-plugin/           # plugin.json + marketplace.json
├── hooks/                    # 12 shell hooks + hooks/lib/ (hook-common, rule-hits, platform, memory-tags, spec-module)
│   └── hooks.json            # hook registration; CC expands ${CLAUDE_PLUGIN_ROOT} here
├── commands/                 # 11 slash-command markdown files
├── bin/                      # standalone CLI (claudemd-lint.js → `npx claudemd-cli`)
├── scripts/                  # 16 Node.js scripts + scripts/lib/
├── spec/                     # the spec: CLAUDE.md, CLAUDE-extended.md, modules, OPERATOR.md, hard-rules.json
├── tests/                    # hook shell tests, Node tests, integration, fixtures
└── docs/                     # ARCHITECTURE.md, HOOK-PROTOCOL.md, RULE-HITS-SCHEMA.md, …
```

Hooks are frozen: bug fixes and removals only (`spec/OPERATOR.md` §13.3). `docs/ADDING-NEW-HOOK.md` records what a new hook would need.

---

## Changelog

Every release is in [`CHANGELOG.md`](https://github.com/sdsrss/claudemd/blob/main/CHANGELOG.md) and on the GitHub Releases page. It is not shipped in the npm tarball.

## License

MIT — see [LICENSE](LICENSE).
