#!/usr/bin/env bash
# banned-vocab-check.sh — PreToolUse:Bash hook.
# Denies git-commit commands whose message matches patterns in banned-vocab.patterns.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch BANNED_VOCAB || exit 0
if ! hook_require_jq; then
  hook_record_failopen banned-vocab jq-missing
  exit 0
fi

EVENT=$(hook_read_event)
if [[ -z "$EVENT" ]]; then
  hook_record_failopen banned-vocab bad-event
  exit 0
fi

TOOL=$(hook_jq_field banned-vocab "$EVENT" '.tool_name // ""') || exit 0
[[ "$TOOL" == "Bash" ]] || exit 0

CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0

# R-N5 readonly fast-path. **v0.20.0 default-ON** (§13.3 promotion from
# v0.8.3 opt-in default-OFF). When CMD is a definitely-read-only shape
# (ls / cat / git log / etc., no shell-meta), exit before the per-pattern
# scan loop. Free in this hook (filter on next line is also fast), but
# uniform across all 4 PreToolUse:Bash hooks for cumulative latency.
# Opt-out: BASH_READONLY_FAST_PATH=0.
if [[ "${BASH_READONLY_FAST_PATH:-1}" != "0" ]] && hook_is_readonly_bash "$CMD"; then
  exit 0
fi

# Telemetry fields, extracted AFTER the fast-path because nothing above needs
# them. They sat above it from v0.8.3 until audit-2026-08-22 条目 12, so every
# read-only Bash call — the shape the fast-path exists to make cheap — paid
# three jq spawns to fill variables it then discarded at the exit two lines
# later. The exit is the point of the fast-path; work in front of it is work
# the fast-path cannot skip. memory-read-check.sh has always had this order;
# these three did not, and the asymmetry was invisible because every hook's
# own suite drove it past the fast-path with a non-read-only command.
#
# Gate: tests/hooks/preToolUse-fastpath-order.test.sh derives this set from
# source and fails any jq extraction that moves back above the exit.
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)
EVENT_CWD=$(printf '%s' "$EVENT" | jq -r '.cwd // ""' 2>/dev/null)

# Filter: must be a git commit invocation. `\s` / `\S` aren't portable under
# BSD grep (macOS); use POSIX character classes so behavior matches Linux.
#
# Flatten CMD before regex match so heredoc bodies and other line-2+ content
# can't masquerade as line-start. Per-line `grep -qE` would otherwise see
# each heredoc body line's bare `git commit -m "..."` as `^`-anchored.
# Segment-anchor: require `^` (real start, post-flatten) OR a real shell
# separator (`[[:space:]]*[;&|]+[[:space:]]*`). The looser `[[:space:];&|]`
# allows ANY whitespace (including space after `#` in
# `ls # git commit -m "msg"`) — produced FPs on comments and heredoc bodies
# whose `git commit` substring was treated as a real invocation. Mirrors the
# memory-read-check.sh v0.9.28 segment-anchor fix and the v0.17.4
# ship-baseline-check.sh sibling.
#
# 2026-07-27 audit (H1): that "mirrors" claim was false for two years of the
# file's life — the siblings moved to the shared strip+flatten in v0.58.0 and
# this line stayed on `tr '\n' ' '`. A newline became a SPACE, so `git commit`
# on line 2+ of an ordinary multi-line block sat at neither `^` nor `[;&|]` and
# the whole gate exited at the trigger check. Now on the shared recipe, which
# also empties quoted bodies. Path 1 below extracts the message from the RAW
# $CMD, so the commit-message scan is unaffected by that strip.
CMD_FLAT=$(printf '%s' "$CMD" | hook_trigger_view)

# Two orthogonal triggers:
#   GIT_COMMIT_RE (Path 1, existing): scans the commit-message body for any
#     §10-V pattern. Narrow to `git commit` only — extending Path 1 to other
#     ship verbs is FP-heavy because their fallback path scans the whole CMD
#     and would catch banned words in branch names / file paths / etc.
#   SHIP_VERB_RE (Path 2, v0.21.0): scans the PRIOR assistant turn's chat
#     prose for high-fire §10-V patterns on broader ship-flow verbs. The
#     transcript is the input, not CMD, so branch-name / path FPs don't apply.
GIT_COMMIT_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'
SHIP_VERB_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)(git[[:space:]]+(commit|push)|gh[[:space:]]+(release|pr)[[:space:]]+create|npm[[:space:]]+publish|cargo[[:space:]]+publish)([[:space:]]|$)'

