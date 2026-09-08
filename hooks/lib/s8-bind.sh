#!/usr/bin/env bash
# s8-bind.sh — "which assignments does bash BIND into the parent shell?"
#
# Sourced by hooks/pre-bash-safety-check.sh. Exists because the §8 rm gate's
# mktemp-provenance recognizer answered that question with
#   grep -oE "(^|[[:space:];&|\`(])VAR=[^[:space:];&|]*"
# over the FLATTENED command, and a grep over text cannot distinguish the three
# states those characters can be in:
#
#   1. a binding assignment  `S=/tmp/x; …`        → the parent shell holds it
#   2. an env PREFIX         `S=/tmp/x cmd …`     → only cmd's environment
#   3. data                  `echo "S=/tmp/x"`    → nothing is assigned at all
#
# Conflating 2 and 3 with 1 cost two real false denies (2026-09-05..08 telemetry,
# 8 of 57 recoverable §8-rm-rf-var denies): `echo "SB=$SB"` after a genuine
# `SB=$(mktemp -d …)` was read as a second, non-mktemp assignment and withdrew
# provenance, and so did the env-prefix reuse `SBX="$SBX" node …`. Neither
# rebinds anything.
#
# `tasks/specs/s8-literal-provenance.md` (status: rejected) names this scan as
# the precondition for re-attempting the literal-provenance class: "Real
# command-position determination for assignments — segment split, wrapper strip,
# command-word check, not a `(^|[[:space:];&|\`(])VAR=` grep over flattened
# text." This file is that determination. It deliberately answers ONLY the
# binding question and classifies no RHS — what counts as a safe value stays in
# the gate, so widening the recognized classes stays a separate, reviewable change.
#
# WHY NOT s8_split_segments: its splitter is `s/[;&|()\`]/\n/g`, which DISCARDS
# the character it split on. `( S=/tmp/x )` and `S=/tmp/x` come out identical, so
# a subshell assignment that never touches the parent shell looks like a binding
# one. That is break #2 of the 2026-07-25 reverted attempt. This scanner keeps
# the separator, which is the whole point.
#
# DIRECTION OF ERROR (by construction): every ambiguity resolves to "does not
# bind", which makes the gate deny — the status quo. The scanner can only ever
# widen an allow by being certain, never by being unsure. Specifically these all
# report nothing and therefore keep denying: `{ …; }` groups, `then`/`do`/`else`
# bodies, leading redirections, `VAR+=` appends, and anything at paren depth > 0.
#
# NOT A SECURITY BOUNDARY. §8 is a guardrail; `DISABLE_*` and `[allow-rm-rf-var]`
# remain bypassable by design. An indirect-name rebind (`unset "$T"`) still spells
# no name this scanner can see — that residual is unchanged and is covered, as
# before, by the caller's bare-mention count.

# The scanner walks the command one character at a time, tracking quote state,
# paren depth and backtick state, and cuts it into segments at the separators
# bash executes on. A segment BINDS when the separator that opened it was `;`, a
# newline, or the start of the command — never `&&`/`||` (the segment may not run
# at all: `false && S=/tmp/x`), never `|`/`&` (it runs in a subshell whose
# assignments die with it). Within a binding segment the leading run of
# `NAME=VALUE` tokens is emitted only if NOTHING follows it but redirections —
# one non-assignment word and the whole run is an env prefix instead.
IFS= read -r -d '' S8_BIND_AWK <<'AWKPROG' || true
# Accumulate the whole command; embedded newlines are separators and must survive.
{ buf = buf $0 "\n" }

function flush_tok() {
  if (tok != "") { seg[segn++] = tok; tok = "" }
}

# A segment just ended. Emit its assignments when it (a) began at a binding
# separator, (b) was not itself carried off into a subshell by the separator that
# ENDED it, and (c) consists of assignment tokens and redirections only.
#
# (b) is its own condition because the opening separator does not settle the
# question: `S=/tmp/x & rm -rf "$S"` and `S=/tmp/x | cat` both open at the start
# of the command, and both hand the assignment to a subshell that takes it away
# again — the parent's $S keeps whatever it already had, which is the empty value
# this gate exists to keep out of an rm target.
function end_seg(next_binds, self_binds,   i, nassign, nother, t, eq) {
  flush_tok()
  if (binds && self_binds && segn > 0) {
    nassign = 0; nother = 0
    for (i = 0; i < segn; i++) {
      t = seg[i]
      # A redirection may trail the run (`S=$(mktemp -d) 2>/dev/null`) without
      # making it a prefix — bash still binds S.
      if (t ~ /^[0-9]*[<>]/) continue
      if (t ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=/) { if (nother == 0) nassign++ }
      else nother++
    }
    if (nassign > 0 && nother == 0) {
      for (i = 0; i < segn; i++) {
        t = seg[i]
        if (t ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=/) {
          # `VAR+=x` appends to whatever VAR already held, which is outside this
          # command's text. The `+` is kept in the VALUE so no RHS classifier can
          # read it as a plain assignment of a value it can see.
          eq = index(t, "=")
          if (substr(t, eq - 1, 1) == "+") print substr(t, 1, eq - 2) "\t" substr(t, eq - 1)
          else print substr(t, 1, eq - 1) "\t" substr(t, eq + 1)
        }
      }
    }
  }
  segn = 0
  binds = next_binds
}

