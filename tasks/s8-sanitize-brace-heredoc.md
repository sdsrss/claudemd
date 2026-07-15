# §8: two pre-existing bypasses upstream of all three gates

**Status**: confirmed, not fixed. This is step 2 of the 2026-07-15 plan (step 1 = v0.47.3).
**Severity**: both blind the gate on shapes it exists to catch. Live in every release
through v0.47.3, including whatever is currently installed.

Found by a fresh-subagent adversarial review, 2026-07-15. **The author refuted both, then
re-verified and was wrong** — see "How the first refutation failed" below before trusting
any probe in this file.

## D1 — `canon_cmd_words` tears `${VAR}/subpath` apart

Measured on shipped v0.47.2 AND on v0.47.3:

```
rm -rf "${SP}/build"      => ALLOW      rm -rf "$SP/build"   => DENY   (control)
rm -rf ${SP}/build        => ALLOW
rm -rf "${HOME}/"         => ALLOW      rm -rf "$HOME/"      => DENY   (control)
```

`canon_cmd_words` sets `cmdpos=1` on `{`, so `SP}/build"` is treated as a command word and
`sub(/.*\//,"",word)` basenames it to `build"`. The expansion becomes `rm -rf "${build"`,
the gate's var-detection grep (`\$[[:alpha:]_]|\$\{[^}]+\}`) finds nothing, and the segment
is skipped — no provenance logic, no guard, no telemetry.

Only shapes with a `/` after the `{` are mangled, so the bypass lands precisely on the
dangerous subpath class while the harmless bare `${SP}` (→ `rm -rf ""`, a no-op) still
denies. `rm -rf "${HOME}/"` with empty HOME is `rm -rf /` — the exact
ValveSoftware/steam-for-linux#3671 case the whitelist branch's residue rule was written to
stop. Adding braces bypasses that rule.

Introduced with `canon_cmd_words` in v0.42.0 (SEC-2).

## D2 — `sanitize_cmd`'s heredoc regex matches an arithmetic left-shift

```
SHIFT=$((1<<bits)); rm -rf "$EVIL/build"   => ALLOW
echo $((1<<n))<newline>rm -rf "$EVIL/build" => ALLOW    echo hi<newline>rm -rf ... => DENY (control)
echo $((1<<n))<newline>npx unknown-pkg      => ALLOW    (blinds the npx gate too)
```

`heredoc_re` = `<<-?[[:space:]]*['"]?([[:alpha:]_][[:alnum:]_]*)['"]?` matches `<<bits`
inside `$((1<<bits))`. sanitize sets `in_heredoc=1`, truncates the line at
`line="${line%%<<*}"`, and blanks every subsequent line until one equals `bits`. The rm is
deleted from the text before any detector runs, so this blinds **all three** gates
(rm, npx, curl|sh), not just the rm gate.

## How the first refutation failed — read this before probing

The author's first pass "disproved" both findings and told the user they were false
positives. The harness copied the hook to `/tmp/s8-head-hook.sh` and ran it there. The hook
resolves its library relative to its own path:

```bash
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
source "$LIB_DIR/hook-common.sh" || exit 0
```

From /tmp that source fails, bash prints an error to **stderr**, the probe captured
`2>&1`, and any non-empty output was scored as DENY. **The harness reported DENY for every
input, including `rm -rf /tmp/build`.** The tell was on screen and was missed.

Rules for this task:
- Swap the hook with `git stash push hooks/pre-bash-safety-check.sh`, never by copying it
  elsewhere. It must run from `hooks/` so `lib/` resolves.
- Do **not** merge stderr. Use `2>/dev/null`; only the hook's stdout JSON is a deny.
- Every probe run starts with two controls that must come out differently
  (`rm -rf $EVIL` → DENY, `rm -rf /tmp/build` → ALLOW). If they agree, the harness is
  broken and every other row is noise.
- `export DISABLE_RULE_HITS_LOG=1` first ([[feedback_manual_hook_probe_pollutes_telemetry]]).

## Direction — decide this BEFORE writing any fix

The reviewer's framing is the one that matters: these defects mean **the gate's input text
is not the text bash executes**, and every guard in the file is a claim about that text.
That is an architectural signal, not a bug list. Data points from 2026-07-15 alone: one
review pass produced 5 bypasses in one feature; `if …; then rm -rf $X; fi` — the most
ordinary cleanup idiom in shell — went unguarded for ~26 releases; two CRITICALs are still
open. Chasing shell semantics with grep/sed/awk yields defects linearly in "how many shapes
did the author think of", and shell's shapes do not enumerate.

**Recommended: fix these two, then stop patching — do NOT escalate to a parser.** §8 already
declares itself a guardrail, and `DISABLE_*` / `[allow-*]` are bypassable by design. So the
honest bar is "catches ordinary mistakes an agent or a tired human actually makes", not
"resists a crafted command". Both D1 and D2 clear that bar and are worth fixing: D1 makes
`rm -rf "${HOME}/"` — a shape people write by habit — silently allowed, and D2 makes any
command containing `$((a<<b))` blind the whole gate. Neither needs adversarial intent to
trigger. The already-open indirect-name rebind (`unset "$T"`) and `trap 'S=' DEBUG` do NOT
clear that bar — they require someone deliberately routing around the gate — so leave them,
and say so in the code rather than pretending otherwise.

What that implies for scope: D1 wants `canon_cmd_words` to stop treating `{` as a
command-position boundary (it was added for `{ rm …; }` brace groups; `${VAR}` is the far
more common `{`). D2 wants the heredoc regex to not match when the `<<` sits inside `$((…))`.
Both are narrow. If a proposed fix starts growing toward tokenizing the command, that is the
signal to stop and re-ask this question rather than push through.

The rejected alternative (real command-position parsing, the treatment B-1 gave the npx gate
in v0.47.0) is what a *correct* literal-provenance would have needed — see
`tasks/specs/s8-literal-provenance.md`. It is not needed for D1/D2, and pulling it in here
would mean rewriting the shared pipeline that has produced two silent bypasses in 24h. If
someone later wants provenance widened, that parser is the prerequisite and it deserves its
own spec, not a rider on this task.

## Why this is not a drive-by

Both defects are in the shared pre-detector pipeline (`sanitize_cmd` / `canon_cmd_words`)
that every gate depends on. That pipeline produced two silent bypasses in the last 24h:
F10 (canon basenaming env-assignments, v0.47.1) and F11 (line-based single-quote sed,
v0.47.1). A fix here must run the full FN matrix across all three gates plus the whole
corpus, and go through a fresh-subagent review — the author's own probes missed both of
these and then misjudged the review that found them.

The reviewer's framing is the one to keep: these defects mean **the gate's input text is
not the text bash executes**, and every guard in the file is a claim about that text.

## Also open (lower severity, from the same review)

- Indirect-name rebind defeats the v0.47.3 rebind guard: `S=$(mktemp -d); unset "$T"; rm -rf "$S/build"`
  and `trap 'S=' DEBUG` are ALLOW. Documented in the hook; both predate v0.47.3.
- `IFS` as a word-splitting vector against the rm token loop (`IFS=/; rm -rf $SP/build`) —
  the reviewer flagged it as NOT-PROBED. Unknown whether a crafted `IFS` can shift which
  token becomes `rm_target`.
