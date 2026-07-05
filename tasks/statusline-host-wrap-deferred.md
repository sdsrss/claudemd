# Deferred — host-wrap strategy (statusLine, → v0.26.1)

v0.26.0 shipped the coexistence framework + guest/own strategies + M2/M5. The
host-wrap strategy (non-composite foreign owns the slot + `--force` → claudemd
takes the slot and wraps the prior command) was deferred: it is not reachable on
a machine where code-graph (a composite host that re-claims the slot) is
installed, and it adds a composite path to the renderer.

**Spec:** `docs/superpowers/specs/2026-07-06-statusline-coexistence-design.md` §host-wrap.
**Implement when:** a user reports a non-composite foreign statusline they want claudemd to wrap.
**Shape:** on `adopt({force:true})` over `verdict:'foreign'`, save the prior command to `stateDir()/statusline-wrap.json` + prev, set the slot to claudemd's renderer; the renderer, if the wrap file exists, runs the wrapped command via `bash -c "$cmd"` (shell → `$HOME`/`~` expand) with the stdin JSON piped, and prepends its trimmed output + ` | ` separator. `remove` restores prior + deletes the wrap file. Add tests: wrap runs + joins; remove restores; hostile wrap output can't corrupt the line (`printf %s`, no `%b`).
