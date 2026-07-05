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

- **[SHIPPED v0.26.1]** Wired `manualPsCandidates(providers)` into `detect()`'s output as `psCandidates`; `commands/claudemd-statusline.md` now reads that field instead of re-deriving the heuristic in prose (single source of truth).
- `adopt({dryRun:true})` on a non-forced `foreign` verdict returns `action:'foreign'` (the `!force` check short-circuits before the `dryRun` check), not a `dry-run` shape — no-op-identical UX wart worth resolving.
- Adapter test coverage gaps: `manualPsCandidates`'s `id !== 'code-graph' / !== 'claudemd'` exclusion branch is fixture-shadowed (the one test fixture's code-graph/claudemd entries are already excluded by the earlier bash/command-substring checks, so the id-check is never the deciding factor); `cgRead`'s primary-wins-when-both-present path is unproven (only primary-absent-falls-back-to-mirror is tested).
- `detect` tests don't assert `providers[]` contents (only `.verdict` / `.host` / `.guestRegistered`).
- Optional: uniform stderr-capture assertions across `install.js`'s 4 statusline note branches (`set` / `host-detected` / `skipped-foreign` / `error`) — none of the 4 currently assert the actual note text in `install.test.js`.

## v0.26.1 follow-ups (from the post-ship independent code review, 2026-07-06)

Second review over `0b45e6a..8f36a17` (opus, fresh eyes, no session history). No Critical /
no Important; 598 tests pass; all 8 load-bearing invariants verified (incl. the execFileSync
guest-exec regression test confirmed as derived-from-code-path, not a hardcoded literal). Five
independent Minors, each re-confirmed against the code:

1. **[SHIPPED v0.26.1] Durability asymmetry in the two-file registry write** — `scripts/lib/statusline-hosts.js:38-39`.
   `cgWrite` writes the VOLATILE primary (`~/.cache/code-graph/statusline-registry.json`)
   un-guarded but the DURABLE mirror (`~/.claude/statusline-providers.json`) best-effort in a
   `try/catch`. Inverts durability: the mirror is the backstop code-graph self-heals the primary
   FROM (our own comment, `statusline-hosts.js:23-24`), yet it's the droppable write. Failure
   path: mirror write throws → files diverge (mirror lacks claudemd) → `~/.cache` later evicted →
   code-graph restores the primary from the stale mirror → claudemd's segment silently vanishes.
   Compound-low-probability + recoverable (re-run `/claudemd-statusline`) → Minor, but the ONE
   latent-correctness item. **Fix:** write the durable mirror FIRST and drop the swallow, so a
   mirror failure aborts before the primary diverges (the only divergence mirror-first can produce
   is the benign self-healing direction). Fold in first if any v0.26.1 ships.
2. **Superseded provider restored to front, not its original index** — `scripts/lib/statusline.js:142`.
   `remove()` restores via `register(prev.superseded, {front:true})` regardless of original
   position → reorders a non-index-0 PS1 to front. Cosmetic (segment order); the "restore"
   contract doesn't advertise the move. **Fix:** capture the original index in adopt()'s
   `{superseded}` record and restore to `min(idx, len)`.
3. **A second `--supersede` clobbers the first's restore record** — `scripts/lib/statusline.js:96`.
   `prevPath()` holds a single `{superseded}`; `--supersede=A` then `--supersede=B` overwrites A →
   `remove()` can only restore B. Narrow (doc flow supersedes one manual PS1). **Fix:** store a
   `{superseded:[...]}` list (append + restore all), or refuse a second supersede while a prev exists.
4. **[SHIPPED v0.26.1] `--supersede=<id-not-in-registry>` no longer a silent no-op** — `scripts/lib/statusline.js:92-100`.
   Unknown id → supersede block skipped, `superseded` stays null, adopt still returns
   `action:'registered'` with no signal the target was missed. **Fix (cheap):** surface a
   `supersedeMissed:<id>` field (+ CLI stderr warn) when the id matches no provider.
5. **Orphan renderer on a host-but-not-registered uninstall** — `scripts/lib/statusline.js:151-152`.
   If claudemd was a guest (renderer copied) and the registry is wiped out-of-band while the slot
   stays a composite host, `remove()` hits `host && !guestRegistered` → `not-ours` and does NOT
   delete `~/.claude/claudemd-statusline.sh`. Very narrow. **Fix:** on the `not-ours` return, also
   `unlinkSync(destPath())` when `dest.exists && dest.matchesShipped` (never delete a foreign file).

**Shipped in v0.26.1:** #1 (durability) + #4 (supersedeMissed observability) + `manualPsCandidates`
wiring (`psCandidates` field). **Remaining for a future patch:** #2 (restore index) / #3 (multi-supersede)
/ #5 (orphan renderer) + the whole-branch-review dry-run-foreign wart + coverage gaps above.
