---
status: rejected
revision: 3
---

# §8 rm gate — literal-assignment provenance  [REJECTED — do not re-attempt as designed]

> **Outcome (2026-07-15): built, reviewed, rejected.** A fresh-subagent adversarial
> review broke the implementation five independent ways in one pass. Root cause is in
> the approach, not the details: guards (1) and (2) use TEXT position as a proxy for
> COMMAND position — the same error the npx gate was rewritten to fix in v0.47.0 (B-1),
> one block below in the same file. Do not re-attempt without real command-position
> parsing. The false-deny stays; `${VAR:?}` is the supported answer.

## Goal

Stop the §8 rm gate from denying `VAR=<literal>; rm -rf "$VAR"` when the literal is
written unquoted in the same command. The value is visible in the command text and
provably non-empty, which is the property the gate actually requires — the same
property the sanctioned `${VAR:?}` escape proves, and strictly less than it (`:?`
proves non-empty about an *invisible* value).

Four field hits across two sessions (agentsmd, sgc scratchpad cleanup):
`SP=<literal>; rm -rf "$SP"; mkdir -p "$SP"`, `WT=<literal>; rm -rf "$WT"`.

## Non-goals

- **Bare-literal danger checks.** `rm -rf /`, `rm -rf /*`, `rm -rf ~` are ALLOW today
  (measured). The gate scopes itself to var expansion, not to which paths are
  dangerous. This change does not touch that boundary, and must not be read as
  endorsing it.
- **Quoted $-free literals.** `SP="/home/me/x"` stays denied — see constraints.
- **Transitive / expansion-prefix vars.** `R="$S/x"`, `SP="$HOME/work"` stay denied.
  They contain `$`; their runtime value is not visible.
- **Relaxing `${VAR:?}` or the HOME/PWD/OLDPWD/TMPDIR whitelist branch.** Untouched.
- **Rewriting `sanitize_cmd` / `canon_cmd_words`.** That shared pipeline is where the
  v0.47.1 F10 and v0.47.2 F14 bypasses lived. Out of scope for an allow-widening change.

## Constraints

1. **Allow-widening = FN direction.** Full FN matrix across all three gates before ship,
   not just the FP corpus (`[[feedback_s8_false_negative_audit]]`). Third bite at this
   apple in three releases.
2. **Sanitize erases quoted $-free bodies.** By the time the rm gate runs,
   `SP="/home/me/x"` has become `SP=""` — indistinguishable from a genuinely empty
   `SP=""`. Empty + subpath target (`rm -rf "$SP/build"` → `/build`) is the exact
   steam-for-linux#3671 class. Therefore **only unquoted literals are recognizable**,
   and `""` must never be classified as a literal. Both field-reported shapes are
   unquoted, so this covers them.
3. **Tilde must not count as literal.** `SP=~/x` has no `$` but tilde-expands to `$HOME`;
   empty HOME reintroduces the collapse. Character allowlist, not a `$`-denylist.
4. **Assignment prefix on the rm's own segment is not provenance.** `SP=/a rm -rf "$SP"`
   expands `$SP` from the *outer* environment before applying the prefix. Assignments
   must be strictly before the rm segment — the v0.47.2 F14 machinery already is.
5. **Released-artifact rule (§2-EXT)**: minor bump, CHANGELOG migration note, explicit
   opt-out, one-time discoverability signal.
6. bash 3.2 / BSD-safe; no `declare -A`, no GNU-only flags.

## Success criteria

- `SP=/home/sds/.claude/tmp/…/bun135; rm -rf "$SP"; mkdir -p "$SP"` → ALLOW (the field repro).
- `BUN=/x/.bin; WT=/x/wt; rm -rf "$WT"` → ALLOW (the second field repro).
- Every one of these still DENIES:
  `rm -rf "$SP"` (no assignment) · `SP=$EVIL; rm -rf "$SP"` · `SP=""; rm -rf "$SP/build"` ·
  `SP=~/x; rm -rf "$SP"` · `SP="/lit"; rm -rf "$SP"` (quoted → erased) ·
  `SP=/a; SP=$EVIL; rm -rf "$SP"` · `SP=/a rm -rf "$SP"` (prefix on own segment) ·
  `rm -rf "$SP"; SP=/a` (assignment after) · `R="$S/x"; rm -rf "$R"` ·
  `SP=/a; rm -rf "$SP/$SUB"` · `echo "SP=/a"; rm -rf "$SP"` (prose, not command position).
- v0.47.2 F14 mktemp rows unchanged; full corpus zero-regression.
- Fresh-subagent review (§12 author≠reviewer) finds no bypass.
- `BASH_SAFETY_LITERAL_PROVENANCE=0` restores pre-change behavior exactly.

## Open questions

- **Resolved — default ON or OFF?** ON. §13.3's default-OFF-for-signal governs hooks that
  *add* denial; this removes a false denial, and shipping it OFF would leave the reported
  pain unfixed. Opt-out flag carries the revert path instead.
