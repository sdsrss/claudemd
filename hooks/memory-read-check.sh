#!/usr/bin/env bash
# memory-read-check.sh — PreToolUse:Bash hook.
# Denies ship/release/push commands when a keyword-matched memory file
# has NOT been Read in the current session.
# Fragile transcript parsing — fail-open on any hiccup.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MEMORY_READ || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# R-N5 readonly fast-path (v0.8.3, opt-in default OFF).
if [[ "${BASH_READONLY_FAST_PATH:-0}" == "1" ]] && hook_is_readonly_bash "$CMD"; then
  exit 0
fi

# Filter: ship/release/push/deploy verbs at command-segment-start.
# Anchor on `^` or shell separator (`;` / `&` / `|`) so `release`/`deploy`/
# `ship` substrings inside quoted commit messages, MR descriptions, file
# paths, etc. don't trigger the whole MEMORY scan. Pre-fix `git commit -m
# "release notes"` and `glab mr create --title "fix release"` both fired
# the filter — see tests Cases 14–15.
TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)(git[[:space:]]+push|gh[[:space:]]+(release|pr)|glab[[:space:]]+mr|npm[[:space:]]+(publish|run[[:space:]]+(release|deploy|ship))|cargo[[:space:]]+publish|make[[:space:]]+(release|deploy|ship)|release|deploy|ship)([^a-zA-Z]|$)'
# v0.9.28: collapse newlines to spaces before regex check. Prior behavior fired
# on multi-line commands where heredoc body lines started with conventional-
# commit verbs (e.g. `git commit -m "$(cat <<EOF\nrelease(v0.9.27): ...\nEOF\n)"`
# matched the bare-verb fallback `release|deploy|ship` because grep -E treats
# each newline-separated line as anchorable via `^`). Collapsing to one line
# means `^` only matches actual start-of-command, while mid-string occurrences
# still need a `[;&|]+` separator before them — which heredoc body content
# never has.
CMD_FLAT=$(printf '%s' "$CMD" | tr '\n' ' ')
echo "$CMD_FLAT" | grep -qE "$TRIGGER_RE" || exit 0

# vNEXT: tag-match sanitize. v0.9.28 anchored the TRIGGER regex at command-
# segment-start so `release` inside `git commit -m "release notes"` no longer
# fires the scan. The TAG-match stage (below) was left scanning the raw command
# including quoted bodies — so `glab mr create --title "fix macos issue"`
# fires `glab mr` trigger correctly (intentional), then tag `mac` exact-matches
# `macos` inside the quoted `--title` argument. Title text is a user-written
# description, not a topic declaration; treating it as authoritative for tag
# matching produced FP fan-out on every MR/PR with a descriptive title.
#
# Fix: strip heredoc bodies, line comments, and ALL quoted-string bodies before
# tag matching. Mirrors `pre-bash-safety-check.sh sanitize_cmd()` but simpler:
# tag-match has no `$VAR` expansion sensitivity (the literal `$VAR` string
# doesn't carry topic information either way), so both `"foo"` and `"$VAR"`
# strip uniformly. Empty-quote markers preserved to keep token boundaries.
sanitize_for_tagmatch() {
  local raw="$1" out="" line in_heredoc=0 heredoc_tag=""
  local heredoc_re=$'<<-?[[:space:]]*[\047"]?([[:alpha:]_][[:alnum:]_]*)[\047"]?'
  while IFS= read -r line || [[ -n "$line" ]]; do
    if (( in_heredoc )); then
      if [[ "$line" =~ ^[[:space:]]*${heredoc_tag}[[:space:]]*$ ]]; then
        in_heredoc=0; heredoc_tag=""
      fi
      out+=$'\n'
      continue
    fi
    if [[ "$line" =~ $heredoc_re ]]; then
      heredoc_tag="${BASH_REMATCH[1]}"
      in_heredoc=1
      line="${line%%<<*}"
    fi
    out+="$line"$'\n'
  done <<< "$raw"
  out=$(printf '%s' "$out" | sed -E 's/(^|[[:space:]])#.*$/\1/')
  out=$(printf '%s' "$out" | sed -E 's/"[^"]*"/""/g')
  out=$(printf '%s' "$out" | sed -E "s/'[^']*'/''/g")
  printf '%s' "$out"
}
CMD_TAGMATCH=$(sanitize_for_tagmatch "$CMD")

CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)

# Per-invocation escape hatch — placed AFTER trigger filter so bypass
# usage is recorded only when the hook would have actually scanned.
# SESSION_ID / TOOL_USE_ID extracted above so bypass row also carries them
# (v0.9.33 / v0.9.34 schema).
#
# v0.9.36: accept both [skip-memory-check] and [skip-memory-check: <reason>].
# Reason text (when present) lands in extra.bypass_reason — fuels future
# §0.1/§13.1 audit: bypass concentrated on `tag-FP` reasons ⇒ rule too
# strict; concentrated on `trivial-edit` reasons ⇒ command-shape too
# aggressive. Distinguishes "operator says rule is broken" from "operator
# says task doesn't need this rule" without manual transcript reading.
BYPASS_RE='\[skip-memory-check[[:space:]]*(:[[:space:]]*([^]]*))?\]'
if [[ "$CMD" =~ $BYPASS_RE ]]; then
  BYPASS_REASON="${BASH_REMATCH[2]:-}"
  # Trim trailing whitespace; leading absorbed by the inner [[:space:]]* group.
  BYPASS_REASON="${BYPASS_REASON%"${BYPASS_REASON##*[![:space:]]}"}"
  if [[ -n "$BYPASS_REASON" ]]; then
    R_JSON=$(printf '%s' "$BYPASS_REASON" | jq -R .)
    EXTRA="{\"token\":\"skip-memory-check\",\"bypass_reason\":$R_JSON}"
  else
    EXTRA='{"token":"skip-memory-check"}'
  fi
  hook_record memory-read-check bypass-escape-hatch "$EXTRA" '§11-memory-read' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi

[[ -n "$CWD" && -n "$SESSION_ID" ]] || exit 0

# Derive project-encoded dir — Claude Code converts every non-`[a-zA-Z0-9-]`
# char to `-` (empirically: `/`, `.`, AND `_` all map to `-`; observed across
# ~/.claude/projects/ — e.g. /mnt/data_ssd → -mnt-data-ssd, my.project → my-project,
# ~/.claude → --claude). Earlier `tr '/.' '-'` missed `_`, silently mis-locating
# the memory dir for any cwd with an underscore (turning the HARD §11 rule into
# a no-op for those projects). `tr '/._'` is the minimal extension covering all
# three observed encoded chars.
ENCODED=$(printf '%s' "$CWD" | tr '/._' '-')
MEM_DIR="$HOME/.claude/projects/${ENCODED}/memory"
MEM_INDEX="$MEM_DIR/MEMORY.md"
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"

# Fail-open if either missing (CC version drift)
[[ -f "$MEM_INDEX" ]] || exit 0
[[ -f "$TRANSCRIPT" ]] || exit 0

# Parse index lines: `- [Title](file.md) [tag1, tag2] — desc`
MATCHES=()
while IFS= read -r line; do
  FILE=$(echo "$line" | sed -n 's/.*(\([^)]*\.md\)).*/\1/p')
  [[ -z "$FILE" ]] && continue
  # Accept both backtick-wrapped (`[tag, tag]`) and plain (`[tag, tag]`)
  # tag-block syntax. Spec §11 documents the plain form; existing user data
  # commonly uses the backtick form. Trying backtick first preserves precise
  # matching when both forms could otherwise overlap on a single line.
  #
  # Both forms anchor on `.md)` so that:
  #   1. A decorative `\`[other]\`` token in the description doesn't get
  #      mistaken for the tag block (greedy `.*` would otherwise eat through
  #      to the LAST `\`[...]\``).
  #   2. A `[Title]` bracket pair in the markdown link itself isn't matched.
  TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*`\[\([^]]*\)\]`.*/\1/p')
  if [[ -z "$TAG_BLOCK" ]]; then
    # Plain form, anchored same way + ending before description separator.
    TAG_BLOCK=$(echo "$line" | sed -n 's/.*\.md)[[:space:]]*\[\([^]]*\)\][[:space:]]*[—-].*/\1/p')
  fi

  if [[ -z "$TAG_BLOCK" ]]; then
    # Untagged entries: hook does NOT auto-block. Spec §11 "Index is a
    # router, not a substitute" — untagged matching is the agent's
    # responsibility (full content scan when in doubt). Pre-fix this branch
    # added the file to MATCHES unconditionally, forcing N unrelated Reads
    # on every push when MEMORY.md grew without tag discipline.
    continue
  else
    IFS=',' read -ra TAGS <<<"$TAG_BLOCK"
    for t in "${TAGS[@]}"; do
      t=$(echo "$t" | tr -d ' ')
      [[ -z "$t" ]] && continue
      # v0.9.28: word-boundary match with 0-2 char declension tolerance.
      # Pre-fix `grep -iF` substring-matched `cli` inside `clippy`,
      # `dead-code` inside any literal citation, etc. — produced ~80% FP rate
      # in v0.9.27 ship-flow self-audit. New form anchors on non-word-char
      # boundaries and allows up to 2 trailing alpha chars so plurals/
      # declensions still match (`hook` still matches `hooks`/`hooked`).
      # `--` separator preserved: a tag beginning with `-` (e.g. `--file`,
      # `-h`) would otherwise be parsed by grep as a flag and silently
      # fail-open the whole §11 rule (regression from v0.9.14).
      # Tag escaping: regex meta chars in tags (`.`, `*`, `+`, `[`, `]`,
      # `(`, `)`, `?`, `{`, `}`, `|`, `^`, `$`, `\`) escaped before use.
      ESC_TAG=$(printf '%s' "$t" | sed 's|[][\\.*^$+?{}()|]|\\&|g')
      if echo "$CMD_TAGMATCH" | grep -qiE -- "(^|[^a-zA-Z0-9])${ESC_TAG}[a-zA-Z]{0,2}([^a-zA-Z0-9]|$)"; then
        MATCHES+=("$FILE")
        break
      fi
    done
  fi
done < "$MEM_INDEX"

(( ${#MATCHES[@]} == 0 )) && exit 0

# Check each matched file against transcript Read events
MISSING=()
for file in "${MATCHES[@]}"; do
  MEMFILE="$MEM_DIR/$file"
  if ! grep -qF -- "$MEMFILE" "$TRANSCRIPT" 2>/dev/null; then
    MISSING+=("$file")
  fi
done

(( ${#MISSING[@]} == 0 )) && exit 0

REASON="§11 MEMORY.md read-the-file (HARD): matched memory file(s) not Read this session:"
for m in "${MISSING[@]}"; do
  REASON+=$'\n'"  - $m"
done
REASON+=$'\n\n'"Options:
  (a) Read the listed file(s), then retry.
  (b) Per-invocation bypass: include [skip-memory-check] or
      [skip-memory-check: <reason>] in the command. Citing a reason
      helps the §0.1/§13.1 audit distinguish 'rule too strict' from
      'task doesn't need this rule'.

Spec: ~/.claude/CLAUDE.md §11 SESSION — MEMORY.md read-the-file."

MISS_JSON=$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)
# v0.9.36: emit match_count = total MATCHES (triggered files), not just
# MISSING (un-Read subset). Distinguishes "deny triggered 8-file fan-out"
# (avalanche signal, rule may be too broad) from "deny triggered 1 file"
# (single match, rule working as designed). Bypass-rate by match_count
# bucket surfaces avalanche-driven bypass.
hook_record memory-read-check deny "{\"missing\":$MISS_JSON,\"match_count\":${#MATCHES[@]}}" '§11-memory-read' "$SESSION_ID" "$TOOL_USE_ID"
hook_deny memory-read-check "$REASON"
