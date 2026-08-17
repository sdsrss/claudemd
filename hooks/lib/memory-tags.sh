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
  block = ""
  for (k = nocc; k >= 1; k--) {
    rest = substr($0, occ[k] + 1)
    # Backtick form first (precise), then plain form terminated by an em-dash
    # or hyphen — same precedence as the shell version.
    if (match(rest, /^[ \t]*`\[[^]]*\]`/) > 0) {
      block = substr(rest, RSTART, RLENGTH)
      sub(/^[ \t]*`\[/, "", block)
      sub(/\]`$/, "", block)
      break
    }
    if (match(rest, /^[ \t]*\[[^]]*\][ \t]*[—-]/) > 0) {
      block = substr(rest, RSTART, RLENGTH)
      sub(/^[ \t]*\[/, "", block)
      sub(/\][ \t]*[—-]$/, "", block)
      break
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
  MEMTAGS_HAY="$hay" awk 'BEGIN { HAY = tolower(ENVIRON["MEMTAGS_HAY"]) } '"$MEMTAGS_AWK" "$index" 2>/dev/null
}
