# §8 mktemp-provenance residuals — eighteen false negatives, and the attempt that was dropped

**Status**: recorded, **not scheduled**. Corpus rows `S8-PROV1`..`S8-PROV20` pin
the current behaviour, with two controls (`S8-PROV-CTL1`/`CTL2`) that fail if the
gate ever stops judging this class at all. **Eighteen** of the twenty allow on
v0.82.0 and delete outside the temp dir as written; the pre-tag review expanded
every row and found the other two, which now say what they are on their own line:

- `S8-PROV17` is a **control, not a residual**. A bash function body is not a
  subshell, so calling `f` binds the assignment in the parent and the target
  stays inside the temp dir — allowing it is correct. It is kept because it is
  the shape the abandoned scanner got backwards: that branch DENIED it.
- `S8-PROV20`, the opaque `DEBUG` trap, is a real hole whose damage needs the
  environment to supply the trap body. Expanded with `$CODE` unset it stays
  inside the temp dir.

They were found by two adversarial reviews of a change that set out to fix a
different problem. **That change is not merged.** It lives on the branch
`s8-command-position-assignments` (five commits, `ffc7302`..`f4a5736`) and is kept
only as the record of what was tried. This file is written in English to sit
beside `s8-round4-residuals.md` and `specs/s8-literal-provenance.md`, which a
reader of this one will read next.

## Why the change was dropped, in one number

**1,103–1,147 real commands** — every `Bash` tool call in the local transcripts
that can reach the rm-var gate — driven through v0.82.0 and through the branch:

| | closes (synthetic) | opens (synthetic) | real commands |
|---|---|---|---|
| the branch tip | 21 | 6 | **repairs 1, breaks 8** |
| variant: unwrap-withdrawal + DEBUG-trap only | 4 | 0 | breaks 5 |
| variant: DEBUG-trap only | 1 | 0 | 0 moved, but misfires on five ordinary shapes |

Baseline: 87 of 561 gate-reaching real commands (15%) already deny on v0.82.0.
The branch would have made that 94. It made the pain it was written for worse.

The shapes it broke are ordinary maintainer work: `local D=$(mktemp -d)` (what
every shell function writes), `… && D=$(mktemp -d)`, `case` arms, `{ … }` groups,
and — for the DEBUG-trap variant — a commit message containing the word DEBUG,
and `trap - DEBUG`, which *removes* a trap.

## What the attempt got right, and where it broke

The design premise still holds and is worth reusing: only shell **builtins and
keywords** can rebind the parent shell, because an external command gets a copy
of the environment and cannot reach the shell's variable table. What broke was
everything built on top of it:

1. **Two halves deciding separately.** The gate's guard is `total == lhs`, sound
   only when `lhs` means "the scanner classified this token". The first
   implementation tagged `lhs` from the token's own syntax, so `export S=/etc`,
   `readonly`, `{ S=…; }`, `then S=…`, `time S=…` and `! S=…` were all credited as
   accounted-for while never being classified. Eleven false negatives.
2. **Keywords and builtins need opposite views.** Measured: escaping *disables* a
   keyword (`i\f true; then` is a syntax error) but *not* a builtin (`un\set`,
   `\export`, `expo\rt`, `"unset"` all run). A single word list tested against a
   single view cannot be right for both.
3. **Absence of evidence used as evidence.** "Arguments to a command not on the
   list are data" let a function definition through: in `f() { S=/etc; }; f` the
   command word is `f()`, so the whole body was discarded as data.
4. **`((` and `wait` are not words.** `(( S = 5 ))` stays one token, and bash 5.1's
   `wait -n -p VAR` writes a caller-named variable.

## The residuals, by mechanism

**The assignment never binds the parent shell** — `S8-PROV1`..`4`: a subshell
`( S=… )`, an assignment behind `&&`, a backgrounded `S=… &`, and
`S=$(mktemp -d)\>&1` where the escaped `>` is a word character so bash backgrounds
the whole thing.

**The text is never executed as an assignment** — `S8-PROV5`..`8`: prose inside a
quoted word; `sh -c '<inner>'`, whose inner text `unwrap_indirect` promotes to
command position so the gates can see an rm hiding there; and an assignment that
runs *after* the rm still vouching for it.

**A body the shell may never enter** — `S8-PROV9`..`14`: `if false`, `while false`,
a `case` with no matching arm, `for` over an empty list, `until`, `select`.

**A function body** — `S8-PROV15`, `16`, `18`: defined and not called (two
spellings), and the `f() ( … )` subshell form, whose body cannot reach the parent
at all. `S8-PROV17` sits with them as the control described above.

**A rebind the name-shaped scan cannot see** — `S8-PROV19`/`20`: `unset ${x-S}`,
where bash expands the parameter default to the literal name and the F20 `-`
adjacency rule drops the mention; and `trap "$CODE" DEBUG`, whose body runs before
every simple command including the rm.

## What a future attempt has to beat

Not a corpus. The corpus said 0 moved across all 751 pre-existing rows while the
branch was breaking eight real commands — it is necessary and nowhere near
sufficient. The bar is:

- **Replay the local transcripts.** Extract every `Bash` command, filter to the
  ones that reach the gate, drive both revisions, and count flips in each
  direction. Ship only if `allow→deny` is zero on that set. A synthetic corpus
  cannot substitute: the shapes that broke were `local D=…` and `… && D=…`, which
  no one writes as a test case because no one thinks of them as edge cases.
- **Separate closing a false negative from fixing a false deny.** They pulled in
  opposite directions here, and bundling them hid the trade until a replay
  measured it.
- **Attribute per component before repairing again**
  (`feedback_revert_the_component_not_the_next_defect`). Three review rounds on
  one component produced 11, then 1, then 6 newly-introduced false negatives. That
  is not convergence, and each round's repair looked local and principled.

## The false deny this was written for

Two shapes, both the shipped mktemp-provenance branch refusing the §8.V4 disposal
idiom it exists to permit: `echo "SB=$SB"` after a genuine `SB=$(mktemp -d …)`, and
the env-prefix reuse `SBX="$SBX" node …`. Both still deny. The measured cost of
the fix was worse than the complaint, so the answer for now is the one the deny
message already prints: `rm -rf "${VAR:?}"`, which the guard has always accepted
and which costs nothing to write the first time.