IS_GIT_COMMIT=0
IS_SHIP_VERB=0
echo "$CMD_FLAT" | grep -qE "$GIT_COMMIT_RE" && IS_GIT_COMMIT=1
echo "$CMD_FLAT" | grep -qE "$SHIP_VERB_RE" && IS_SHIP_VERB=1
(( IS_GIT_COMMIT == 0 && IS_SHIP_VERB == 0 )) && exit 0


# Per-invocation escape hatch.
#
# v0.57.0 — the token no longer short-circuits before the scan. Pre-fix the row
# carried only `{"token":"allow-banned-vocab"}`, so the question the §13.2
# demote review has to answer — WHICH term does the operator keep overriding —
# had no data behind it (deny rows carry `matched`, bypass rows did not; 30d:
# 15 denies vs 16 bypasses, join impossible). The scan now runs first and the
# bypass row is emitted AT the hit, carrying the same `matched` array.
#
# Measurement-semantics change (deliberate): a token on a command that would
# have passed anyway now records NOTHING, where it previously recorded a bypass.
# Prophylactic tokens were inflating the override rate — post-fix the count is
# overrides only. Series before/after 0.57.0 are not comparable.
BYPASS_VOCAB=0
if echo "$CMD" | grep -qF '[allow-banned-vocab]'; then
  BYPASS_VOCAB=1
fi

PATTERNS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/banned-vocab.patterns"
if [[ ! -r "$PATTERNS_FILE" ]]; then
  hook_record_failopen banned-vocab patterns-missing
  exit 0
fi

# Path 1 (commit-msg scan) gated on git-commit trigger only. Non-commit ship
# verbs (push / pr-create / release / publish) skip Path 1 and go straight
# to Path 2 prose scan. Pre-v0.21.0 Path 1 fallback scanned the whole CMD
# when no -m extracted; broadening the trigger naïvely would FP on branch
# names / path args. Path 1 logic body unchanged inside the gate.
if (( IS_GIT_COMMIT == 1 )); then

# Extract commit-message bodies (-m / --message) from CMD. §10-V is about the
# commit message, not the whole invocation — scanning `git -c core.editor=...
# commit -m "fix"` across all tokens used to flag unrelated config text.
# Supported forms: `-m "..."`, `-m '...'`, `--message="..."`, `--message='...'`,
# `--message "..."`, `--message '...'`, AND combined short-flag blocks ending in
# `m` (`-am`, `-vam`, `-Sam` — `git commit -am "…"` is one of the most common
# forms). `-[[:alpha:]]*m` matches the whole block; a bare `-m` still matches
# with zero leading alphas, so this is a strict superset of the prior `-m`-only
# regex. Without it, `-am` fell through to the whole-CMD fallback, so a banned
# word in a CHAINED segment (`git commit -am "fix" && npm run comprehensive-x`)
# denied a clean-message commit that the identical `-m` form would have passed.
# BSD-safe: uses octal \047 for single quote inside regex (some macOS seds/greps
# don't understand \x27).
SQ=$'\047'
MSG_REGEX="-[[:alpha:]]*m[[:space:]]+\"[^\"]*\"|-[[:alpha:]]*m[[:space:]]+${SQ}[^${SQ}]*${SQ}|--message=\"[^\"]*\"|--message=${SQ}[^${SQ}]*${SQ}|--message[[:space:]]+\"[^\"]*\"|--message[[:space:]]+${SQ}[^${SQ}]*${SQ}"
MSG_TEXT=""
while IFS= read -r match; do
  body=$(printf '%s' "$match" | sed -E "s/^(-[[:alpha:]]*m|--message([= ]))[\"${SQ}]?//; s/[\"${SQ}]\$//")
  [[ -n "$body" ]] && MSG_TEXT+="$body"$'\n'
done < <(printf '%s' "$CMD" | grep -oE -- "$MSG_REGEX" 2>/dev/null)

# Fallback — no -m/--message captured (editor commits, `-F file`, amend with
# no-edit, unusual quoting). Scan the whole CMD to preserve §10-V coverage.
# Trade-off: banned words in unrelated argv tokens (filenames, `-c
# user.email=...`, env vars) can cause false positives in this branch — the
# `[allow-banned-vocab]` escape hatch is the documented workaround.
[[ -z "$MSG_TEXT" ]] && MSG_TEXT="$CMD"

