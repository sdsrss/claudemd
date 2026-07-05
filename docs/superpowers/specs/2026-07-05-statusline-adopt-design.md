---
status: draft
revision: 1
level: L3
slug: statusline-adopt
---

# claudemd statusLine auto-registration — design

## Goal

Ship a claudemd-owned statusLine so a fresh install renders a PS1-style status
line — `user@host:/path (branch) Model (variant) [ctx:N%]` — without the user
hand-editing `~/.claude/settings.json`. Idempotent: never duplicate, never
clobber another provider's slot.

Reference (the "manual" setup this replaces): `~/.claude/statusline-command.sh`,
today registered as the `user-ps1` provider inside code-graph-mcp's composite
(`settings.json.statusLine` → `statusline-composite.js`). We replicate that
segment as a self-contained, claudemd-shipped script.

## Non-goals

- **Not** a composite/registry framework. We do not chain third-party providers
  or reimplement code-graph-mcp's registry. One script, one slot.
- **Not** taking over a slot another provider owns. Foreign slot → report + skip
  (only explicit `--force` replaces).
- **Not** a SessionStart auto-writer. No hook spawns a settings write every
  session (bug-magnet per `project_design_adopt_v0240.md`; also code-graph's
  self-healing-path pattern we deliberately avoid — see Constraints).
- **Not** adding new context/token math. `[ctx:N%]` reads a CC-provided field;
  if absent, the segment hides.

## Success criteria

1. On a machine with **no** `statusLine` set: install auto-wires claudemd's line;
   next render shows `user@host:/cwd (branch) <model> [ctx:N%]`.
2. On a machine with a **foreign** `statusLine` (e.g. current code-graph
   composite): install touches nothing; `/claudemd-statusline` reports who owns
   the slot and how to take over; existing statusline keeps working.
3. Re-running install/adopt when claudemd already owns the slot is a no-op that
   only refreshes the shipped script copy (survives plugin upgrade).
4. `/claudemd-statusline remove` restores the prior statusline (or clears the
   slot) and deletes the shipped script — no broken slot left behind.
5. `[ctx:N%]` is green `<50%`, yellow `50–79%`, red `≥80%`.
6. All state transitions are covered by tests that run against a **sandbox**
   settings.json (never the real `~/.claude/settings.json`).

## Constraints

- **§5 hard-AUTH + NEVER-downgrade**: writing `~/.claude/settings.json` is a hard
  gate. The command path always shows the diff and gets consent, even under
  `AUTONOMY_LEVEL: aggressive` (mirrors `/claudemd-design-adopt` step 4). The
  install path only writes when the slot is **empty** (non-clobbering), inside
  install's already-consented settings write, backed up first.
- **Version-dir staleness**: `${CLAUDE_PLUGIN_ROOT}` does **not** expand in
  `settings.json`, and an absolute plugin-cache version-dir path goes stale on
  the next plugin upgrade (documented in `install.js` for hooks). Therefore the
  renderer is **copied to a stable path** `~/.claude/claudemd-statusline.sh`
  (same pattern install.js uses for spec files), and `settings.json` references
  that stable path. Upgrade re-copies. This avoids code-graph-mcp's alternative
  (rewrite settings.json every SessionStart), which we reject as a bug-magnet.
