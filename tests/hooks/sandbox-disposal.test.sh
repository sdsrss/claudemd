#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here; PASS branch is `echo` which does not fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/sandbox-disposal-check.sh"
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/.claudemd-state" "$HOME/.claude/tmp" "$HOME/.claude/logs"

FAIL=0
SKIPPED=0

# Cases 1-20 pin WHAT counts as residue (locations, filters, depth, own-dir
# exclusion, the block verdict). They run with the 0.97.0 first-sight timing,
# which since v0.98.0 is the opt-out SANDBOX_DISPOSAL_IMMEDIATE=1; the default
# deferred timing (report only what is still there one Stop later) is pinned by
# cases 21-25 at the end, which unset it.
export SANDBOX_DISPOSAL_IMMEDIATE=1

# Case 1: first run (no session-start.ref) → creates ref + silent
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" && -f "$HOME/.claude/.claudemd-state/session-start.ref" ]] \
  && echo "PASS: 1 first run silent + ref created" \
  || { echo "FAIL: 1 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 2: no fresh tmp dirs since ref → silent.
# Scoped to the sandbox via the override for the reason Cases 7+8 were scoped
# in v0.5.0: the hook's production spec also scans the real /tmp, where any
# fresh `claudemd-*` from another process lands in this window and makes an
# empty-stderr assertion fail for a reason that has nothing to do with the
# hook. The remedy existed since v0.5.0 and had not reached this case, which
# is why Case 5's comment below could say an empty-stderr assertion was
# impossible while this line was making one (round-16 audit 6.1).
sleep 1
touch "$HOME/.claude/.claudemd-state/session-start.ref"
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$HOME/.claude/tmp|both" bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 2 no residue silent" || { echo "FAIL: 2 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 3: fresh tmp.XXXXXX created → warn
sleep 1
mkdir -p "$HOME/.claude/tmp/tmp.abc123"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
echo "$STDERR" | grep -q "sandbox disposal" && echo "PASS: 3 warn on mkdtemp residue" \
  || { echo "FAIL: 3 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 4: kill-switch
STDERR=$(DISABLE_SANDBOX_DISPOSAL_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 4 kill-switch" || { echo "FAIL: 4"; FAIL=$((FAIL+1)); }

# Case 5: nested tmp.XXXXXX is NOT walked (M2) — spec §8 forbids recursive
# ~/.claude/ traversal; hook must only scan immediate children of tmp/.
# Scoped to the sandbox like Case 2: without the override the hook also scans
# the real /tmp, whose unrelated churn would reach stderr. The assertion is
# still on the specific nested path rather than on empty stderr, because that
# names the defect — a walked nested dir — instead of merely detecting that
# something was printed.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp/legit-container" "$HOME/.claude/.claudemd-state"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
mkdir -p "$HOME/.claude/tmp/legit-container/tmp.nested_m2_marker_xyz"
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$HOME/.claude/tmp|both" bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.nested_m2_marker_xyz"; then
  echo "FAIL: 5 nested tmp.X walked — recursive traversal bug still present (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 5 nested tmp.X ignored (maxdepth 1 respected)"
fi

# Case 6 (v0.1.9 P3a): warn bullet list has no trailing blank " - " entry
# even when FOUND accumulator ends with \n.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
touch -d '1 second ago' "$HOME/.claude/.claudemd-state/session-start.ref" 2>/dev/null \
  || { touch "$HOME/.claude/.claudemd-state/session-start.ref"; sleep 1; }
mkdir -p "$HOME/.claude/tmp/tmp.p3a_bullet_test"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -E '^[[:space:]]*-[[:space:]]*$'; then
  echo "FAIL: 6 trailing blank bullet present — sed '/^$/d' regression (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 6 no trailing blank bullet in warn list"
fi

# Cases 7+8 (v0.5.0 §1.B refactor): test the system-tmp filter logic via the
# CLAUDEMD_SCAN_SPECS_OVERRIDE env knob. Pre-v0.5.0 these cases wrote into the
# real /tmp and read the hook's reaction — failed reproducibly on GitHub
# Actions macos-15-arm64 with empty stderr (FOUND list empty in hook) and
# mtime/symlink defenses didn't change the outcome (v0.4.1 / v0.4.2). v0.5.0
# decouples the hook from real /tmp via the override; tests now run identically
# on Linux + macOS without depending on hosted-runner /tmp behavior.
SYSTEM_FIXTURE="$TMP_HOME/system-tmp"
HOME_FIXTURE="$HOME/.claude/tmp"
RS=$'\x1e'

# Case 7: claudemd_only filter rejects ^tmp\. dirs (system /tmp churn from
# vim/pip/cargo/mktemp must NOT be attributed to the agent session).
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
mkdir "$SYSTEM_FIXTURE/tmp.system_marker"
SCAN_OVERRIDE="${SYSTEM_FIXTURE}|claudemd_only${RS}${HOME_FIXTURE}|both"
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$SCAN_OVERRIDE" bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.system_marker"; then
  echo "FAIL: 7 system /tmp/tmp.* attributed to session (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 7 system /tmp/tmp.* not attributed (claudemd_only filter)"
fi

# Case 8: claudemd_only filter accepts ^claudemd- dirs (claudemd-aware code
# that explicitly labels its mkdtemp IS attributable).
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$SYSTEM_FIXTURE"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
mkdir "$SYSTEM_FIXTURE/claudemd-test-labeled"
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$SCAN_OVERRIDE" bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -q "claudemd-test-labeled"; then
  echo "PASS: 8 /tmp/claudemd-* still flagged"
else
  echo "FAIL: 8 /tmp/claudemd-* not flagged (stderr: $STDERR)"
  FAIL=$((FAIL+1))
fi

# Case 9 (v0.16.0): plain files matching the prefix are NOT flagged. Regression
# guard for the cross-hook conflict where version-sync.sh's
# `~/.claude/tmp/claudemd-sync-<sid>` sentinel FILES were being flagged as
# sandbox dir leaks (95% of 30d warn volume in production telemetry).
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
touch "$HOME/.claude/.claudemd-state/session-start.ref"
sleep 1
touch "$HOME/.claude/tmp/claudemd-sync-fake-session-id"
touch "$HOME/.claude/tmp/tmp.fake-mktemp-file"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
if echo "$STDERR" | grep -qE 'claudemd-sync-fake-session-id|tmp\.fake-mktemp-file'; then
  echo "FAIL: 9 file matching prefix flagged (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 9 plain files with matching prefix NOT flagged"
fi

# Cases 10-11 (2026-08-16 audit F5/CONC-1): the time window must be
# per-session. With one global session-start.ref shared by every session,
# concurrent sessions both misattributed each other's sandboxes (B's Stop
# flagged A's dir under B's session_id) AND disarmed each other (B's Stop
# advanced the ref, so A's own artifact was never "newer than ref" at A's
# Stop). Sessions without a session_id keep the legacy global ref — same
# blind spot as before, named in the hook comment, not silently worse.
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state"
ISO_SPECS="${HOME_FIXTURE}|both"
# A's first Stop: establishes A's window silently.
bash "$HOOK" <<<'{"session_id":"sessA"}' >/dev/null 2>&1
sleep 1
mkdir "$HOME/.claude/tmp/tmp.owned_by_A"
# Case 10: B's FIRST Stop lands between A's Stops — must not claim A's dir.
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO_SPECS" bash "$HOOK" <<<'{"session_id":"sessB"}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.owned_by_A"; then
  echo "FAIL: 10 session B attributed session A's sandbox (stderr: $STDERR)"
  FAIL=$((FAIL+1))
else
  echo "PASS: 10 cross-session sandbox not misattributed"
fi
# Case 11: A's own next Stop must still see its artifact — B must not have
# disarmed A's window.
STDERR=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO_SPECS" bash "$HOOK" <<<'{"session_id":"sessA"}' 2>&1)
if echo "$STDERR" | grep -q "tmp\.owned_by_A"; then
  echo "PASS: 11 owning session still flags its own sandbox"
else
  echo "FAIL: 11 owning session's window was disarmed by another session's Stop (stderr: $STDERR)"
  FAIL=$((FAIL+1))
fi

# Cases 12-19 (v0.97.0, spec v6.34.0 §8.V4 scope: /tmp, /var/tmp,
# ~/.claude/projects/). Each case uses its own session_id so its window is
# established by its own first Stop, never inherited from an earlier case.
# stop_at SID [EXTRA_JSON_FIELDS] — run the hook as a Stop for SID; stderr is
# folded into stdout so one capture sees both the warn and a block verdict.
stop_at() {
  local sid="$1" extra="${2:-}"
  bash "$HOOK" <<<"{\"session_id\":\"$sid\"${extra:+,$extra}}" 2>&1
}
PROJ="$HOME/.claude/projects"
rm -rf "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$PROJ"
mkdir -p "$HOME/.claude/tmp" "$HOME/.claude/.claudemd-state" "$PROJ"

# Case 12: a project dir made since the previous Stop whose name encodes a
# temp-dir cwd (a headless `claude -p` probe run from a scratchpad — the
# 2026-09-26 stopprobe leftover) is flagged, in every spelling the hook
# documents: Linux -tmp- / -var-tmp-, macOS -private-tmp- /
# -private-var-folders- / -var-folders-. Shaped like a real one: a fresh
# <sid>.jsonl, and a <sid>/ subdir (0.97.0 re-review H-1: empty dirs let an
# inverted freshness test pass). One dir also holds an OLD file two levels
# down; the check looks one level in, so it is still flagged (re-review M-2:
# without -maxdepth the deep file would hide it, and §8 forbids the descent).
# Scoped to the projects arm, so the 5-line list cap cannot drop an entry
# when another process makes /tmp/claudemd-* dirs meanwhile.
stop_at s12 >/dev/null; sleep 1
P12=(-tmp-claude-1000--home-x-scratchpad-stopprobe -var-tmp-probe
     -private-tmp-probe -private-var-folders-ab-T-probe -var-folders-ab-T-probe)
for d in "${P12[@]}"; do mkdir -p "$PROJ/$d/sid"; touch "$PROJ/$d/sid.jsonl"; done
touch -t 202001010000 "$PROJ/${P12[0]}/sid/old.jsonl"
OUT=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$PROJ|probe_session" stop_at s12)
MISS=""
for d in "${P12[@]}"; do echo "$OUT" | grep -q -- "/$d\$" || MISS+=" $d"; done
if [[ -z "$MISS" ]] && echo "$OUT" | grep -q "may belong to another session"; then
  echo "PASS: 12 temp-cwd probe project dirs flagged, warn disclaims ownership"
else
  echo "FAIL: 12 probe project dirs not flagged:$MISS (out: $OUT)"; FAIL=$((FAIL+1))
fi
# Case 12b: the DEFAULT scan list includes ~/.claude/projects (one dir, so
# the list cap leaves room for unrelated /tmp churn).
stop_at s12b >/dev/null; sleep 1
mkdir "$PROJ/-tmp-default-list-probe"; touch "$PROJ/-tmp-default-list-probe/s.jsonl"
OUT=$(stop_at s12b)
if echo "$OUT" | grep -q -- "/-tmp-default-list-probe\$"; then
  echo "PASS: 12b the default scan list covers ~/.claude/projects"
else
  echo "FAIL: 12b default list misses ~/.claude/projects (out: $OUT)"; FAIL=$((FAIL+1))
fi

# Case 13: a fresh project dir for an ordinary cwd is a real project, not
# residue — never flagged, including one whose path merely contains `tmp`
# (~/tmp/proj encodes to -home-u-tmp-proj; the pattern is anchored).
stop_at s13 >/dev/null; sleep 1
mkdir "$PROJ/-home-ai-dev-newproject" "$PROJ/-home-u-tmp-proj"
OUT=$(stop_at s13)
if echo "$OUT" | grep -q -- "-home-ai-dev-newproject\|-home-u-tmp-proj"; then
  echo "FAIL: 13 ordinary project dir flagged (out: $OUT)"; FAIL=$((FAIL+1))
else
  echo "PASS: 13 ordinary project dir not flagged"
fi

# Case 14: the session's OWN project dir (the one holding transcript_path) is
# not residue even when its cwd is a temp dir — its mtime moves whenever the
# session writes a subagent transcript.
stop_at s14 >/dev/null; sleep 1
mkdir "$PROJ/-tmp-own-session-cwd"
OUT=$(stop_at s14 "\"transcript_path\":\"$PROJ/-tmp-own-session-cwd/s14.jsonl\"")
if echo "$OUT" | grep -q -- "-tmp-own-session-cwd"; then
  echo "FAIL: 14 own transcript dir flagged (out: $OUT)"; FAIL=$((FAIL+1))
else
  echo "PASS: 14 own transcript dir excluded"
fi

# Case 15: /var/tmp is in the DEFAULT scan list with the `both` filter. Real
# /var/tmp, because the override would replace the list under test; the dir
# is mktemp-named (so no collision) and removed right after. SKIP when
# /var/tmp is not writable (sandboxed runner) — not a pass.
if VT=$(mktemp -d /var/tmp/tmp.XXXXXXXXXX 2>/dev/null); then
  rm -rf "${VT:?}"
  stop_at s15 >/dev/null; sleep 1
  VT=$(mktemp -d /var/tmp/tmp.XXXXXXXXXX)
  OUT=$(stop_at s15)
  rm -rf "${VT:?}"
  if echo "$OUT" | grep -qF "$VT"; then
    echo "PASS: 15 fresh /var/tmp/tmp.* flagged by the default scan"
  else
    echo "FAIL: 15 /var/tmp residue not flagged (out: $OUT)"; FAIL=$((FAIL+1))
  fi
else
  echo "SKIP: 15 /var/tmp not writable here"; SKIPPED=$((SKIPPED+1))
fi

# Cases 16-19: SANDBOX_DISPOSAL_BLOCK=1 turns the warn into a Stop block.
ISO="$HOME/.claude/tmp|both"
# Case 16: residue + opt-in → {"decision":"block"} on stdout.
stop_at s16 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.block_me"
STDOUT=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s16"}' 2>/dev/null)
if [[ "$(jq -r '.decision // empty' <<<"$STDOUT" 2>/dev/null)" == "block" ]] \
   && jq -r '.reason' <<<"$STDOUT" | grep -q "tmp\.block_me" \
   && jq -r '.reason' <<<"$STDOUT" | grep -q "may belong to another session" \
   && jq -r '.reason' <<<"$STDOUT" | grep -q "remove only the ones this task created" \
   && jq -r '.reason' <<<"$STDOUT" | grep -qF 'rm -rf "${D:?}"' \
   && [[ "$(tail -n 1 "$HOME/.claude/logs/claudemd.jsonl" | jq -r '[.event, .spec_section] | join(" ")')" == "block §8.V4" ]]; then
  echo "PASS: 16 opt-in block names the residue, disclaims ownership, records a block row"
else
  echo "FAIL: 16 no block verdict (stdout: $STDOUT)"; FAIL=$((FAIL+1))
fi
# Case 17: a block must not advance the window — the Stop that follows still
# sees what is left, so an uncleaned dir is reported again, not forgotten.
# That Stop carries stop_hook_active=true: it warns but never blocks twice.
STDOUT=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" \
  <<<'{"session_id":"s16","stop_hook_active":true}' 2>"$TMP_HOME/s17.err")
if [[ -z "$STDOUT" ]] && grep -q "tmp\.block_me" "$TMP_HOME/s17.err"; then
  echo "PASS: 17 follow-up Stop warns again without a second block"
else
  echo "FAIL: 17 (stdout: $STDOUT; stderr: $(cat "$TMP_HOME/s17.err"))"; FAIL=$((FAIL+1))
fi
rm -rf "$HOME/.claude/tmp/tmp.block_me"
# Case 18: opt-in with nothing left → no verdict at all.
stop_at s18 >/dev/null; sleep 1
STDOUT=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s18"}' 2>/dev/null)
[[ -z "$STDOUT" ]] && echo "PASS: 18 opt-in with no residue is silent" \
  || { echo "FAIL: 18 (stdout: $STDOUT)"; FAIL=$((FAIL+1)); }
# Case 19: default (no opt-in) never writes a verdict to stdout.
stop_at s19 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.default_warn"
STDOUT=$(CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s19"}' 2>/dev/null)
[[ -z "$STDOUT" ]] && echo "PASS: 19 default mode stays advisory" \
  || { echo "FAIL: 19 (stdout: $STDOUT)"; FAIL=$((FAIL+1)); }

# Case 20 (0.97.0 pre-tag review H1): a temp-cwd project dir that existed
# before this session's window is not this session's residue, even when
# another session writes a new transcript into it (which moves its mtime).
# A dir still holding an entry at or before the window's start is not
# flagged. The old entry is a memory/ DIRECTORY, the shape real project dirs
# have (final re-review M-2: a freshness check narrowed to files let this
# dir through).
mkdir -p "$PROJ/-tmp-work/memory"; touch -t 202001010000 "$PROJ/-tmp-work/memory"
stop_at s20 >/dev/null; sleep 1
touch "$PROJ/-tmp-work/B.jsonl"; mkdir "$PROJ/-tmp-work/B"
OUT=$(stop_at s20)
if echo "$OUT" | grep -q -- "-tmp-work"; then
  echo "FAIL: 20 pre-existing project dir flagged after another session wrote into it (out: $OUT)"; FAIL=$((FAIL+1))
else
  echo "PASS: 20 pre-existing temp-cwd project dir not attributed to this session"
fi

# Cases 21-25 (v0.98.0, analysis 2026-09-26 B7): the DEFAULT timing is
# deferred. 149 of 149 paths the old timing reported since boot were gone
# afterwards; 127 were this repo's own test-suite dirs, alive at Stop only
# because a background run had not finished. A candidate is now remembered at
# the Stop that first sees it and reported only if it still exists at the next.
unset SANDBOX_DISPOSAL_IMMEDIATE
ISO="$HOME/.claude/tmp|both"
dstop() { CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<"{\"session_id\":\"$1\"${2:+,$2}}" 2>&1; }
# Case 21: first sight is silent; still there at the next Stop → reported.
dstop s21 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.left_behind"
OUT1=$(dstop s21)
OUT2=$(dstop s21)
if [[ -z "$OUT1" ]] && echo "$OUT2" | grep -q "tmp\.left_behind" && echo "$OUT2" | grep -q "may belong to another session" \
   && [[ "$(tail -n 1 "$HOME/.claude/logs/claudemd.jsonl" | jq -r '.extra.mode')" == "deferred" ]]; then
  echo "PASS: 21 default: silent at first sight, reported when still present one Stop later"
else
  echo "FAIL: 21 (first: $OUT1 | second: $OUT2)"; FAIL=$((FAIL+1))
fi
# Case 22: gone before the next Stop → never reported (the in-flight suite).
dstop s22 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.in_flight"
OUT1=$(dstop s22)
rm -rf "$HOME/.claude/tmp/tmp.in_flight"
OUT2=$(dstop s22)
if [[ -z "$OUT1" && -z "$OUT2" ]]; then
  echo "PASS: 22 default: a dir removed before the next Stop is never reported"
else
  echo "FAIL: 22 (first: $OUT1 | second: $OUT2)"; FAIL=$((FAIL+1))
fi
# Case 23: reported once; untouched afterwards → not reported again.
OUT3=$(dstop s21)
if [[ -z "$OUT3" ]]; then
  echo "PASS: 23 default: a reported dir that is not touched again is not re-reported"
else
  echo "FAIL: 23 re-reported: $OUT3"; FAIL=$((FAIL+1))
fi
rm -rf "$HOME/.claude/tmp/tmp.left_behind"
# Case 23b: a dir that is reported AND was written again during that turn is
# still reported once — it must not be re-queued by the same Stop's scan.
dstop s23b >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.busy"
dstop s23b >/dev/null; sleep 1
touch "$HOME/.claude/tmp/tmp.busy/f"
R2=$(dstop s23b)
R3=$(dstop s23b)
if echo "$R2" | grep -q "tmp\.busy" && [[ -z "$R3" ]]; then
  echo "PASS: 23b default: a reported dir written again in that turn is not re-queued"
else
  echo "FAIL: 23b (second: $R2 | third: $R3)"; FAIL=$((FAIL+1))
fi
rm -rf "$HOME/.claude/tmp/tmp.busy"
# Case 23c (review M4): the pending list is per session — session B's Stop
# must not confirm (or consume) a dir session A first saw.
dstop s23ca >/dev/null; dstop s23cb >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.seen_by_a"
dstop s23ca >/dev/null
RB=$(dstop s23cb)
RA=$(dstop s23ca)
if ! echo "$RB" | grep -q "tmp\.seen_by_a" && echo "$RA" | grep -q "tmp\.seen_by_a"; then
  echo "PASS: 23c default: the pending list is per session"
else
  echo "FAIL: 23c (B: $RB | A: $RA)"; FAIL=$((FAIL+1))
fi
rm -rf "$HOME/.claude/tmp/tmp.seen_by_a"
# Case 24: block mode blocks at the CONFIRMING Stop, not at first sight; the
# follow-up Stop (stop_hook_active) re-checks and only warns.
dstop s24 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.block_later"
B1=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s24"}' 2>/dev/null)
B2=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s24"}' 2>/dev/null)
B3=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" \
  <<<'{"session_id":"s24","stop_hook_active":true}' 2>"$TMP_HOME/s24.err")
if [[ -z "$B1" ]] && [[ "$(jq -r '.decision // empty' <<<"$B2" 2>/dev/null)" == "block" ]] \
   && jq -r '.reason' <<<"$B2" | grep -q "tmp\.block_later" \
   && [[ -z "$B3" ]] && grep -q "tmp\.block_later" "$TMP_HOME/s24.err"; then
  echo "PASS: 24 default + block: blocks at the confirming Stop, follow-up only warns"
else
  echo "FAIL: 24 (b1: $B1 | b2: $B2 | b3: $B3 / $(cat "$TMP_HOME/s24.err"))"; FAIL=$((FAIL+1))
fi
rm -rf "$HOME/.claude/tmp/tmp.block_later"
# Case 25: the opt-out restores first-sight reporting — the SAME shape as case
# 21's first Stop, which was silent.
dstop s25 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.immediate"
OUT=$(SANDBOX_DISPOSAL_IMMEDIATE=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s25"}' 2>&1)
if echo "$OUT" | grep -q "tmp\.immediate" \
   && [[ "$(tail -n 1 "$HOME/.claude/logs/claudemd.jsonl" | jq -r '.extra.mode')" == "immediate" ]]; then
  echo "PASS: 25 SANDBOX_DISPOSAL_IMMEDIATE=1 reports at first sight"
else
  echo "FAIL: 25 (out: $OUT)"; FAIL=$((FAIL+1))
fi
rm -rf "$HOME/.claude/tmp/tmp.immediate"

TOTAL=$((28 - ${SKIPPED:-0}))
if (( FAIL > 0 )); then
  echo "Tests: $((TOTAL - FAIL))/$TOTAL passed$( (( SKIPPED > 0 )) && echo " ($SKIPPED skipped)")"; exit 1
fi
echo "Tests: $TOTAL/$TOTAL passed$( (( SKIPPED > 0 )) && echo " ($SKIPPED skipped)")"
