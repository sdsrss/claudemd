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
# Record fail-open on missing prereqs (roadmap OBS-1): don't let a jq-less /
# malformed-stdin environment silently no-op this §11 gate — the §13.1 audit
# must see the bypass, not read it as "never fired".
if ! hook_require_jq; then
  hook_record_failopen memory-read-check jq-missing
  exit 0
fi
# memory-tags.sh provides memtags_match (shared with memory-prompt-hint.sh).
# An unreadable matcher would make every command match nothing — this §11 gate
# silently allowing every push is exactly the fail-open that OBS-1 exists to
# make visible, so it is recorded, not swallowed.
# shellcheck source=/dev/null
source "$LIB_DIR/memory-tags.sh" 2>/dev/null
# `source` returning 0 is NOT enough: a file truncated mid-heredoc — the shape
# user-journey.test.sh already exercises for the marketplace cache — sources
# cleanly and simply never defines the function. The gate then hit
# `memtags_match: command not found`, matched nothing, allowed the push, and
# logged nothing (pre-tag review). Assert the symbol, not the exit code.
if ! declare -f memtags_match >/dev/null 2>&1; then
  hook_record_failopen memory-read-check prereq-missing
  exit 0
fi

EVENT=$(hook_read_event)
if [[ -z "$EVENT" ]]; then
  hook_record_failopen memory-read-check bad-event
  exit 0
fi
TOOL=$(hook_jq_field memory-read-check "$EVENT" '.tool_name // ""') || exit 0
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# R-N5 readonly fast-path. **v0.20.0 default-ON** (§13.3 promotion).
# Opt-out: BASH_READONLY_FAST_PATH=0.
if [[ "${BASH_READONLY_FAST_PATH:-1}" != "0" ]] && hook_is_readonly_bash "$CMD"; then
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
# Heredoc bodies are stripped BEFORE flattening. Order is load-bearing: the
# flatten turns newlines into `;`, which is exactly the separator TRIGGER_RE
# anchors on, so an unstripped heredoc body would hand its own lines to the
# trigger as if they were commands — reintroducing the v0.9.28 bug the comment
# above describes. ship-baseline has always stripped first; this now matches it.
#
# 2026-07-27 audit (M1): "matches it" was still one stage short — ship-baseline
# also empties quoted bodies AFTER the flatten, and this hook did not. The
# flatten turns a newline INSIDE an `-m` payload into `;`, which is exactly the
# separator TRIGGER_RE anchors on, so `git commit -m "fix parser\ndeploy notes"`
# put a bare `deploy` at a synthetic segment start and widened the scan to
# quoted prose (it denied two of the audit's own probe commands). The shared
# hook_trigger_view carries all three stages in the load-bearing order; this is
# the same direction as the v0.9.28 anchor fix, which already declared quoted
# `release`/`deploy` text to be data rather than an invocation.
CMD_FLAT=$(printf '%s' "$CMD" | hook_trigger_view)
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
  local raw="$1" out=""
  # Heredoc bodies via the shared hook_strip_heredoc_bodies (hook-common.sh).
  # This was a hand-copied loop that never received pre-bash-safety's terminator
  # LOOKAHEAD guard, so `echo $((1<<n)) && git push` opened a phantom heredoc and
  # blanked the trigger — the §11 gate then allowed the push (2026-07-25 audit).
  out=$(printf '%s' "$raw" | hook_strip_heredoc_bodies)
  # Strip quoted-string bodies. Flatten newlines to \r first so the (line-based)
  # sed also strips MULTI-LINE quoted args — e.g. a multi-paragraph
  # `gh release create --notes "..."`. Without the flatten, an opening quote
  # left unclosed on its own line leaks the whole body into tag matching — the
  # exact FP this strip exists to prevent (v0.23.10: a multi-line release-notes
  # body's "self-dogfood" matched a `dogfood` tag and forced a spurious deny).
  # \r is the placeholder — bash command strings carry no literal CR.
  out=$(printf '%s' "$out" | tr '\n' '\r' \
    | sed -E 's/"[^"]*"/""/g' \
    | sed -E "s/'[^']*'/''/g" \
    | tr '\r' '\n')
  # Strip line comments LAST — AFTER the quote strips. Pre-v0.23.11 this ran
  # first, so a `#` inside a quoted commit message (`git commit -m "closes #42"`)
  # was mistaken for a real comment and everything after it — including chained
  # ship verbs + topic tags (`&& deploy <topic>`) — was deleted, silently
  # bypassing the §11 memory gate. Issue/PR numbers in commit messages make this
  # routine. By this point all quoted bodies are emptied, so any surviving `#` is
  # a genuine unquoted comment. (Same ordering fix as pre-bash-safety-check.sh.)
  out=$(printf '%s' "$out" | sed -E 's/(^|[[:space:]])#.*$/\1/')
  # vNEXT: strip filesystem-path / URL tokens (any unquoted run containing `/`).
  # A path segment is not a topic declaration — e.g. `~/.claude/projects/...`
  # would otherwise match a `projects` tag and deny an unrelated command.
  # Live-reproduced twice in the 2026-06-03 impact audit. Same intent as the
  # quoted-title sanitize above; bare-word tags (no slash) are unaffected.
  out=$(printf '%s' "$out" | sed -E 's#[^[:space:]]*/[^[:space:]]*# #g')
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
# a no-op for those projects). `tr -c 'a-zA-Z0-9-' '-'` converts EVERY non-
# `[a-zA-Z0-9-]` char (space, `+`, `@`, …) to `-`, exactly matching CC's
# encoding — the narrower `tr '/._'` only handled the three chars seen in this
# maintainer's own cwds and silently mis-located the dir for any project path
# with a special char beyond those, no-op'ing the HARD §11 rule there too.
# For `/._`-only paths the two forms are byte-identical, so this is a strict
# superset fix. (Mirror sites: memory-prompt-hint.sh, banned-vocab-check.sh,
# lib/rule-hits.sh — all derive the same projects-dir encoding.)
ENCODED=$(hook_encode_project "$CWD")
MEM_DIR="$HOME/.claude/projects/${ENCODED}/memory"
MEM_INDEX="$MEM_DIR/MEMORY.md"
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"

# Fail-open if either missing (CC version drift)
[[ -f "$MEM_INDEX" ]] || exit 0
[[ -f "$TRANSCRIPT" ]] || exit 0

# Parse index lines: `- [Title](file.md) [tag1, tag2] — desc`, via the shared
# single-pass matcher (lib/memory-tags.sh; see its header for the parse rules
# that used to live here). This was an inline loop forking three processes per
# tag: 1.9s at 336 tags, 3.7s at 750, against this hook's 3s hooks.json budget.
# Unlike the hint hook's copy, a timeout here is not a missing suggestion — the
# process is killed before it can emit, so the §11 DENY never reaches Claude
# Code and the gate fails open at exactly the ship moment, with no telemetry row
# to say so. Matching semantics are unchanged; the parity test holds them.
#
# Only the file column is read: this hook denies per FILE, and the old loop
# `break`ed on the first matching tag. memtags_match reports every matched tag,
# which is a superset — the file set is identical.
MATCHES=()
while IFS=$'\t' read -r _file _tags; do
  [[ -n "$_file" ]] || continue
  MATCHES+=("$_file")
done < <(memtags_match "$MEM_INDEX" "$CMD_TAGMATCH")

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