END {
  s = buf
  # Drop the trailing newline this accumulation added, so a command with no final
  # newline is not handed a phantom empty segment.
  if (substr(s, length(s), 1) == "\n") s = substr(s, 1, length(s) - 1)
  n = length(s)
  q = ""; depth = 0; bt = 0
  binds = 1; segn = 0; tok = ""
  i = 1
  while (i <= n) {
    c = substr(s, i, 1)
    if (q != "") {
      # Inside quotes nothing separates and nothing nests. A backslash escapes
      # only within double quotes; inside single quotes it is a literal.
      if (q == "\"" && c == "\\" && i < n) { tok = tok c substr(s, i + 1, 1); i += 2; continue }
      if (c == q) q = ""
      tok = tok c; i++; continue
    }
    if (c == "\\" && i < n) { tok = tok c substr(s, i + 1, 1); i += 2; continue }
    if (c == "'" || c == "\"") { q = c; tok = tok c; i++; continue }
    if (c == "`") { bt = 1 - bt; tok = tok c; i++; continue }
    # `(` covers both a subshell and the `$(` of a command substitution. Both
    # must suppress separator handling until they close: the assignments inside
    # a subshell do not reach the parent, and the `;` inside `$(a; b)` is not a
    # separator of the OUTER command.
    if (bt == 0 && c == "(") { depth++; tok = tok c; i++; continue }
    if (bt == 0 && c == ")" && depth > 0) { depth--; tok = tok c; i++; continue }
    if (depth == 0 && bt == 0) {
      if (c == " " || c == "\t") { flush_tok(); i++; continue }
      two = substr(s, i, 2)
      # Two independent verdicts per separator: does the segment it CLOSES keep
      # its bindings, and does the segment it OPENS get to bind at all?
      # `&&` / `||`: what came before ran here and binds; what comes after is
      # conditional and may never run (`false && S=/tmp/x`).
      if (two == "&&" || two == "||") { end_seg(0, 1); i += 2; continue }
      # `;` and newline: both sides run in THIS shell.
      if (c == ";" || c == "\n") { end_seg(1, 1); i++; continue }
      # `|` and `&`: the segment on each side is a pipeline stage or a background
      # job — a subshell either way, so neither side's assignments reach here.
      # Except the `&` of a redirection (`2>&1`, `<&-`), which is part of the
      # operator and separates nothing; s8_split_segments learned the same thing
      # as F28, and missing it here would withdraw provenance from every command
      # that merges its streams.
      if (c == "&" && (substr(s, i - 1, 1) == ">" || substr(s, i - 1, 1) == "<") \
          && substr(s, i + 1, 1) ~ /^[0-9-]$/) { tok = tok c; i++; continue }
      if (c == "|" || c == "&") { end_seg(0, 0); i++; continue }
    }
    # `{` `}` `)` at depth 0 are left as ordinary characters on purpose: `${VAR}`
    # and `case x in y)` spell them, and treating them as separators cut tokens
    # in half and manufactured assignments out of the halves. A `{ …; }` group
    # therefore keeps its brace as the segment's first token, which is not an
    # assignment, so the group emits nothing — conservative, and correct here.
    tok = tok c; i++
  }
  end_seg(1, 1)
}
AWKPROG

# s8_bind_assignments CMD → one `NAME<TAB>VALUE` line per assignment that binds
# the parent shell, in source order. Silent when there are none.
#
# Fail-safe: an awk that could not be read (empty program) prints nothing, which
# the caller reads as "no provenance" and therefore denies — the same verdict as
# before this file existed.
s8_bind_assignments() {
  [[ -n "${S8_BIND_AWK:-}" ]] || return 0
  printf '%s' "$1" | awk "$S8_BIND_AWK"
}