- **Resolved — allowlist or denylist for literal chars?** Allowlist
  (`[A-Za-z0-9_/.,:@%+=-]`), per §3 stricter-reading. Rejects `~`, glob, quotes,
  whitespace, `$`, backtick by construction rather than by enumeration of what is bad.
- **Open — should the quoted-literal gap be closed later?** Would require reading the RHS
  from the raw command while proving command position from the sanitized one. Deferred;
  not attempted here (constraint 2 / non-goals).

# Change log

- r1 (2026-07-15): initial draft. Design carried over from `tasks/s8-literal-provenance.md`
  (the pre-AUTH design note); constraints 2 and 3 are new — both found while enumerating
  the FN matrix for this spec, and both would have shipped as bypasses without it.
- r2 (2026-07-15): implemented, shipped v0.48.0. Two additions found during build, both
  constraint-shaped rather than plan drift:
  - **Constraint 7 (new): the literal must carry ≥1 non-slash character.** `/` is a member
    of the character allowlist, so `S=/` classified as a literal and
    `S=$(mktemp -d); S=/; rm -rf "$S"` flipped from deny to ALLOW. A v0.47.2 corpus row
    caught it. Mirrors the whitelist branch's existing residue rule (`$HOME/sub` allows,
    bare `$HOME` denies). The bare `rm -rf /` allowance is a scope boundary (non-goals),
    not a licence to widen a var path into it — §3 stricter-reading.
  - **Scope pickup: the v0.47.2 empty-assignment regression.** `SP=; rm -rf "$SP/build"`
    ALLOWed on shipped v0.47.2 — the F14 loop's `[[ -n "$prov_rhs" ]] || continue` (meant
    for blank grep lines) also skipped genuine empty assignments, so condition (2) passed
    vacuously. Author-introduced, one release old, zero installs (user's installed plugin
    was 0.47.0). Folded here rather than hotfixed separately because v0.48.0 shipped the
    same hour and touches the same loop. Fixed by construction — an empty RHS matches
    neither safe class once the `continue` is removed.
  - Fresh-subagent adversarial review per §EXT §12 author≠reviewer: see REPORT.

# Review outcome (2026-07-15) — why this was rejected

Fresh-subagent adversarial review (§EXT §12 author≠reviewer), ~60 probe shapes. Five
bypasses in the candidate, each verified ALLOW against the implementation:

1. **Prose injection into the assignment scan.** `echo " SP=/tmp/x $HOME"; rm -rf "$SP/build"`
   — sanitize preserves a `$`-bearing double-quoted body verbatim, so the scan matched the
   ` SP=` *inside the string literal*. SP is never assigned at runtime. The spec's own
   success criterion `echo "SP=/a"; rm -rf "$SP"` denied only by accident (no `$` in the
   body, and `"` immediately precedes `SP=`); one leading space and one `$` defeat it.
   Realistic form: `git commit -m "set SP=/tmp/x for $USER"; rm -rf "$SP/build"`.
2. **Fake assignment manufactured by `unwrap_indirect`.** `echo sh -c 'SP=/tmp/x' ; rm -rf "$SP/build"`
   — unwrap rewrites the *echoed argument* into real command position before sanitize runs.
3. **Indirect-name rebind.** `SP=/tmp/x; unset "$T"; rm -rf "$SP/build"` — the rebind guard
   counts bare mentions of the name, but `"$T"` never spells it. This refutes the guard's
   stated rationale ("an allowlist on shape covers forms not enumerated"): it is an
   allowlist on the shape of the NAME, and `"$T"` has the same shape as no name at all.
4. **`eval` with a non-literal argument.** `SP=/tmp/x; eval "$CODE"; rm -rf "$SP/build"` —
   `source` was rejected for running unseen current-shell code; `eval "$CODE"` does the
   same, and unwrap only ever exposes LITERAL inner text.
5. **`trap 'SP=' DEBUG`** — the DEBUG trap body runs before each simple command including
   the rm; sanitize erases the quoted body, so neither the scan nor the count sees it.

The review also reported two CRITICAL pre-existing defects (`${VAR}/subpath` mangled by
`canon_cmd_words`; heredoc regex matching `$((1<<n))`). The author first refuted both — using
a harness that ran the hook from /tmp, where its `source lib/hook-common.sh` failed, the
error went to stderr, and a `2>&1` capture made every command look like a DENY. Re-verified
with a working harness, **both findings are real**; they are tracked in
`tasks/s8-sanitize-brace-heredoc.md`. Lesson recorded: the refutation of a correct review
finding was itself the least-verified claim of the session.

## What would have to be true to re-attempt

Real command-position determination for assignments — the same treatment B-1 gave the npx
gate (segment split, wrapper strip, command-word check), not a `(^|[[:space:];&|`(])VAR=`
grep over flattened text. Absent that, every guard here is a claim about text that is
provably not the text bash executes (see defects 1, 2, and the two upstream ones).
