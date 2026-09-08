---
status: draft
revision: 1
---

# §8 rm gate — command-position assignment scan  [phase A]

> **For agentic workers:** this touches the repo's most sensitive file. The corpus
> (`tests/fixtures/bash-safety/corpus.tsv`, 851 rows green at plan time) is the
> master safety net and gates every step. Steps use `- [ ]`.

**Spec:** this file. **Plan:** the `## Implementation plan` section below.

## Goal

Replace the mktemp-provenance recognizer's **flat-text `VAR=` grep** with a scan
that only counts assignments bash actually **binds into the parent shell**, so the
already-shipped provenance class stops being withdrawn by text that is not an
assignment at all.

Two field shapes, both reproduced against repo HEAD and installed 0.81.0:

| Command | Today | Why |
|---|---|---|
| `S=/tmp/x; SB=$(mktemp -d "$S/a-XXXXXX"); mkdir -p "$SB/home"; rm -rf "$SB"` | ALLOW | control |
| … same, plus `echo "SB=$SB"` before the rm | **deny** | the echoed `SB=$SB` is scanned as a second, non-mktemp assignment |
| `SBX=$(mktemp -d /tmp/x.XXXXXX); echo "sandbox=$SBX"; SBX="$SBX" node -e "1"; rm -rf "$SBX"` | **deny** | the env-prefix `SBX="$SBX" node …` is scanned as a rebind |

Neither text rebinds anything: a `VAR=` inside a quoted word is data, and a
`VAR=… cmd` prefix binds only that command's environment, never the parent shell.

Measured cost: 8 of 57 recoverable `§8-rm-rf-var` denies (14%) in the
2026-09-05 → 09-08 telemetry window are this class.

## Non-goals

- **Literal-assignment provenance** (`S=/tmp/x; rm -rf "$S"`). That is phase B,
  gated on the FN matrix + fresh-subagent adversarial review, and tracked in
  `tasks/specs/s8-literal-provenance.md` (status: rejected). Phase A adds the
  command-position foundation that rejection names as the precondition; it does
  **not** widen the recognized RHS classes. After phase A the only safe RHS class
  is still mktemp.
- **The `${VAR:?}` escape, the HOME/PWD/OLDPWD/TMPDIR whitelist branch, the
  `find … -delete` rewrite, the npx gate, the curl-sh gate.** Untouched.
- **Rewriting `sanitize_cmd` / `canon_cmd_words`.** The shared pre-pipeline stays
  as-is; this change consumes it.
- **Making §8 an anti-injection boundary.** It is a guardrail. `DISABLE_*` and
  `[allow-rm-rf-var]` remain bypassable by design, as the file already states.

## Constraints

1. **bash 3.2 floor** (macOS `/bin/bash`): indexed arrays + plain strings only; no
   `declare -A`, no `mapfile`/`readarray`, no sed `\n`. CI gate rejects them.
2. **Allow-widening is the FN direction.** Every verdict change must be
   enumerated and justified; the corpus is the proof, not a claim in a comment.
3. **Operate on `SANITIZED_CMD`, never `SANITIZED_CMD_FLAT`, for binding
   decisions.** FLAT is `tr '\n' ' '`, which turns the single most common real
   shape — an assignment on its own line — into an env-prefix. Using FLAT here
   would invert the very distinction this change exists to draw.
