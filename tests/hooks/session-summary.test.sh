#!/usr/bin/env bash
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
REF="$HOME/.claude/.claudemd-state/session-start.ref"

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

if (( FAIL > 0 )); then
  echo "Tests: $((6 - FAIL))/6 passed"
  exit 1
fi
echo "Tests: 6/6 passed"
