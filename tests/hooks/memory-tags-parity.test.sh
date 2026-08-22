#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# memory-tags-parity.test.sh — hooks/lib/memory-tags.sh must produce EXACTLY
# what the per-tag shell loop it replaced produced, and no hook may keep a
# private copy of that loop.
#
# The extraction (2026-08-17) was a performance fix: three forks per tag, 5.1
# ms/tag, 1.9s at this maintainer's 336 tags against a 3s hooks.json timeout,
# with the §11 DENY in memory-read-check.sh on the same curve. Performance work
# that quietly changes matching semantics would swap a visible timeout for an
# invisible behavior change — a gate that stops denying is indistinguishable
# from a gate that has nothing to deny.
#
# So the OLD loop is kept here verbatim as an oracle and both are run over a
# corpus. Three properties, in the order they can fail:
#   1. parity   — awk output == oracle output, byte for byte
#   2. control  — a deliberately broken awk MUST diverge on the same corpus.
#                 Without it a comparison harness that always agrees (or always
#                 returns empty) reads as a clean pass. This suite's own first
#                 draft had a sed that silently failed to inject the break, and
#                 reported parity against an unmodified copy of itself
#                 (feedback_probe_harness_controls_first).
#   3. consumers — derived from source, not named: any hook that resolves a
#                  MEMORY.md index must call memtags_match, and none may carry
#                  the private declension regex again
#                  (feedback_extraction_needs_consumer_gate).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
HOOKS_DIR="$REPO/hooks"
LIB="$HOOKS_DIR/lib/memory-tags.sh"

FAIL=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

SANDBOX=$(mktemp -d -t claudemd-memtags-XXXXXX) || { echo "FAIL: mktemp"; exit 1; }
trap 'rm -rf "$SANDBOX"' EXIT

# ------------------------------------------------------------------ corpus ---
# Every line here is a shape the old sed spellings treated in a specific way.
# `—` em-dash and `-` hyphen separators both appear because the plain-form
# regex accepts either.
INDEX="$SANDBOX/MEMORY.md"
cat > "$INDEX" <<'EOF'
- [Ship lessons](feedback_ship.md) `[ship, release, push]` — atomic ship convention
- [Plain form](feedback_plain.md) [macos, bsd-wc, timeout] — plain tag block, em-dash
- [Plain hyphen](feedback_hyphen.md) [hyphen-sep, second-tag] - plain tag block, ascii hyphen
- [Untagged legacy](project_old.md) — no tag block at all, agent decides
- [Decorative desc](feedback_decor.md) `[realtag]` — desc mentions `[decortag]` inline
- [Second link in desc](feedback_first.md) `[firsttag]` — see also (feedback_other.md) for context
- [Two links two blocks](feedback_two.md) `[realtag2]` — see also (feedback_decoy.md) `[decoytag2]` here
- [Backtick then plain](feedback_mixed.md) `[btag]` and (feedback_mixed2.md) [ptag] — form beats position
- [Endash sep](feedback_endash.md) [endashtag] – not an em-dash, must not tag
- [Regex meta](feedback_meta.md) `[v6.9, printf-%b, c++build]` — metachars must be literal
- [Leading dash](feedback_dash.md) `[--file, -h]` — tags that look like grep flags
- [CJK tags](feedback_cjk.md) `[全面审核, 发版, 门存在但没盖住]` — chinese tags
- [Internal space](feedback_space.md) `[two words, normal]` — tr -d ' ' removes inner spaces
- [Declension](feedback_decl.md) `[audit, ship]` — 0-2 trailing letters tolerated
- [Empty tag](feedback_empty.md) `[, alpha, ]` — empty members are skipped
- [Upper case](feedback_case.md) `[MixedCase, UPPER]` — matching is case-insensitive
- [Dotted file](feedback_v2.name.md) `[dotted]` — file token contains extra dots
EOF
# A vertical tab cannot be written in a quoted heredoc; append it with printf.
# `[[:space:]]` (what the sed used) covers \v and \r within a line, `[ \t]`
# does not — the narrowed class silently untagged these entries.
printf -- '- [Vtab separated](feedback_vtab.md)\v`[vtabtag]` — vertical tab before the block\n' >> "$INDEX"
printf -- '- [CR before dash](feedback_cr.md) [crtag]\r— carriage return before the separator\n' >> "$INDEX"