4. **`s8_split_segments` cannot be reused for assignment detection.** Its splitter
   is `s/[;&|()`]/\n/g` — it discards the subshell parens, so `( S=/tmp/x )` and
   `S=/tmp/x` are indistinguishable in its output. This is break #2 of the
   2026-07-25 reverted attempt. The new scanner must keep the separator.
5. **The rebind-guard invariant must survive.** Today: `prov_bare == prov_nassign`,
   where a surplus bare mention of the name is an unseen rebind (`unset SP`,
   `SP+=`, `printf -v SP`, `for SP in`, `read SP`, `declare -n r=SP`). Phase A
   changes which assignments are *classified*, and must not change the
   *denominator* — otherwise every quoted `VAR=` becomes a phantom rebind.
6. **Released-artifact rule (§2-EXT)**: minor bump, CHANGELOG migration note,
   explicit opt-out, one-time discoverability signal.

## Success criteria

**Must flip deny → ALLOW** (the reported field shapes):

- `S=/tmp/x; SB=$(mktemp -d "$S/a-XXXXXX"); echo "SB=$SB"; mkdir -p "$SB/home"; rm -rf "$SB"`
- `SBX=$(mktemp -d /tmp/x.XXXXXX); echo "sandbox=$SBX"; SBX="$SBX" node -e "1"; rm -rf "$SBX"`

**Must stay deny** (every documented break, plus the F14/F17 corpus classes):

- `S=$(mktemp -d); S=$EVIL; rm -rf "$S/build"` — real reassignment at command position
- `S=$(mktemp -d); S=/; rm -rf "$S"` — root-literal reassignment
- `rm -rf "$S"; S=$(mktemp -d)` — assignment after the rm
- `S=$(mktemp -d); rm -rf "$S/$SUB"` — second unknown var in target
- `S=$(mktemp -d); unset S; rm -rf "$S/build"` — F17 rebind family (all 6 rows)
- `S=$(mktemp -d); rm -rf "$S/../../home/u/proj"` — traversal out of the temp dir
- `IFS=/; S=$(mktemp -d); rm -rf $S` — IFS re-split
- `echo " SP=/tmp/x $HOME"; rm -rf "$SP/build"` — prose injection (review break #1)
- `echo sh -c 'SP=$(mktemp -d)' ; rm -rf "$SP/build"` — unwrap-manufactured assignment (break #2)
- `S=/tmp/x; rm -rf "$S"` — literal provenance stays denied (phase B, not this change)

**Must stay ALLOW** (no regression in the shipped disposal idiom): all 9 `F14-fp`
and `F8` corpus rows, including `S=$(mktemp -d) && rm -rf "$S"` (the `&&` there
follows the assignment; only a separator *preceding* it disqualifies).

**Whole-corpus:** 851/851 green, and every verdict change is a row added or
changed deliberately in this spec's change log — no silent movement.

## Open questions

- **Resolved — do `&&` / `||` / `|` / `&` before an assignment bind?** No; they are
  rejected. `false && S=$(mktemp -d); rm -rf "$S/build"` leaves `$S` unset and the
  target collapses to `/build` (steam-for-linux#3671 class). This is *tighter* than
  today, where the prefix grep's char class accepts them. Cost: `cd /x && S=$(mktemp
  -d); rm -rf "$S"` newly denies. Deny-direction, `${VAR:?}` is the answer.
- **Resolved — subshell assignments?** Rejected (paren depth must be 0, backtick
  state must be closed). Also tighter than today.
- **Open — does phase A's scanner want to live in `hooks/lib/`?** It has one
  consumer today and a second (phase B) that is not authorized. Kept in
  `pre-bash-safety-check.sh` beside its consumer until phase B needs it, per the
  seam-multiplication lesson of the 2026-07-27 audit.

## Implementation plan

**Architecture:** one awk program, `S8_BIND_AWK`, walks `SANITIZED_CMD` character
by character tracking quote state, paren depth and backtick state. At each point
where bash would start a command it decides whether the token run that follows is
a **binding assignment run** (the segment is assignments and nothing else) or an
**env prefix** (a command word follows). It emits one `NAME<TAB>RHS` line per
binding assignment. The rm gate's provenance block consumes that list instead of
its `grep -oE "(^|[[:space:];&|\`(])VAR="` over flat text.

**Tech stack:** bash 3.2, awk, existing corpus harness.

### Global constraints

Copied verbatim from `## Constraints` above — bash 3.2 floor (no `declare -A`,
no `mapfile`, no sed `\n`); binding decisions read `SANITIZED_CMD`, never
`SANITIZED_CMD_FLAT`; `prov_nassign` (the rebind denominator) keeps counting **all**
text `VAR=` occurrences; every verdict change is enumerated in the change log.

### Task 1: `s8_bind_assignments` scanner + its own unit tests

**Files:**
- Modify: `hooks/pre-bash-safety-check.sh` (new function beside `s8_strip_wrappers`, ~line 775)
- Test: `tests/hooks/pre-bash-safety.test.sh` (new inline unit block) + `tests/fixtures/bash-safety/corpus.tsv`

