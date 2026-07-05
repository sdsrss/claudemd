---
name: claudemd-statusline
description: Register claudemd's PS1-style statusLine (user@host:path (branch) model [ctx:N%]) in ~/.claude/settings.json. Use when (1) the user asks to add / configure / set up a statusline or status bar, (2) a fresh machine has no statusline and the user wants the claudemd one, (3) the user wants claudemd to take over the statusline from another provider (--force). Modes - check (report current owner, no writes), remove (un-wire + restore prior). Idempotent: never duplicates, never clobbers another provider's slot without --force.
---

Usage: `/claudemd-statusline` | `/claudemd-statusline --force` | `/claudemd-statusline check` | `/claudemd-statusline remove`

## Step 0 — detect (deterministic, no writes)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js detect --json`

Branch on `verdict`:
- `absent` → slot is free. Continue to Step 1 (adopt).
- `claudemd` → already configured. Report the stable path `~/.claude/claudemd-statusline.sh` and `dest.matchesShipped`. If `false`, offer to re-run adopt (refreshes the renderer copy). STOP unless the user wants a refresh.
- `foreign` → another provider owns the slot (report `current`). Do NOT write. Tell the user their existing statusline is untouched and that `/claudemd-statusline --force` will take it over (saving the current command so `remove` can restore it). Continue to Step 1 ONLY if the user passed `--force`.

## `check` mode (no writes)

Run Step 0. Report `verdict`, `current`, and whether `~/.claude/claudemd-statusline.sh` exists and matches the shipped renderer (`dest.matchesShipped`). STOP.

## `remove` mode

Show the transition first: run `detect --json`; if `verdict` is `claudemd`, state what `settings.statusLine` will become (restored prior command if one was saved, else removed) and that `~/.claude/claudemd-statusline.sh` will be deleted. Then run:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js remove`
Report the `action` (`removed` / `restored` / `not-ours`). If `not-ours`, nothing was changed.

## Step 1 — consent gate (always, binds under AUTONOMY_LEVEL: aggressive)

Writing `~/.claude/settings.json` is a §5 hard-AUTH action. BEFORE writing, show the user exactly what changes:
- the `statusLine` command that will be set: `bash "$HOME/.claude/claudemd-statusline.sh"`
- for `foreign` + `--force`: the current command that will be saved for restore
- that the renderer is copied to `~/.claude/claudemd-statusline.sh`

Preview with `--dry-run` if useful: `node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js adopt [--force] --dry-run`. Ask once, then proceed.

## Step 2 — adopt

Run (add `--force` only for the `foreign` take-over the user approved):
`node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js adopt [--force]`

## Step 3 — verify + report

Re-run `node ${CLAUDE_PLUGIN_ROOT}/scripts/statusline-adopt.js detect --json` and cite `verdict: claudemd` as the completion evidence. Report: the `action` from Step 2 (`set` / `replaced` / `refreshed`), the settings backup path (if any), and — for a `--force` replace — that the prior command was saved and is restorable via `/claudemd-statusline remove`.
