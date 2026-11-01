# `hook-drift` can name a `plugin-cache` root that nothing is running

Status: DECIDED 2026-11-01 (0.117.0) — see the last section. Found during the 0.89.0 pre-ship review.
**Pre-existing, not a 0.89.0 regression**: the same state was equally red
before `78661c7`, verified by the reviewer.

## What it is

When `runningPluginRoot()` falls through to `activePluginRoot()` and that
resolves via the `plugin-cache` arm (`scripts/lib/paths.js:446-471`; 384-391 when this was filed), the root
is simply the newest semver directory under the cache. Nothing checks that it
is the directory Claude Code actually loaded.

An abandoned directory from an interrupted install — newer than the real one by
semver — becomes the compared-against root. `hook-drift` then goes red about a
root nothing is using, and because the row counts toward the exit code, that is
a standing exit 3 on a machine whose install is fine.

## Why it is filed rather than fixed

0.89.0 repaired the three states where the row gave a false CAUSE or unfixable
advice (round-16 audit 6.6). This is a different thing: the cause is stated
correctly, the basis is now printed as `(via plugin-cache)`, and the root named
really does differ. The claim the row makes is just built on an inference —
"newest in the cache" standing in for "what is running" — that nothing verifies.

The honest fix is not in the message. It is either to verify the candidate
(there is no reliable signal available to a doctor process —
`feedback_plugin_root_is_the_versioned_cache` records that
`${CLAUDE_PLUGIN_ROOT}` is expanded, never exported) or to stop counting the
row when the basis is an inference rather than a measurement.

## Suggested next step

Decide the second question first: should a row that counts toward exit 3 ever
rest on an inferred basis? `hook-fired` is measured; `installed-plugins` is a
registry claim; `plugin-cache` is a guess. If the answer is no, the change is
to the row's counted-ness per basis, not to any wording — and it should be
weighed against 0.84.0, which demoted this row entirely to stop exactly this
class of standing red, and 0.85.0, which put it back.

## Triage 2026-10-24

**Decision pending.** Still undecided whether a row that counts toward doctor's exit code may rest on the inferred `plugin-cache` basis. Ordinary installs are skipped since 0.85.0, so only a checkout run with no hook-root record and no valid installed_plugins entry is exposed.

Two read-only subagents re-checked each item against HEAD 8e71e6c (v0.116.4); the §8 shapes, the restore path and the statusline items were re-run by the main session.

## Decision 2026-11-01 — the guess no longer moves the exit code (0.117.0)

Answer to the question above: no. A row that counts toward exit 3 does not rest on the `plugin-cache` basis.

Measured before deciding, in a sandbox HOME (session scratchpad): `install.js` from the checkout (a healthy install), no `installed_plugins.json`, no `hook-root.json`, the plugin cache holding a real 0.116.6 and an interrupted install's partial `0.200.0` (one hook file). `node scripts/doctor.js` from the checkout exited 3 and `hook-drift` was the only counted red row: "33 hook script(s) differ" against `0.200.0`, which nothing runs. With the same cache minus the leftover the row is green and the exit is 0, so the exit code was a function of which leftover sorts newest. The first run of the regression test found a second row on the same guess: `plugin cache:staleness` reads the leftover's `package.json` as "the installed plugin" (the probe's leftover had none, so the row could not read a version there). `plugin-root:stale-registration` is the third: from a cache dir with a newer leftover and no registry, "vX is installed" is the same guess.

0.85.0's own reason for counting `hook-drift` again was that the running root became measurable (`hook-fired`); `plugin-cache` is the one basis that reason does not cover, and 0.84.0's reason for demoting the row (it compares against "an unrelated leftover") is exactly this state.

Done in bba4536: on `ACTIVE.source` / `RUNNING.source === 'plugin-cache'` the three rows print as before, carry `advisory: true` plus a sentence saying they do not count, and the CLI's exit predicate (`countsTowardExit`, exported) skips them. Rows on the `installed-plugins` and `hook-fired` bases stay counted; the tests carry a registry control arm that still exits 3. Mutation check: 4/4 mutants caught.

Considered and rejected: verifying the candidate (no signal reaches a doctor process: `${CLAUDE_PLUGIN_ROOT}` is expanded, never exported), and dropping the rows on that basis (spends the line a maintainer can still read).

Round-1 pre-tag review (M1): the `stale-registration` skip on `hook-drift` still let the guess silence a measured row — doctor from a cache dir, no registry, a hook record naming a checkout whose hooks differ, and a partial newer leftover exited 0, the same tree without the leftover 3. Repaired in the same release: the skip applies only when the registration is not the guess (`staleRegistration && !activeGuess`), with that state as a test.
