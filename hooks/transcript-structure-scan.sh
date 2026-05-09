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

# Read the LAST assistant turn from the transcript jsonl. Bound to last 200
# lines; mirror transcript-vocab-scan.sh parsing (try fromjson catch empty).
# join("\n") here (not " ") because we need line anchors for ^Done: etc.
LAST_TEXT=$(tail -n 200 "$TRANSCRIPT_PATH" 2>/dev/null \
  | jq -R -r 'try fromjson catch empty
              | select(.type == "assistant")
              | (.message.content // [])
              | map(select(.type == "text") | .text)
              | join("\n")' 2>/dev/null)
[[ -n "$LAST_TEXT" ]] || exit 0

declare -a HITS=()

# --- Locate the four section labels --------------------------------------
# Single awk pass captures FIRST occurrence of each label. NR is line number.
# Output: "DONE_LN NOTDONE_LN FAILED_LN UNCERTAIN_LN" (0 = absent).
read -r done_ln notdone_ln failed_ln uncertain_ln <<< "$(
  printf '%s\n' "$LAST_TEXT" | awk '
    /^Done:/      { if (!d) d = NR }
    /^Not done:/  { if (!nd) nd = NR }
    /^Failed:/    { if (!f) f = NR }
    /^Uncertain:/ { if (!u) u = NR }
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
    # Iterate Done: line(s) inside [min_ln, max_ln]; check current + next 2
    # lines for evidence fingerprints.
    while IFS= read -r ln_str; do
      [[ -z "$ln_str" ]] && continue
      ln=$ln_str
      (( ln >= min_ln && ln <= max_ln )) || continue
      # Pull this Done: line + next 2 (3 lines total context).
      block=$(printf '%s\n' "$LAST_TEXT" | sed -n "${ln},$((ln+2))p")
      # Evidence fingerprints (any one suffices).
      if printf '%s' "$block" | grep -qE '\.[a-zA-Z]+:[0-9]+|\b(passed|failed|tests)\b|[0-9]+[^[:space:]]*[[:space:]]*(→|->|=>)[[:space:]]*[0-9]+|Checked:|baseline|known-red'; then
        continue
      fi
      # L3 zero-issue / empty Done: → skip.
      first_line=$(printf '%s\n' "$LAST_TEXT" | sed -n "${ln}p")
      echo "$first_line" | grep -qE '^Done:[[:space:]]*(\(none\)|\(无\)|none|N/A|-+|$)' && continue
      # Otherwise: missing evidence anchor.
      excerpt=$(printf '%s' "$first_line" | head -c 80 | tr -d '\n')
      HITS+=("§iron-law-2|Done@L$ln lacks evidence fingerprint: \"$excerpt\"")
    done < <(printf '%s\n' "$LAST_TEXT" | awk '/^Done:/ {print NR}')
  fi
fi

# --- Detection 3: uncertain-hedge -------------------------------------------
# `^Uncertain:` lines, <80 chars, no "because"/"since"/"reason:"/"因为", not
# "(none)"/"(无)"/"none"/"N/A"/"-". Independent of four-section context — a
# bare hedged Uncertain in any L1 report is honesty drift.
while IFS= read -r ln_str; do
  [[ -z "$ln_str" ]] && continue
  ln=$ln_str
  line=$(printf '%s\n' "$LAST_TEXT" | sed -n "${ln}p")
  len=${#line}
  (( len < 80 )) || continue
  # Empty / explicit-none → skip.
  echo "$line" | grep -qE '^Uncertain:[[:space:]]*(\(none\)|\(无\)|none|N/A|-+)?[[:space:]]*$' && continue
  # Has rationale connector → skip.
  echo "$line" | grep -qiE '\b(because|since)\b|reason:|因为' && continue
  # Otherwise: bare Uncertain w/o rationale.
  excerpt=$(printf '%s' "$line" | head -c 80 | tr -d '\n')
  HITS+=("§10-honesty|Uncertain@L$ln short + no rationale connector: \"$excerpt\"")
done < <(printf '%s\n' "$LAST_TEXT" | awk '/^Uncertain:/ {print NR}')

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
    "{\"matched\":$matched_json,\"count\":$count}" "$section"
  unset matched
done <<< "$SECTION_LIST"

exit 0
