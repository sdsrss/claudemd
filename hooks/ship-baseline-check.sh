#!/usr/bin/env bash
# ship-baseline-check.sh — PreToolUse:Bash hook.
# Denies `git push` if base-branch CI is RED, unless bypass present.

set -uo pipefail

LIB_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null || cd .; pwd)/lib"
# shellcheck source=/dev/null
source "$LIB_DIR/hook-common.sh" || exit 0
# shellcheck source=/dev/null
source "$LIB_DIR/platform.sh" 2>/dev/null || true

hook_kill_switch SHIP_BASELINE || exit 0
# The `|| true` on the platform source is deliberate (a missing lib must not
# take the hook down at source time) but it left `platform_timeout` unasserted:
# the two `gh run list` calls below both end in `|| exit 0`, so a missing lib
# turned `command not found` (127) into a silent allow — the OBS-1 gap this
# hook's own header claims to have closed (2026-08-29 audit R10-06a).
# `source` exiting 0 is not evidence a function exists
# (feedback_hook_platform_lib_source); assert the symbol. Placed AFTER the
# kill switch so a deliberately disabled hook records nothing.
if ! declare -f platform_timeout >/dev/null 2>&1; then
  hook_record_failopen ship-baseline prereq-missing
  exit 0
fi
# Record fail-open on missing prereqs (roadmap OBS-1): don't let a jq-less /
# malformed-stdin environment silently no-op this §7 gate — the §13.1 audit
# must see the bypass, not read it as "never fired".
if ! hook_require_jq; then
  hook_record_failopen ship-baseline jq-missing
  exit 0
fi
# Assert the shared trigger fragment, don't assume it. `source` returning 0 does
# NOT mean a symbol got defined — a file truncated mid-heredoc sources cleanly
# (the shape memory-read-check.sh:27-35 documents). Under `set -u` an unset
# HOOK_GIT_GLOBAL_FLAGS would abort this hook mid-regex, i.e. fail open at
# exactly the push moment with nothing on the record.
if [[ -z "${HOOK_GIT_GLOBAL_FLAGS:-}" ]]; then
  hook_record_failopen ship-baseline prereq-missing
  exit 0
fi

EVENT=$(hook_read_event)
if [[ -z "$EVENT" ]]; then
  hook_record_failopen ship-baseline bad-event
  exit 0
fi
hook_read_bash_fields ship-baseline "$EVENT" || exit 0
[[ "$HOOK_TOOL_NAME" == "Bash" ]] || exit 0
CMD="$HOOK_CMD"
[[ -n "$CMD" ]] || exit 0
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
# Strip body between `<<DELIM` (or `<<'DELIM'`, `<<"DELIM"`, `<<-DELIM`) and the
# closing DELIM line — now via the shared hook_strip_heredoc_bodies in
# hook-common.sh. This was a bash-native state machine hand-copied from
# pre-bash-safety-check.sh, and it never received that file's terminator
# LOOKAHEAD guard: `echo $((1<<n))` + newline + `git push origin main` opened a
# phantom heredoc that swallowed the push, so the §7 red-CI gate stopped seeing
# the trigger it exists to gate (2026-07-25 audit, reproduced live).

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
# 2026-07-27 audit: this three-stage pipeline WAS the correct one; it is now
# `hook_trigger_view` in hook-common.sh, shared with the two sibling gates that
# had each drifted off a different stage of it (H1/M1). Semantics are unchanged.
# One byte-level difference (pre-tag review, inert): the old form assigned through
# `CMD_STRIPPED=$(…)`, whose command substitution ate trailing newlines, so a
# command ending in a blank line now flattens to `…;;` instead of `…;`. Both
# satisfy the segment anchor.
CMD_FLAT=$(printf '%s' "$CMD" | hook_trigger_view)
# Segment-anchor regex: require `^` (real start-of-command, post-flatten) OR a
# real shell separator (`[[:space:]]*[;&|]+[[:space:]]*`). The looser
# `[[:space:];&|]` allows ANY whitespace (including space after `#` in
# `ls # git push later`, or space inside a heredoc body) — produced FPs on
# comments, heredoc bodies, and trailing-arg references. Mirrors the
# memory-read-check.sh v0.9.28 segment-anchor fix.
# The suffix accepts a shell separator, not just whitespace-or-EOL. hook_flatten_cmd
# terminates its output with `;` (verified: `git push` → `git push;`), so an
# ARGUMENT-LESS push put `;` immediately after the verb and matched neither arm —
# `git push`, the most common spelling there is, has never reached this §7 gate.
# Every case in this suite drove `git push origin main`, so nothing said so
# (0.70.0 pre-tag review, HIGH-1). Not `[^a-zA-Z]` (memory-read-check's spelling):
# that would newly match `git push-notes`.
TRIGGER_RE="(^|[[:space:]]*[;&|]+[[:space:]]*)git${HOOK_GIT_GLOBAL_FLAGS}[[:space:]]+push([[:space:]]|[;&|]|\$)"
echo "$CMD_FLAT" | grep -qE "$TRIGGER_RE" || exit 0

