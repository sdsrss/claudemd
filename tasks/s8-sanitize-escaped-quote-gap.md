# §8 sanitize: `\"` escape gap — now has a live FP hit

**Status**: deferred, **scheduled-when-triggered** (was "not scheduled" — an open
item with no trigger never gets picked up). Assessed 2026-08-24, not implemented.
**Recorded**: 2026-07-15, during the v0.47.1 F10/F11/F13 fixes.

## Assessment 2026-08-24 — the FN framing below is too pessimistic, but the work is still a batch of its own

The "Deny-direction risk" paragraph below reads the fix as an FN-direction change
because honoring the escape HIDES text from the detectors. Checked against bash
semantics rather than against the sanitizer's: for the shapes this actually
covers, hiding it is **correct**, not a regression.

`echo "harmless \" ; rm -rf / "` is ONE double-quoted argument to `echo` in bash.
The `rm` never runs. The sanitizer's current model — outer string ends at the
escaped quote — invents a command position bash does not have, which is exactly
the false-deny observed. Modelling the escape brings the sanitizer TOWARD bash,
and text bash treats as data is text the detectors should not see.

So the risk is not the direction of the change. It is the **precision of the
escape model**:

- `\\"` — an escaped backslash, then a real closing quote. Consuming the `\\`
  as one unit is required, or the string is treated as continuing and a genuine
  command position gets swallowed. THIS is the FN, and it lives in the fix, not
  in the concept.
- `'...\"...'` — no escape processing inside single quotes. Already noted below.
- `$'...\"...'` — ANSI-C quoting has its own escape rules, and the machine has
  no `$'` state at all today.

That is a real FN surface, on the one gate in this repo that is never-downgrade,
and `feedback_s8_false_negative_audit` records the precedent: a v0.47.1 precision
fix on this same shared pipeline reopened a bypass. It needs the full FN matrix
across all §8 gates (rm / npx / curl-sh), not the FP corpus, plus the three
shapes above as explicit cases.

**Decision**: not folded into the 2026-08-22 convergence batch. That batch is
test-and-instrument work with no runtime blast radius; this changes the parsing
core of the blocking safety gate and belongs in its own release with its own
review. Bundling it would put an FN-surface change behind a changelog entry about
gates and documentation.

**Trigger to pick it up** (any one, so it stops depending on someone remembering):

- A second live false-deny of this shape. One is a workaround; two is a pattern,
  and the workaround (`-F <file>`) does not reach MCP tool params.
- Any other scheduled edit to `sanitize_cmd`'s quote machine — the FN matrix has
  to be run for that edit anyway, so the marginal cost drops to the three cases.
- A `$'...'` shape showing up in real commands, which needs the same machine
  touched regardless.

## What

`sanitize_cmd`'s quote state machine does not model backslash-escaped quotes
inside a double-quoted string (`\"`). It has been a documented residual since
the double-quote machine landed ("Escape sequences (`\"` inside `"..."`) are
not modeled — same gap as the prior regex; not in scope"), and the v0.47.1
single/double-quote unification did not change it.

## Why it is worth revisiting now

It stopped being theoretical. During the v0.47.1 session it **false-denied a
legitimate command of mine**: a `mem_save` CLI call whose `--lesson` argument
quoted the F11 repro string. The argument was one bash double-quoted string
containing `\"`-escaped inner quotes; the machine closed the outer string at
the first escaped quote, so `rm -rf $X` from the *prose* landed at what looked
like command position and the rm gate denied it.

That is one live FP in one session — from an agent writing a routine memory
save. The shape (prose quoting a shell snippet, passed as an escaped-quote
argument) is not exotic; it is what any `-m` / `--lesson` / `--notes` flag
carrying shell examples looks like.

## Direction if picked up

Track a backslash escape inside the `st == 2` (double-quote) branch: on `\`,
consume the next char into `buf` verbatim without letting it toggle state.
Single-quoted bodies need no change — there is no escape inside `'...'`.

Deny-direction risk: an escaped quote currently *ends* the string early, which
EXPOSES the rest to the detectors (false-deny direction). Honoring the escape
keeps that text inside the body, which HIDES it — so this is an FN-direction
change and must go through the full FN matrix, not just the FP corpus. See
`[[feedback_s8_false_negative_audit]]`: the shared sanitize/canon pipeline is
exactly where a precision fix reopened a bypass in v0.47.1.

## Workaround meanwhile

Pass the text via a file (`git commit -F <file>`, MCP tool params) instead of
an escaped-quote inline argument. Used successfully in the v0.47.1 ship.

## Other §8 residuals (unchanged, still not scheduled)

Tracked in `tasks/s8-false-negative-audit-2026-07-03.md`: `xargs rm` (target on
stdin), option-with-argument wrappers (`sudo -u svc rm`, `timeout -s KILL 5 rm`),
`eval "$(curl …)"`, `find -delete`.
