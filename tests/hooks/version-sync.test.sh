#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# version-sync.sh tests — UserPromptSubmit piggy-back behavior (v0.3.1).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/version-sync.sh"
PLUGIN_ROOT="$HERE/../.."
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX")
# C8_HOME is created ~150 lines down and removed by a straight-line `rm -rf`;
# unset-safe here so an early exit still reaps it (2026-09-02 audit R11-38).
trap 'rm -rf "$TMP_HOME" "${C8_HOME:-}" 2>/dev/null || true' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"

# Pin TMPDIR to the sandbox so the sentinel lands alongside $HOME and auto-
# cleans on trap. Without this the hook reads whatever the caller's shell
# environment TMPDIR is (e.g. ~/.claude/tmp/) and the test's expected path
# diverges from the hook's real sentinel path.
export TMPDIR="$TMP_HOME"

# Isolated session scope per test invocation so sentinel files don't leak.
export CLAUDE_SESSION_ID="testscope-$$"
SENTINEL="$TMPDIR/claudemd-sync-$CLAUDE_SESSION_ID"

FAIL=0
reset_state() {
  rm -f "$SENTINEL" "$HOME/.claude/.claudemd-manifest.json"
  : > "$HOME/.claude/logs/claudemd-bootstrap.log"
}

# Case 1: no manifest → silent early-exit + sentinel written (fresh-install
# scenario defers to SessionStart; we don't want to repeat on every prompt).
reset_state
STDOUT=$(bash "$HOOK" <<<'{}' 2>/dev/null)
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDOUT" && -z "$STDERR" && "$LOG_SIZE" == "0" && -f "$SENTINEL" ]]; then
  echo "PASS: 1 no-manifest path silent + sentinel written"
else
  echo "FAIL: 1 (stdout=$STDOUT stderr=$STDERR log=$LOG_SIZE sentinel=$([[ -f $SENTINEL ]] && echo yes || echo no))"
  FAIL=$((FAIL+1))
fi

# Case 2: manifest version matches plugin → silent no-op, no spawn.
reset_state
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json")
jq -n --arg v "$PLUGIN_VER" '{version:$v,entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
STDOUT=$(bash "$HOOK" <<<'{}' 2>/dev/null)
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDOUT" && -z "$STDERR" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 2 version-match no-op (no spawn)"
else
  echo "FAIL: 2 (stdout=$STDOUT stderr=$STDERR log=$LOG_SIZE)"
  FAIL=$((FAIL+1))
fi

# Case 3: manifest version < plugin version → spawns install.js in background.
# Manifest gets re-written to plugin version; bootstrap log records the upgrade.
reset_state
jq -n '{version:"0.0.1",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
STDOUT=$(bash "$HOOK" <<<'{}' 2>/dev/null)
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
# Wait up to 10 × 0.5s for background install to land.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  NEW_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
  [[ -n "$NEW_VER" && "$NEW_VER" != "0.0.1" ]] && break
  sleep 0.5
done
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json")
POST_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDOUT" && -z "$STDERR" && "$LOG_SIZE" -gt "0" && "$POST_VER" == "$PLUGIN_VER" ]]; then
  echo "PASS: 3 version-mismatch triggers piggy-back (0.0.1 → $PLUGIN_VER)"
else
  echo "FAIL: 3 (stdout=$STDOUT stderr=$STDERR log=$LOG_SIZE post=$POST_VER plugin=$PLUGIN_VER)"
  FAIL=$((FAIL+1))
fi

