#!/usr/bin/env bash
# rule-hits.sh — append-only JSONL log for §13.1 self-audit data.

# hook_encode_project RAW → stdout
#   Encode a path to Claude Code's ~/.claude/projects/<encoded>/ convention: CC
#   replaces EVERY non-`[a-zA-Z0-9-]` char with `-`. ARCH-1 (2026-07-12 audit):
#   the single source for what were 4 inlined `tr -c 'a-zA-Z0-9-' '-'` copies
#   (here + memory-prompt-hint / memory-read-check / banned-vocab-check). The
#   earlier `tr '/._'` form mis-encoded any path with another special char →
#   telemetry mis-attribution (feedback_cc_cwd_encoding_dots). Lives in this leaf
#   lib (sourced standalone by tests AND eagerly by hook-common.sh) so all
#   consumers share ONE definition — no `declare -F`-guarded inline fallback
#   (that silent-divergence anti-pattern is feedback_hook_platform_lib_source).
#
#   CHARACTER-wise, not byte-wise (2026-07-17 audit): CC's encoder is a Node
#   String.replace, so a CJK char yields ONE `-`. The previous `tr -c` was
#   byte-wise — `/home/项目x` became `-home-------x` (3 dashes per CJK char)
#   while scripts/lib/paths.js#encodeProjectCwd (and CC itself) produce
#   `-home---x` — the two sides of the language seam disagreed and every JS
#   auditor mis-located ~/.claude/projects/<encoded> for non-ASCII cwds.
#   Cross-language parity is now pinned by rule-hits.test.sh (CJK fixture).
#   The character class is spelled out (no `[a-z]` ranges): bash pattern ranges
#   collate per-locale and can swallow accented letters JS would map to `-`.
#   ${s:i:1} slicing needs a UTF-8 LC_CTYPE (CC always runs in one); under
#   LC_ALL=C it degrades to byte-wise — exactly the old tr behavior, never worse.
#   Non-BMP chars (emoji) remain a known residual: JS counts UTF-16 units (2
#   dashes), bash counts codepoints (1 dash). No real project path hits this.
hook_encode_project() {
  local s="${1:-}" out="" c i
  for (( i=0; i<${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-]) out+="$c" ;;
      *) out+="-" ;;
    esac
  done
  printf '%s' "$out"
}

# rule_hits_append HOOK EVENT EXTRA_JSON [SPEC_SECTION] [SESSION_ID] [TOOL_USE_ID]
#   HOOK        — hook name (banned-vocab, ship-baseline, ...)
#   EVENT       — see docs/RULE-HITS-SCHEMA.md "Events" table for the
#                 canonical list (kept in sync via tests/hooks/contract.test.sh).
#   EXTRA       — JSON value (object | null | string). "null" if none.
#   SECTION     — optional spec section identifier for §0.1/§13.1/§13.2
#                 promotion and demotion accounting. See docs/RULE-HITS-SCHEMA.md
#                 "Spec section taxonomy" table. Empty arg → null in JSONL row.
#                 Hooks that aren't enforcing a spec rule (session-start
#                 bootstrap, version-sync) leave it empty.
#   SESSION_ID  — optional Claude Code session identifier (extracted from
#                 stdin EVENT JSON `.session_id`). Empty arg → null in row.
#                 Added v0.9.33.
#   TOOL_USE_ID — optional per-invocation tool use ID (CC stdin `.tool_use_id`,
#                 format `toolu_[alnum]`). Empty arg → null in row. Only
#                 PreToolUse / PostToolUse events carry this; Stop /
#                 SessionStart / SessionEnd / UserPromptSubmit do not.
#                 Added v0.9.34 to enable audit `unique_invocations` dedup.
#                 Dedup key (extended v0.23.21) is (ts, hook, session_id,
#                 tool_use_id, event, extra): BYTE-IDENTICAL rows twice ⇒ true
#                 single-invocation double-fire (registration / lib bug);
#                 different tool_use_id at same ts ⇒ Claude fast-retry after
#                 deny, not a duplicate. NOTE multi-emit hooks (pre-bash-safety
#                 logs one row per matched pattern in a compound command)
#                 legitimately repeat (ts, hook, session_id, tool_use_id) with
#                 differing extra — the event+extra key keeps those distinct;
#                 a byte-identical residual can still come from one command
#                 repeating the same pattern, so confirm against the source
#                 command before calling a pre-bash-safety `_real` a bug.
# _rule_hits_json_escape STR — escape a string for a JSON string body.
# bash 3.2 safe (no ${var@Q}). Backslash MUST be escaped before quote, or the
# escapes this function itself inserts get double-escaped.
_rule_hits_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  # Control chars are illegal raw inside a JSON string and would also break the
  # one-row-per-line JSONL contract. Drop rather than \u-encode: every field
  # reaching here is a token, path, or UUID, never prose.
  printf '%s' "$s" | tr -d '\001-\037'
}