# Baseline-context exemption: if the commit message carries an explicit
# before-after anchor (number on both sides of →/->/=>) OR the literal word
# `baseline`, ratio-class patterns (tagged `@ratio` in their reason column)
# are suppressed. Non-ratio hedges/adjectives still deny regardless.
# Aligns with spec §10 "ratio with baseline" permission.
BASELINE_EXEMPT=0
if echo "$MSG_TEXT" | grep -qE '[0-9][^[:space:]]*[[:space:]]*(→|->|=>)[[:space:]]*[0-9]'; then
  BASELINE_EXEMPT=1
elif echo "$MSG_TEXT" | grep -qiE 'baseline'; then
  BASELINE_EXEMPT=1
fi

# Collect hits
declare -a HITS=()
declare -a REASONS=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  local_regex="${line%|*}"
  local_reason="${line##*|}"
  is_ratio=0
  if [[ "$local_reason" == "@ratio "* ]]; then
    is_ratio=1
    local_reason="${local_reason#@ratio }"
  fi
  if echo "$MSG_TEXT" | grep -qiE "$local_regex"; then
    if (( is_ratio == 1 && BASELINE_EXEMPT == 1 )); then
      continue
    fi
    match=$(echo "$MSG_TEXT" | grep -oiE "$local_regex" | head -n1)
    HITS+=("$match")
    REASONS+=("$local_reason")
  fi
done < "$PATTERNS_FILE"

