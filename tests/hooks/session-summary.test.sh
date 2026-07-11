#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# session-summary.test.sh — tests for v0.8.0 R-N4 Stop hook +
# session-start banner emission. Exercises both halves end-to-end:
# (1) session-summary.sh aggregates rule-hits.jsonl since session ref
#     and writes summary JSON; (2) session-start-check.sh reads it and
#     emits additionalContext, then renames file as consumed.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUMMARY_HOOK="$HERE/../../hooks/session-summary.sh"
SS_HOOK="$HERE/../../hooks/session-start-check.sh"

TMP_HOME=$(mktemp -d -t claudemd-summary-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

mkdir -p "$HOME/.claude/logs" "$HOME/.claude/.claudemd-state"
LOG="$HOME/.claude/logs/claudemd.jsonl"
SUMMARY="$HOME/.claude/.claudemd-state/last-session-summary.json"
# v0.9.13: session-summary owns its own sentinel (not session-start.ref, which
# is shared with sandbox-disposal-check.sh in the same Stop event and races).
REF="$HOME/.claude/.claudemd-state/session-summary.lastrun"

FAIL=0
ok() { echo "PASS: $1"; }
ng() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

# Stop hooks read stdin event JSON; session-summary.sh ignores it but should
# still cope. session-start-check.sh reads stdin too. Provide a minimal stub.
EVENT='{"hook_event_name":"Stop","session_id":"summary-test"}'

# --- Case 1: empty log → no summary written -----------------------------------
rm -f "$SUMMARY"
echo -n '' > "$LOG"
echo "$EVENT" | bash "$SUMMARY_HOOK" >/dev/null 2>&1 || true
if [[ ! -f "$SUMMARY" ]]; then
  ok "Case 1: empty log → no summary written"
else
  ng "Case 1: summary written despite empty log (got: $(cat "$SUMMARY"))"
fi

# --- Case 2: rows in window → summary captures denies/bypasses/warns ---------
rm -f "$SUMMARY"
touch "$REF"
sleep 1  # ensure session-start ref < log row timestamp
NOW_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"banned-vocab\",\"event\":\"deny\",\"spec_section\":\"§10-V\",\"extra\":null}"
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"banned-vocab\",\"event\":\"deny\",\"spec_section\":\"§10-V\",\"extra\":null}"
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"banned-vocab\",\"event\":\"bypass-escape-hatch\",\"spec_section\":\"§10-V\",\"extra\":null}"
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"sandbox-disposal\",\"event\":\"warn\",\"spec_section\":\"§8.V4\",\"extra\":null}"
} > "$LOG"
echo "$EVENT" | bash "$SUMMARY_HOOK" >/dev/null 2>&1 || true
if [[ -f "$SUMMARY" ]] \
   && [[ "$(jq -r '.denies' "$SUMMARY")" == "2" ]] \
   && [[ "$(jq -r '.bypasses' "$SUMMARY")" == "1" ]] \
   && [[ "$(jq -r '.warns' "$SUMMARY")" == "1" ]] \
   && [[ "$(jq -r '.total' "$SUMMARY")" == "4" ]]; then
  ok "Case 2: summary captures 2 denies + 1 bypass + 1 warn"
else
  ng "Case 2: counts wrong (summary: $(cat "$SUMMARY" 2>/dev/null))"
fi

# --- Case 3: top_section reflects highest-count spec_section -----------------
TOP=$(jq -r '.top_section' "$SUMMARY")
if [[ "$TOP" == "§10-V" ]]; then
  ok "Case 3: top_section = §10-V (3 events, beats §8.V4 with 1)"
else
  ng "Case 3: top_section wrong (got '$TOP', expected '§10-V')"
fi

# --- Case 4: kill-switch suppresses write -------------------------------------
rm -f "$SUMMARY"
DISABLE_SESSION_SUMMARY_HOOK=1 bash -c "echo '$EVENT' | bash '$SUMMARY_HOOK' >/dev/null 2>&1" || true
if [[ ! -f "$SUMMARY" ]]; then
  ok "Case 4: DISABLE_SESSION_SUMMARY_HOOK=1 → no write"
else
  ng "Case 4: write occurred despite kill-switch (summary: $(cat "$SUMMARY"))"
