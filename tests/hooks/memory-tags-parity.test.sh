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
- [Regex meta](feedback_meta.md) `[v6.9, printf-%b, c++build]` — metachars must be literal
- [Leading dash](feedback_dash.md) `[--file, -h]` — tags that look like grep flags
- [CJK tags](feedback_cjk.md) `[全面审核, 发版, 门存在但没盖住]` — chinese tags
- [Internal space](feedback_space.md) `[two words, normal]` — tr -d ' ' removes inner spaces
- [Declension](feedback_decl.md) `[audit, ship]` — 0-2 trailing letters tolerated
- [Empty tag](feedback_empty.md) `[, alpha, ]` — empty members are skipped
- [Upper case](feedback_case.md) `[MixedCase, UPPER]` — matching is case-insensitive
- [Dotted file](feedback_v2.name.md) `[dotted]` — file token contains extra dots
EOF

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

for c in ${CONSUMERS[@]+"${CONSUMERS[@]}"}; do
  base=$(basename "$c")
  if grep -q 'memtags_match' "$c"; then
    pass "$base matches tags via the shared memtags_match"
  else
    fail "$base resolves a MEMORY.md index but does NOT call memtags_match (private tag loop)"
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
  ALL_TAGS=$(awk -F'`' '/\.md\)[[:space:]]*`\[/ { n = split($2, a, ","); for (i = 1; i <= n; i++) { gsub(/[][ ]/, "", a[i]); if (a[i] != "") printf "%s ", a[i] } }' "$INDEX")
  ALL_TAGS="$ALL_TAGS $(sed -nE 's/.*\.md\)[[:space:]]*\[([^]]*)\][[:space:]]*[—-].*/\1/p' "$INDEX" | tr ',' ' ')"
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

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
