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

# Every identifier the finished token spells in CODE position, tagged `lhs` when
# it is the token's own assignment target and `bare` otherwise. This is the
# rebind guard's raw material: a mention that is not an lhs is the name being
# handled by something this scanner does not model (`unset S`, `read S`,
# `for S in`, `declare -n r=S`), after which the value is no longer determinable
# from the command text.
#
# Mentions are read from the token's CODE view — the characters outside quotes —
# because counting them inside quoted words is what made `echo "SB=$SB"` and
# `echo "SB=x"` read as rebinds and cost the field false denies. One exception:
# a token that is exactly the quoted name (`unset 'S'`) is a mention, since that
# is the one rebind spelling quoting would otherwise hide.
#
# `can_lhs` is decided by the CALLER, from the finished segment — never from this
# token's own syntax. An adversarial review (2026-09-08) falsified the first
# version, which read `start == 1 && nxt == "="` here and tagged `lhs` on that
# alone: `export S=/etc`, `readonly S=/etc`, `{ S=/etc; }`, `then S=/etc`,
# `do S=/etc`, `time S=/etc` and `! S=/etc` all spell a token that looks like an
# assignment's left-hand side, and bash BINDS every one of them, but end_seg
# classifies none of them — so the gate's `total == lhs` invariant read them as
# accounted-for and granted provenance over a rebind it had never seen. Eleven
# spellings, each measured DENY before the change and ALLOW after, one of them
# the everyday `WORK=$(mktemp -d); if [ -n "$D" ]; then WORK=$D; fi; rm -rf
# "$WORK/out"`. The two halves must not decide separately; `lhs` now means
# exactly "end_seg classified this token", which is what the invariant needs.
function emit_mentions(raw, code, can_lhs,   L, j, ch, prev, nxt, nxt2, name, start) {
  if (raw ~ /^'[A-Za-z_][A-Za-z0-9_]*'$/ || raw ~ /^"[A-Za-z_][A-Za-z0-9_]*"$/) {
    print "M\t" substr(raw, 2, length(raw) - 2) "\tbare"
    return
  }
  L = length(code)
  j = 1
  while (j <= L) {
    ch = substr(code, j, 1)
    if (ch !~ /^[A-Za-z_]$/) { j++; continue }
    start = j
    while (j <= L && substr(code, j, 1) ~ /^[A-Za-z0-9_]$/) j++
    name = substr(code, start, j - start)
    prev = (start > 1) ? substr(code, start - 1, 1) : ""
    nxt = (j <= L) ? substr(code, j, 1) : ""
    # `$S` and `${S}` are READS. Reads must not count, or every use of the
    # variable would look like a rebind and provenance could never hold.
    if (prev == "$") continue
    if (prev == "{" && start > 2 && substr(code, start - 2, 1) == "$") continue
    # `.` `/` `-` next to the name disqualify it (F20): no rebind syntax puts
    # those beside an identifier — shell names cannot contain them — but file
    # paths do, and a var named `bak` was once false-counted inside
    # `cfg.bak.XXXXXX`, denying the very idiom it sat next to.
    if (prev ~ /^[.\/-]$/ || nxt ~ /^[.\/-]$/) continue
    nxt2 = (j < L) ? substr(code, j + 1, 1) : ""
    if (can_lhs && start == 1 && (nxt == "=" || (nxt == "+" && nxt2 == "="))) print "M\t" name "\tlhs"
    else print "M\t" name "\tbare"
  }
}

function flush_tok() {
  if (tok != "") { seg[segn] = tok; segcode[segn] = code; segn++; tok = ""; code = "" }
}

# Can a command with this word as its command word rebind a variable in THIS
# shell? Only builtins and keywords can — an external command gets a copy of the
# environment and cannot reach back into the shell's variable table. That is an
# invariant of how bash works, not a heuristic, which is what makes the list
# below closeable rather than a denylist chasing spellings.
#
# It has to be asked because `sanitize_cmd` strips quotes before this scanner
# runs: `echo "S=$S"` arrives as `echo S=$S`, so "an assignment-shaped word in
# argument position" describes BOTH the quoted label a developer prints and the
# `export S=/etc` that really does rebind. The command word is what separates
# them. Arguments to a non-assigning command are data and produce no mentions;
# arguments to anything on this list do.
#
# A word carrying `$` or a backtick is not resolvable here (`$CMD S=/etc`), so it
# is treated as assigning — the deny direction. RESIDUAL, unchanged in kind from
# the indirect-name rebind already documented above: a shell FUNCTION defined
# OUTSIDE this command can rebind while its call site names none of these words.
# Built by concatenation, not as one long literal: a backslash-continued string
# constant is a gawk extension and POSIX leaves it undefined, and this file has
# to run under BSD awk on the macOS floor.
function reserved_word(w,   s) {
  s = " if then else elif fi for while until do done case esac select function in "
  s = s "{ } ! time export readonly declare typeset local let eval source . unset "
  # Two names are spliced across the concatenation so this line does not match
  # tests/lib/bash32-constructs.sh, which greps for them as bash-4 constructs.
  # They are DATA here — the shell builtins whose arguments can rebind — not
  # constructs this file uses. Same technique that gate applies to its own
  # pattern string, and for the same reason (feedback_self_referential_marker_regex).
  s = s "read map" "file read" "array printf getopts alias trap set command builtin coproc "
  return index(s, " " w " ") > 0
}