# Case 4: kill-switch suppresses everything — no background spawn, no
# sentinel side-effects the caller can observe.
reset_state
jq -n '{version:"0.0.1",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
STDERR=$(DISABLE_USER_PROMPT_SUBMIT_HOOK=1 bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
sleep 1
POST_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$POST_VER" == "0.0.1" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 4 kill-switch suppresses piggy-back"
else
  echo "FAIL: 4 (stderr=$STDERR post=$POST_VER log=$LOG_SIZE)"
  FAIL=$((FAIL+1))
fi

# Case 5: sentinel prevents double-spawn within the same session scope.
# First call spawns (mismatch), second call must no-op even with mismatch.
reset_state
jq -n '{version:"0.0.1",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
bash "$HOOK" <<<'{}' >/dev/null 2>&1
# Wait for first install to finish so log is stable, then truncate and re-run.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  POST_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
  [[ "$POST_VER" != "0.0.1" ]] && break
  sleep 0.5
done
# Reset manifest to mismatch again — a second prompt in the same session with
# stale version should NOT retrigger because sentinel is set.
jq -n '{version:"0.0.1",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1 >/dev/null)
sleep 1
SECOND_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
SECOND_LOG=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$SECOND_VER" == "0.0.1" && "$SECOND_LOG" == "0" ]]; then
  echo "PASS: 5 sentinel prevents double-run in same session"
else
  echo "FAIL: 5 (stderr=$STDERR second_ver=$SECOND_VER second_log=$SECOND_LOG)"
  FAIL=$((FAIL+1))
fi

# Case 6: stdout must be exactly 0 bytes on every path — UserPromptSubmit
# stdout is injected into the user's prompt context; non-empty output here
# would silently leak into every prompt.
reset_state
jq -n '{version:"0.0.1",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
BYTES=$(bash "$HOOK" <<<'{}' 2>/dev/null | wc -c | tr -d ' ')
if [[ "$BYTES" == "0" ]]; then
  echo "PASS: 6 stdout is 0 bytes (no prompt-context pollution)"
else
  echo "FAIL: 6 stdout leaked $BYTES bytes"
  FAIL=$((FAIL+1))
fi

# Case 7: self-cleanup GCs stale claudemd-sync-* sentinels (>24h old) on
# first prompt of a session. Recent sentinels and unrelated names are kept.
# Confirms the leak that produced 525+ accumulated sentinels in 9 days is
# now bounded.
reset_state
STALE_A="$TMPDIR/claudemd-sync-stale-A"
STALE_B="$TMPDIR/claudemd-sync-stale-B"
RECENT="$TMPDIR/claudemd-sync-recent"
UNRELATED="$TMPDIR/something-else.txt"
touch "$STALE_A" "$STALE_B" "$RECENT" "$UNRELATED"
# Mark A and B as 2 days old via node (portable Linux/macOS).
node -e "const fs=require('fs'); const t=(Date.now()/1000)-86400*2; for (const f of process.argv.slice(1)) fs.utimesSync(f,t,t)" "$STALE_A" "$STALE_B"
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json")
jq -n --arg v "$PLUGIN_VER" '{version:$v,entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
bash "$HOOK" <<<'{}' >/dev/null 2>&1
if [[ ! -e "$STALE_A" && ! -e "$STALE_B" && -e "$RECENT" && -e "$UNRELATED" && -e "$SENTINEL" ]]; then
  echo "PASS: 7 self-cleanup removes >24h sentinels, keeps recent and unrelated"
else
  echo "FAIL: 7 (stale_A=$([[ -e $STALE_A ]] && echo kept || echo gone) stale_B=$([[ -e $STALE_B ]] && echo kept || echo gone) recent=$([[ -e $RECENT ]] && echo kept || echo gone) unrelated=$([[ -e $UNRELATED ]] && echo kept || echo gone) sentinel=$([[ -e $SENTINEL ]] && echo created || echo missing))"
  FAIL=$((FAIL+1))
fi

# Case 8 (v0.36.0): manifest NEWER than this plugin root → stale gate skips
# the spawn. RED baseline (pre-gate): the piggy-back ran the stale root's
# install.js and downgraded the manifest (repro 2026-07-11, tasks/manifest-
# pluginroot-stale-cache.md). stdout stays 0 bytes (hook contract); bootstrap
# log records the skip; stale-root rule-hits row written; manifest untouched.
#
# Its own HOME (2026-08-31): the earlier cases spawn install.js DETACHED with a
# 10s cap, and `reset_state` neither waits for nor kills those children. Under
# suite load one of them landed after this case had written 9.9.9, rewrote the
# manifest to the real plugin version, and this case reported the stale gate as
# broken — observed once in a full run-all, never standalone. A fresh HOME puts
# the manifest an in-flight sibling writes out of this case's reach, which is
# deterministic where a longer sleep would only be luckier.
C8_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || { echo "FAIL: 8 mktemp"; exit 1; }
SAVED_HOME="$HOME"
export HOME="$C8_HOME"
mkdir -p "$HOME/.claude/logs"
reset_state
rm -f "$HOME/.claude/logs/claudemd.jsonl"
jq -n '{version:"9.9.9",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
STDOUT=$(bash "$HOOK" <<<'{}' 2>/dev/null)
sleep 3
POST8=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
if [[ -z "$STDOUT" && "$POST8" == "9.9.9" ]] \
   && grep -q 'stale plugin root' "$HOME/.claude/logs/claudemd-bootstrap.log" \
   && jq -e 'select(.hook=="user-prompt-submit" and .event=="stale-root" and .extra.installed_version=="9.9.9")' "$HOME/.claude/logs/claudemd.jsonl" >/dev/null 2>&1; then
  echo "PASS: 8 stale-root gate skips piggy-back downgrade (log + telemetry recorded)"
else
  echo "FAIL: 8 (stdout=$STDOUT post_ver=$POST8 log=$(head -3 "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null))"
  FAIL=$((FAIL+1))
