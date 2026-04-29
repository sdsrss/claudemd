#!/usr/bin/env bash
# session-start-check.sh tests — self-bootstrap behavior (v0.1.9 P1b)
# + upstream-check banner behavior (v0.4.0 Cases 8-11).
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here; PASS branch is `echo` which does not fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/session-start-check.sh"
PLUGIN_ROOT="$HERE/../.."
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"

# Cases 1-7 should NOT exercise upstream-check — keep them network-free and
# stdout-clean. Cases 8-11 explicitly override DISABLE_UPSTREAM_CHECK=0.
export DISABLE_UPSTREAM_CHECK=1

FAIL=0

# Case 1: no manifest at either location → hook spawns install.js in background.
# We don't wait for the background install here — the test only asserts the
# hook exits 0 and records a `bootstrap` event in the rule-hits log.
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 1 first-run silent stdout/stderr" \
  || { echo "FAIL: 1 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Wait for the background install to finish, then assert manifest appeared.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$HOME/.claude/.claudemd-manifest.json" ]] && break
  sleep 0.5
done
[[ -f "$HOME/.claude/.claudemd-manifest.json" ]] \
  && echo "PASS: 2 background install wrote manifest" \
  || { echo "FAIL: 2 manifest never appeared"; FAIL=$((FAIL+1)); }

# Bootstrap log exists (diagnostic trail).
[[ -f "$HOME/.claude/logs/claudemd-bootstrap.log" ]] \
  && echo "PASS: 3 bootstrap log created" \
  || { echo "FAIL: 3 bootstrap log missing"; FAIL=$((FAIL+1)); }

# Case 4: manifest version matches current plugin version → no bootstrap spawn.
# v0.2.5: hook now compares manifest.version against plugin package.json version.
# Case 2 above ran a real install, so the current manifest carries the same
# version as $PLUGIN_ROOT/package.json — match path exercised here.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 4 manifest version-match no-op (no spawn)"
else
  echo "FAIL: 4 hook spawned install despite version match (stderr=$STDERR size=$LOG_SIZE)"
  FAIL=$((FAIL+1))
fi

# Case 5: kill-switch suppresses bootstrap.
rm -f "$HOME/.claude/.claudemd-manifest.json"
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(DISABLE_SESSION_START_HOOK=1 bash "$HOOK" <<<'{}' 2>&1)
sleep 1
[[ ! -f "$HOME/.claude/.claudemd-manifest.json" && -z "$STDERR" ]] \
  && echo "PASS: 5 kill-switch suppresses bootstrap" \
  || { echo "FAIL: 5 kill-switch leaked (stderr=$STDERR)"; FAIL=$((FAIL+1)); }

# Case 6: legacy manifest present → hook treats as installed, no spawn.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
mkdir -p "$HOME/.claude/.claudemd-state"
echo '{"version":"0.1.8","entries":[]}' > "$HOME/.claude/.claudemd-state/installed.json"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" == "0" ]]; then
  echo "PASS: 6 legacy manifest → no re-bootstrap"
else
  echo "FAIL: 6 hook re-bootstrapped despite legacy manifest (stderr=$STDERR size=$LOG_SIZE)"
  FAIL=$((FAIL+1))
fi

# Case 7 (v0.2.5): manifest present but .version < current plugin → auto-upgrade.
# Regression for the 0.2.2→0.2.4 stuck-upgrade scenario: under the old hook,
# manifest-exists was sufficient to short-circuit. Auto-sync must trigger.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
# Background install needs a moment to write bootstrap log + new manifest.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  NEW_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
  [[ -n "$NEW_VER" && "$NEW_VER" != "0.0.1" ]] && break
  sleep 0.5
done
PLUGIN_VER=$(jq -r .version "$PLUGIN_ROOT/package.json" 2>/dev/null || echo "")
POST_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
LOG_SIZE=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ -z "$STDERR" && "$LOG_SIZE" -gt "0" && "$POST_VER" == "$PLUGIN_VER" ]]; then
  echo "PASS: 7 version-mismatch triggers auto-upgrade (0.0.1 → $PLUGIN_VER)"
else
  echo "FAIL: 7 auto-upgrade not triggered (stderr=$STDERR log_size=$LOG_SIZE post_ver=$POST_VER plugin_ver=$PLUGIN_VER)"
  FAIL=$((FAIL+1))
fi

# --- v0.4.0 upstream-check cases ---
# Restore manifest to plugin-current version so subsequent cases hit the
# manifest-MATCH path (where upstream_check fires).
PLUGIN_VER_REAL=$(jq -r .version "$PLUGIN_ROOT/package.json")
echo "{\"version\":\"$PLUGIN_VER_REAL\",\"entries\":[]}" > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true

# Mock cache parent with one semver dir
mkdir -p "$TMP_HOME/cache/0.4.0"

# Mock git ls-remote: returns v9.9.9 (newer than 0.4.0)
cat > "$TMP_HOME/mock-ls-remote-newer.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'abc123def456789012345678901234567890abcd\trefs/tags/v9.9.9\n'
MOCK
chmod +x "$TMP_HOME/mock-ls-remote-newer.sh"

