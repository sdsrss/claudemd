#!/usr/bin/env bash
# transcript-structure-scan.sh — Stop hook (advisory only, opt-in default OFF).
#
# v0.9.10 — agent self-rule observation mirror for §iron-law-2 (no Done without
# fresh evidence), §10-four-section-order (Done → Not done → Failed → Uncertain),
# §10-honesty (Uncertain stated as "uncertain because <X>"). Closes the audit
# observation that ~7 self-enforced HARD rules in spec/hard-rules.json had no
# hook-side feedback signal — only banned-vocab (§10-V) was observed via
# transcript-vocab-scan. Companion to that hook (PostToolUse, every tool call);
# this is Stop (once per session end), so heavier checks are affordable.
#
# Detections (FP-tightened so single-section quotations don't trigger):
#   1. four-section-order — only fires when ALL 4 of (Done:, Not done:,
#      Failed:, Uncertain:) appear line-anchored within a 50-line window. If
#      found, must be in spec order (Done<Not done<Failed<Uncertain). Single
#      Done: blocks (L1 short-form per spec §10) never trigger this check.
#   2. iron-law-2-anchor — within a four-section block, each `Done:` line and
#      the next two lines must contain at least one evidence fingerprint:
#      file:line citation (`\.[a-z]+:[0-9]+`), test result token
#      (`\b(passed|failed|tests)\b`), baseline arrow
#      (`[0-9].*(→|->|=>).*[0-9]`), `Checked:` reference, `baseline` literal,
#      or `known-red` literal. Done: (none) / Done: (无) / Done:$ → skipped
#      (legitimate L3 zero-issue or empty).
#   3. uncertain-hedge — `^Uncertain:` lines that are <80 chars total AND
#      don't contain `because`|`since`|`reason:`|`因为` AND don't end with
#      `(none)`|`(无)`|`none`|`N/A`|`-` → flag.
#
# All advisory (Stop event cannot block). Records to rule-hits log via new
# event `structure-advisory`; one row per distinct §-section detected.
# Stderr banner mirrors transcript-vocab-scan format.
#
# Spec sections used (drives /claudemd-audit byEnforcement counters):
#   §iron-law-2              — Iron Law #2 (no Done without fresh evidence)
#   §10-four-section-order   — REPORT order Done → Not done → Failed → Uncertain
#   §10-honesty              — Uncertain stated as "uncertain because <X>"
#
# Opt-in: TRANSCRIPT_STRUCTURE_SCAN=1 (default OFF). Same precedent as
# transcript-vocab-scan / pre-bash-safety BASH_SAFETY_INDIRECT_CALL — behavior-
# layer hooks ship default-off for ≥30 days FP signal collection.
#
# Kill-switches:
#   DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1                 — global

set -uo pipefail

