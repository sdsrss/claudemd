#!/usr/bin/env bash
# memory-tags.sh — MEMORY.md tag parsing + matching, in ONE awk pass.
#
# SINGLE SOURCE for memory-prompt-hint.sh (UserPromptSubmit) and
# memory-read-check.sh (PreToolUse §11 deny). Both hand-rolled the same loop.
#
# Why it was extracted (2026-08-17). The shared loop forked three processes per
# tag (`echo | tr`, `printf | sed`, `echo | grep`), so cost was linear in tag
# count at a measured 5.1 ms/tag: 336 tags = 1.8s on an idle box, 3.5-3.9s
# under session load, against a 3s hooks.json timeout. memory-prompt-hint
# started missing its budget in a live session (the §11 hint stopped appearing);
# memory-read-check sits on the same curve at 1.9s, and its timeout does not
# cost a hint — a hook killed at its timeout emits nothing, so the §11 DENY
# silently fails open at exactly the ship moment it exists to guard, without
# even logging that it did. One awk pass makes the cost independent of tag
# count (same 750-tag fixture: 3.7s -> under 0.05s, tests/hooks/hook-budget.test.sh).
#
# Semantics are a byte-for-byte port of the loop it replaces, not a redesign.
# tests/hooks/memory-tags-parity.test.sh keeps the two in step by running the
# ORIGINAL shell loop as an oracle over a corpus, and carries a control that
# breaks the awk deliberately to prove the comparison can fail.
#
# Two details of the old sed spellings that are load-bearing and easy to lose:
#   * both `.*` prefixes were GREEDY, so the tag block anchors on the RIGHTMOST
#     `.md)` whose remainder still matches the tag shape (sed backtracks). A
#     description mentioning another memory file — `… — see also (other.md)` —
#     reads differently under a leftmost-match rewrite.
#   * tag whitespace was stripped with `tr -d ' '`, which removes SPACES
#     ANYWHERE in the tag, not just around it, and leaves tabs alone.
#
# Interval quantifiers are avoided on purpose: macOS ships BWK awk, which does
# not support `{0,2}`, so the declension tolerance is spelled
# `([a-zA-Z]([a-zA-Z])?)?`. Verified identical output under mawk and busybox awk;
# the macOS CI leg covers BWK.

# bash 3.2 (macOS /bin/bash) cannot parse a heredoc nested inside `$( … )`
# (feedback_bash32_nested_heredoc_cmdsubst), and this program is full of quotes
# and parens. `read -r -d ''` assigns the same text without nesting; it returns
# non-zero at EOF, hence `|| true`.
# shellcheck disable=SC2034  # consumed by memtags_match below and by the hooks
IFS= read -r -d '' MEMTAGS_AWK <<'AWKPROG' || true
# Escape the regex metacharacters the old `sed 's|[][\\.*^$+?{}()|]|\\&|g'`
# escaped — same set, same order-independent effect.
function memtags_esc(s,   out, i, c) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (index("][\\.*^$+?{}()|", c) > 0) out = out "\\" c
    else out = out c
  }
  return out
}
# Rightmost `(<something>.md)` on the line — the greedy `.*` of
# `sed -n 's/.*(\([^)]*\.md\)).*/\1/p'`.
function memtags_file(line,   best, s, rest) {
  best = ""
  rest = line
  while (match(rest, /\([^)]*\.md\)/) > 0) {
    s = substr(rest, RSTART + 1, RLENGTH - 2)
    best = s
    rest = substr(rest, RSTART + RLENGTH)
  }
  return best
}
{
  file = memtags_file($0)
  if (file == "") next

  # Walk `.md)` occurrences RIGHT to LEFT and take the first whose remainder
  # matches a tag block — this is what the greedy `.*` plus sed backtracking
  # did. Collect the occurrence offsets first (awk has no rindex).
  nocc = 0
  scan = $0; base = 0
  while (match(scan, /\.md\)/) > 0) {
    nocc++
    occ[nocc] = base + RSTART + RLENGTH - 1   # index of the char AFTER `.md)`
    base += RSTART + RLENGTH - 1
    scan = substr(scan, RSTART + RLENGTH)
  }
  # TWO passes, not one. Precedence is by FORM, not by position: the shell
  # version ran the whole backtick sed over the entire line and fell back to
  # the plain sed only when the first matched nowhere. A single right-to-left
  # walk trying backtick-then-plain at each offset inverts that whenever a
  # plain block sits to the RIGHT of a backtick one:
  #   - [A](x.md) `[tag1]` and (y.md) [tag2] — desc
  # the oracle yields `y.md tag1` (file = last link, tags = the backtick
  # block); the one-pass form yielded `y.md tag2` — a LOST deny for tag1 and a
  # GAINED deny for tag2. Caught by the pre-tag review: the corpus's
  # "second link in desc" line carries no bracketed token after the second
  # link, so it could not see this.
  #
  # Whitespace is `[ \t\r\v\f]` — the within-line members of the
  # `[[:space:]]` the sed spellings used. Plain `[ \t]` silently untagged an
  # entry separated by a vertical tab or a CR (same review).
  block = ""
  for (k = nocc; k >= 1; k--) {
    rest = substr($0, occ[k] + 1)
    if (match(rest, /^[ \t\r\v\f]*`\[[^]]*\]`/) > 0) {
      block = substr(rest, RSTART, RLENGTH)
      sub(/^[ \t\r\v\f]*`\[/, "", block)
      sub(/\]`$/, "", block)
      break
    }
  }
  if (block == "") {
    for (k = nocc; k >= 1; k--) {
      rest = substr($0, occ[k] + 1)
      # `(—|-)` as an ALTERNATION, never the bracket expression `[—-]` the sed
      # used. An em-dash is three bytes, so on a byte-oriented awk (mawk,
      # busybox) that bracket is the four-element set {0xE2,0x80,0x94,-} and
      # ANY separator whose first byte is 0xE2 — en-dash, arrow, `≥` — was
      # accepted as a tag-block terminator, while a character-oriented awk
      # (gawk, recent macOS awk) reads the same source as a two-element class
      # and rejects them. That is index parsing differing between the ubuntu
      # and macos CI legs from identical source; cross-checking mawk against
      # busybox awk — two byte-oriented engines — structurally cannot see it.
      if (match(rest, /^[ \t\r\v\f]*\[[^]]*\][ \t\r\v\f]*(—|-)/) > 0) {
        block = substr(rest, RSTART, RLENGTH)
        sub(/^[ \t\r\v\f]*\[/, "", block)
        sub(/\][ \t\r\v\f]*(—|-)$/, "", block)
        break
      }
    }
  }
  # Untagged entries are not matched at all — §11 "index is a router, not a
  # substitute" leaves those to the agent rather than fanning out a deny.
  if (block == "") next

  n = split(block, tags, ",")
  hit = ""
  for (i = 1; i <= n; i++) {
    t = tags[i]
    gsub(/ /, "", t)
    if (t == "") continue
    re = "(^|[^a-zA-Z0-9])" memtags_esc(tolower(t)) "([a-zA-Z]([a-zA-Z])?)?([^a-zA-Z0-9]|$)"
    if (HAY ~ re) hit = (hit == "" ? t : hit "," t)
  }
  if (hit != "") print file "\t" hit
}
AWKPROG

