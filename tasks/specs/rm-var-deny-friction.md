---
status: implemented
revision: 3
---

# §8-rm-rf-var deny friction

## goal

Cut the retry cost of the §8 `rm $VAR` gate without widening what it lets through
beyond the mktemp provenance class it already certifies.

Measured 2026-09-25 over 20 days (`~/.claude/logs/claudemd.jsonl`, 741 transcripts):
620 `§8-rm-rf-var` denies = 89% of all hook denies. ~93% of the denied commands bind
the flagged var in the same command (scratchpad literal, mktemp, derived from a bound
var, loop var). 93.5% are fixed in one retry, so the cost is one wasted round-trip plus
a rejected command (median 760 chars) and a 2.2KB deny message, most of which is about
NPX and curl.

Two changes ship (a third was built and reverted — see r3 in the change log):

1. **Deny message (2c)**: when every hit is `§8-rm-rf-var`, the message carries only the
   rm material. Its first bullet sends a line that names its own fix (`..`, bare
   `$HOME`/`$TMPDIR`, unbounded find) to that fix; its guard advice names the var that
   can be EMPTY (`rm -rf "${SP:?}/x"`), and says a derived target needs both guards.
   Mixed-section denies keep the full message.
2. **Spec text (2b)**: core §8's rm bullet names the `-r`/`-f` and `find -delete`
   coverage, and which var the guard goes on.

Reverted: per-target mktemp provenance (2a), which let `rm -rf "$D" "$H"` (both mktemp)
allow. `rm -rf "${D:?}" "${H:?}"` passes without it.

Produces:

- Produces: `_s8_rm_only` — selects the rm-only deny message when every hit is `§8-rm-rf-var`.
- Produces: `MSG_SPELLINGS` — test block asserting every spelling the message offers passes the gate.

## non-goals

- Literal-assignment provenance (`SP=/tmp/x; rm -rf "$SP/y"`). Rejected twice
  (v0.48.0; 2026-07-25, `tasks/audit-2026-07-25-deferred.md`); text position is not
  command position. Not re-attempted.
- Rewriting commands via `updatedInput`. The same text/command confusion would corrupt
  heredocs and commit messages (12 of the denies were rm text inside data).
- Narrowing `rm -f` coverage.
- Any change to an allow/deny verdict (after r3).

## constraints

- §8 is immutable in intent; every change is deny-direction or inside an already-certified
  class.
- Real-command replay (`feedback_replay_real_commands_not_corpus`): all unique Bash
  commands from `~/.claude/projects/*/*.jsonl` that contain `rm`/`find`, driven through
  the HEAD hook and the changed hook. **allow→deny must be 0**; every deny→allow flip is
  listed and inspected by hand.
- Corpus rows for the new pass shape AND its negative controls (non-mktemp neighbour,
  unassigned neighbour, reassigned neighbour, both vars in one token).
- Core spec stays under the 25000-byte cap.

## success-criteria

- Replay of real commands: 0 verdict flips in either direction against HEAD.
- An rm-only deny contains no NPX/curl text; an rm+npx deny prints HEAD's full message.
- Every spelling the message offers as a fix passes the gate (`MSG_SPELLINGS`), and
  the runtime claim (a derived var's `:?` never fires, the base's does) is pinned by
  running `echo` with the base unset.
- `npm run check` exit 0.

## open-questions

- None blocking. Plugin version for these changes is decided at ship (0.93.0 is tagged).

# Change log

- r1 2026-09-25: initial, from the 20-day deny analysis; user approved "按你的建议执行".
- r2 2026-09-25: implemented; `- Produces:` lines added for the status gate.
- r3 2026-09-25: goal item 2 (per-target mktemp provenance) REVERTED after two review
  rounds: each accepted neighbour var inherited residual holes of other arms, for 10 of
  6138 replayed commands that `"${D:?}" "${H:?}"` already passes. Guard advice corrected
  (review r2 H1): the guard goes on the var that can be EMPTY (the base), not on a derived
  or loop var, which is never empty. Final replay: 0 verdict flips either direction.