# Haystacks: prompts / sanitized commands. The last one matches nothing.
HAYSTACKS=(
  "ship the release to main"
  "fix the macos timeout in CI"
  "hyphen-sep applies here"
  "realtag matters"
  "decortag should not match"
  "firsttag only"
  "v6.9 and printf-%b and c++build"
  "pass --file and -h to the cli"
  "全面审核 发版 门存在但没盖住"
  "twowords and normal"
  "audits and ships plural"
  "alpha member"
  "mixedcase and upper"
  "dotted entry"
  "git push origin main"
  "nothing here matches any tag at all"
  "TAB	separated	prompt with literal backslash \\t and \\n"
  # Rightmost-`.md)` anchoring and FORM-over-POSITION precedence — the two
  # semantics the header calls load-bearing. Without these the corpus could not
  # tell a leftmost walk, or a one-pass backtick-then-plain walk, from the
  # oracle: the pre-tag review mutated both and the suite stayed green.
  "realtag2 mentioned"
  "decoytag2 mentioned"
  "btag mentioned"
  "ptag mentioned"
  # Within-line whitespace beyond space/tab, and a separator that is NOT the
  # em-dash but shares its first byte (en-dash). A byte-oriented awk reading
  # `[—-]` as a four-element byte set accepted it; a character-oriented one
  # did not, so the two CI legs parsed the index differently.
  "vtabtag mentioned"
  "crtag mentioned"
  "endashtag mentioned"
)

# ------------------------------------------------------------------ oracle ---
# The pre-extraction loop, verbatim from memory-prompt-hint.sh (which collected
# every matching tag; memory-read-check.sh's copy differed only in stopping at
# the first one, a strict subset of this output).
oracle_match() {
  local index="$1" hay="$2" line FILE TAG_BLOCK t ESC_TAG MATCHED_TAGS
  local -a TAGS
  while IFS= read -r line; do
    FILE=$(echo "$line" | sed -n 's/.*(\([^)]*\.md\)).*/\1/p')
    [[ -z "$FILE" ]] && continue
    TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*`\[\([^]]*\)\]`.*/\1/p')
    if [[ -z "$TAG_BLOCK" ]]; then
      TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*\[\([^]]*\)\][[:space:]]*[—-].*/\1/p')
    fi
    [[ -z "$TAG_BLOCK" ]] && continue
    IFS=',' read -ra TAGS <<<"$TAG_BLOCK"
    MATCHED_TAGS=""
    for t in "${TAGS[@]}"; do
      t=$(echo "$t" | tr -d ' ')
      [[ -z "$t" ]] && continue
      ESC_TAG=$(printf '%s' "$t" | sed 's|[][\\.*^$+?{}()|]|\\&|g')
      if echo "$hay" | grep -qiE -- "(^|[^a-zA-Z0-9])${ESC_TAG}[a-zA-Z]{0,2}([^a-zA-Z0-9]|$)"; then
        if [[ -z "$MATCHED_TAGS" ]]; then MATCHED_TAGS="$t"; else MATCHED_TAGS="$MATCHED_TAGS,$t"; fi
      fi
    done
    [[ -n "$MATCHED_TAGS" ]] && printf '%s\t%s\n' "$FILE" "$MATCHED_TAGS"
  done < "$index"
}

# ------------------------------------------------------------------ parity ---
# shellcheck source=/dev/null
source "$LIB" || { echo "FAIL: cannot source $LIB"; exit 1; }

DIFFS=0
TOTAL_ROWS=0
for hay in "${HAYSTACKS[@]}"; do
  EXPECT=$(oracle_match "$INDEX" "$hay")
  ACTUAL=$(memtags_match "$INDEX" "$hay")
  TOTAL_ROWS=$((TOTAL_ROWS + $(printf '%s' "$EXPECT" | grep -c . || true)))
  if [[ "$EXPECT" == "$ACTUAL" ]]; then
    pass "parity: $hay"
  else
    fail "parity: $hay"
    diff <(printf '%s\n' "$EXPECT") <(printf '%s\n' "$ACTUAL") | sed 's/^/      /'
    DIFFS=$((DIFFS + 1))
  fi
done