# memtags_match INDEX_FILE HAYSTACK
#   Prints one TAB-separated row per matching entry: `<file>\t<tag1,tag2,…>`.
#   Tags are in MEMORY.md authoring order; rows are in file order. Callers that
#   only need the file take field 1.
#   Fail-open: unreadable index or a missing/empty awk program prints nothing,
#   which every caller already treats as "no matches" (§11 gates are fail-open
#   by design — see each hook's header).
memtags_match() {
  local index="$1" hay="$2"
  [[ -r "$index" ]] || return 0
  [[ -n "${MEMTAGS_AWK:-}" ]] || return 0

  # tolower() on the haystack once, in BEGIN, rather than per tag: the old loop
  # got case-insensitivity from `grep -i`.
  #
  # ENVIRON, not `-v HAY_RAW=…`: awk processes backslash escapes in a -v value,
  # so a prompt or command containing `\t` / `\n` / `\\` would reach the matcher
  # as different text than the grep it replaces saw. ENVIRON is passed through
  # verbatim.
  #
  # …but the environment is passed through `execve`, and Linux caps a SINGLE
  # env string at MAX_ARG_STRLEN = 128 KiB. Past that awk is never exec'd,
  # `2>/dev/null` eats "Argument list too long", output is empty, and every
  # caller reads that as "no matches" — a silent fail-open in a BLOCKING gate,
  # with no fail-open row, which is the exact defect this file was written to
  # remove. Measured on the pre-fix code: haystack 131000 -> deny, 131072 ->
  # allow, 300000 -> allow, while the v0.68.1 loop it replaced (grep reading
  # stdin, unbounded) denied at every size. Found by the pre-tag review.
  #
  # Both call sites reach it: memory-prompt-hint passes the raw user prompt (a
  # pasted log or transcript clears 128 KiB routinely) and memory-read-check
  # passes the sanitized command.
  #
  # The bound is in CHARACTERS but the kernel limit is in BYTES, and `${#hay}`
  # counts characters under a UTF-8 locale — so it is set at 30000, below
  # 131072/4, rather than at the true limit. Above it, spill through a file:
  # slower, and irrelevant, because a haystack that large is already rare.
  if (( ${#hay} < 30000 )); then
    MEMTAGS_HAY="$hay" awk 'BEGIN { HAY = tolower(ENVIRON["MEMTAGS_HAY"]) } '"$MEMTAGS_AWK" "$index" 2>/dev/null
    return 0
  fi

  local hayfile
  hayfile=$(mktemp "${TMPDIR:-/tmp}/memtags-hay-XXXXXX") || return 0
  printf '%s' "$hay" > "$hayfile"
  # Rejoining with "\n" can add one trailing newline the original lacked. That
  # cannot change a verdict: every tag regex ends `([^a-zA-Z0-9]|$)`, and a
  # newline is a non-alphanumeric, so the two spellings of "end of haystack"
  # are interchangeable there.
  awk -v MEMTAGS_HAYFILE="$hayfile" '
    BEGIN {
      HAY = ""
      while ((getline _line < MEMTAGS_HAYFILE) > 0) HAY = HAY tolower(_line) "\n"
    } '"$MEMTAGS_AWK" "$index" 2>/dev/null
  rm -f "$hayfile"
}