**Interfaces:**
- Produces: `s8_bind_assignments CMD` → stdout, one `NAME<TAB>RHS` per binding
  assignment, in source order. No output when none. Never reads globals.

- [ ] **Step 1: Write the failing unit test** — a table in the test runner driving
      `s8_bind_assignments` directly and asserting the emitted `NAME<TAB>RHS` set:
      binding (`S=/tmp/x`, `A=1 B=2`, newline-separated, `S=$(mktemp -d)`),
      non-binding (`echo "SB=$SB"`, `SBX="$SBX" node -e 1`, `( S=/tmp/x )`,
      `false && S=/tmp/x`, `` `S=/tmp/x` ``, `echo 'S=/tmp/x'`).
- [ ] **Step 2: Run it, confirm it fails** with "command not found: s8_bind_assignments".
- [ ] **Step 3: Implement `S8_BIND_AWK` + the wrapper.**
- [ ] **Step 4: Run the unit block, confirm green.**
- [ ] **Step 5: Run the full corpus** (`bash tests/hooks/pre-bash-safety.test.sh`) —
      must still be 851/851; Task 1 adds a function with no caller, so any movement
      here is a bug in the function's side effects, not a verdict change.
- [ ] **Step 6: Commit.**

### Task 2: rewire the provenance block onto the scanner

**Files:**
- Modify: `hooks/pre-bash-safety-check.sh:1107-1174` (the `prov_prefix` grep, the
  classification `while` loop, and the `prov_bare` rebind guard)
- Test: `tests/fixtures/bash-safety/corpus.tsv`

**Interfaces:**
- Consumes: `s8_bind_assignments` from Task 1.

- [ ] **Step 1: Add the corpus rows** — the two `pass` rows from Success criteria
      (the field shapes) and the two new `deny` rows (prose injection, unwrap-
      manufactured assignment).
- [ ] **Step 2: Run the corpus, confirm the two new `pass` rows FAIL** (they are the
      reported false denies) and the two new `deny` rows pass.
- [ ] **Step 3: Rewire.** `prov_prefix` becomes `${SANITIZED_CMD%%"$segment"*}`;
      classification iterates `s8_bind_assignments "$prov_prefix"` filtered to
      `varname`; `prov_nassign` keeps its current flat-text count so the
      `prov_bare` invariant is unchanged.
- [ ] **Step 4: Run the corpus, confirm 855/855** (851 + 4).
- [ ] **Step 5: Re-run the field repro harness** — all shapes in Success criteria.
- [ ] **Step 6: Commit.**

### Task 3: released-artifact obligations (§2-EXT)

**Files:**
- Modify: `CHANGELOG.md`, `package.json` + the version-cascade sites, `hooks/pre-bash-safety-check.sh` (opt-out flag)

- [ ] **Step 1: Add `BASH_SAFETY_BIND_SCAN=0` opt-out** restoring the flat-text
      grep exactly, with a corpus row pinning the restored behavior.
- [ ] **Step 2: CHANGELOG migration note** naming both the widened shapes and the
      two newly-tightened ones (`&&`-preceded and subshell assignments).
- [ ] **Step 3: Run the full suite** (`npm test`).
- [ ] **Step 4: Commit.**

### Task 4: fresh-subagent adversarial review (§EXT §12 author ≠ reviewer)

- [ ] **Step 1: Dispatch a fresh subagent** with the scanner, the corpus diff, and
      the five bypasses from `s8-literal-provenance.md` + the four from the
      2026-07-25 revert as the probe seed. Brief: find a command whose runtime
      binding differs from what `s8_bind_assignments` reports.
- [ ] **Step 2: Triage findings** per §EXT §12 Review-finding repair.
- [ ] **Step 3: Record the outcome in this file's change log** and set
      `status: implemented` (or `rejected`, if it breaks the way phase B's did).

# Change log

- r1 (2026-09-08): initial draft. Scope is phase A only — user chose "command-position
  scan + two-phase landing" over a single-shot literal-provenance re-attempt, with
  phase B explicitly gated on this foundation plus an adversarial review.