if (( ${#HITS[@]} != 0 )); then
  # Path 1 (existing): commit-message banned vocab found. Deny.
  REASON_TEXT="§10-V Specificity: banned terms detected:"
  for i in "${!HITS[@]}"; do
    REASON_TEXT+=$'\n'"  - ${HITS[$i]}  (${REASONS[$i]})"
  done
  REASON_TEXT+=$'\n\n'"Bypass options:
  (a) Rewrite with absolute numbers (preferred).
  (b) Per-commit escape: include [allow-banned-vocab] in the commit message.
  (c) Disable the hook: DISABLE_BANNED_VOCAB_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §10 Honesty rules — Specificity (HARD)."

  HITS_JSON=$(printf '%s\n' "${HITS[@]}" | jq -R . | jq -s .)
  if (( BYPASS_VOCAB == 1 )); then
    hook_record banned-vocab bypass-escape-hatch \
      "{\"token\":\"allow-banned-vocab\",\"matched\":$HITS_JSON,\"path\":\"commit-msg\"}" \
      '§10-V' "$SESSION_ID" "$TOOL_USE_ID"
    exit 0
  fi
  hook_record banned-vocab deny "{\"matched\":$HITS_JSON}" '§10-V' "$SESSION_ID" "$TOOL_USE_ID"
  hook_deny banned-vocab "$REASON_TEXT"
fi
fi  # end IS_GIT_COMMIT block

# ============================================================================
# Path 2 (v0.21.0): ship-verb prose scan.
# ============================================================================
# When CMD is a ship-flow verb (commit / push / pr create / release create /
# publish) AND the previous assistant turn's chat prose contains a high-fire
# §10-V pattern, deny. Per §13.3 Gate 2 promotion data (sampling-audit
# cross-project ≥5, default-ON ≥30d, ≥1 load-bearing feedback memory).
#
# Mechanism: chat prose has no PreToolUse surface of its own — it's emitted
# during assistant turns. The only blocking surface is "next ship-flow tool
# call", giving the rule a chance to surface BEFORE a release artifact lands
# with the vague claim still in the chain of trust.
#
# Opt-out: BANNED_VOCAB_PROSE_SCAN=0 disables only this Path 2 branch (Path 1
# commit-message scan remains active).
#
# Scope: scans ONLY the high-fire region of banned-vocab.patterns (markers
# `# region: high-fire` ... `# region: prophylactic` bound the subset).
# Prophylactic patterns kept advisory-only via transcript-vocab-scan.sh.
[[ "${BANNED_VOCAB_PROSE_SCAN:-1}" == "0" ]] && exit 0

# Filter: IS_SHIP_VERB was computed at top — covers commit + push + pr create
# + release create + npm/cargo publish.
(( IS_SHIP_VERB == 1 )) || exit 0

# Locate transcript via CC's cwd→encoded-dir convention (per memory
# feedback_cc_cwd_encoding_dots.md: every non-`[a-zA-Z0-9-]` char → `-`).
[[ -n "$EVENT_CWD" && -n "$SESSION_ID" ]] || exit 0
ENCODED=$(hook_encode_project "$EVENT_CWD")
TRANSCRIPT="$HOME/.claude/projects/${ENCODED}/${SESSION_ID}.jsonl"
[[ -f "$TRANSCRIPT" ]] || exit 0

# Extract the LAST assistant turn's text: assistant entries AFTER the last
# real typed user prompt. Real prompt = type=="user" with STRING content
# (typed prompts are strings; tool_results arrive as user entries with ARRAY
# content and are mid-turn, NOT turn boundaries — per
# feedback_cc_user_content_string_vs_array), excluding isMeta /
# <system-reminder> injections. Pre-v0.23.19 this concatenated ALL assistant
# text in the tail window, so a slip in an EARLIER turn kept denying every
# ship attempt even after the user intervened and the agent re-calibrated —
# un-escapable without the bypass token (field report: 3 consecutive push
# denies, claudemd.txt 2026-06-12). No real prompt in the tail window →
# max // -1 → slice from 0 = pre-fix whole-window behavior. tail -n 200
# caps memory.
#
# 2026-07-27 audit (H2): the boundary test is now the shared `is_user_turn`
# (HOOK_USER_TURN_JQ, hook-common.sh), not a local spelling. The local one
# accepted STRING content only, so a prompt carrying an attachment — array
# content with a text block — was not a boundary here while its two sibling
# engines treated it as one. Consequence was the pre-v0.23.19 shape returning
# through a different door: the user intervenes with a screenshot attached, the
# agent recalibrates, and this scan still reads the pre-intervention prose and
# denies every ship attempt.
LAST_TEXT=$(tail -n 200 "$TRANSCRIPT" 2>/dev/null \
  | jq -R -r -n "$HOOK_USER_TURN_JQ"'
      [inputs | try fromjson catch empty] as $e
      | ([ $e | to_entries[]
           | select(.value | is_user_turn)
           | .key ] | max // -1) as $u
      | [ $e[($u + 1):][]
          | select(.type == "assistant")
          | (.message.content // [])
          | map(select(type == "object" and .type == "text") | .text)
          | join("\n") ]
      | join("\n")' 2>/dev/null)
[[ -n "$LAST_TEXT" ]] || exit 0

# Cap to the trailing 4096 chars (very long turns; most recent prose wins).
LAST_TEXT=$(printf '%s' "$LAST_TEXT" | tail -c 4096)

# v0.23.19 — identifier/path mentions are not value claims. `\b` treats '-'
# and '/' as word boundaries, so a branch name like
# docs/comprehensive-audit-2026-06-12 quoted in prose fires \bcomprehensive\b
# (the field-report deny loop: renaming the branch could not clear the prior
# prose, so every retry denied). Strip, in order: fenced code blocks, inline
# backtick spans, path-like ASCII runs containing '/' (branch names, file
# paths, URLs), then bare `name.ext` files (lowercase extension only, so
# decimals/versions like "3.5x"/"v6.14" survive). The path classes are
# ASCII-only on purpose — 中文 prose around a path stays intact, and
# bare-prose violations still match. Keep the clause list identical to
# transcript-vocab-scan.sh + lib/lint.js#stripIdentifiers —
# tests/scripts/sanitize-stage-parity.test.js extracts and runs this program.
LAST_TEXT=$(printf '%s\n' "$LAST_TEXT" \
  | awk '/^[[:space:]]*```/{f=!f; next} !f' \
  | sed -E 's/`[^`]*`/ /g; s|[A-Za-z0-9._@~-]*/[A-Za-z0-9._/@~-]*| |g; s/[A-Za-z0-9_-]+\.[a-z][a-z0-9]*/ /g')

# Scan high-fire region of PATTERNS_FILE only. Stop at prophylactic marker.
#
# Region markers are anchored on the trailing `(` because the file's docstring
# ALSO mentions "region: high-fire" and "region: prophylactic" as prose
# (indented, no trailing paren). The actual region headers immediately after
# the `# ===` ruler look like:
#   # region: high-fire (last audit window)
#   # region: prophylactic (kept for §10-V coverage; 0 hits in last audit window)
# The `\(` anchor is the differentiator that prevents the docstring lines from
# tripping the markers. Pre-fix the regex matched the docstring's
# `#   region: high-fire     ≥1 deny in the most recent 30d audit window.`,
# setting in_high_fire=1 too early, then `#   region: prophylactic  0 hits ...`
# broke the loop BEFORE any actual pattern was reached — Path 2 silently
# scanned 0 patterns, all expected denies returned no hits.
declare -a PROSE_HITS=()
declare -a PROSE_REASONS=()
in_high_fire=0
while IFS= read -r line; do
  # Region boundary — stop reading
  if [[ "$line" =~ ^#[[:space:]]region:[[:space:]]prophylactic[[:space:]]*\( ]]; then
    break
  fi
  # Region boundary — start reading
  if [[ "$line" =~ ^#[[:space:]]region:[[:space:]]high-fire[[:space:]]*\( ]]; then
    in_high_fire=1
    continue
  fi
  (( in_high_fire == 0 )) && continue
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  local_regex="${line%|*}"
  local_reason="${line##*|}"
  # @ratio patterns in prose are LEGIT when baseline-anchored — skip them
  # in prose scan (chat prose has different conventions than commit msgs;
  # the baseline-context exemption in Path 1 doesn't transfer cleanly).
  [[ "$local_reason" == "@ratio "* ]] && continue
  if echo "$LAST_TEXT" | grep -qiE "$local_regex"; then
    match=$(echo "$LAST_TEXT" | grep -oiE "$local_regex" | head -n1)
    PROSE_HITS+=("$match")
    PROSE_REASONS+=("$local_reason")
  fi
done < "$PATTERNS_FILE"

(( ${#PROSE_HITS[@]} == 0 )) && exit 0

# v0.21.1 — observability before enforcement. When CLAUDEMD_PATH2_DRY_RUN=1,
# log a `deny-prose-dry-run` event with the matched hits but allow the command
# through. Operators staging Path 2 rollout (or auditing FP rate after a
# pattern-set edit) can grep ~/.claude/logs/claudemd.jsonl for the dry-run
# rows to measure true-positive vs false-positive density without blocking
# real ship flows. Default 0 (live enforcement).
if [[ "${CLAUDEMD_PATH2_DRY_RUN:-0}" == "1" ]]; then
  PROSE_HITS_JSON=$(printf '%s\n' "${PROSE_HITS[@]}" | jq -R . | jq -s .)
  hook_record banned-vocab deny-prose-dry-run "{\"matched\":$PROSE_HITS_JSON}" '§10-V' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi

REASON_TEXT="§10-V prose scan (v0.21.0): ship-flow command blocked because the preceding assistant turn contains §10-V high-fire banned vocab:"
for i in "${!PROSE_HITS[@]}"; do
  REASON_TEXT+=$'\n'"  - \"${PROSE_HITS[$i]}\"  (${PROSE_REASONS[$i]})"
done
REASON_TEXT+=$'\n\n'"Why this fires: §10-V (Specificity HARD) bans vague-positive vocab in agent prose, not just commit messages. Ship-flow verbs (commit/push/pr-create/release-create/publish) are the highest-stakes moments — the preceding analysis turn should already be calibrated with numbers + baselines.

Bypass options:
  (a) Add [allow-banned-vocab] to the current command (acknowledges the slip).
  (b) Per-flag opt-out: BANNED_VOCAB_PROSE_SCAN=0 (keeps Path 1 commit-msg scan active).
  (c) Disable the whole hook: DISABLE_BANNED_VOCAB_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §10 — Specificity (HARD)."

PROSE_HITS_JSON=$(printf '%s\n' "${PROSE_HITS[@]}" | jq -R . | jq -s .)
if (( BYPASS_VOCAB == 1 )); then
  hook_record banned-vocab bypass-escape-hatch \
    "{\"token\":\"allow-banned-vocab\",\"matched\":$PROSE_HITS_JSON,\"path\":\"prose\"}" \
    '§10-V' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi
hook_record banned-vocab deny-prose "{\"matched\":$PROSE_HITS_JSON}" '§10-V' "$SESSION_ID" "$TOOL_USE_ID"
hook_deny banned-vocab "$REASON_TEXT"
