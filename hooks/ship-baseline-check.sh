#!/usr/bin/env bash
# ship-baseline-check.sh — PreToolUse:Bash hook.
# Denies `git push` if base-branch CI is RED, unless bypass present.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch SHIP_BASELINE || exit 0
hook_require_jq || exit 0

EVENT=$(hook_read_event) || exit 0
TOOL=$(printf '%s' "$EVENT" | jq -r '.tool_name // ""' 2>/dev/null)
[[ "$TOOL" == "Bash" ]] || exit 0
CMD=$(printf '%s' "$EVENT" | jq -r '.tool_input.command // ""' 2>/dev/null)
[[ -n "$CMD" ]] || exit 0
SESSION_ID=$(printf '%s' "$EVENT" | jq -r '.session_id // ""' 2>/dev/null)
TOOL_USE_ID=$(printf '%s' "$EVENT" | jq -r '.tool_use_id // ""' 2>/dev/null)

# R-N5 readonly fast-path. **v0.20.0 default-ON** (§13.3 promotion).
# Opt-out: BASH_READONLY_FAST_PATH=0.
if [[ "${BASH_READONLY_FAST_PATH:-1}" != "0" ]] && hook_is_readonly_bash "$CMD"; then
  exit 0
fi

# Filter: git push, not --help.
# Flatten CMD before regex match so heredoc bodies and other line-2+ content
# can't masquerade as line-start. Per-line `grep -qE` would otherwise see
# each heredoc body line's bare `git push origin main` as `^`-anchored.
CMD_FLAT=$(printf '%s' "$CMD" | tr '\n' ' ')
# Segment-anchor regex: require `^` (real start-of-command, post-flatten) OR a
# real shell separator (`[[:space:]]*[;&|]+[[:space:]]*`). The looser
# `[[:space:];&|]` allows ANY whitespace (including space after `#` in
# `ls # git push later`, or space inside a heredoc body) — produced FPs on
# comments, heredoc bodies, and trailing-arg references. Mirrors the
# memory-read-check.sh v0.9.28 segment-anchor fix.
TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)git[[:space:]]+push([[:space:]]|$)'
echo "$CMD_FLAT" | grep -qE "$TRIGGER_RE" || exit 0
echo "$CMD_FLAT" | grep -qE '\-\-help|\-h\b' && exit 0

# Require gh CLI
command -v gh >/dev/null 2>&1 || exit 0

# Filter by current branch when available — otherwise an unrelated scheduled
# workflow failing on main would block a feature-branch push whose own CI is
# green. Detached HEAD / non-git: skip the filter (old unfiltered behavior).
BRANCH=$(git branch --show-current 2>/dev/null)
if [[ -n "$BRANCH" ]]; then
  RUN_JSON=$(timeout 2 gh run list --branch "$BRANCH" --limit 1 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
else
  RUN_JSON=$(timeout 2 gh run list --limit 1 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
fi
[[ -n "$RUN_JSON" ]] || exit 0

CONCLUSION=$(printf '%s' "$RUN_JSON" | jq -r '.[0].conclusion // ""' 2>/dev/null)
# `gh` reports red as one of these terminal states; treating only "failure" as
# red lets cancelled/timed-out runs ship silently. Spec §7 Ship-baseline says
# "Red →" — these are red in gh parlance.
case "$CONCLUSION" in
  failure|cancelled|timed_out|action_required|startup_failure) ;;
  *) hook_record ship-baseline pass null '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"; exit 0 ;;
esac

# known-red baseline bypass
HEAD_MSG=$(git log -1 --format=%B 2>/dev/null || true)
if printf '%s' "$HEAD_MSG" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red null '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi

RUN_URL=$(printf '%s' "$RUN_JSON" | jq -r '.[0].url // ""')
RUN_TITLE=$(printf '%s' "$RUN_JSON" | jq -r '.[0].displayTitle // ""')

# v0.18.1 — retry-cooldown detection. Real session evidence (daagu 5/18-5/20):
# 3 distinct red CI run URLs each attracted 2 deny events within 71-230s of
# each other, same session. The agent saw the (a)/(b)/(c) options on first
# deny but retried anyway. Sentinel-based 5-minute window detects the repeat
# pattern → escalated REASON wording + `deny-repeat` audit event so the
# operator can spot "ignored-guidance" retries without parsing the raw log.
STATE_DIR="$HOME/.claude/.claudemd-state/ship-baseline-recent"
mkdir -p "$STATE_DIR" 2>/dev/null || true
# Sentinel key: (session_id, run_id-from-URL-last-segment). Both are
# filename-safe (UUID + numeric ID). Skip cooldown tracking when either is
# empty — falls back to normal deny behavior.
RUN_ID="${RUN_URL##*/}"
SENTINEL=""
[[ -n "$SESSION_ID" && -n "$RUN_ID" && -d "$STATE_DIR" ]] && SENTINEL="$STATE_DIR/${SESSION_ID}_${RUN_ID}.sentinel"

REPEAT=0
if [[ -n "$SENTINEL" && -f "$SENTINEL" ]] && command -v platform_stat_mtime >/dev/null 2>&1; then
  now=$(date +%s 2>/dev/null) || now=0
  smtime=$(platform_stat_mtime "$SENTINEL" 2>/dev/null) || smtime=0
  if [[ "$now" -gt 0 && "$smtime" -gt 0 ]]; then
    age=$(( now - smtime ))
    [[ "$age" -lt 300 ]] && REPEAT=1
  fi
fi
# Touch (or create) sentinel after the lookup, before emitting deny.
[[ -n "$SENTINEL" ]] && touch "$SENTINEL" 2>/dev/null
# Self-prune: drop sentinels older than 1 day. Bounded — only our own
# directory + filename pattern; never recurses outside STATE_DIR.
[[ -d "$STATE_DIR" ]] && find "$STATE_DIR" -maxdepth 1 -type f -name '*.sentinel' -mmin +1440 -delete 2>/dev/null

if [[ "$REPEAT" -eq 1 ]]; then
  REASON="§7 Ship-baseline: SECOND deny on same red CI run within 5 minutes — $RUN_TITLE
$RUN_URL

Your prior retry did NOT change the CI conclusion. Pick (a), (b), or (c) BEFORE the next retry:
  (a) Fix failing workflow, then retry push.
  (b) Override: prepend commit body with: known-red baseline: <reason>
  (c) Bypass: DISABLE_SHIP_BASELINE_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §7 Ship-baseline check."
  hook_record ship-baseline deny-repeat "{\"run_url\":\"$RUN_URL\"}" '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
else
  REASON="§7 Ship-baseline: base-branch CI is RED — $RUN_TITLE
$RUN_URL

Options:
  (a) Fix failing workflow, then retry push.
  (b) Override: prepend commit body with: known-red baseline: <reason>
  (c) Bypass: DISABLE_SHIP_BASELINE_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §7 Ship-baseline check."
  hook_record ship-baseline deny "{\"run_url\":\"$RUN_URL\"}" '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
fi
hook_deny ship-baseline "$REASON"