- **Shell expansion in `statusLine.command`**: CC runs `statusLine.command`
  through a shell (confirmed by code-graph's own `expandTilde` comment). `~`
  inside double quotes stays literal, so we use `$HOME`, which expands inside
  double quotes: `bash "$HOME/.claude/claudemd-statusline.sh"`.
  **OPEN — verify with a real render before ship.**
- **`jq` dependency**: the renderer needs `jq` (already a plugin-wide hook
  dependency). One `jq` invocation per render (reference used three).
- **macOS portability** (`feedback_macos_shell_portability.md`): `#!/usr/bin/env
  bash`; process substitution + brace-group reads are bash-3.2-safe; `mapfile`
  is banned (bash 4+). `whoami` / `hostname -s` / `git -C` are BSD/GNU-safe.
- **CC field dependency**: `[ctx:N%]` reads `.context_window.used_percentage`
  from the statusLine stdin JSON. Empirically present (the reference renders
  `[ctx:6%]`), but **OPEN — confirm the field name against a captured payload
  before ship**; absent → segment hides (graceful).

## Architecture / components

| File | Role |
|---|---|
| `scripts/statusline.sh` | Renderer (bash + one jq). Repo source of truth. Copied to `~/.claude/claudemd-statusline.sh` on adopt/install. |
| `scripts/lib/statusline.js` | Core node logic: `detect()`, `adopt()`, `remove()`. Reuses `lib/settings-merge`, `lib/backup`, `lib/paths`. Testable, no CLI parsing. |
| `scripts/statusline-adopt.js` | CLI wrapper: `detect --json` / `adopt [--force] [--dry-run]` / `remove`. Uses `lib/argv.js#parseStrict`. |
| `commands/claudemd-statusline.md` | Command entry: detect → consent gate → CLI → report. `check` / `remove` modes. |
| `scripts/install.js` | Add `adoptStatusline({ emptyOnly: true })`, best-effort try/catch. |
| `scripts/uninstall.js` | Remove claudemd statusline (restore prev / clear key + delete script). |
| `tests/scripts/statusline.test.js` | Renderer: segments, colors, ctx thresholds, degradation. |
| `tests/scripts/statusline-adopt.test.js` | State machine on sandbox settings.json. |

## Renderer (`scripts/statusline.sh`)

Output format (segment order): `user@host` `:` `path` ` (branch)` ` model`
` [ctx:N%]`.

Data extraction — one jq call, three newline-delimited outputs, read in a
bash-3.2-safe brace group. Each field uses `// ""` (NOT `// empty`) so exactly
three lines always emit and the reads stay aligned:

```bash
#!/usr/bin/env bash
# claudemd statusLine — PS1-style: user@host:path (branch) model [ctx:N%]
input=$(cat)
cwd=""; model=""; used=""
if [ -n "$input" ]; then
  {
    IFS= read -r cwd
    IFS= read -r model
    IFS= read -r used
  } < <(jq -r '
    .cwd // .workspace.current_dir // "",
    .model.display_name // "",
    (.context_window.used_percentage // "")
  ' <<<"$input" 2>/dev/null)
fi

# PS1 colors: bold-green user@host, bold-blue path
user_host="\033[01;32m$(whoami)@$(hostname -s)\033[00m"
path_part=""
[ -n "$cwd" ] && path_part="\033[01;34m${cwd}\033[00m"

# Git branch (magenta) — only inside a repo; detached HEAD → short SHA
branch_part=""
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    branch_part=" \033[00;35m(${branch})\033[00m"
  elif [ -n "$branch" ]; then
    sha=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    [ -n "$sha" ] && branch_part=" \033[00;35m(detached:${sha})\033[00m"
  fi
fi

# Model (cyan)
model_part=""
[ -n "$model" ] && model_part=" \033[00;36m${model}\033[00m"

# Context usage — semantic threshold color: <50 green, 50-79 yellow, >=80 red
ctx_part=""
used_int=${used%.*}
case "$used_int" in
  ''|*[!0-9]*) : ;;                 # empty / non-numeric → skip
  *)
    if   [ "$used_int" -ge 80 ]; then c=31
    elif [ "$used_int" -ge 50 ]; then c=33
    else c=32; fi
    ctx_part=" \033[00;${c}m[ctx:${used_int}%]\033[00m"
  ;;
esac

printf '%b' "${user_host}:${path_part}${branch_part}${model_part}${ctx_part}"
```

Degradation (all exercised by tests):
- empty/invalid stdin → jq errors swallowed, `cwd/model/used` empty → only
  `user@host:` renders. No crash (no `set -e`).
- no `context_window.used_percentage` → ctx segment hidden.
- cwd not a git repo → branch segment hidden.
- detached HEAD → `(detached:<sha>)`.
- non-numeric `used` → ctx segment hidden (guards the new threshold arithmetic).

## detect / adopt / remove state machine (`scripts/lib/statusline.js`)

Stable identifiers:
- `DEST = <claudeHome>/claudemd-statusline.sh`
- `COMMAND = 'bash "$HOME/.claude/claudemd-statusline.sh"'`
- ownership test: `settings.statusLine.command` includes `claudemd-statusline.sh`.

`detect()` → `{ verdict, current }`:

| `settings.statusLine` | verdict | meaning |
|---|---|---|
| absent / falsy | `absent` | slot free |
| command includes `claudemd-statusline.sh` | `claudemd` | we own it |
| any other command | `foreign` | someone else owns it |

`adopt({ force, emptyOnly, dryRun, pluginRoot })`:
- `absent` → backup settings.json → copy renderer to `DEST` (chmod 0755) → set
  `statusLine = { type:'command', command: COMMAND }`. Report `set`.
- `claudemd` → re-copy renderer (upgrade refresh); leave settings. Report
  `refreshed`.
- `foreign`:
  - `emptyOnly` (install path) → do nothing (no file copy, no orphan). Report
    `skipped-foreign` + current command.
  - `force` → save `{ command: <foreign> }` to `stateDir/statusline-prev.json`
    → backup settings → copy renderer → set `statusLine`. Report `replaced`.
  - else → do nothing. Report `foreign` + current + hint to use `--force`.
- `dryRun` → compute the transition and report it; write nothing.

`remove()`:
- `claudemd` → if `statusline-prev.json` exists, restore that command; else
  delete the `statusLine` key. Delete `DEST`. Delete `statusline-prev.json`.
  Show the settings diff first. Report `removed` / `restored`.
- `absent` / `foreign` → do nothing. Report `not-ours` + current.

Backups reuse the existing settings-backup discipline in `install.js`
(`.claudemd-backup-<ISO>` sibling + `pruneSettingsBackups(5)`), factored so both
install and adopt share it.

## Triggers

- **install.js** (auto, empty-slot-only): after the manifest write, call
  `adoptStatusline({ emptyOnly: true, pluginRoot })` wrapped in try/catch — a
  statusline failure must never fail install (same posture as `pruneCache`). Add
  the result to install's return payload (`statusline: set|skipped-foreign|
  refreshed|opted-out`). **Opt-out**: `CLAUDEMD_NO_STATUSLINE=1` in the
  environment skips the install-time write entirely (house-consistent with the
  plugin's `DISABLE_*_HOOK` toggles; satisfies the Released-artifact
  explicit-opt-out requirement). The `/claudemd-statusline` command ignores the
  env var — an explicit command is itself the opt-in. Discoverability: on `set`,
  emit a one-line stderr note (Released-artifact checklist §2-EXT: first-run
  signal for users who skip the CHANGELOG). On `skipped-foreign`, stderr note
  naming the owner + the `/claudemd-statusline --force` path.
- **command** `/claudemd-statusline`: `detect` → if a write would occur, show the
  exact settings diff and ask once (consent gate, binds under aggressive) →
  `adopt` → re-run `detect` and cite `verdict: claudemd` as completion evidence.
  `check` mode reports current owner + whether `DEST` exists and matches the
  shipped renderer. `remove` mode runs `remove()` after showing the diff.

## Uninstall cleanup (`scripts/uninstall.js`)

Uninstall MUST call `remove()` semantics: if claudemd owns the slot, restore the
prior command (or clear the key) and delete `DEST` + `statusline-prev.json`.
Otherwise leave the slot alone. Rationale: without this, uninstall leaves
`settings.statusLine` pointing at a deleted script → broken status line every
session. This is the statusline analog of the manifest/state cleanup uninstall
already performs.

## Testing

- `tests/scripts/statusline.test.js` — pipe synthetic stdin JSON to
  `statusline.sh`; assert:
  - full payload → all five segments present, correct ANSI codes.
  - ctx thresholds at boundaries: 49→green(32), 50→yellow(33), 79→yellow(33),
    80→red(31); decimal `6.2`→`6`; non-numeric→hidden; absent→hidden.
  - no git repo → no branch; detached HEAD fixture → `(detached:...)`.
  - empty stdin → `user@host:` only, exit 0.
  - Lock ≥1 assertion to the real reference format
    (`feedback_test_fixture_format_drift.md`).
- `tests/scripts/statusline-adopt.test.js` — `HOME` pointed at a `mkdtemp`
  sandbox (§8.V3 destructive-smoke; hermeticity per
  `feedback_hook_env_test_hermeticity.md`), never the real home:
  - absent→set (settings written, DEST exists, backup created).
  - claudemd→refreshed (settings unchanged, DEST re-copied).
  - foreign+emptyOnly→skipped (settings untouched, no DEST).
  - foreign+force→replaced (prev saved, settings updated).
  - remove after set→key cleared + DEST gone; remove after force→prev restored.
  - `--dry-run`→no writes.

## Classification, cascade, obligations (L3)

Classified **L3** — released-artifact user-visible default behavior change
(install now writes `statusLine`) + LLM-visible command description (§2 hard
upgrade, regardless of LOC). Route: §4.FULL-lite (no auth/payment/crypto, ≤3
Modules, no data migration).

Ship cascade:
- Version `0.24.1` → **`0.25.0`** (minor, additive user-visible).
- CHANGELOG: top migration note — what changes, opt-out (`/claudemd-statusline
  remove`, or never set when foreign), first-run stderr signal.
- README: document `/claudemd-statusline` + `check`/`remove`/`--force`.
- Released-artifact checklist (§2-EXT): SemVer minor ✓, CHANGELOG note ✓,
  opt-out (`CLAUDEMD_NO_STATUSLINE=1`) + revert path (`remove`) ✓, first-run
  discoverability (stderr) ✓.
- `mem_save` at ship (§11 Step-1 global-state-hard: ≥2 `~/.claude/` writes —
  settings.json + `claudemd-statusline.sh` — and the state is opaque, so the
  CHANGELOG exemption does not fully apply): record the stable-path + `$HOME`
  decisions and the foreign-skip policy.
- `version-cascade-check.js`: grep old version across manifests/tests before the
  bump (`feedback_spec_version_bump_cascade_grep.md`).
- No `spec/` change → no Sizing-line edit (this is plugin code, not spec text).

## Open questions (resolve during implementation, before ship)

1. Confirm `$HOME` expands in `settings.json.statusLine.command` via a real CC
   render (fallback: unquoted `bash ~/.claude/claudemd-statusline.sh`, safe
   because the path has no spaces).
2. Confirm the ctx field is `.context_window.used_percentage` against a captured
   statusLine stdin payload (fallback: whatever the live field is; segment hides
   if absent).
3. Confirm `hostname -s` output matches the desired `nb` short host on the
   target machines (reference already uses it).

## Change log

- rev 1 (2026-07-05): initial design. Decisions locked with user: trigger =
  command + empty-slot-only install auto; conflict policy = never clobber, report
  + `--force`; colors = PS1 base + semantic ctx thresholds (green/yellow/red at
  50/80).