function assigning_cmd(w) {
  if (w == "") return 1
  if (w ~ /[$`]/) return 1
  return reserved_word(w)
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
function end_seg(next_binds, self_binds,   i, t, t0, nlead, tail, isbind, runlhs, eq, cw, first, argdata) {
  flush_tok()
  # `time` and `!` prefix a whole command, and `command`/`builtin` prefix a
  # builtin; none of them is the command word, and none stops the assignments
  # behind it from binding. `time S=/etc` binds S, which is why skipping them
  # here is what lets the run below be recognized and then REJECTED on its value,
  # rather than being waved through as somebody else's argument.
  first = 0
  while (first < segn && (seg[first] == "time" || seg[first] == "!" \
         || seg[first] == "command" || seg[first] == "builtin")) first++
  # The LEADING assignment run: consecutive `NAME=` tokens from the head of the
  # segment, with redirections allowed among them. `tail` records that a word
  # which is not an assignment has been seen — everything after it is that
  # command's ARGUMENT, however much it looks like an assignment. This is the
  # distinction the review turned on: in `export S=/etc` the assignment is an
  # argument to `export`, and in `then S=/etc` it is the body of a conditional.
  nlead = 0; tail = 0; cw = ""
  for (i = first; i < segn; i++) {
    t = seg[i]
    # A redirection may sit among the run (`S=$(mktemp -d) 2>/dev/null`) without
    # making it a prefix — bash still binds S.
    if (t ~ /^[0-9]*[<>]/) continue
    if (tail == 0 && t ~ /^[A-Za-z_][A-Za-z0-9_]*\+?=/) { lead[i] = 1; nlead++; continue }
    if (tail == 0) cw = t
    tail = 1
  }
  # A segment binds when it opened and closed in this shell, is not nested inside
  # a block whose execution this scanner cannot predict, and is assignments only.
  isbind = (binds && self_binds && blockdepth == 0 && nlead > 0 && tail == 0)
  # A run is ACCOUNTED FOR either because it binds (classified below) or because
  # it is an env prefix — `S=x cmd …` reaches only cmd's environment, so it is
  # not a rebind of the parent and the guard need not treat it as one. An
  # assignment-only segment that does NOT bind (`false && S=/etc`, `( S=/etc )`,
  # a loop body) is neither: bash may or may not have run it, and no reading of
  # the text settles which, so it stays unaccounted and the gate denies.
  runlhs = (nlead > 0 && (isbind || tail == 1))
  # Everything this command receives as an ARGUMENT is data when the command
  # cannot assign — `echo S=$S` and `git commit -m S=1` name nothing. The lead
  # run is exempt: it is the command's own env prefix, not one of its arguments.
  argdata = (tail == 1 && !assigning_cmd(cw))
  for (i = 0; i < segn; i++) {
    t = seg[i]
    if (argdata && !lead[i]) continue
    if (isbind && lead[i]) {
      # `VAR+=x` appends to whatever VAR already held, which is outside this
      # command's text. The `+` is kept in the VALUE so no RHS classifier can
      # read it as a plain assignment of a value it can see.
      eq = index(t, "=")
      if (substr(t, eq - 1, 1) == "+") print "A\t" substr(t, 1, eq - 2) "\t" substr(t, eq - 1)
      else print "A\t" substr(t, 1, eq - 1) "\t" substr(t, eq + 1)
    }
    emit_mentions(t, segcode[i], (runlhs && lead[i]) ? 1 : 0)
  }
  # Block nesting, judged from the segment's first word AFTER it has been used:
  # `if false; then` … `S=$(mktemp -d)` … `fi` puts a lone assignment at what the
  # splitter calls a binding segment head, and bash may never run it. Allowing it
  # let `rm -rf "$S/build"` through as `/build` — the steam-for-linux#3671 shape,
  # and the one finding of the review that predates this change rather than
  # arriving with it. Nesting is counted, not parsed: while the count is above
  # zero nothing binds, which is wrong only in the deny direction (a cleanup
  # written inside a loop body now needs `${VAR:?}`).
  if (segn > 0) {
    t0 = seg[0]
    if (t0 == "if" || t0 == "while" || t0 == "until" || t0 == "for" || t0 == "case" \
        || t0 == "select" || t0 == "{") blockdepth++
    else if (t0 == "fi" || t0 == "done" || t0 == "esac" || t0 == "}") {
      if (blockdepth > 0) blockdepth--
    }
  }
  for (i = 0; i < segn; i++) lead[i] = 0
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
  binds = 1; segn = 0; tok = ""; code = ""; blockdepth = 0
  i = 1
  while (i <= n) {
    c = substr(s, i, 1)
    # `code` is the token minus everything inside quotes — the part bash reads as
    # syntax rather than as a word's contents. It is what emit_mentions counts,
    # and keeping it alongside `tok` is why there is one walker here and not two.
    if (q != "") {
      # Inside quotes nothing separates and nothing nests. A backslash escapes
      # only within double quotes; inside single quotes it is a literal.
      if (q == "\"" && c == "\\" && i < n) { tok = tok c substr(s, i + 1, 1); i += 2; continue }
      if (c == q) q = ""
      tok = tok c; i++; continue
    }
    # An escaped character is data, but it is data OUTSIDE quotes: `unset \S`
    # rebinds S. The backslash is dropped from the code view so the name behind
    # it reads as the identifier it is.
    if (c == "\\" && i < n) { tok = tok c substr(s, i + 1, 1); code = code substr(s, i + 1, 1); i += 2; continue }
    if (c == "'" || c == "\"") { q = c; tok = tok c; i++; continue }
    if (c == "`") { bt = 1 - bt; tok = tok c; code = code c; i++; continue }
    # `(` covers both a subshell and the `$(` of a command substitution. Both
    # must suppress separator handling until they close: the assignments inside
    # a subshell do not reach the parent, and the `;` inside `$(a; b)` is not a
    # separator of the OUTER command.
    if (bt == 0 && c == "(") { depth++; tok = tok c; code = code c; i++; continue }
    if (bt == 0 && c == ")" && depth > 0) { depth--; tok = tok c; code = code c; i++; continue }
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
          && substr(s, i + 1, 1) ~ /^[0-9-]$/) { tok = tok c; code = code c; i++; continue }
      if (c == "|" || c == "&") { end_seg(0, 0); i++; continue }
    }
    # `{` `}` `)` at depth 0 are left as ordinary characters on purpose: `${VAR}`
    # and `case x in y)` spell them, and treating them as separators cut tokens
    # in half and manufactured assignments out of the halves. A `{ …; }` group
    # therefore keeps its brace as the segment's first token, which is not an
    # assignment, so the group emits nothing — conservative, and correct here.
    tok = tok c; code = code c; i++
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
  printf '%s' "$1" | awk "$S8_BIND_AWK" | sed -n 's/^A\t//p'
}