fi

export HOME="$SAVED_HOME"
rm -rf "$C8_HOME"

# Case 9 (v0.50.0): failed piggy-back install writes the bootstrap-failed
# sentinel (same shared wrapper as session-start bootstrap) so the next
# SessionStart can banner the silent background failure. Failure injection:
# fake `node` shim exiting 1, prepended to PATH.
reset_state
BOOT_SENTINEL="$HOME/.claude/.claudemd-state/bootstrap-failed.json"
rm -f "$BOOT_SENTINEL" 2>/dev/null || true
mkdir -p "$TMP_HOME/fakebin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP_HOME/fakebin/node"
chmod +x "$TMP_HOME/fakebin/node"
jq -n '{version:"0.0.1",entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"
PATH="$TMP_HOME/fakebin:$PATH" bash "$HOOK" <<<'{}' >/dev/null 2>&1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$BOOT_SENTINEL" ]] && break
  sleep 0.5
done
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json")
TO9=$(jq -r '.to // ""' "$BOOT_SENTINEL" 2>/dev/null)
if [[ -f "$BOOT_SENTINEL" && "$TO9" == "$PLUGIN_VER" ]]; then
  echo "PASS: 9 failed piggy-back install writes bootstrap-failed sentinel"
else
  echo "FAIL: 9 (sentinel=$([[ -f $BOOT_SENTINEL ]] && echo yes || echo no) to=$TO9)"
  FAIL=$((FAIL+1))
fi

# Case 10 (R11-04, 2026-09-02 audit): THE PRODUCTION SHAPE — CLAUDE_SESSION_ID
# unset, session_id arriving on stdin. Every case above exports
# CLAUDE_SESSION_ID (line 22), which is exactly the shape production never has:
# 628 of 704 live user-prompt-submit rows carry session_id:null. Keyed on $PPID
# instead, the "once per session" sentinel became once per PROMPT. Two prompts
# in one session must produce ONE sentinel named for the session, and the
# second must early-exit.
reset_state
C10_SID="sess-r11-04-$$"
C10_SENTINEL="$TMPDIR/claudemd-sync-$C10_SID"
rm -f "$C10_SENTINEL"
C10_EVENT=$(jq -n --arg s "$C10_SID" '{session_id:$s, prompt:"hi"}')
# Version match → the hook's quiet path; we are asserting the SENTINEL, not the sync.
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json")
jq -n --arg v "$PLUGIN_VER" '{version:$v,entries:[]}' > "$HOME/.claude/.claudemd-manifest.json"

C10_BEFORE=$(find "$TMPDIR" -maxdepth 1 -name 'claudemd-sync-*' 2>/dev/null | wc -l | tr -d ' ')
( unset CLAUDE_SESSION_ID; bash "$HOOK" <<<"$C10_EVENT" >/dev/null 2>&1 )
( unset CLAUDE_SESSION_ID; bash "$HOOK" <<<"$C10_EVENT" >/dev/null 2>&1 )
C10_AFTER=$(find "$TMPDIR" -maxdepth 1 -name 'claudemd-sync-*' 2>/dev/null | wc -l | tr -d ' ')
C10_NEW=$((C10_AFTER - C10_BEFORE))

if [[ -f "$C10_SENTINEL" && "$C10_NEW" == "1" ]]; then
  echo "PASS: 10 session_id from stdin names the sentinel; 2 prompts → 1 sentinel"
else
  echo "FAIL: 10 (sentinel=$([[ -f $C10_SENTINEL ]] && echo yes || echo no) new_sentinels=$C10_NEW expected 1)"
  FAIL=$((FAIL+1))
fi

# Case 11 (R11-04): no session_id anywhere → $PPID fallback, exactly the old
# behavior. The fix must never be worse than what it replaced.
reset_state
C11_BEFORE=$(find "$TMPDIR" -maxdepth 1 -name 'claudemd-sync-*' 2>/dev/null | wc -l | tr -d ' ')
( unset CLAUDE_SESSION_ID; bash "$HOOK" <<<'{}' >/dev/null 2>&1 )
C11_AFTER=$(find "$TMPDIR" -maxdepth 1 -name 'claudemd-sync-*' 2>/dev/null | wc -l | tr -d ' ')
if (( C11_AFTER > C11_BEFORE )); then
  echo "PASS: 11 no session_id → PPID-keyed sentinel still written (fail-open)"
else
  echo "FAIL: 11 (no sentinel written on the fallback path)"
  FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((11 - FAIL))/11 passed"; exit 1
fi
echo "Tests: 11/11 passed"