# _rule_hits_json_or_null STR — `null` when empty, else a quoted escaped string.
_rule_hits_json_or_null() {
  if [[ -z "$1" ]]; then printf 'null'; else printf '"%s"' "$(_rule_hits_json_escape "$1")"; fi
}

# _rule_hits_fallback_row TS HOOK EVENT PROJECT SESSION TOOLUSE SECTION HV EXTRA
#   jq-free row builder. Field order and null-vs-string posture mirror the jq
#   program below exactly; tests/hooks/fail-open.test.sh T12 parses this output
#   back with a real jq and asserts all 9 schema fields survive.
_rule_hits_fallback_row() {
  local extra="$9"
  # `extra` arrives as a JSON fragment. Under a broken jq the caller's own
  # jq-built payload may be empty, partial or multi-line, and pasting that in
  # would emit an unparseable row — worse than no telemetry, because the OLD
  # code's `jq -cn` simply failed and dropped the row, leaving the log valid.
  #
  # A newline is the load-bearing check: several callers build `extra` with
  # `jq -s .` (uncompacted, hence multi-line), and one embedded newline turns a
  # single row into several partial lines, breaking the one-object-per-line
  # contract this whole fallback exists to preserve. Brace/bracket balance at
  # the ends additionally rejects a truncated payload.
  #
  # This is a guard, not a validator: real JSON validation is not available on
  # a path defined by jq being unusable. It bounds the damage to "extra
  # degraded to null" (row survives) rather than "log corrupted".
  #
  # 2026-08-16 audit H-1: the first/last-char sniff alone accepted truncated
  # payloads with intact outer braces verbatim — six call sites wrap a
  # possibly-empty jq fragment in a literal brace pair, so a jq that works
  # once then fails yields exactly `{"matched":}` / `{"matched":[}`, and the
  # old guard appended an unparseable line. Two cheap structural checks close
  # those shapes: delimiter-count balance, and no dangling ':'/',' before the
  # closer. Both can only false-positive on delimiter-bearing STRING values
  # (e.g. {"note":"a["}), where the payload degrades to null — conservative
  # by design.
  if [[ "$extra" == *$'\n'* || "$extra" == *$'\r'* ]]; then
    extra=null
  else
    case "$extra" in
      null) : ;;
      '{'*'}'|'['*']')
        # Delimiter counts via length difference after deleting the target
        # char. NOT via `${var//[^X]/}` keep-only patterns: bash parses the
        # bracket expression `[^]]` as `[^]` + literal `]` (diverging from the
        # POSIX "]-first-is-literal" rule), which silently miscounts and
        # rejected every valid payload on this function's first cut.
        local _t _n1 _n2
        _t=${extra//\{/}; _n1=$(( ${#extra} - ${#_t} ))
        _t=${extra//\}/}; _n2=$(( ${#extra} - ${#_t} ))
        [[ "$_n1" -ne "$_n2" ]] && extra=null
        if [[ "$extra" != null ]]; then
          _t=${extra//\[/}; _n1=$(( ${#extra} - ${#_t} ))
          _t=${extra//\]/}; _n2=$(( ${#extra} - ${#_t} ))
          [[ "$_n1" -ne "$_n2" ]] && extra=null
        fi
        case "${extra: -2}" in
          ':}'|',}'|':]'|',]') extra=null ;;
        esac
        # Mid-payload dangling separator (2026-08-16 pre-tag review S1): an
        # empty jq fragment BETWEEN fields yields {"missing":,"n":2} — the
        # closer check alone misses it (this guard's own scope-narrower-than-
        # subject moment, caught before tag). memory-read-check.sh:260 is a
        # live producer of exactly that shape under a jq that fails mid-hook.
        # A string VALUE containing ':,' or ',,' degrades to null — same
        # conservative posture as the delimiter counts above.
        if [[ "$extra" == *':,'* || "$extra" == *',,'* ]]; then extra=null; fi
        ;;
      *) extra=null ;;
    esac
  fi
  printf '{"ts":"%s","hook":"%s","event":"%s","project":"%s","session_id":%s,"tool_use_id":%s,"spec_section":%s,"hook_version":%s,"extra":%s}' \
    "$(_rule_hits_json_escape "$1")" \
    "$(_rule_hits_json_escape "$2")" \
    "$(_rule_hits_json_escape "$3")" \
    "$(_rule_hits_json_escape "$4")" \
    "$(_rule_hits_json_or_null "$5")" \
    "$(_rule_hits_json_or_null "$6")" \
    "$(_rule_hits_json_or_null "$7")" \
    "$(_rule_hits_json_or_null "$8")" \
    "$extra"
}

rule_hits_append() {
  [[ "${DISABLE_RULE_HITS_LOG:-0}" == "1" ]] && return 0

  local hook="${1:-unknown}"
  local event="${2:-unknown}"
  local extra="${3:-null}"
  local section="${4:-}"
  local session_id="${5:-}"
  local tool_use_id="${6:-}"

  # Reserved test sentinel. `t` is the fixture session_id used across most of
  # the hook test suite. The suite sandboxes HOME so its writes are disposable,
  # but ad-hoc *manual* hook invocations in the real $HOME with a fixture event
  # were leaking these into production telemetry (309 rows / 11.5% of the log
  # as of the 2026-06-03 impact audit), inflating deny counts ~2x and obscuring
  # real signal. Real CC session_ids are UUIDs, never `t`; the few tests that
  # assert on log content use distinct ids (e.g. sess35, and the `test`
  # sentinel for transcript-*-scan) — so dropping `t` is invisible to every
  # real caller and every test.
  [[ "$session_id" == "t" ]] && return 0

  # Project: encode to match Claude Code's ~/.claude/projects/<encoded>/
  # convention via hook_encode_project above — CC replaces every
  # non-`[a-zA-Z0-9-]` char with `-`, CHARACTER-wise. (This said `tr -c` "is the
  # exact transform"; the 2026-07-17 audit disproved that and replaced it with
  # the per-character loop — `tr` is byte-wise and emits three dashes per CJK
  # character. Two copies of the false claim survived that fix; this is one of
  # them, 2026-08-29 audit R10-21c. The live rationale is in the function
  # header.) The earlier `tr '/._'`
  # only handled the three chars seen in this maintainer's cwds and mis-encoded
  # the project field for any path with another special char (telemetry then
  # attributed those rows to the wrong / a non-existent project). For `/._`-only
  # paths the forms are identical. See hooks/memory-read-check.sh for the
  # matching consumer + bug-history note. Empty string when neither var is set.
  local project_raw="${CLAUDE_PROJECT_DIR:-${PWD:-}}"
  local project=""
  [[ -n "$project_raw" ]] && project=$(hook_encode_project "$project_raw")

  local log_dir="$HOME/.claude/logs"
  local log_file="$log_dir/claudemd.jsonl"
  mkdir -p "$log_dir" 2>/dev/null || return 0

  # Size-capped rotation. Over CLAUDEMD_LOG_MAX_MB (default 5) → rotate to
  # .1, pushing any existing .1 to .2 (drop .2). Two rotations retained =
  # one headroom between rotate and next overflow, bounded growth at
  # ~3× max_mb on disk. `/claudemd-audit` currently reads only the primary
  # file, so rotations beyond .1 are effectively archived (read-only).
  # `stat -c` is GNU, `-f` is BSD — try both, default to 0 if neither works
  # (fail-safe: no rotation better than wrong rotation on an unknown stat).
  # Concurrency (corrected 2026-08-16 audit CONC-4; the previous "at worst
  # one log line is lost" claim was FALSE): two processes can both pass the
  # size check, then interleave the two mv steps — P1 rotates live→.1, and
  # P2's `mv .1 .2` then moves that JUST-ROTATED live generation onto .2,
  # wiping the archive P1 made. Sandbox replay: {live, .1, .2} degraded to
  # {gone, gone, live-as-.2} — BOTH prior generations lost (up to ~2×max_mb
  # of archive), though live rows survive under the .2 name. Accepted:
  # archives are best-effort cold storage no consumer reads (audit reads the
  # primary only), the window is one mv wide, and flock would add a
  # dependency on this fail-open path. Do NOT cite this comment as "the race
  # is bounded to a line" — it is bounded to the ARCHIVES.
  local max_mb="${CLAUDEMD_LOG_MAX_MB:-5}"
  # Numeric-guard: a non-integer env value (user typo) would make
  # `$((max_mb * ...))` an unbound-variable crash under `set -u`, and because
  # this runs before the JSONL write, the telemetry row would be silently lost.
  [[ "$max_mb" =~ ^[0-9]+$ ]] || max_mb=5
  local max_bytes=$((max_mb * 1024 * 1024))
  if [[ -f "$log_file" ]]; then
    local size
    size=$(stat -c %s "$log_file" 2>/dev/null || stat -f %z "$log_file" 2>/dev/null || echo 0)
    if (( size > max_bytes )); then
      [[ -f "$log_file.1" ]] && mv -f "$log_file.1" "$log_file.2" 2>/dev/null
      mv -f "$log_file" "$log_file.1" 2>/dev/null
    fi
  fi

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # hook_version (ARCH-3, 2026-07-25 audit): stamp every row with the emitting
  # build's version so rows written by a STALE registered hook dir (other live
  # CC windows keep old hooks until restart — 242 stale-root events across 12
  # version gaps in the live log) are stratifiable by consumers instead of
  # pooling into calibration windows. Cached per process; empty → null field
  # (fail-open, matches session_id posture). Version source = plugin root
  # package.json, two levels up from this lib file.
  if [[ -z "${RULE_HITS_HOOK_VERSION+x}" ]]; then
    local _pkg
    _pkg="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)/package.json"
    RULE_HITS_HOOK_VERSION=$(jq -r '.version // empty' "$_pkg" 2>/dev/null) || RULE_HITS_HOOK_VERSION=""
    # sed fallback: without it a jq-less/broken environment loses the version
    # stamp on exactly the rows that diagnose that environment. The stamp is
    # what lets consumers stratify rows written by a stale hook dir.
    if [[ -z "$RULE_HITS_HOOK_VERSION" ]]; then
      RULE_HITS_HOOK_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$_pkg" 2>/dev/null | head -1)
    fi
  fi

  # Primary builder is jq; `_rule_hits_fallback_row` covers the case jq cannot.
  # Build into a variable first — the previous form redirected jq straight at
  # the log, so a jq that failed mid-write could leave a torn line in a file
  # whose whole contract is one valid JSON object per line.
  local row=""
  row=$(jq -cn \
    --arg ts "$ts" \
    --arg hook "$hook" \
    --arg event "$event" \
    --arg project "$project" \
    --arg session_id "$session_id" \
    --arg tool_use_id "$tool_use_id" \
    --arg section "$section" \
    --arg hv "${RULE_HITS_HOOK_VERSION:-}" \
    --argjson extra "$extra" \
    '{ts: $ts, hook: $hook, event: $event, project: $project,
      session_id: (if $session_id == "" then null else $session_id end),
      tool_use_id: (if $tool_use_id == "" then null else $tool_use_id end),
      spec_section: (if $section == "" then null else $section end),
      hook_version: (if $hv == "" then null else $hv end),
      extra: $extra}' 2>/dev/null) || row=""

  if [[ -z "$row" ]]; then
    row=$(_rule_hits_fallback_row "$ts" "$hook" "$event" "$project" \
      "$session_id" "$tool_use_id" "$section" "${RULE_HITS_HOOK_VERSION:-}" "$extra")
  fi

  [[ -n "$row" ]] && printf '%s\n' "$row" >> "$log_file"
  return 0
}
