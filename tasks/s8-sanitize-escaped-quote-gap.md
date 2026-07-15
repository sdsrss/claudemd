# §8 sanitize: `\"` escape gap — now has a live FP hit

**Status**: deferred, not scheduled. Candidate for the next §8 batch.
**Recorded**: 2026-07-15, during the v0.47.1 F10/F11/F13 fixes.

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
