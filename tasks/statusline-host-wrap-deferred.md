# Deferred — host-wrap strategy (statusLine, → v0.26.1)

v0.26.0 shipped the coexistence framework + guest/own strategies + M2/M5. The
host-wrap strategy (non-composite foreign owns the slot + `--force` → claudemd
takes the slot and wraps the prior command) was deferred: it is not reachable on
a machine where code-graph (a composite host that re-claims the slot) is
installed, and it adds a composite path to the renderer.

**Spec:** `docs/superpowers/specs/2026-07-06-statusline-coexistence-design.md` §host-wrap.
**Implement when:** a user reports a non-composite foreign statusline they want claudemd to wrap.
**Shape:** on `adopt({force:true})` over `verdict:'foreign'`, save the prior command to `stateDir()/statusline-wrap.json` + prev, set the slot to claudemd's renderer; the renderer, if the wrap file exists, runs the wrapped command via `bash -c "$cmd"` (shell → `$HOME`/`~` expand) with the stdin JSON piped, and prepends its trimmed output + ` | ` separator. `remove` restores prior + deletes the wrap file. Add tests: wrap runs + joins; remove restores; hostile wrap output can't corrupt the line (`printf %s`, no `%b`).

## v0.26.1 follow-ups (from the v0.26.0 whole-branch review)

- Wire `manualPsCandidates(providers)` (`scripts/lib/statusline-hosts.js`) into `detect()`'s output (or the CLI) so the tested supersede heuristic is the one that actually runs, instead of the LLM re-deriving it from `commands/claudemd-statusline.md` prose — or drop the export if it stays unused.
- `adopt({dryRun:true})` on a non-forced `foreign` verdict returns `action:'foreign'` (the `!force` check short-circuits before the `dryRun` check), not a `dry-run` shape — no-op-identical UX wart worth resolving.
- Adapter test coverage gaps: `manualPsCandidates`'s `id !== 'code-graph' / !== 'claudemd'` exclusion branch is fixture-shadowed (the one test fixture's code-graph/claudemd entries are already excluded by the earlier bash/command-substring checks, so the id-check is never the deciding factor); `cgRead`'s primary-wins-when-both-present path is unproven (only primary-absent-falls-back-to-mirror is tested).
- `detect` tests don't assert `providers[]` contents (only `.verdict` / `.host` / `.guestRegistered`).
- Optional: uniform stderr-capture assertions across `install.js`'s 4 statusline note branches (`set` / `host-detected` / `skipped-foreign` / `error`) — none of the 4 currently assert the actual note text in `install.test.js`.