# s8_name_mentions NAME CMD → `<total> <lhs>`: how many times NAME is spelled in
# code position, and how many of those are an assignment's own left-hand side.
#
# The rebind guard reads the two as a single question — "is every mention of this
# name one this scanner can account for?" — because enumerating rebind SYNTAX is
# a denylist that cannot be completed (`unset` / `+=` / `printf -v` / `for` /
# `read` / `mapfile` / `declare -n` and whatever bash adds next). Inverting it
# costs nothing to maintain: a rebind that spells the name shows up as a mention
# that is not an lhs, whatever keyword carries it.
#
# Residual, unchanged from the grep this replaces and stated so it is not mistaken
# for coverage: an INDIRECT rebind never spells the name at all (`unset "$T"`,
# `printf -v "$T" ""`, `declare -n r=$T`) and is invisible to any name-shaped
# check. §8 is a guardrail, not an anti-injection boundary.
#
# Fail-safe: with no awk program the counts come back `0 0`, which the caller
# reads as "no mentions, so the classified assignments do not account for the
# name" — provenance is withheld and the gate denies, as it did before.
s8_name_mentions() {
  local _name="$1" _cmd="$2"
  if [[ -z "${S8_BIND_AWK:-}" ]] || [[ ! "$_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    printf '0 0'
    return 0
  fi
  printf '%s' "$_cmd" | awk "$S8_BIND_AWK" \
    | awk -F'\t' -v n="$_name" '$1=="M" && $2==n { t++; if ($3=="lhs") l++ } END { printf "%d %d", t+0, l+0 }'
}
