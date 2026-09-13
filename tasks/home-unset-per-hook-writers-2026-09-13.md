# Per-hook `$HOME` writers are unguarded when HOME is empty

Opened 2026-09-13 during the 0.88.0 pre-tag review. Deferred deliberately; this
file is what `hooks/lib/hook-common.sh`'s bind comment points at.

## What

`hook-common.sh` binds `: "${HOME:=}"` so an unset HOME is empty rather than a
`set -u` fatal. The shared writers — `rule_hits_append` in `rule-hits.sh`, plus
`hook_record_failopen`, `hook_install_sentinel_write`, `hook_install_sentinel_clear`
and `hook_record_plugin_root` in `hook-common.sh` — each carry
`[[ -n "$HOME" ]] || return 0`. Find them with:

```sh
grep -n '\[\[ -n "\$HOME" \]\]' hooks/lib/*.sh
```

The per-hook writers do not. With an empty HOME they aim at `/.claude/…`.

## The set has three sizes, and that is the point

Three rounds of this release's pre-tag review each caught a different wrong
number in the comment that points here. They were wrong in different ways
because "the set" answers three different questions. Do not copy a number out of
this file either — run the derivation for the question you are actually asking.

**(1) Hooks that merely READ a `$HOME` path — 13.** Includes `banned-vocab-check`,
`memory-prompt-hint` and `memory-read-check`, which root transcript paths at
`$HOME` but create nothing. Harmless: a read of a path that does not exist.

```sh
for f in hooks/*.sh; do
  s=$(sed -E 's/^[[:space:]]*#.*$//' "$f")
  printf '%s' "$s" | grep -qE '\$\{?HOME\b' || continue
  printf '%s' "$s" | grep -qE '\[\[ -n "\$HOME" \]\]' && continue
  basename "$f" .sh
done
```

**(2) Hooks whose SOURCE contains an unguarded create/remove — 10.** The static
candidate set. A regex is fragile here: the first attempt anchored variable
assignments at `^` and so missed `transcript-vocab-scan`, whose
`VS_STATE_DIR="$HOME/…"` is indented inside a function — which is why the
assignment match below is unanchored. Prefer (3).

```sh
for f in hooks/*.sh; do
  s=$(sed -E 's/^[[:space:]]*#.*$//' "$f")
  printf '%s' "$s" | grep -qE '\[\[ -n "\$HOME" \]\]' && continue   # already guarded
  printf '%s' "$s" | grep -qE '(mkdir -p|rm -f|touch|>>?)[^|]*\$\{?HOME\b' \
    && { basename "$f" .sh; continue; }                             # direct
  printf '%s' "$s" | grep -oE '[A-Za-z_]+=("?)\$\{?HOME\b' | sed 's/=.*//' | sort -u \
    | while read -r v; do                                           # via a bound name
        printf '%s' "$s" | grep -qE "(mkdir -p|rm -f|touch|>>?)[[:space:]]*\"?\\\$\{?$v\b" \
          && { basename "$f" .sh; break; }
      done
done | sort -u
```

**(3) Hooks that actually REACH a create/remove on a representative event — 7.**
Ground truth, and the only one that needs no pattern guessing. Measured on
`4d505b4`: `mem-audit`, `residue-audit`, `sandbox-disposal-check`,
`session-end-check`, `session-start-check`, `session-summary`,
`transcript-vocab-scan`. `session-extended-read`, `ship-baseline-check` and
`version-sync` carry the code but exit earlier on the events probed — they need
their own trigger conditions (the exact extended-spec path, a red-CI deny, a
manifest version mismatch), so (3) is a floor, not a ceiling.

```sh
# per hook, with an event shaped for its own hook_event_name:
printf '%s' "$EVENT" | env -u HOME bash -x hooks/<name>.sh 2>&1 >/dev/null \
  | grep -E '^\+ (mkdir -p|rm -f|touch) [^ ]*/\.claude'
```

## Why it was not fixed in 0.88.0

A **widening of an existing hole, not a new one**. At `9dc08d2`, before the bind
existed, an empty-but-SET `HOME` already reached the same `mkdir -p /.claude/…`
in these hooks — verified with `env HOME= bash -x`. The bind extends the trigger
from empty-HOME to unset-HOME.

Blast radius is bounded to **uid 0 with no HOME**: for every non-root user the
`mkdir` fails and each hook's existing swallow (`|| exit 0`, `|| true`, or a
brace group ending in `exit 0` — the spelling varies) absorbs it. Measured on
`4d505b4`: on a NON-TRIGGERING event, all fifteen hooks run under `env -u HOME`
exit 0, print nothing, and create no `/.claude`. The qualifier is load-bearing —
a triggering one is supposed to speak: `rm -rf $EVIL` through
`pre-bash-safety-check` with `HOME` unset prints its deny, which is the whole
point of the release.

0.88.0 is a release about the deny path surviving a missing HOME. Guarding the
per-hook writers is a change about a different subject, and folding it in
silently is what the pre-tag review exists to catch.

## What closing it looks like

Not a blanket early `exit 0` — several of these hooks do work that does not need
`$HOME`, so exiting would change behaviour rather than degrade it. Each writer
needs its own guard at the point of use, the shape the shared writers took.

Untestable on a normal runner, and that is the honest reason it is easy to get
wrong: the difference only appears under uid 0, and there is no portable way to
give a suite a writable `/`. The same limitation is already recorded on the
`rule_hits_append` guard.

## Trigger to reopen

Any report of files appearing at `/.claude` on a machine, or a decision to run
the hooks under a root agent.
