#!/usr/bin/env bash
# mid-spine-yield-scan.sh — Stop hook (advisory only, opt-in default OFF).
#
# v0.15.0 P2 #1 (a-mini) — agent self-rule observation for §11-mid-spine-yield.
# Pairs with transcript-vocab-scan (§10-V) / transcript-structure-scan
# (§iron-law-2 + §10-four-section-order + §10-honesty) as the observability
# surface for self-enforced HARD rules that have no hard-deny path.
#
# Rule (core §11 Mid-SPINE turn-yield): once a turn has executed ≥1 tool call
# inside an active SPINE cycle, continue planned steps through VALIDATE. Yield
# only on [AUTH REQUIRED], ambiguity, or context pressure. Spec gives the tell:
# "next user message is `继续 / next / 怎么停了 / why did you stop` → confirmed
# prior yield."
#
# Detection (heuristic — advisory only, default-OFF for ≥30d FP signal collection
# per transcript-*-scan precedent):
#   1. Walk transcript jsonl in order; track each assistant turn's text + tool-use
#      count.
#   2. For each user message matching the continuation tell (continuation regex
#      + body length ≤ 30 chars to filter long-form instructions starting with
#      "继续"), look at the immediately-prior assistant turn.
#   3. Suspect mid-SPINE yield if the prior assistant turn:
#        (a) contained ≥1 tool_use AND
#        (b) text body did NOT contain a four-section report anchor
#            (^Done: / ^## Done / ^Done —) AND
#        (c) text body did NOT contain [AUTH REQUIRED (legitimate yield) AND
#        (d) text body did NOT contain [PARTIAL: (legitimate partial signal).
#   4. Aggregate yields per session; emit one advisory row with extra.count.
#
# Per-session dedup via state sentinel — emits at most once per session_id.
#
# Opt-in: MID_SPINE_YIELD_SCAN=1 (default OFF). Same precedent as
# transcript-vocab-scan / transcript-structure-scan.
#
# Kill-switches:
#   DISABLE_MID_SPINE_YIELD_HOOK=1 — disable after opt-in
#   DISABLE_CLAUDEMD_HOOKS=1       — global

set -uo pipefail

[[ "${MID_SPINE_YIELD_SCAN:-0}" == "1" ]] || exit 0

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0

hook_kill_switch MID_SPINE_YIELD || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TRANSCRIPT_PATH=$(printf '%s' "$EVENT" | jq -r '.transcript_path // ""' 2>/dev/null)
[[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
[[ -n "$SESSION_ID" ]] || exit 0

STATE_DIR="$HOME/.claude/.claudemd-state"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0
SENTINEL="$STATE_DIR/mid-spine-yield-${SESSION_ID}.ts"
[[ -f "$SENTINEL" ]] && exit 0

# Extract a flat per-line record: type marker + payload. jq -R reads line-by-
# line; per-line `try fromjson catch empty` drops malformed rows. Output one
# tab-separated row per source line, in three shapes:
#   A<TAB>tools_count<TAB>text_first_4kb
#   U<TAB>0<TAB>user_text_first_4kb
#   X (skip)
# Limit body to 4kb to bound memory and grep cost — continuation tells are
# always short, and report anchors are at the start.
WALK=$(jq -R -r '
  try fromjson catch empty
  | if .type == "assistant" then
      ([(.message.content // [])[] | select(.type == "tool_use") | .name] | length) as $tc
      | (([(.message.content // [])[] | select(.type == "text") | .text] | join("\n")) // "") as $tx
      | "A\t" + ($tc|tostring) + "\t" + ($tx[:4096] | gsub("[\n\r\t]"; " "))
    elif .type == "user" then
      (.message.content) as $c
      | if ($c | type) == "string" then
          "U\t0\t" + ($c[:4096] | gsub("[\n\r\t]"; " "))
        else
          # Skip user array entries (tool_result); they are not human input.
          "X\t0\t"
        end
    else
      "X\t0\t"
    end
' "$TRANSCRIPT_PATH" 2>/dev/null)
[[ -n "$WALK" ]] || exit 0

# Continuation tell — anchored at start, allowing trailing punctuation.
# Body length filter (≤ 30 chars) handles FP from long instructions
# accidentally starting with "继续". Multi-byte 中文 char counting in bash is
# byte-based; "继续" is 6 bytes; allow up to ~30 bytes of message body.
#
# Patterns: 继续 / next / continue / proceed / 怎么停了 / why (did) you stop /
# 为什么停了 / keep going / 还有吗 / again.
CONTINUATION_RE='^[[:space:]]*(继续|next|continue|proceed|怎么停了|为什么停了|还有吗|why[[:space:]]+(did[[:space:]]+)?you[[:space:]]+stop|why[[:space:]]+stop|keep[[:space:]]+going|again)[[:space:]]*[。？.?!！]?[[:space:]]*$'

# Walk pairs: track previous-assistant (tools, text). On a U row matching the
# tell, evaluate suspicion. Accumulate count.
COUNT=0
PREV_TOOLS=0
PREV_TEXT=""
PREV_VALID=0
while IFS=$'\t' read -r kind tc body; do
  case "$kind" in
    A)
      PREV_TOOLS="$tc"
      PREV_TEXT="$body"
      PREV_VALID=1
      ;;
    U)
      # Only evaluate if a prior assistant turn exists.
      if (( PREV_VALID == 1 )); then
        # Length filter — keep short forms only.
        if (( ${#body} <= 30 )); then
          # Continuation tell match (case-insensitive on EN tokens; CN chars
          # are case-irrelevant). grep -E + -i.
          if printf '%s' "$body" | grep -qiE -- "$CONTINUATION_RE"; then
            # Suspicion criteria: prev had tool_use AND no legit-yield marker.
            if (( PREV_TOOLS >= 1 )); then
              if ! printf '%s' "$PREV_TEXT" | grep -qE '\[AUTH REQUIRED|\[PARTIAL:|(^|[[:space:]])Done:|(^|[[:space:]])## Done|(^|[[:space:]])Done —'; then
                COUNT=$(( COUNT + 1 ))
              fi
            fi
          fi
        fi
      fi
      # Reset prev state — pairs are strictly adjacent (only the immediately
      # prior assistant turn counts as "what the user said 继续 to").
      PREV_VALID=0
      ;;
  esac
done <<< "$WALK"

(( COUNT >= 1 )) || exit 0

touch "$SENTINEL" 2>/dev/null
echo "[claudemd] §11-mid-spine-yield: detected $COUNT suspected mid-SPINE yield(s) this session — prior assistant turn ended with tool_use (no four-section report / no [AUTH REQUIRED] / no [PARTIAL:]), next user message was a continuation tell (继续/next/why stop)." >&2
echo "  Spec: §11 Mid-SPINE turn-yield (HARD). Once a turn has executed ≥1 tool call, continue planned steps through VALIDATE — yield only on [AUTH REQUIRED], ambiguity, or context pressure." >&2
echo "  Disable: MID_SPINE_YIELD_SCAN=0 or DISABLE_MID_SPINE_YIELD_HOOK=1" >&2

EXTRA=$(jq -cn --argjson c "$COUNT" '{count:$c}' 2>/dev/null) || EXTRA='null'
hook_record mid-spine-yield-scan mid-spine-advisory "$EXTRA" '§11-mid-spine-yield' "$SESSION_ID"

exit 0
