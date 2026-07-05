# StatusLine multi-provider coexistence — design (v0.26.0)

**Status:** approved direction (brainstorming 2026-07-06), pending spec review.
**Supersedes behavior from:** `2026-07-05-statusline-adopt-design.md` (v0.25.x). Spec content unchanged (stays AI-CODING-SPEC v6.14.1); this is a plugin-artifact feature.

## Goal

Make claudemd's statusLine **coexist** with other statusLine providers instead of clobbering them. The `statusLine` slot in `~/.claude/settings.json` is single-valued, but multiple providers can share it through a composite host. claudemd adapts to whatever owns the slot:

- **Empty slot** → claudemd sets its own renderer (today's v0.25.x behavior).
- **A composite host owns it (code-graph)** → claudemd registers itself as a *guest* provider in that host's registry; the host keeps the slot and renders claudemd's segment alongside its own.
- **A non-composite foreign owns it** → `--force` makes claudemd take the slot as a *host* that wraps the foreign; otherwise report and skip.

Also folds in two deferred Minors from the v0.25.1 review: M2 (renderer newline-strip) and M5 (`--json` / `--dry-run` UX).

## Verified current state (2026-07-06, this machine)

- code-graph is a **generic composite host** (`scripts/statusline-composite.js` + `scripts/lifecycle.js`):
  - Registry: primary `~/.cache/code-graph/statusline-registry.json`, durable mirror `~/.claude/statusline-providers.json`. Format: `[{id, command, needsStdin}]`.
  - Renders each provider via `execFileSync` (NO shell), `~`-expansion only (`expandTilde`), `_previous` first then array order, joined by ` | ` (dim). Passes the CC stdin JSON to providers with `needsStdin:true`.
  - Self-heals + **re-claims the slot aggressively**: on the next SessionStart, if anything non-composite owns `statusLine`, code-graph captures it as `_previous` and re-claims (`lifecycle.js` `install()` step 1). Public registry API: `registerStatuslineProvider(id, command, needsStdin)` / `unregisterStatuslineProvider(id)`.
- Live registry right now: `[{id:"user-ps1", command:'bash "/home/sds/.claude/statusline-command.sh"', needsStdin:true}, {id:"code-graph", ...}]`. `user-ps1` is the user's **hand-made PS1** — the line claudemd's renderer is meant to supersede.
- **Consequence:** claudemd cannot stably *own* the slot while code-graph is installed — force-taking it just makes code-graph swallow claudemd as `_previous`. Stable coexistence = claudemd registers as a guest in code-graph's registry.

## Non-goals

- No adapters for hypothetical composite hosts other than code-graph. The adapter layer is a general interface, but **code-graph is the only shipped adapter** (YAGNI). Both plugins are the same author's, so coupling to code-graph's registry is coupling within one ecosystem.
- **No SessionStart self-heal hook** for statusline (prior lessons: no sync spawn in SessionStart; silent heuristic = bug magnet). Strategy is recomputed on each `/claudemd-statusline` / install run; drift (e.g. code-graph later removed) is fixed by re-running the command.
- No silent deletion/replacement of a foreign provider. Superseding the manual PS1 is consent-driven.
- No change to the empty-slot path shipped in v0.25.x.

## Architecture

### Strategy resolution (adaptive by slot state)

`detect()` returns a richer verdict; the CLI/install map it to a strategy:

| Slot state | verdict | adopt action | remove action |
|---|---|---|---|
| absent / null / `''` | `absent` | set own renderer (slot-owner) | clear slot + delete renderer |
| claudemd's own renderer in slot | `claudemd` | refresh renderer | clear/restore + delete renderer |
| composite host (code-graph) owns slot | `host:code-graph` | register claudemd as guest in host registry | unregister claudemd provider |
| non-composite foreign owns slot | `foreign` | `--force`: take slot, wrap foreign (host mode); else report/skip | restore prior + delete renderer |

### Composite-host adapter interface

```
Adapter = {
  id,                                  // 'code-graph'
  matches(command) -> bool,            // recognizes this host's slot command
  listProviders() -> [{id, command, needsStdin}],
  register({id, command, needsStdin}) -> bool,   // find-or-insert, atomic
  unregister(id) -> bool,
  isRegistered(id) -> bool,
}
```

**code-graph adapter:**
- `matches`: `command.includes('statusline-composite')`.
- Registry files: primary `~/.cache/code-graph/statusline-registry.json` + durable mirror `~/.claude/statusline-providers.json`. Read prefers primary, falls back to mirror (mirror is code-graph's self-heal source). **Write both**, each via tmp+rename (atomic), mirroring code-graph's `writeRegistry`.
- Our entry: `{id:'claudemd', command:<absolute-path form>, needsStdin:true}`.
- Insert position: **front** of the provider list (after any `_previous`) so claudemd renders first — `claudemd | code-graph`, matching the existing `user-ps1 | code-graph` order. code-graph's own `register('code-graph', …)` updates in place and never reorders, so the position is stable across code-graph updates.

### Command form (load-bearing compatibility detail)

The renderer FILE is unchanged (`~/.claude/claudemd-statusline.sh`), but the command STRING depends on who invokes it:

- **Slot-owner mode** (settings.json, run by CC through a shell): `bash "$HOME/.claude/claudemd-statusline.sh"` — unchanged from v0.25.x. `$HOME` expands in the shell; a quoted `~` would not.
- **Guest mode** (code-graph's `execFileSync`, no shell, `~`-expansion only, **`$HOME` NOT expanded**): the `$HOME` form would be passed literally → `bash` gets a filename `"$HOME/.claude/…"` → ENOENT → code-graph swallows the error → claudemd's segment silently blanks (the `#2183`-class invisible failure). Guest command therefore uses an **absolute path** computed at register time: `bash "/home/sds/.claude/claudemd-statusline.sh"` (`os.homedir()` + the stable basename). This matches code-graph's own and `user-ps1`'s absolute-path convention. **A regression test spawns this exact command via `execFileSync` and asserts exit 0.**
- `needsStdin: true` — the renderer reads the CC stdin JSON for cwd / model / ctx.

### Superseding the manual PS1 (consent)

`/claudemd-statusline`, when a host owns the slot, prints the current provider list and asks whether to **supersede** a detected manual PS1 (a provider whose command runs a bash script under `~/.claude/` that isn't a known plugin — e.g. `user-ps1 → ~/.claude/statusline-command.sh`) or **keep both**. No silent heuristic replacement. If superseded: unregister that provider, put claudemd in its position, and save its command to the prev-backup so `remove` can restore it.

## Behavior by entry point

### Install-time auto-adopt

- **Empty slot** → set own renderer (v0.25.x unchanged), `action:'set'`.
- **Composite host present** → **no registry write**; stderr note: `code-graph statusLine detected — run /claudemd-statusline to add claudemd's segment`. `action:'host-detected'`.
- **Non-composite foreign** → `action:'skipped-foreign'` (unchanged); `--force` (command only) to wrap.
- `CLAUDEMD_NO_STATUSLINE=1` opt-out unchanged → `action:'opted-out'`.

Rationale: install never silently writes another plugin's files; guest registration is consent-driven (matches the v0.25.x "non-empty slot needs consent" posture).

### `/claudemd-statusline` command

`detect` → strategy → for `host:*`: show providers, offer supersede-or-keep-both, register claudemd (guest), re-verify by reading back the registry. For `absent`/`foreign`: as v0.25.x (+ `--force` wrap for non-composite foreign). `check` = detect-only, no writes. `remove` = strategy-appropriate teardown.

### host-wrap (non-composite foreign + `--force`)

claudemd takes the slot; its renderer prepends the wrapped prior command's output (same stdin) joined by the separator, then its own segment. claudemd becomes a minimal composite host. Completes the framework; not exercised on the user's current machine (code-graph is a composite host → guest path).

### remove / uninstall

- **Guest**: unregister `claudemd` from both registry files; leave code-graph's slot + segment intact. If claudemd superseded a manual PS1, restore it from the prev-backup.
- **Slot-owner**: restore prior / clear + delete renderer (v0.25.x).
- `uninstall` runs the strategy-appropriate teardown unconditionally, before the no-manifest early return (as v0.25.1).

## Deferred Minors folded in

- **M2**: renderer strips `\r`/`\n` from `cwd`/`model` after the NUL-delimited read → guarantees a single line even for a pathological newline-bearing field.
- **M5**: `--json` actually gates output (default human-readable summary; JSON only with `--json`); `--dry-run` returns a `dry-run`-shaped result in every branch, including `host:*` (guest) and `foreign`.

## Error handling

- Registry read/parse failure → treat as empty list, never crash.
- Registry write failure (guest) → report; install stays best-effort (a statusline failure never fails install, as v0.25.x).
- Renderer stays mode `0755` so `execFileSync bash <abs>` runs.
- **Edge — code-graph removed after claudemd registered**: claudemd's entry is orphaned (no host renders it). Re-running `/claudemd-statusline` recomputes (slot now empty/foreign → own/wrap). Documented; no auto-heal hook (per non-goals).

## Testing

Fixtures: mkdtemp HOME with a fake `~/.cache/code-graph/statusline-registry.json` + mirror.

- `detect`: recognizes `host:code-graph` (composite command), `absent`, `claudemd`, non-composite `foreign`.
- code-graph adapter: `register` writes BOTH files atomically; entry command is **absolute-path** (regression lock for the `$HOME`-execFile trap); entry lands at front; `unregister` removes from both; idempotent re-register is a no-op.
- **Guest-command execution**: spawn `bash "<abs>/.claude/claudemd-statusline.sh"` via `execFileSync` (as code-graph would) → exit 0, non-empty output.
- Supersede-manual-PS1 consent path: superseded provider removed, prev saved, restored on `remove`; keep-both path leaves it.
- install: empty→set; code-graph present→`host-detected` (no registry write, note emitted); foreign→skipped-foreign.
- uninstall: guest→unregister (code-graph slot + segment intact); slot-owner→restore.
- M2: embedded-newline field → single-line output. M5: `--json`/`--dry-run` shapes.
- All existing 574 Node tests still pass.

## Success criteria

- With code-graph owning the slot, after `/claudemd-statusline`: the rendered line shows **both** claudemd's segment and code-graph's; code-graph's slot command is untouched; claudemd's registered command is absolute-path and runs under `execFileSync`.
- `/claudemd-statusline remove` → claudemd's segment gone, code-graph intact, manual PS1 restored if it was superseded.
- Empty-slot behavior identical to v0.25.x.

## Resolved decisions

- Architecture → general provider framework (adapters + host-wrap). [user]
- Install-time when a host is present → command + consent only, no auto registry write. [user]
- Manual PS1 (user-ps1) → ask at runtime (supersede vs keep both), no silent heuristic. [user]

## Version

**v0.26.0** — minor (new adaptive coexistence capability). Plugin artifact only; AI-CODING-SPEC content stays v6.14.1.