# Telemetry fields — below the TRIGGER exit, not merely below the fast-path exit
# (audit-2026-08-22 条目 12 fixed the fast-path layer; this is the same
# asymmetry one layer down). Any command carrying shell metacharacters is not
# read-only, so it cleared the fast-path and paid two jq spawns here before
# exiting one line above on a non-push command — measured 4 spawns for
# `ls /tmp >/dev/null` against memory-read-check's 2 (2026-08-29 audit R10-23).
# Gate: tests/hooks/preToolUse-jq-spawn-budget.test.sh.
hook_read_telemetry_ids "$EVENT"
# Help-invocation exemption (`git push --help` / `git push -h` does nothing, so
# never gate it on CI). Pre-v0.23.11 this grep'd `--help|-h\b` across the WHOLE
# command, so any incidental `-h` — a branch named `feature-h`, or a commit
# message mentioning `-h` chained before the push — exempted a real red-CI push
# (§7 bypass). Now isolate the `git push …` segment (up to the next shell
# separator) and require `-h`/`--help` to be a standalone flag token within it.
# Same global-flag tolerance as TRIGGER_RE: without it `git -C /repo push --help`
# matched the trigger but yielded an EMPTY segment, so the help exemption never
# applied and a no-op invocation could be denied on red CI.
PUSH_SEG=$(echo "$CMD_FLAT" | grep -oE "git${HOOK_GIT_GLOBAL_FLAGS}[[:space:]]+push[^;&|]*" | head -n1)
echo "$PUSH_SEG" | grep -qE '(^|[[:space:]])(-h|--help)([[:space:]]|$)' && exit 0

# Require gh CLI
command -v gh >/dev/null 2>&1 || exit 0

# WHICH repository is being pushed (2026-09-02 audit R11-15).
#
# TRIGGER_RE has accepted `git -C <dir> push` since R10-05, and
# hook_read_telemetry_ids has been handing back EVENT_CWD since v0.9.34 — but
# every git/gh call below ran bare, in the hook process's own cwd. So the §7
# gate read repo A's branch, CI colour and HEAD message to decide about a push
# to repo B: A green + B red is a false PASS (silent, which is the dangerous
# direction), A red + B green a false deny naming a run from the wrong repo.
# The three sibling gates all carry a cwd model; this one did not.
#
# Resolution order, most explicit first. Anything unresolvable keeps `.` — the
# pre-fix behavior — because this is a deny gate and the fix must never make it
# newly block. Quoted paths containing spaces fall through here by design.
SB_DIR=$(printf '%s' "$PUSH_SEG" | grep -oE '(^|[[:space:]])-C[[:space:]]+[^[:space:]]+' | head -n1 | sed -E 's/.*-C[[:space:]]+//')
if [[ -z "$SB_DIR" ]]; then
  # `cd <dir> && git push` — last cd BEFORE the push wins, which is what the
  # shell would have done by the time the push runs.
  #
  # Scoped to the prefix, not the whole command (pre-tag review of this
  # release). A bare `tail -n1` over $CMD_FLAT also picks up a `cd` that
  # FOLLOWS the push — `git push origin main && cd ../sibling && npm test`,
  # an entirely ordinary shape — and then adjudicated the push against
  # ../sibling's branch, CI colour and HEAD commit body. Both exemption inputs
  # this gate reads could be sourced from an unrelated repo named after the
  # fact, so a red-CI push was silently ALLOWED. The pre-fix hook denied every
  # one of those cases: it was a regression introduced by the fix, in the
  # direction the surrounding comment did not consider — this gate must never
  # newly BLOCK, and it must never newly ALLOW either.
  SB_PRE=${CMD_FLAT%%"$PUSH_SEG"*}
  SB_DIR=$(printf '%s' "$SB_PRE" | grep -oE '(^|[;&|][[:space:]]*)cd[[:space:]]+[^[:space:];&|]+' | tail -n1 | sed -E 's/.*cd[[:space:]]+//')
