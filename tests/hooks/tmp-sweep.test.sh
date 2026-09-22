#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/tmp-sweep.sh"
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || exit 1
trap 'rm -rf "${SANDBOX:?}"' EXIT
export HOME="$SANDBOX/home"
ROOT="$SANDBOX/tmproot"
mkdir -p "$HOME/.claude/.claudemd-state" "$ROOT"
# The seam: the detached sweep scans ONLY this root, never the real /tmp.
export CLAUDEMD_TMP_SWEEP_ROOTS="$ROOT"
STAMP="$HOME/.claude/.claudemd-state/tmp-sweep.stamp"
RESULT="$HOME/.claude/.claudemd-state/tmp-sweep.last.json"
EVT='{"session_id":"tmp-sweep-test","tool_name":"Bash","tool_input":{"command":"npm test"}}'

# shellcheck source=../lib/assert.sh
source "$HERE/../lib/assert.sh"

# A stale dir with the exact vitest signature, aged two hours.
mk_vitest() {
  local d="$ROOT/$1"
  mkdir -p "$d/ssr"
  printf 'x' >"$d/ssr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  touch -d '2 hours ago' "$d/ssr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$d/ssr" "$d" 2>/dev/null ||
    touch -t "$(date -v-2H +%Y%m%d%H%M)" "$d/ssr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$d/ssr" "$d"
}
# The sweep is detached; wait for its result file rather than sleeping blind.
wait_result() {
  for _ in $(seq 1 50); do
    [[ -s "$RESULT" ]] && jq -e . "$RESULT" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  return 1
}

# Case 1: kill switch — nothing runs, no stamp.
mk_vitest AAAAAAAAAAAAAAAAAAAAA
OUT=$(DISABLE_TMP_SWEEP_HOOK=1 bash "$HOOK" <<<"$EVT" 2>&1)
[[ -z "$OUT" && ! -e "$STAMP" && -d "$ROOT/AAAAAAAAAAAAAAAAAAAAA" ]] && ok "1 kill switch" ||
  ng "1 kill switch (out: $OUT)"

# Case 2: first run sweeps the stale signature dir and keeps a lookalike.
mkdir -p "$ROOT/BBBBBBBBBBBBBBBBBBBBB/ssr"
printf 'x' >"$ROOT/BBBBBBBBBBBBBBBBBBBBB/ssr/notes.txt"
touch -d '2 hours ago' "$ROOT/BBBBBBBBBBBBBBBBBBBBB/ssr/notes.txt" "$ROOT/BBBBBBBBBBBBBBBBBBBBB/ssr" "$ROOT/BBBBBBBBBBBBBBBBBBBBB" 2>/dev/null || true
CLAUDEMD_TMP_PRESSURE_PCT=101 bash "$HOOK" <<<"$EVT" >/dev/null 2>&1
if wait_result && [[ ! -e "$ROOT/AAAAAAAAAAAAAAAAAAAAA" && -d "$ROOT/BBBBBBBBBBBBBBBBBBBBB" && -f "$STAMP" ]] &&
  [[ "$(jq -r .deleted "$RESULT")" == "1" ]]; then
  ok "2 stale signature dir swept, lookalike kept"
else
  ng "2 sweep (result: $(cat "$RESULT" 2>/dev/null); ls: $(ls "$ROOT"))"
fi

# Case 3: inside the interval the hook does nothing (fresh stamp), and the
# same fixture IS swept once the stamp ages — the liveness half, without which
# "nothing happened" could mean the hook is simply broken.
rm -f "$RESULT"
mk_vitest CCCCCCCCCCCCCCCCCCCCC
touch "$STAMP"
CLAUDEMD_TMP_PRESSURE_PCT=101 bash "$HOOK" <<<"$EVT" >/dev/null 2>&1
sleep 1
[[ -d "$ROOT/CCCCCCCCCCCCCCCCCCCCC" && ! -e "$RESULT" ]] && ok "3a rate-limited inside the interval" ||
  ng "3a rate limit (result: $(cat "$RESULT" 2>/dev/null))"
touch -d '20 minutes ago' "$STAMP" 2>/dev/null || touch -t "$(date -v-20M +%Y%m%d%H%M)" "$STAMP"
CLAUDEMD_TMP_PRESSURE_PCT=101 bash "$HOOK" <<<"$EVT" >/dev/null 2>&1
wait_result && [[ ! -e "$ROOT/CCCCCCCCCCCCCCCCCCCCC" ]] && ok "3b runs again once the stamp ages" ||
  ng "3b (result: $(cat "$RESULT" 2>/dev/null))"

# Case 4: pressure advisory — one JSON object naming the percentage at a
# threshold every filesystem meets, silence at one none can.
rm -f "$STAMP"
OUT=$(CLAUDEMD_TMP_PRESSURE_PCT=0 TMPDIR="$ROOT" bash "$HOOK" <<<"$EVT" 2>/dev/null)
if printf '%s' "$OUT" | jq -e '.suppressOutput == true and .hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("% full"))' >/dev/null 2>&1; then
  ok "4a advisory at threshold 0"
else
  ng "4a advisory (out: $OUT)"
fi
rm -f "$STAMP"
OUT=$(CLAUDEMD_TMP_PRESSURE_PCT=101 TMPDIR="$ROOT" bash "$HOOK" <<<"$EVT" 2>/dev/null)
[[ -z "$OUT" ]] && ok "4b silent below threshold" || ng "4b (out: $OUT)"

wait_result || true
claudemd_assert_summary