# Oversize haystacks (B1, pre-tag review). The matcher passes the haystack to
# awk through the environment, and Linux caps ONE env string at MAX_ARG_STRLEN
# = 128 KiB; past that awk is never exec'd, stderr is discarded, and the empty
# output reads as "no matches" — a silent fail-open in a blocking gate. The
# shell loop this replaced piped to grep's stdin and had no such bound.
# Nothing else in this corpus is above ~1 KB, so the cliff was invisible.
# 131072 is the exact limit; the others bracket and clear it.
for size in 131000 131072 300000; do
  BIGPAD=$(awk -v n="$size" 'BEGIN { s = ""; while (length(s) < n) s = s "x"; print s }')
  BIGHAY="ship the release $BIGPAD"
  EXPECT=$(oracle_match "$INDEX" "$BIGHAY")
  ACTUAL=$(memtags_match "$INDEX" "$BIGHAY")
  if [[ -n "$EXPECT" && "$EXPECT" == "$ACTUAL" ]]; then
    pass "oversize haystack ${size}B still matches (no exec-limit fail-open)"
  else
    fail "oversize haystack ${size}B: oracle=[${EXPECT}] matcher=[${ACTUAL}]"
  fi
done
unset BIGPAD BIGHAY

# A corpus that matches nothing anywhere would make every comparison trivially
# equal. Assert the oracle actually produced rows.
if (( TOTAL_ROWS >= 12 )); then
  pass "corpus produces $TOTAL_ROWS oracle rows (comparison is not vacuous)"
else
  fail "corpus produced only $TOTAL_ROWS oracle rows — parity above compared mostly-empty output"
fi

# ----------------------------------------------------------------- control ---
# Break the awk on purpose and require the SAME comparison to notice. The break
# removes the 0-2 char declension tolerance, which `audits`/`ships` exercises.
BROKEN="$SANDBOX/memory-tags-broken.sh"
ORIG_RE='memtags_esc(tolower(t)) "([a-zA-Z]([a-zA-Z])?)?([^a-zA-Z0-9]|$)"'
BREAK_RE='memtags_esc(tolower(t)) "([^a-zA-Z0-9]|$)"'
if ! grep -qF -- "$ORIG_RE" "$LIB"; then
  fail "control: the anchor line for the injected break is gone from $LIB — the control below would be vacuous"
else
  # awk, not sed: the anchor is full of regex metacharacters and a sed that
  # silently fails to substitute produces an unmodified copy — which is exactly
  # how a control reports "no divergence" while testing nothing.
  awk -v o="$ORIG_RE" -v b="$BREAK_RE" '{ i = index($0, o); if (i > 0) $0 = substr($0, 1, i-1) b substr($0, i + length(o)); print }' \
    "$LIB" > "$BROKEN"
  if cmp -s "$LIB" "$BROKEN"; then
    fail "control: injected break produced an IDENTICAL file — the harness cannot see a change"
  else
    CTRL_DIFFERS=0
    for hay in "audits and ships plural" "hooks and audits"; do
      EXPECT=$(oracle_match "$INDEX" "$hay")
      BROKEN_OUT=$(bash -c "source '$BROKEN'; memtags_match '$INDEX' '$hay'")
      [[ "$EXPECT" != "$BROKEN_OUT" ]] && CTRL_DIFFERS=$((CTRL_DIFFERS + 1))
    done
    if (( CTRL_DIFFERS > 0 )); then
      pass "control: broken matcher diverges from the oracle on $CTRL_DIFFERS/2 probes (comparison has teeth)"
    else
      fail "control: broken matcher still agreed with the oracle — the parity assertions above prove nothing"
    fi
  fi
fi

# --------------------------------------------------------------- consumers ---
# Derive the set: a hook that resolves a MEMORY.md index is a tag-matching hook.
CONSUMERS=()
while IFS= read -r _c; do
  [[ -n "$_c" ]] && CONSUMERS+=("$_c")
