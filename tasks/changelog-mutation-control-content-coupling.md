# The CHANGELOG mutation control splices at a literal from the release's prose

**Status**: filed 2026-09-13, **not scheduled**. A guard shipped in v0.87.0; the
full fix below is the one that removes the coupling.

## What it is

`tests/scripts/changelog-structure.test.js`'s mutation control replays the real
corruption — the file header pasted mid-line into the top entry — to prove the
three structure assertions can fail. It splices at `` `$` ``, a backticked dollar,
which it finds by `indexOf` inside the top entry.

That literal is **content of the release prose**, so every release must happen to
contain one. Two have not:

- v0.84.1 — its changelog records going red for this reason.
- v0.87.0 — repaired by adding a sentence that links the release to v0.86.0's
  `$`-rooted targets. True and worth saying, but written because a test wanted a
  character.

## Why the obvious repair is wrong

Widening the marker, or letting `indexOf` match later in the file, makes the
control green while testing nothing: the splice lands outside the top entry,
`topEntry(corrupted)` comes back unchanged, and arms 2 and 3 pass against
unmodified text. The pre-ship reviewer for v0.87.0 measured this and it is the
reason the shipped guard names the unsound repair in its own failure message.

## What shipped in v0.87.0 (guard only)

The assertion now requires the marker to be found **inside** the entry —
`at !== -1 && at < entryStart + entry.length` — and its message says not to widen
the marker and why. Before it, the failure read "the foreign-H2 arm would not have
caught the corruption that shipped", which blames the arm when what happened is
that the splice missed; that message aims an author straight at the unsound fix.
Mutation-tested in a sandbox: marker removed from the top entry but left elsewhere
in the file fails with the new message, which is the case the old `at !== -1`
admitted.

## The full fix

Drop the content literal. The corruption being replayed was a **mid-line**
injection, so any mid-line offset inside the entry reproduces its shape — the
first backtick of the entry body, or a fixed column into its first prose line.
Nothing then depends on what a release happens to say, and the guard above becomes
unnecessary rather than load-bearing.

Smaller than the sentence v0.87.0 wrote to satisfy the marker, and it ends a class
rather than an instance.
