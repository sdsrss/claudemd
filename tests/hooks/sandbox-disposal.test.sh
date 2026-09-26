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

# Case 12: the DEFAULT scan list covers ~/.claude/projects/: a project dir
# created this session whose name encodes a temp-dir cwd (a headless
# `claude -p` probe run from a scratchpad — the 2026-09-26 stopprobe leftover)
# is flagged, on Linux (-tmp-) and macOS (-private-var-folders-) spellings.
stop_at s12 >/dev/null; sleep 1
mkdir "$PROJ/-tmp-claude-1000--home-x-scratchpad-stopprobe" "$PROJ/-private-var-folders-ab-T-probe"
OUT=$(stop_at s12)
if echo "$OUT" | grep -q -- "-tmp-claude-1000--home-x-scratchpad-stopprobe" \
   && echo "$OUT" | grep -q -- "-private-var-folders-ab-T-probe"; then
  echo "PASS: 12 temp-cwd probe project dirs flagged by the default scan"
else
  echo "FAIL: 12 probe project dirs not flagged (out: $OUT)"; FAIL=$((FAIL+1))
fi

# Case 13: a fresh project dir for an ordinary cwd is a real project, not
# residue — never flagged.
stop_at s13 >/dev/null; sleep 1
mkdir "$PROJ/-home-ai-dev-newproject"
OUT=$(stop_at s13)
if echo "$OUT" | grep -q -- "-home-ai-dev-newproject"; then
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
  rm -rf "$VT"
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
  echo "SKIP: 15 /var/tmp not writable here"
fi

# Cases 16-19: SANDBOX_DISPOSAL_BLOCK=1 turns the warn into a Stop block.
ISO="$HOME/.claude/tmp|both"
# Case 16: residue + opt-in → {"decision":"block"} on stdout.
stop_at s16 >/dev/null; sleep 1
mkdir "$HOME/.claude/tmp/tmp.block_me"
STDOUT=$(SANDBOX_DISPOSAL_BLOCK=1 CLAUDEMD_SCAN_SPECS_OVERRIDE="$ISO" bash "$HOOK" <<<'{"session_id":"s16"}' 2>/dev/null)
if [[ "$(jq -r '.decision // empty' <<<"$STDOUT" 2>/dev/null)" == "block" ]] \
   && jq -r '.reason' <<<"$STDOUT" | grep -q "tmp\.block_me"; then
  echo "PASS: 16 opt-in block names the residue"
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

TOTAL=19
if (( FAIL > 0 )); then
  echo "Tests: $((TOTAL - FAIL))/$TOTAL passed"; exit 1
fi
echo "Tests: $TOTAL/$TOTAL passed"
