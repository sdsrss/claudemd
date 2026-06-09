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

# v0.23.1 — strip heredoc bodies before trigger match. Real-world failure
# (claudemd downstream consumer, 5/24): commit-body heredoc containing
# `&& git push --tags` (quoting a shell snippet in a release commit message)
# tripped the segment-anchor trigger after flatten, denying `git commit -m
# "$(cat <<EOF ... EOF)"`. Worse: the (b) escape requires `git commit
# --amend` to add the `known-red baseline:` marker, but the amend re-uses
# the same body and trips the same FP → escape unreachable, agent loops.
# v0.17.4 Cases 12-14 covered comments + bare heredoc bodies, but the
# adjacent-separator pattern (`&& git push` inside a heredoc body) slipped
# through because the case used `git push` standalone, not `&& git push`.
# Strip body between `<<DELIM` (or `<<'DELIM'`, `<<"DELIM"`, `<<-DELIM`)
# and the closing DELIM line. Bash-native state machine — no external awk
# script needed.
strip_heredocs() {
  local in_hd=0 delim="" dash=0 line test_line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if (( in_hd )); then
      test_line="$line"
      if (( dash )); then
        while [[ "$test_line" == $'\t'* ]]; do test_line="${test_line#?}"; done
      fi
      [[ "$test_line" == "$delim" ]] && in_hd=0
      continue
    fi
    if [[ "$line" =~ \<\<(-)?[[:space:]]*[\'\"]?([A-Za-z_][A-Za-z0-9_]*)[\'\"]? ]]; then
      [[ -n "${BASH_REMATCH[1]}" ]] && dash=1 || dash=0
      delim="${BASH_REMATCH[2]}"
      in_hd=1
    fi
    printf '%s\n' "$line"
  done
}

# Filter: git push, not --help.
# Strip heredoc bodies (v0.23.1) THEN flatten THEN strip quoted bodies — the
# segment-anchor regex needs real shell separators to be the only `&&`/`;`/`|`
# candidates, not commit-message prose quoting them. v0.23.1 stripped heredoc
# bodies; the far more common `-m "..."` inline form was still vulnerable:
# `git commit -m "fix && git push in docs"` (a pure commit, no push) tripped the
# trigger and was denied on red CI with a nonsensical push-bypass message. Strip
# "..." and '...' bodies AFTER flattening (a multi-line -m payload is one line by
# then). A real push is always UNQUOTED, so this drops the FP without an FN —
# `git commit -m "x" && git push` keeps its outside-quote `&& git push`. The
# known-red marker check below reads the raw $CMD, so the (b) escape inside a
# quoted -m payload still works.
CMD_STRIPPED=$(printf '%s' "$CMD" | strip_heredocs)
CMD_FLAT=$(printf '%s' "$CMD_STRIPPED" | tr '\n' ' ' | sed -E 's/"[^"]*"/""/g' | sed -E "s/'[^']*'/''/g")
# Segment-anchor regex: require `^` (real start-of-command, post-flatten) OR a
# real shell separator (`[[:space:]]*[;&|]+[[:space:]]*`). The looser
# `[[:space:];&|]` allows ANY whitespace (including space after `#` in
# `ls # git push later`, or space inside a heredoc body) — produced FPs on
# comments, heredoc bodies, and trailing-arg references. Mirrors the
# memory-read-check.sh v0.9.28 segment-anchor fix.
TRIGGER_RE='(^|[[:space:]]*[;&|]+[[:space:]]*)git[[:space:]]+push([[:space:]]|$)'
echo "$CMD_FLAT" | grep -qE "$TRIGGER_RE" || exit 0
# Help-invocation exemption (`git push --help` / `git push -h` does nothing, so
# never gate it on CI). Pre-v0.23.11 this grep'd `--help|-h\b` across the WHOLE
# command, so any incidental `-h` — a branch named `feature-h`, or a commit
# message mentioning `-h` chained before the push — exempted a real red-CI push
# (§7 bypass). Now isolate the `git push …` segment (up to the next shell
# separator) and require `-h`/`--help` to be a standalone flag token within it.
PUSH_SEG=$(echo "$CMD_FLAT" | grep -oE 'git[[:space:]]+push[^;&|]*' | head -n1)
echo "$PUSH_SEG" | grep -qE '(^|[[:space:]])(-h|--help)([[:space:]]|$)' && exit 0

# Require gh CLI
command -v gh >/dev/null 2>&1 || exit 0

# Filter by current branch when available — otherwise an unrelated scheduled
# workflow failing on main would block a feature-branch push whose own CI is
# green. Detached HEAD / non-git: skip the filter (old unfiltered behavior).
BRANCH=$(git branch --show-current 2>/dev/null)
if [[ -n "$BRANCH" ]]; then
  RUN_JSON=$(platform_timeout 2 gh run list --branch "$BRANCH" --limit 1 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
else
  RUN_JSON=$(platform_timeout 2 gh run list --limit 1 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
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

# known-red baseline bypass — accept marker in EITHER (a) current HEAD or
# (b) the proposed `-m` / heredoc payload inside CMD itself.
#
# v0.23.2 — Real-world chicken-and-egg (claudemd consumer, 2026-05-24):
# typical ship flow chains `git commit -m "<body>" && git push origin main`
# in one bash call. PreToolUse fires BEFORE the commit runs → HEAD has no
# marker yet, deny. Agent retries `git commit --amend -m "<body+marker>" &&
# git push ...` — same trap: amend hasn't landed, HEAD unchanged. Loop.
# Pre-fix the (b) escape required the agent to break the chain: amend first
# (standalone, no push) THEN push — non-obvious from the deny prose, and
# the cooldown then escalated to "SECOND deny" wording implying ignored
# guidance.
#
# Accepting the marker in CMD itself (typical forms: `-m "...known-red
# baseline: ..."` or `<<EOF ... known-red baseline: ... EOF`) makes the
# (b) escape reachable from the natural chained workflow. Worst case for
# this looser check: a command like `grep 'known-red baseline:' file && git
# push` would pass — but typing the literal marker is a strong intent
# signal, not accidental.
HEAD_MSG=$(git log -1 --format=%B 2>/dev/null || true)
if printf '%s' "$HEAD_MSG" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red null '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi
if printf '%s' "$CMD" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red-incmd null '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
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
  # Regex-guard before arithmetic: `[[ "$smtime" -gt 0 ]]` itself crashes under
  # `set -u` when smtime is non-numeric-non-empty (treats it as an unbound var).
  if [[ "$now" =~ ^[1-9][0-9]*$ && "$smtime" =~ ^[1-9][0-9]*$ ]]; then
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
  (b) Override: include 'known-red baseline: <reason>' in the commit body
      (the -m payload or HEAD message). Chained commit+push in one bash
      call works — marker is detected in CMD itself, no separate amend.
  (c) Bypass: DISABLE_SHIP_BASELINE_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §7 Ship-baseline check."
  hook_record ship-baseline deny-repeat "{\"run_url\":\"$RUN_URL\"}" '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
else
  REASON="§7 Ship-baseline: base-branch CI is RED — $RUN_TITLE
$RUN_URL

Options:
  (a) Fix failing workflow, then retry push.
  (b) Override: include 'known-red baseline: <reason>' in the commit body.
      Works in EITHER current HEAD message OR the proposed -m payload,
      so chained 'git commit -m \"...known-red baseline: x\" && git push'
      passes in one shot — no need to amend separately.
  (c) Bypass: DISABLE_SHIP_BASELINE_HOOK=1 (discouraged).

Spec: ~/.claude/CLAUDE.md §7 Ship-baseline check."
  hook_record ship-baseline deny "{\"run_url\":\"$RUN_URL\"}" '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
fi
hook_deny ship-baseline "$REASON"