# Opt-in gate (default OFF). Check BEFORE sourcing hook-common to keep the
# default-OFF path cheap (no jq probe, no event read).
[[ "${TRANSCRIPT_STRUCTURE_SCAN:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch TRANSCRIPT_STRUCTURE_SCAN || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TRANSCRIPT_PATH=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
[[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)

# Read the LAST assistant turn from the transcript jsonl. Bound to last 200
# lines; mirror transcript-vocab-scan.sh parsing (try fromjson catch empty).
# join("\n") here (not " ") because we need line anchors for ^Done: etc.
#
# Pre-v0.23.11 BUG: this lacked any last-turn selection — the per-row jq output
# of EVERY assistant turn was concatenated by command substitution, so the awk
# below line-numbered the whole multi-turn document as one turn. Four-section
# labels scattered across different turns synthesized phantom blocks, and stale
# reports from earlier in the session were re-flagged as "last turn" drift on
# every Stop. Fix: slurp into an array, take the LAST non-empty-text assistant
# turn (mirrors transcript-vocab-scan.sh's `awk 'NF' | tail -n 1`, but preserves
# the multi-line structure within that one turn). Two-stage jq is BSD-portable
# (no GNU `tail -z`).
LAST_TEXT=$(tail -n 200 "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -R 'try fromjson catch empty' 2>/dev/null \
  | jq -s -r 'map(select(.type == "assistant")
                  | (.message.content // [])
                  | map(select(.type == "text") | .text)
                  | join("\n"))
              | map(select(. != ""))
              | last // ""' 2>/dev/null)
[[ -n "$LAST_TEXT" ]] || exit 0

declare -a HITS=()

# --- Locate the four section labels --------------------------------------
# Single awk pass captures FIRST occurrence of each label. NR is line number.
# v0.9.11: matches both spec-canonical line-anchored form (`^Done:`) AND the
# markdown-header form (`## Done — ...`, `## Done`, `## Done:`) widely used
# in real reports per memory feedback_done_section_chinese_prose. Strip a
# leading `## ` first, then test for `^<label>` followed by colon, em-dash
# (with surrounding space), trailing whitespace + EOL, or end-of-line.
# `## Done with the analysis` (narrative continuation) does NOT match
# because the next non-space char must be `:`, `—`, or EOL.
# Output: "DONE_LN NOTDONE_LN FAILED_LN UNCERTAIN_LN" (0 = absent).
read -r done_ln notdone_ln failed_ln uncertain_ln <<< "$(
  printf '%s\n' "$LAST_TEXT" | awk '
    {
      l = $0
      sub(/^##[[:space:]]+/, "", l)
    }
    l ~ /^Done([[:space:]]+—|:|[[:space:]]*$)/      { if (!d) d = NR }
    l ~ /^Not done([[:space:]]+—|:|[[:space:]]*$)/  { if (!nd) nd = NR }
    l ~ /^Failed([[:space:]]+—|:|[[:space:]]*$)/    { if (!f) f = NR }
    l ~ /^Uncertain([[:space:]]+—|:|[[:space:]]*$)/ { if (!u) u = NR }
    END { print (d+0)" "(nd+0)" "(f+0)" "(u+0) }
  '
)"

# --- Detection 1: four-section-order -----------------------------------------
# Only fire when ALL 4 present within a 50-line window. Single-section
# narrative ("Done — v0.9.6 ship 完成") never triggers because it lacks the
# other three labels.
if (( done_ln > 0 && notdone_ln > 0 && failed_ln > 0 && uncertain_ln > 0 )); then
  max_ln=$(printf '%s\n' "$done_ln" "$notdone_ln" "$failed_ln" "$uncertain_ln" \
    | sort -n | tail -1)
  min_ln=$(printf '%s\n' "$done_ln" "$notdone_ln" "$failed_ln" "$uncertain_ln" \
    | sort -n | head -1)
  span=$((max_ln - min_ln))
  if (( span <= 50 )); then
    # Spec order: Done < Not done < Failed < Uncertain
    if (( done_ln >= notdone_ln || notdone_ln >= failed_ln || failed_ln >= uncertain_ln )); then
      HITS+=("§10-four-section-order|order violation: Done@L$done_ln, Not done@L$notdone_ln, Failed@L$failed_ln, Uncertain@L$uncertain_ln (spec: Done<Not done<Failed<Uncertain)")
    fi

    # --- Detection 2: iron-law-2-anchor (only inside this four-section block)
    # Iterate Done: line(s) inside [min_ln, max_ln]; for each, the evidence
    # window is `[ln, min(ln+14, next_label_line - 1)]`. v0.9.11 widened
    # from a fixed 3-line window because markdown-header reports
    # (## Done — ...) commonly have a blank line + intro + bullet/table
    # block. The cap-at-next-label avoids bleeding evidence keywords from
    # the Not done / Failed / Uncertain sections into Done's accounting
    # (e.g. "untested" in Uncertain matching `\btest\b`).
    while IFS= read -r ln_str; do
      [[ -z "$ln_str" ]] && continue
      ln=$ln_str
      (( ln >= min_ln && ln <= max_ln )) || continue
      # Find smallest label position > ln (the section after this Done block).
      next_label=999999
      for cand in $notdone_ln $failed_ln $uncertain_ln; do
        if (( cand > ln && cand < next_label )); then
          next_label=$cand
        fi
      done
      upper=$((ln + 14))
      (( next_label - 1 < upper )) && upper=$((next_label - 1))
      (( upper < ln )) && upper=$ln
      block=$(printf '%s\n' "$LAST_TEXT" | sed -n "${ln},${upper}p")
      # Evidence fingerprints (any one suffices). Tight set — `\b(passed|
      # failed|tests)\b` is word-bounded so "untested" / "testing" don't
      # match. `证据[:：]` requires the section-header form (Chinese colon
      # included) so prose mentions of "证据" don't trip.
      if printf '%s' "$block" | grep -qE '\.[a-zA-Z]+:[0-9]+|\b(passed|failed|tests)\b|[0-9]+[^[:space:]]*[[:space:]]*(→|->|=>)[[:space:]]*[0-9]+|Checked:|baseline|known-red|证据[:：]' >/dev/null 2>&1; then
        continue
      fi
      # L3 zero-issue / empty Done: → skip. The skip applies only to the
      # canonical inline form `Done: (none)` / `Done: ` (empty body); the
      # markdown-header form `## Done` carries its body on subsequent lines
      # and must NOT short-circuit here — the evidence-window check above
      # already inspects those lines.
      first_line=$(printf '%s\n' "$LAST_TEXT" | sed -n "${ln}p")
      echo "$first_line" | grep -qE '^Done:[[:space:]]*(\(none\)|\(无\)|none|N/A|-+)?[[:space:]]*$' && continue
      # Otherwise: missing evidence anchor.
      excerpt=$(printf '%s' "$first_line" | head -c 80 | tr -d '\n')
      window_size=$((upper - ln + 1))
      HITS+=("§iron-law-2|Done@L$ln lacks evidence fingerprint in next $window_size lines: \"$excerpt\"")
    done < <(printf '%s\n' "$LAST_TEXT" | awk '
      {
        l = $0
        sub(/^##[[:space:]]+/, "", l)
      }
      l ~ /^Done([[:space:]]+—|:|[[:space:]]*$)/ { print NR }
    ')
  fi
fi

# --- Detection 3: uncertain-hedge -------------------------------------------
# `^Uncertain:` or `^## Uncertain` lines, <80 chars, no "because"/"since"/
# "reason:"/"因为", not "(none)"/"(无)"/"none"/"N/A"/"-". Independent of
# four-section context — a bare hedged Uncertain in any report is honesty drift.
# v0.9.11: also matches `## Uncertain` markdown-header form. Markdown headers
# alone (no rationale on same line, content follows) are skipped because
# rationale typically lives on the NEXT line; the test is for short standalone
# `Uncertain:` lines that ALSO carry the (presumably hedged) reason inline.
while IFS= read -r ln_str; do
  [[ -z "$ln_str" ]] && continue
  ln=$ln_str
  line=$(printf '%s\n' "$LAST_TEXT" | sed -n "${ln}p")
  norm=$(printf '%s' "$line" | sed -E 's/^##[[:space:]]+//')
  len=${#norm}
  (( len < 80 )) || continue
  # Markdown header alone (`## Uncertain` w/ no inline content) → skip;
  # the rationale typically lives on a following line, not the header itself.
  echo "$line" | grep -qE '^##[[:space:]]+Uncertain[[:space:]]*$' && continue
  # Empty / explicit-none → skip.
  echo "$norm" | grep -qE '^Uncertain[[:space:]]*[:—-][[:space:]]*(\(none\)|\(无\)|none|N/A|-+)?[[:space:]]*$' && continue
  # Has rationale connector → skip. The list must cover both halves of the
  # spec's bilingual canonical form: English `because/since/due to/owing to`
  # and 中文 `因为/由于/鉴于`. Pre-fix it only had `因为`, so a 中文 report
  # writing the equally-canonical `由于 …`/`鉴于 …` (or English `due to …`)
  # was falsely flagged as a reasonless hedge — a §10-honesty FP against the
  # rule's own intent (the line DOES state a reason). These connectors only
  # match when a real reason follows, so adding them removes FPs without
  # letting reasonless hedges ("Uncertain: maybe broken") pass.
  echo "$norm" | grep -qiE '\b(because|since|due to|owing to)\b|reason:|因为|由于|鉴于' && continue
  # Bare Uncertain header without : or — separator and no body → skip
  # (typically markdown form where reason follows on next line).
  echo "$norm" | grep -qE '^Uncertain[[:space:]]*$' && continue
  # Otherwise: bare Uncertain w/o rationale.
  excerpt=$(printf '%s' "$line" | head -c 80 | tr -d '\n')
  HITS+=("§10-honesty|Uncertain@L$ln short + no rationale connector: \"$excerpt\"")
done < <(printf '%s\n' "$LAST_TEXT" | awk '
  {
    l = $0
    sub(/^##[[:space:]]+/, "", l)
  }
  l ~ /^Uncertain([[:space:]]+—|:|[[:space:]]*$)/ { print NR }
')

(( ${#HITS[@]} == 0 )) && exit 0

# Build per-section dedup list (bash 3.2 compatible — no associative arrays).
SECTION_LIST=""
for hit in "${HITS[@]}"; do
  section="${hit%%|*}"
  if ! printf '%s' "$SECTION_LIST" | grep -qFx -- "$section"; then
    SECTION_LIST+="$section"$'\n'
  fi
done

# Stderr advisory banner (cap at first 5 hits to avoid wall-of-text).
echo "[claudemd] structure drift in last assistant turn (${#HITS[@]} hits):" >&2
i=0
for hit in "${HITS[@]}"; do
  section="${hit%%|*}"
  msg="${hit#*|}"
  printf '  - %s — %s\n' "$section" "$msg" >&2
  i=$((i + 1))
  (( i >= 5 )) && break
done
extra_hits=$(( ${#HITS[@]} - 5 ))
(( extra_hits > 0 )) && echo "  ... +$extra_hits more" >&2
echo "  Disable: TRANSCRIPT_STRUCTURE_SCAN=0 or DISABLE_TRANSCRIPT_STRUCTURE_SCAN_HOOK=1" >&2

# Record one rule-hits row per distinct §-section. Don't merge — operator
# audits will want per-rule firing rates.
while IFS= read -r section; do
  [[ -z "$section" ]] && continue
  count=0
  declare -a matched=()
  for hit in "${HITS[@]}"; do
    if [[ "${hit%%|*}" == "$section" ]]; then
      count=$((count + 1))
      matched+=("${hit#*|}")
    fi
  done
  matched_json=$(printf '%s\n' "${matched[@]}" | jq -R . | jq -s .)
  hook_record transcript-structure-scan structure-advisory \
    "{\"matched\":$matched_json,\"count\":$count}" "$section" "$SESSION_ID"
  unset matched
done <<< "$SECTION_LIST"

exit 0