fi

# --- Case 5: session-start-check banner consumes summary, renames file -------
rm -f "$SUMMARY" "$SUMMARY.last-shown"
# Pre-seed a summary file
cat > "$SUMMARY" <<EOF
{
  "ts": "2026-05-09T10:00:00Z",
  "since": "2026-05-09T08:00:00Z",
  "total": 4,
  "denies": 2,
  "bypasses": 1,
  "warns": 1,
  "top_section": "§10-V"
}
EOF
# Need a manifest with matching version so the version-match branch is hit.
# Build minimal plugin tree: package.json with version 0.0.0 + manifest matching.
PLUGIN_ROOT_FAKE=$(mktemp -d -t claudemd-pr-XXXXXX)
trap 'rm -rf "$TMP_HOME" "$PLUGIN_ROOT_FAKE"' EXIT
mkdir -p "$PLUGIN_ROOT_FAKE/hooks/lib"
echo '{"version":"0.0.0"}' > "$PLUGIN_ROOT_FAKE/package.json"
cp "$HERE/../../hooks/lib/hook-common.sh" "$PLUGIN_ROOT_FAKE/hooks/lib/"
cp "$HERE/../../hooks/lib/platform.sh" "$PLUGIN_ROOT_FAKE/hooks/lib/" 2>/dev/null || true
cp "$SS_HOOK" "$PLUGIN_ROOT_FAKE/hooks/"
echo "{\"version\":\"0.0.0\"}" > "$HOME/.claude/.claudemd-manifest.json"
DISABLE_UPSTREAM_CHECK=1 OUT=$(echo '{"hook_event_name":"SessionStart"}' | bash "$PLUGIN_ROOT_FAKE/hooks/session-start-check.sh" 2>/dev/null || true)
if echo "$OUT" | grep -q 'last session: 2 denies' \
   && echo "$OUT" | grep -q '§10-V' \
   && [[ ! -f "$SUMMARY" ]] \
   && [[ -f "$SUMMARY.last-shown" ]]; then
  ok "Case 5: session-start banner consumed + renamed"
else
  ng "Case 5: banner emission/consumption wrong (out: $OUT; summary exists: $([[ -f "$SUMMARY" ]] && echo yes || echo no); last-shown: $([[ -f "$SUMMARY.last-shown" ]] && echo yes || echo no))"
fi

# --- Case 6: DISABLE_SESSION_SUMMARY_BANNER=1 suppresses banner -------------
rm -f "$SUMMARY" "$SUMMARY.last-shown"
cat > "$SUMMARY" <<EOF
{"ts":"2026-05-09T10:00:00Z","since":"2026-05-09T08:00:00Z","total":3,"denies":3,"bypasses":0,"warns":0,"top_section":"§10-V"}
EOF
OUT=$(DISABLE_UPSTREAM_CHECK=1 DISABLE_SESSION_SUMMARY_BANNER=1 \
  bash -c "echo '{\"hook_event_name\":\"SessionStart\"}' | bash '$PLUGIN_ROOT_FAKE/hooks/session-start-check.sh' 2>/dev/null" || true)
if ! echo "$OUT" | grep -q 'last session'; then
  ok "Case 6: DISABLE_SESSION_SUMMARY_BANNER=1 suppresses banner"
else
  ng "Case 6: banner emitted despite suppression flag (out: $OUT)"
fi

