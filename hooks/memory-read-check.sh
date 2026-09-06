#!/usr/bin/env bash
# memory-read-check.sh — PreToolUse:Bash hook.
# Denies ship/release/push commands when a keyword-matched memory file
# has NOT been Read in the current session.
# Fragile transcript parsing — fail-open on any hiccup.

set -uo pipefail

LIB_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null || cd .; pwd)/lib"
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
# Same reasoning for the shared trigger fragment: unset under `set -u` aborts
# the hook mid-regex, which is a fail-open with no row on the record. Both
# constants are asserted, not just the one in the regex: an empty
# HOOK_TRIGGER_QUOTE_AWK would make `awk ""` a cat, leaking every quoted body
# into tag matching — a silent FP storm rather than an abort, so it needs the
# assertion more, not less.
if [[ -z "${HOOK_GIT_GLOBAL_FLAGS:-}" || -z "${HOOK_TRIGGER_QUOTE_AWK:-}" ]]; then
  hook_record_failopen memory-read-check prereq-missing
  exit 0
fi

EVENT=$(hook_read_event)
if [[ -z "$EVENT" ]]; then
  hook_record_failopen memory-read-check bad-event
  exit 0
fi
hook_read_bash_fields memory-read-check "$EVENT" || exit 0
[[ "$HOOK_TOOL_NAME" == "Bash" ]] || exit 0
CMD="$HOOK_CMD"
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
#
# `git${HOOK_GIT_GLOBAL_FLAGS}` (hook-common.sh): `git -C /repo push` is an
# ordinary way for an agent to push a repo it is not cd'd into, and requiring
# `git` and `push` to be adjacent let it walk past this gate — and past the §7
# and §10-V gates, which shared the omission (2026-08-29 audit R10-05).
TRIGGER_RE="(^|[[:space:]]*[;&|]+[[:space:]]*)(git${HOOK_GIT_GLOBAL_FLAGS}[[:space:]]+push|gh[[:space:]]+(release|pr)|glab[[:space:]]+mr|npm[[:space:]]+(publish|run[[:space:]]+(release|deploy|ship))|cargo[[:space:]]+publish|make[[:space:]]+(release|deploy|ship)|release|deploy|ship)([^a-zA-Z]|\$)"
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
  # Strip quoted-string bodies, via the SAME single-pass state machine the
  # trigger stage above uses (hook-common.sh HOOK_TRIGGER_QUOTE_AWK).
  #
  # This was two independent line-based seds —
  #   sed -E 's/"[^"]*"/""/g' | sed -E "s/'[^']*'/''/g"
  # — with a `tr '\n' '\r'` / `tr '\r' '\n'` flatten around them so the
  # line-based seds could also reach a MULTI-LINE quoted arg (a multi-paragraph
  # `gh release create --notes "…"`; v0.23.10). R11-05 replaced exactly that pair
  # in hook_trigger_view, and v0.47.1 replaced it in pre-bash-safety-check.sh,
  # for the reason spelled out at the constant: single- and double-quote context
  # are MUTUALLY EXCLUSIVE in the shell, so two passes that each ignore the
  # other's context pair the closing quote of one region with the opening quote
  # of the NEXT and delete everything between them. `grep 'a"b' f && ship runbook
  # && grep 'c"d' g` came out of the pair as `grep '' g` — the topic word gone,
  # so memtags_match found nothing and this HARD §11 gate exited 0 on a command
  # its own trigger had just decided to hold, with no fail-open row (2026-09-05
  # audit ENG-02). The trigger stage was fixed in R11-05 and this copy was
  # missed, which is why the hook still fires and still fails to match.
  #
  # The awk reads the whole input as one record (RS="\004"), so multi-line quoted
  # bodies are covered by construction and the \r round trip is gone with it.
  # Output still uses `''` / `""` markers, so token boundaries are unchanged from
  # the seds on every input where the seds were right.
  out=$(printf '%s' "$out" | awk "$HOOK_TRIGGER_QUOTE_AWK")
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

# One jq spawn for all three (hook_read_telemetry_ids), not three — this hook
# reaches here only past the trigger, but the three siblings hand-copied the
# same extractions and the set had no single source (2026-08-29 audit R10-23).
hook_read_telemetry_ids "$EVENT"
CWD="$EVENT_CWD"

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

# Past this point the trigger has FIRED — every remaining `exit 0` is this HARD
# §11 gate declining to run on a command it decided to gate. Those exits carry a
# fail-open row (roadmap OBS-1) so the §13.1 audit reads them as "could not
# evaluate", not as "never fired". The cwd-encoding drift this depends on has
# really happened twice (feedback_cc_cwd_encoding_dots), and both times it
# silently no-op'd this gate and left nothing behind to say so
# (2026-08-29 audit R10-06b).
if [[ -z "$CWD" || -z "$SESSION_ID" ]]; then
  hook_record_failopen memory-read-check event-fields-missing
  exit 0
fi

# Derive project-encoded dir — Claude Code converts every non-`[a-zA-Z0-9-]`
# char to `-` (empirically: `/`, `.`, AND `_` all map to `-`; observed across
# ~/.claude/projects/ — e.g. /mnt/data_ssd → -mnt-data-ssd, my.project → my-project,
# ~/.claude → --claude). Earlier `tr '/.' '-'` missed `_`, silently mis-locating
# the memory dir for any cwd with an underscore (turning the HARD §11 rule into
# a no-op for those projects), and the `tr -c 'a-zA-Z0-9-' '-'` that replaced it
# was described here as "exactly matching CC's encoding" — it is not. `tr` works
# on BYTES, so a CJK path segment gets three dashes per character where CC (a
# Node String.replace) emits one. The 2026-07-17 audit replaced it with the
# per-character `hook_encode_project` in lib/rule-hits.sh; this comment kept
# asserting the old equivalence (2026-08-29 audit R10-21c). Encoding rationale,
# the locale caveat and the non-BMP residual all live in that function's header.
# (Mirror sites: memory-prompt-hint.sh, banned-vocab-check.sh, lib/rule-hits.sh
# — all call the same single source.)
ENCODED=$(hook_encode_project "$CWD")
MEM_DIR="$HOME/.claude/projects/${ENCODED}/memory"
MEM_INDEX="$MEM_DIR/MEMORY.md"
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"

# Fail-open if either missing (CC version drift) — recorded, not silent. A
# mis-derived ENCODED makes BOTH paths miss, which is indistinguishable from
# "this project has no memory index" unless the row says which one was absent.
if [[ ! -f "$MEM_INDEX" ]]; then
  hook_record_failopen memory-read-check mem-index-missing
  exit 0
fi
if [[ ! -f "$TRANSCRIPT" ]]; then
  hook_record_failopen memory-read-check transcript-missing
  exit 0
fi

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

# Check each matched file against transcript Read events.
#
# The "was it Read" test is hook_memfile_was_read (hooks/lib/hook-common.sh):
# it anchors on a tool-input `file_path` FIELD, not a bare path substring, which
# keeps the producer set to actual file-open events (Read/Edit/Write all carry
# `file_path`). The rationale and the two accepted spellings live with the
# function; it is shared with memory-prompt-hint.sh so the deny gate and the
# hint cannot drift back to two answers (2026-08-29 audit R10-01, 2026-09-02
# audit R11-28).
# Fixtures: tests Cases 45-47 (real transcript line, hint banner, bare prose).
MISSING=()
for file in "${MATCHES[@]}"; do
  MEMFILE="$MEM_DIR/$file"
  if ! hook_memfile_was_read "$TRANSCRIPT" "$MEMFILE"; then
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
