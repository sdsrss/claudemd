#!/usr/bin/env bash
# version-sync.sh tests — UserPromptSubmit piggy-back behavior (v0.3.1).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/version-sync.sh"
PLUGIN_ROOT="$HERE/../.."
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME" 2>/dev/null || true' EXIT
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

if (( FAIL > 0 )); then
  echo "Tests: $((8 - FAIL))/8 passed"; exit 1
fi
echo "Tests: 8/8 passed"
