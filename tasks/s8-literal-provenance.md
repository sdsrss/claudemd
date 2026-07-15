# §8 rm gate: literal-assignment provenance (step 2)

**Status**: designed, awaiting go-ahead. Step 1 (v0.47.2 F14) shipped the mechanism.
**Recorded**: 2026-07-15.

## The false-deny

```
rm -rf /home/me/work              => ALLOW
SP=/home/me/work; rm -rf "$SP"    => DENY     <-- same deletion, same visible path
```

Four field hits across two sessions (scratchpad cleanup in agentsmd / sgc):
`SP=<literal>; rm -rf "$SP"; mkdir -p "$SP"`, `WT=<literal>; rm -rf "$WT"`.

## Why it is a defect and not strictness

The gate defends against **the var being empty/unset at runtime**, which collapses
the target (`rm -rf "$SP/build"` with empty SP deletes `/build`). That is why the
whitelist branch demands a literal subpath under `$HOME`, citing
ValveSoftware/steam-for-linux#3671.

Under that model a same-command literal assignment is *proof of non-emptiness* —
exactly what the sanctioned `${VAR:?}` escape proves, and strictly more, because
the value is also visible. Measured:

```
SP=/; : "${SP:?}" && rm -rf "$SP"   => ALLOW   # :? proves non-empty, not safe
rm -rf "${SP:?}"  (SP from env)      => ALLOW   # value entirely invisible
SP=/home/me/x; rm -rf "$SP"          => DENY    # value right there
```

So the gate currently accepts an invisible env value and refuses a visible literal.
The earlier rationale in the code ("a literal prefix is only as bounded as the
literal, `..` can escape upward") does not hold: `rm -rf /home/me/../../etc` is
allowed today, as is `rm -rf /`. Bare literals are out of scope by design — the
gate is about var expansion, not about which paths are dangerous.

## Design (small increment on the F14 mechanism)

F14 already computes, for the rm target's var: every assignment to it before this
rm segment, every assignment anywhere, and whether the target expands any other
var. Step 2 adds **one safe-RHS class**: a pure literal (no `$`, no backtick, no
`$(`). Everything else is unchanged.

```
last-assignment classes:  $(mktemp …) -> safe (shipped)
                          pure literal -> safe (this task)
                          $EVIL / $(cat f) / "$S/x" -> unsafe
                          none before the rm -> unsafe
```

The "every assignment must be safe" rule already handles the conditional-branch
hazard (`SP=$EVIL; if …; then SP=/tmp/safe; fi; rm -rf "$SP"` denies, because
textual order is not runtime order).

## Why it needs its own decision, not a drive-by

- It **widens allow** on a shipped guardrail — FN direction by definition. Per
  `[[feedback_s8_false_negative_audit]]`, the full FN matrix across all gates must
  run, not just the FP corpus. Precision work on this pipeline opened the v0.47.1
  F10 bypass and the v0.47.2 F14 bypass; this is the third bite at the same apple.
- Read against spec §2, a user-visible default-behavior change on a released
  marketplace artifact classifies L3 → `[AUTH REQUIRED]` on "L3 enter
  implementation". Not something `AUTONOMY_LEVEL: aggressive` covers.

## Explicitly out of scope

`rm -rf /` as a bare literal is allowed and stays allowed. Whether the gate should
grow a dangerous-literal-path check at all is an independent scope decision.

## Workaround meanwhile

`${VAR:?}` works today. It proves non-empty only — it is not a safety guarantee,
just the shape the hook accepts.