fi
[[ -z "$SB_DIR" ]] && SB_DIR="$EVENT_CWD"
# Must be a real worktree, not merely a directory. Existing suites drive
# `cwd:"/tmp"` while the fixture repo is elsewhere; without this check those
# events would resolve to a non-repo and every `git` below would go quiet,
# turning the known-red bypass off. Non-repo → fall back to the hook's cwd.
if [[ -z "$SB_DIR" ]] || ! git -C "$SB_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  SB_DIR="."
fi

# Filter by current branch when available — otherwise an unrelated scheduled
# workflow failing on main would block a feature-branch push whose own CI is
# green. Detached HEAD / non-git: skip the filter (old unfiltered behavior).
BRANCH=$(git -C "$SB_DIR" branch --show-current 2>/dev/null)
# gh resolves the repo from its cwd, so it has to run inside the target too —
# `gh run list --branch B` in repo A would report A's runs for B's branch name.
if [[ -n "$BRANCH" ]]; then
  RUN_JSON=$(cd "$SB_DIR" && platform_timeout 2 gh run list --branch "$BRANCH" --limit 5 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
else
  RUN_JSON=$(cd "$SB_DIR" && platform_timeout 2 gh run list --limit 5 --json databaseId,status,conclusion,displayTitle,url 2>/dev/null) || exit 0
fi
[[ -n "$RUN_JSON" ]] || exit 0

# Baseline color = the most recent COMPLETED run, not simply the newest one.
#
# 2026-07-25 audit: this read `.[0].conclusion` only. A run that is still
# executing carries `status:"in_progress"` with `conclusion:null`, so the empty
# string fell through to the `*)` arm and was recorded as a §7 `pass` — a
# positive baseline row for a run that had not produced a result. Under the
# atomic-ship flow that is the NORMAL timing (pushing main starts CI; the tag
# push follows seconds later), so the gate reported pass at exactly the moment
# it was supposed to evaluate, and every downstream count built on those rows
# was inflated. Selecting the newest completed run gives the question a real
# answer; `--limit 5` provides the lookback for it.
COMPLETED_RUN=$(printf '%s' "$RUN_JSON" | jq -c '[.[] | select(.status == "completed")][0] // empty' 2>/dev/null)
if [[ -z "$COMPLETED_RUN" ]]; then
  # Nothing has finished yet — there is no color to gate on. Record the state
  # under its own event so it is never counted as a green baseline.
  IN_FLIGHT=$(printf '%s' "$RUN_JSON" | jq -r '.[0].status // "unknown"' 2>/dev/null)
  hook_record ship-baseline pending-no-baseline "{\"status\":\"$IN_FLIGHT\"}" '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi

CONCLUSION=$(printf '%s' "$COMPLETED_RUN" | jq -r '.conclusion // ""' 2>/dev/null)
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
HEAD_MSG=$(git -C "$SB_DIR" log -1 --format=%B 2>/dev/null || true)
if printf '%s' "$HEAD_MSG" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red null '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi
if printf '%s' "$CMD" | grep -qi 'known-red baseline:'; then
  hook_record ship-baseline pass-known-red-incmd null '§7-ship-baseline' "$SESSION_ID" "$TOOL_USE_ID"
  exit 0
fi

# From COMPLETED_RUN, not `.[0]` — the deny message and the repeat-cooldown key
# must name the run whose conclusion produced the verdict.
RUN_URL=$(printf '%s' "$COMPLETED_RUN" | jq -r '.url // ""')
RUN_TITLE=$(printf '%s' "$COMPLETED_RUN" | jq -r '.displayTitle // ""')

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