# --- Case 7: top_section ignores housekeeping events lacking spec_section ----
# Regression for the "top: (unset)" bug. Bootstrap / version-sync / upstream-
# banner / pass events have null spec_section by design (rule-hits.sh only
# stamps section when the caller passes one). Pre-fix, group_by lumped them
# all into "(unset)" and that bucket dominated whenever ops events outnumbered
# rule-violation events — which is the steady state for a healthy session.
# Post-fix: only deny/bypass/warn events with non-null spec_section count
# toward top_section, so it tracks actual rule activity.
rm -f "$SUMMARY"
touch "$REF"
sleep 1
NOW_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  # 2 deny §10-V + 1 warn §8.V4 = real rule activity
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"banned-vocab\",\"event\":\"deny\",\"spec_section\":\"§10-V\",\"extra\":null}"
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"banned-vocab\",\"event\":\"deny\",\"spec_section\":\"§10-V\",\"extra\":null}"
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"sandbox-disposal\",\"event\":\"warn\",\"spec_section\":\"§8.V4\",\"extra\":null}"
  # 15 housekeeping events (no spec_section) — would dominate (unset) bucket pre-fix
  for _ in 1 2 3 4 5; do
    echo "{\"ts\":\"$NOW_TS\",\"hook\":\"session-start\",\"event\":\"bootstrap\",\"extra\":null}"
    echo "{\"ts\":\"$NOW_TS\",\"hook\":\"user-prompt-submit\",\"event\":\"version-sync\",\"extra\":null}"
    echo "{\"ts\":\"$NOW_TS\",\"hook\":\"ship-baseline\",\"event\":\"pass\",\"extra\":null}"
  done
} > "$LOG"
echo "$EVENT" | bash "$SUMMARY_HOOK" >/dev/null 2>&1 || true
TOP=$(jq -r '.top_section' "$SUMMARY" 2>/dev/null)
DENIES=$(jq -r '.denies' "$SUMMARY" 2>/dev/null)
WARNS=$(jq -r '.warns' "$SUMMARY" 2>/dev/null)
if [[ "$TOP" == "§10-V" && "$DENIES" == "2" && "$WARNS" == "1" ]]; then
  ok "Case 7: top_section ignores null-section housekeeping events"
else
  ng "Case 7: top_section pollution (got top='$TOP' denies=$DENIES warns=$WARNS, expected top='§10-V' denies=2 warns=1)"
fi

# --- Case 8: SUMMARY_REF is touched even on no-event Stop (window discipline) -
# Without always-touch, a Stop with zero events would not advance the window
# boundary, and the next session's window would silently extend back through
# this gap. v0.9.13 adds unconditional `touch "$SUMMARY_REF"` before the
# total-eq-0 early-exit.
rm -f "$SUMMARY" "$REF"
echo -n '' > "$LOG"
echo "$EVENT" | bash "$SUMMARY_HOOK" >/dev/null 2>&1 || true
if [[ -f "$REF" && ! -f "$SUMMARY" ]]; then
  ok "Case 8: SUMMARY_REF touched even when no events (no summary written)"
else
  ng "Case 8: window discipline broken (REF exists: $([[ -f "$REF" ]] && echo yes || echo no); SUMMARY exists: $([[ -f "$SUMMARY" ]] && echo yes || echo no))"
fi

# --- Case 9: SUMMARY_REF mtime drives subsequent window (decoupled from
#             session-start.ref / sandbox-disposal-check) -------------------
# After Case 8, SUMMARY_REF mtime is "just now". Write a row dated 5 minutes
# in the past — the hook should NOT include it (mtime > row.ts). Then write a
# fresh row — the hook SHOULD include it.
rm -f "$SUMMARY"
PAST_TS=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-5M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || echo "1970-01-01T00:00:00Z")
NOW_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo "{\"ts\":\"$PAST_TS\",\"hook\":\"banned-vocab\",\"event\":\"deny\",\"spec_section\":\"§10-V\",\"extra\":null}"
  echo "{\"ts\":\"$NOW_TS\",\"hook\":\"banned-vocab\",\"event\":\"deny\",\"spec_section\":\"§10-V\",\"extra\":null}"
} > "$LOG"
sleep 1  # let mtime+ts ordering be unambiguous against the just-touched REF
echo "$EVENT" | bash "$SUMMARY_HOOK" >/dev/null 2>&1 || true
if [[ -f "$SUMMARY" ]] \
   && [[ "$(jq -r '.denies' "$SUMMARY")" == "1" ]] \
   && [[ "$(jq -r '.total' "$SUMMARY")" == "1" ]]; then
  ok "Case 9: SUMMARY_REF mtime gates window — past row excluded, fresh row included"
else
  ng "Case 9: window gate broken — expected denies=1 total=1; got $(cat "$SUMMARY" 2>/dev/null)"
fi

if (( FAIL > 0 )); then
  echo "Tests: $((9 - FAIL))/9 passed"
  exit 1
fi
echo "Tests: 9/9 passed"