# Mock git ls-remote: exits non-zero (network failure)
cat > "$TMP_HOME/mock-ls-remote-fail.sh" <<'MOCK'
#!/usr/bin/env bash
exit 1
MOCK
chmod +x "$TMP_HOME/mock-ls-remote-fail.sh"

# Case 8 (v0.4.0): upstream-check emits SessionStart additionalContext banner
# when the mocked git ls-remote returns a tag higher than the local cache max.
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" 2>/dev/null || true
OUT8=$(CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-newer.sh" \
       CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
       DISABLE_UPSTREAM_CHECK=0 \
       bash "$HOOK" <<<'{}' 2>/dev/null)
if echo "$OUT8" | grep -q '"additionalContext"' && echo "$OUT8" | grep -q 'v9.9.9' && echo "$OUT8" | grep -q 'plugin marketplace update claudemd'; then
  echo "PASS: 8 upstream-check banner emitted on newer remote tag"
else
  echo "FAIL: 8 banner malformed or missing (out: $OUT8)"; FAIL=$((FAIL+1))
fi

# Case 9 (v0.4.0): DISABLE_UPSTREAM_CHECK=1 suppresses banner.
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" 2>/dev/null || true
OUT9=$(CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-newer.sh" \
       CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
       DISABLE_UPSTREAM_CHECK=1 \
       bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT9" ]]; then
  echo "PASS: 9 DISABLE_UPSTREAM_CHECK=1 suppresses banner"
else
  echo "FAIL: 9 kill-switch leaked (out: $OUT9)"; FAIL=$((FAIL+1))
fi

# Case 10 (v0.4.0): sentinel within 24h prevents re-emit (no banner, mock NOT called).
# Pre-touch sentinel; the hook should skip ls-remote and return silently.
mkdir -p "$HOME/.claude/.claudemd-state"
touch "$HOME/.claude/.claudemd-state/upstream-check.lastrun"
OUT10=$(CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-newer.sh" \
        CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
        DISABLE_UPSTREAM_CHECK=0 \
        bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT10" ]]; then
  echo "PASS: 10 24h sentinel skips fresh check"
else
  echo "FAIL: 10 sentinel ignored (out: $OUT10)"; FAIL=$((FAIL+1))
fi

# Case 11 (v0.4.0): git ls-remote failure → fail-open (hook exits 0, no banner, no stderr).
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" 2>/dev/null || true
CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-fail.sh" \
CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
DISABLE_UPSTREAM_CHECK=0 \
  bash "$HOOK" <<<'{}' >"$TMP_HOME/out11" 2>"$TMP_HOME/err11"
EC11=$?
OUT11=$(cat "$TMP_HOME/out11"); ERR11=$(cat "$TMP_HOME/err11")
if [[ "$EC11" == "0" && -z "$OUT11" && -z "$ERR11" ]]; then
  echo "PASS: 11 ls-remote failure fail-open (exit=0, no output)"
else
  echo "FAIL: 11 fail-open broken (ec=$EC11 out=$OUT11 err=$ERR11)"; FAIL=$((FAIL+1))
fi

# Case 12: bootstrap log rotation. Pre-load >64 KiB of stale content; assert
# the next hook run truncates it to ≤32 KiB before appending its own line.
# Without this, the file grew unbounded across sessions.
rm -f "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
# Sentinel at the HEAD followed by 80 KiB of filler. tail -c 32768 keeps
# only the trailing 32 KiB → the head sentinel must vanish post-rotate.
{ echo "STALE_SENTINEL_LINE_AT_HEAD"; head -c 81920 /dev/urandom | base64 | head -c 81920; } > "$HOME/.claude/logs/claudemd-bootstrap.log"
PRE_BYTES=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
bash "$HOOK" <<<'{}' >/dev/null 2>&1
# Wait for the background install to write its line.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$HOME/.claude/.claudemd-manifest.json" ]] && break
  sleep 0.5
done
POST_BYTES=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
# After rotate the file = 32 KiB tail kept + this run's bootstrap output
# (install.js dumps its JSON result ≈ 2-3 KiB). Cap the assertion at 48 KiB
# (32 KiB + 16 KiB slack) — comfortably under the 64 KiB rotate ceiling, so
# the next session would not re-rotate. Stale-sentinel must be gone (it
# lived in the truncated head); that's the real content-rotation assertion.
if [[ "$PRE_BYTES" -gt 65536 && "$POST_BYTES" -lt 49152 ]] \
   && ! grep -q STALE_SENTINEL_LINE_AT_HEAD "$HOME/.claude/logs/claudemd-bootstrap.log"; then
  echo "PASS: 12 bootstrap log rotates at >64 KiB (pre=$PRE_BYTES post=$POST_BYTES)"
else
  echo "FAIL: 12 log rotation not applied (pre=$PRE_BYTES post=$POST_BYTES)"; FAIL=$((FAIL+1))
fi

if (( FAIL > 0 )); then
  echo "Tests: $((12 - FAIL))/12 passed"; exit 1
fi
echo "Tests: 12/12 passed"
