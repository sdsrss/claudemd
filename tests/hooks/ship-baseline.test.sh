#!/usr/bin/env bash
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here; PASS branch is `echo` which does not fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/ship-baseline-check.sh"
MOCKS="$HERE/../fixtures/mock-gh"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude"

# Initialize a fake git repo for git log to return something
cd "$TMP_HOME" && git init -q && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "clean commit" 2>/dev/null

FAIL=0
run_hook() {
  local mock="$1" event="$2"
  PATH="$MOCKS/$mock:$PATH" bash "$HOOK" <<<"$event" 2>&1
}

EVENT_PUSH='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"/tmp"}'
EVENT_HELP='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push --help"},"cwd":"/tmp"}'
EVENT_COMMIT='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m test"},"cwd":"/tmp"}'

# Case 1: green CI → pass
OUT=$(run_hook pass-green "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 1 green → pass" || { echo "FAIL: 1 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 2: red CI + no bypass → deny
OUT=$(run_hook fail-red "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 2 red → deny" || { echo "FAIL: 2 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 3: red CI + known-red commit body → pass
cd "$TMP_HOME" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: x" -m "known-red baseline: flaky test quarantined"
OUT=$(run_hook fail-red "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 3 known-red bypass" || { echo "FAIL: 3 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 4: git push --help → pass
OUT=$(run_hook fail-red "$EVENT_HELP")
[[ -z "$OUT" ]] && echo "PASS: 4 --help → pass" || { echo "FAIL: 4 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 5: non-push command → pass
OUT=$(run_hook fail-red "$EVENT_COMMIT")
[[ -z "$OUT" ]] && echo "PASS: 5 non-push → pass" || { echo "FAIL: 5 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 6: 2s timeout on slow gh → fail-open pass
START=$(date +%s)
OUT=$(run_hook slow "$EVENT_PUSH")
END=$(date +%s)
ELAPSED=$((END - START))
[[ -z "$OUT" && $ELAPSED -le 3 ]] && echo "PASS: 6 slow gh → timeout fail-open (${ELAPSED}s)" \
  || { echo "FAIL: 6 (elapsed=${ELAPSED}s, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 7: gh not on PATH → fail-open pass
OUT=$(PATH="/usr/bin:/bin" bash "$HOOK" <<<"$EVENT_PUSH" 2>&1)
[[ -z "$OUT" ]] && echo "PASS: 7 no gh → pass" || { echo "FAIL: 7 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 8: kill-switch
OUT=$(DISABLE_SHIP_BASELINE_HOOK=1 run_hook fail-red "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 8 kill-switch" || { echo "FAIL: 8 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 9: branch-aware filter (M1) — previously `gh run list --limit 1` took
# the latest run of ANY workflow, so a failing scheduled cron on main blocked
# a feature-branch push whose own CI was green.
cd "$TMP_HOME" && git checkout -q -b feature-x 2>/dev/null \
  && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "on feature-x"
OUT=$(run_hook branch-aware "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 9 --branch filter: feature-x green despite main-red cron" \
  || { echo "FAIL: 9 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 10/11: non-failure red conclusions also block. Pre-fix the hook only
# treated `failure` as red, letting `cancelled` and `timed_out` runs ship
# silently — both are red in `gh run list` parlance.
cd "$TMP_HOME" && git checkout -q main 2>/dev/null
# Reset HEAD message so known-red bypass (Case 3) doesn't carry over.
git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: clean again"
OUT=$(run_hook fail-cancelled "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 10 cancelled → deny" \
  || { echo "FAIL: 10 (got: $OUT)"; FAIL=$((FAIL + 1)); }

OUT=$(run_hook fail-timed-out "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 11 timed_out → deny" \
  || { echo "FAIL: 11 (got: $OUT)"; FAIL=$((FAIL + 1)); }

if (( FAIL > 0 )); then
  echo "Tests: $((11 - FAIL))/11 passed"
  exit 1
fi
echo "Tests: 11/11 passed"