done < <(grep -l -F 'MEM_INDEX' "$HOOKS_DIR"/*.sh 2>/dev/null | sort)

if (( ${#CONSUMERS[@]} >= 2 )); then
  pass "consumer-set floor (${#CONSUMERS[@]} MEMORY.md-index hooks derived from source)"
else
  fail "consumer-set floor (expected >= 2, found ${#CONSUMERS[@]}) — grep or glob broke"
fi

# What counts as "calls it" needs two exclusions, and each was established by a
# mutation that survived without it:
#   - COMMENTS. Both consumers name memtags_match in their rationale prose, so
#     the plain grep passed on prose alone — the real call could be replaced by
#     a no-op and this stayed green, the exact failure mode the header cites
#     feedback_extraction_needs_consumer_gate for.
#   - The `declare -f memtags_match` PREREQ GUARD. Adding that guard (itself a
#     fix from the same review) put a second non-comment mention in both files,
#     which re-fed the assertion and kept the same mutation green a second time.
# So: strip comments, drop the guard line, then require a surviving mention —
# which can only be an invocation.
for c in ${CONSUMERS[@]+"${CONSUMERS[@]}"}; do
  base=$(basename "$c")
  if grep -vE '^[[:space:]]*#' "$c" | grep -v 'declare -f memtags_match' | grep -q 'memtags_match'; then
    pass "$base invokes the shared memtags_match"
  else
    fail "$base resolves a MEMORY.md index but never INVOKES memtags_match (comments and the prereq guard do not count) — private tag loop"
  fi
done

# No hook may carry the interval-quantifier declension regex again. That spelling
# is the fingerprint of the hand-rolled loop AND is unsupported by the BWK awk
# macOS ships, so it can only come from a reintroduced grep copy. Comment lines
# are stripped first: this file's own rationale mentions the idiom, and a
# detector that matches prose about its subject fires on the fix
# (feedback_self_referential_marker_regex).
PRIVATE=$(grep -vE '^[[:space:]]*#' "$HOOKS_DIR"/*.sh "$HOOKS_DIR"/lib/*.sh 2>/dev/null | grep -F 'a-zA-Z]{0,2}' || true)
if [[ -z "$PRIVATE" ]]; then
  pass "no hook carries a private [a-zA-Z]{0,2} declension regex"
else
  fail "private declension regex found (tag matching duplicated outside the lib):"
  printf '%s\n' "$PRIVATE" | sed 's/^/      /'
fi

# ------------------------------------------------- truncated-lib guard -------
# A lib file truncated mid-heredoc SOURCES CLEANLY and simply never defines the
# function. Guarding on `source`'s exit code therefore let both hooks run on to
# `memtags_match: command not found`, match nothing, and — in the deny hook's
# case — allow the push, with no fail-open row (pre-tag review). This is not
# hypothetical: user-journey.test.sh already exercises a truncated marketplace
# cache. Both consumers must record prereq-missing and exit quietly instead.
TRUNC_HOME="$SANDBOX/trunc-home"
TRUNC_HOOKS="$SANDBOX/trunc-hooks"
mkdir -p "$TRUNC_HOME/.claude/logs" "$TRUNC_HOOKS/lib"
cp "$HOOKS_DIR"/*.sh "$TRUNC_HOOKS/" 2>/dev/null
cp "$HOOKS_DIR"/lib/*.sh "$TRUNC_HOOKS/lib/" 2>/dev/null
# Truncate INSIDE the quoted heredoc — the shape that still sources cleanly.
head -n 40 "$HOOKS_DIR/lib/memory-tags.sh" > "$TRUNC_HOOKS/lib/memory-tags.sh"
if bash -c "source '$TRUNC_HOOKS/lib/memory-tags.sh'" 2>/dev/null; then
  pass "truncated lib still sources with exit 0 (so an exit-code guard cannot see it)"
else
  fail "truncated lib failed to source — this fixture no longer reproduces the shape it pins"
fi

TRUNC_CWD="/work/trunc-proj"
TRUNC_ENC=$(printf '%s' "$TRUNC_CWD" | tr -c 'a-zA-Z0-9-' '-')
TRUNC_MEM="$TRUNC_HOME/.claude/projects/$TRUNC_ENC/memory"
mkdir -p "$TRUNC_MEM"
printf -- '- [Ship](feedback_ship.md) `[shiptag]` — desc\n' > "$TRUNC_MEM/MEMORY.md"
: > "$TRUNC_MEM/feedback_ship.md"
: > "$TRUNC_HOME/.claude/projects/$TRUNC_ENC/trunc-sess.jsonl"

TRUNC_EV=$(jq -cn --arg c "$TRUNC_CWD" \
  '{tool_name:"Bash", cwd:$c, session_id:"trunc-sess", tool_use_id:"tu",
    tool_input:{command:"git push origin main shiptag"}}')
TRUNC_OUT=$(printf '%s' "$TRUNC_EV" | HOME="$TRUNC_HOME" bash "$TRUNC_HOOKS/memory-read-check.sh" 2>&1)
TRUNC_LOG="$TRUNC_HOME/.claude/logs/claudemd.jsonl"
if [[ -z "$TRUNC_OUT" ]] \
   && [[ -f "$TRUNC_LOG" ]] \
   && grep -q '"event":"fail-open"' "$TRUNC_LOG" 2>/dev/null; then
  pass "truncated lib → memory-read-check exits quiet AND records fail-open"
else
  fail "truncated lib → memory-read-check silently allowed with no fail-open row (out: ${TRUNC_OUT:-<empty>}; log: $(tail -n 1 "$TRUNC_LOG" 2>/dev/null))"
fi

# ------------------------------------------------- cross-language parse ------
# scripts/lib/memory-tags.js parses the same index for the doctor's §11-EXT
# tag-specificity check, and its own comments say it mirrors the hook. Nothing
# held the two together. Compare the parsed (file, tags) list: build a haystack
# containing every tag so memtags_match reports the full parse.
JS_LIB="$REPO/scripts/lib/memory-tags.js"
if ! command -v node >/dev/null 2>&1; then
  echo "SKIP: node not installed — cross-language parse parity not exercised"
  [[ -n "${CI:-}" ]] && { echo "FAIL: that SKIP is not acceptable under CI"; FAIL=$((FAIL + 1)); }
elif [[ ! -f "$JS_LIB" ]]; then
  fail "cross-language: $JS_LIB is gone — the doctor's parser moved without this gate noticing"
else
  # Every bracketed token on every line, not just the first block per line: a
  # line carrying TWO tag blocks (the rightmost-anchoring case above) put its
  # second block out of reach of a `-F backtick` field split, so the shell
  # matcher had nothing to match and the comparison read as a divergence.
  # Markdown link titles come along too; harmless, since a superset haystack
  # can only help every tagged entry match, which is the point.
  ALL_TAGS=$(grep -oE '\[[^]]*\]' "$INDEX" | tr -d '[]' | tr ',' ' ' | tr '\n' ' ')
  SH_PARSE=$(memtags_match "$INDEX" "$ALL_TAGS" | cut -f1 | sort)
  JS_PARSE=$(node --input-type=module -e "
    import { parseMemoryIndex } from '$JS_LIB';
    import fs from 'node:fs';
    const c = fs.readFileSync('$INDEX', 'utf8');
    for (const e of parseMemoryIndex(c)) console.log(e.file);
  " 2>/dev/null | sort)
  if [[ "$SH_PARSE" == "$JS_PARSE" ]]; then
    pass "cross-language parse: shell and scripts/lib/memory-tags.js resolve the same entry files ($(printf '%s' "$SH_PARSE" | grep -c . || true))"
  else
    fail "cross-language parse divergence between the hook matcher and the doctor's parser:"
    diff <(printf '%s\n' "$SH_PARSE") <(printf '%s\n' "$JS_PARSE") | sed 's/^/      /'
  fi
fi

# ------------------------------------------------ spill-branch integrity -----
# audit-2026-08-22 P1-5. The >30000-char branch spills the haystack to a file.
# Three gaps, all on the DENY path of a blocking gate:
#   1. `mktemp … || return 0` and the `printf` that follows produce an empty
#      haystack on failure — a silent fail-open, with no fail-open row, in the
#      same function whose 128 KiB sibling branch was fixed WITH a row. Whoever
#      reads the telemetry sees a gate that had nothing to deny.
#   2. No `trap`: killed at its hooks.json timeout — the scenario this library
#      exists for — the hook leaks the spill file.
#   3. Nothing collected the leak (covered by the join test in
#      tests/scripts/clean-residue.test.js).
SPILL_LIBDIR="$HOOKS_DIR/lib"
SPILL_HOME="$SANDBOX/spill-home"
mkdir -p "$SPILL_HOME/.claude/logs"
# Above the 30000-char spill threshold; `ship` makes it match a real entry, so
# an empty result can only mean the branch failed open.
SPILL_HAY="ship the release $(awk 'BEGIN { s = ""; while (length(s) < 40000) s = s "x"; print s }')"

# $0 is set to a real hook name: hook_record_failopen keys its state marker on
# it, and the row should read like the hook that actually failed open.
spill_probe() {  # $1=TMPDIR $2=PATH-prefix ("" for none)
  local extra_path="$2"
  env HOME="$SPILL_HOME" TMPDIR="$1" DISABLE_RULE_HITS_LOG=0 \
      PATH="${extra_path:+$extra_path:}$PATH" \
    bash -c 'source "$1/hook-common.sh" || exit 0
             source "$1/memory-tags.sh" || exit 0
             memtags_match "$2" "$3"' \
    memory-read-check.sh "$SPILL_LIBDIR" "$INDEX" "$SPILL_HAY" 2>/dev/null
}
failopen_markers() { ls -1 "$SPILL_HOME/.claude/.claudemd-state"/failopen-*.ts 2>/dev/null | wc -l | tr -d ' '; }

# Control first: the branch must MATCH on a healthy $TMPDIR, otherwise the two
# failure probes below would "pass" on a spill path that never runs
# (feedback_probe_harness_controls_first).
SPILL_OK_TMP="$SANDBOX/spill-ok"; mkdir -p "$SPILL_OK_TMP"
if [[ -n "$(spill_probe "$SPILL_OK_TMP" "")" ]]; then
  pass "control: the spill branch matches on a healthy TMPDIR (the probes below exercise it)"
else
  fail "control: the spill branch produced NO match on a healthy TMPDIR — the failure probes below prove nothing"
fi
if [[ -z "$(ls -A "$SPILL_OK_TMP" 2>/dev/null)" ]]; then
  pass "spill file is removed on the normal path"
else
  fail "spill file left behind on the normal path: $(ls -A "$SPILL_OK_TMP")"
fi

# 1a. mktemp cannot create the file.
rm -rf "$SPILL_HOME/.claude/.claudemd-state"
SPILL_OUT=$(spill_probe "$SANDBOX/no-such-dir-for-mktemp" "")
if [[ -z "$SPILL_OUT" && "$(failopen_markers)" -ge 1 ]]; then
  pass "spill mktemp failure records fail-open (blocking gate does not go quiet unlogged)"
else
  fail "spill mktemp failure: out=[${SPILL_OUT}] failopen-markers=$(failopen_markers) — expected empty output WITH a fail-open row"
fi

# 1b. mktemp succeeds but the write does not (full disk / unwritable target).
# Shimmed mktemp hands back a path under a read-only dir, so the `printf >` fails.
if [[ "$(id -u)" == "0" ]]; then
  echo "SKIP: running as root — a read-only dir does not block the write probe"
else
  SPILL_SHIM="$SANDBOX/shim-mktemp"; mkdir -p "$SPILL_SHIM"
  SPILL_RO="$SANDBOX/spill-readonly"; mkdir -p "$SPILL_RO"; chmod 500 "$SPILL_RO"
  {
    echo '#!/usr/bin/env bash'
    echo "printf '%s\\n' '$SPILL_RO/claudemd-memtags-hay-shim'"
  } > "$SPILL_SHIM/mktemp"
  chmod +x "$SPILL_SHIM/mktemp"
  rm -rf "$SPILL_HOME/.claude/.claudemd-state"
  SPILL_OUT=$(spill_probe "$SANDBOX/spill-ok" "$SPILL_SHIM")
  if [[ -z "$SPILL_OUT" && "$(failopen_markers)" -ge 1 ]]; then
    pass "spill write failure records fail-open"
  else
    fail "spill write failure: out=[${SPILL_OUT}] failopen-markers=$(failopen_markers) — expected empty output WITH a fail-open row"
  fi
fi

# 2. Timeout kill must not leak the spill file. A stub `awk` that sleeps holds
# the branch open; job control puts the probe in its own process group so the
# TERM reaches the shell that owns the trap as well as the stub.
SPILL_LEAK_SHIM="$SANDBOX/shim-awk"; mkdir -p "$SPILL_LEAK_SHIM"
printf '#!/usr/bin/env bash\nsleep 5\n' > "$SPILL_LEAK_SHIM/awk"
chmod +x "$SPILL_LEAK_SHIM/awk"
leak_probe() {  # $1=lib dir under test → echoes the number of files left behind
  local libdir="$1" leaktmp
  leaktmp=$(mktemp -d "$SANDBOX/leak-XXXXXX") || { echo "-1"; return; }
  set -m
  env HOME="$SPILL_HOME" TMPDIR="$leaktmp" DISABLE_RULE_HITS_LOG=1 \
      PATH="$SPILL_LEAK_SHIM:$PATH" \
    bash -c 'source "$1/hook-common.sh" || exit 0
             source "$1/memory-tags.sh" || exit 0
             memtags_match "$2" "$3"' \
    memory-read-check.sh "$libdir" "$INDEX" "$SPILL_HAY" >/dev/null 2>&1 &
  local pid=$!
  set +m
  # Signal only once the spill file EXISTS. A fixed sleep raced two ways under a
  # loaded suite: too early and the branch had not spilled yet (reads as "no
  # leak" — a vacuous pass), too late is only slower.
  local waited=0
  while [[ -z "$(ls -A "$leaktmp" 2>/dev/null)" ]] && (( waited < 50 )); do
    sleep 0.1; waited=$((waited + 1))
  done
  kill -TERM -"$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  # `wait` can return before the inner subshell's trap has finished unlinking
  # (the TERM goes to the whole group; the shell owning the trap is a child of
  # the one being waited on). Give cleanup a bounded window — a trap-less copy
  # still has nothing to run, so the control keeps its teeth.
  local settle=0
  while [[ -n "$(ls -A "$leaktmp" 2>/dev/null)" ]] && (( settle < 30 )); do
    sleep 0.1; settle=$((settle + 1))
  done
  ls -1 "$leaktmp" 2>/dev/null | wc -l | tr -d ' '
}

# Control: the same probe against a copy with the trap stripped MUST leak.
# Without it a probe that never reached the spill branch reads as "no leak".
SPILL_NOTRAP="$SANDBOX/notrap-lib"; mkdir -p "$SPILL_NOTRAP"
cp "$SPILL_LIBDIR"/*.sh "$SPILL_NOTRAP/"
# Anchored on the STATEMENT (leading whitespace, `trap`, an `rm -f` somewhere in
# the handler), not on one exact spelling: the first cut matched `trap 'rm -f `
# literally and reported "anchor gone" the moment the handler grew a guard.
# That is the anchor-guard working — but the pattern it guards should survive a
# handler rewrite, since the property under test is "there is a cleanup trap".
grep -vE "^[[:space:]]*trap .*rm -f" "$SPILL_LIBDIR/memory-tags.sh" > "$SPILL_NOTRAP/memory-tags.sh"
if cmp -s "$SPILL_LIBDIR/memory-tags.sh" "$SPILL_NOTRAP/memory-tags.sh"; then
  fail "control: no trap line found to strip in memory-tags.sh — the leak probe below cannot fail"
else
  CTRL_LEAK=$(leak_probe "$SPILL_NOTRAP")
  if [[ "$CTRL_LEAK" -ge 1 ]]; then
    pass "control: trap-less copy leaks $CTRL_LEAK spill file(s) on a TERM (the probe can fail)"
  else
    fail "control: trap-less copy leaked nothing — the leak probe proves nothing (probe never reached the spill branch?)"
  fi
fi
REAL_LEAK=$(leak_probe "$SPILL_LIBDIR")
if [[ "$REAL_LEAK" == "0" ]]; then
  pass "TERM at the hooks.json timeout leaves no memtags spill file behind"
else
  fail "TERM left $REAL_LEAK spill file(s) in TMPDIR — the leak this library's own scenario produces"
fi

# Both consumers must source hook-common.sh BEFORE memory-tags.sh: the fail-open
# rows above are recorded through hook_record_failopen, and a consumer that
# sources them the other way round (or not at all) gets the silent fail-open
# back with no call-site change to notice it.
for c in ${CONSUMERS[@]+"${CONSUMERS[@]}"}; do
  base=$(basename "$c")
  HC_LINE=$(grep -n 'source .*hook-common\.sh' "$c" | head -1 | cut -d: -f1)
  MT_LINE=$(grep -n 'source .*memory-tags\.sh' "$c" | head -1 | cut -d: -f1)
  if [[ -n "$HC_LINE" && -n "$MT_LINE" ]] && (( HC_LINE < MT_LINE )); then
    pass "$base sources hook-common.sh before memory-tags.sh (fail-open rows reachable)"
  else
    fail "$base must source hook-common.sh before memory-tags.sh (hook-common=${HC_LINE:-none}, memory-tags=${MT_LINE:-none}) — otherwise memtags fail-open goes unlogged"
  fi
done

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
