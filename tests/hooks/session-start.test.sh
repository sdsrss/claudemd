#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# session-start-check.sh tests — self-bootstrap behavior (v0.1.9 P1b)
# + upstream-check banner behavior (v0.4.0 Cases 8-11).
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here; PASS branch is `echo` which does not fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/session-start-check.sh"
PLUGIN_ROOT="$HERE/../.."
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
mkdir -p "$HOME/.claude/logs"

# Cases 1-7 should NOT exercise upstream-check — keep them network-free and
# stdout-clean. Cases 8-11 explicitly override DISABLE_UPSTREAM_CHECK=0.
export DISABLE_UPSTREAM_CHECK=1
# Hermeticity: a user-level DISABLE_COMPACT_REREAD_REMINDER=1 in settings env
# would silently degrade Case 15 (expected-emit) into a false pass elsewhere.
unset DISABLE_COMPACT_REREAD_REMINDER

FAIL=0

# Case 1: no manifest at either location → hook bootstraps install.js.
# Since v0.75.0 the FRESH path runs it synchronously (Case 2); this case only
# asserts the hook stays silent on both streams, which the sync branch must
# preserve — install.js prints its JSON report to stdout, and letting that
# reach Claude Code would make the hook's output unparseable.
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
[[ -z "$STDERR" ]] && echo "PASS: 1 first-run silent stdout/stderr" \
  || { echo "FAIL: 1 (stderr: $STDERR)"; FAIL=$((FAIL+1)); }

# Case 2 (v0.75.0): the manifest exists the instant the hook RETURNS — no poll,
# no sleep. That immediacy IS the fresh-path contract: install.js writes
# ~/.claude/CLAUDE.md, and a detached run racing Claude Code's session-start
# context assembly is what delayed the spec's first appearance by a session.
# A poll loop here would pass just as happily against the old async spawn, so
# the absence of one is the assertion.
[[ -f "$HOME/.claude/.claudemd-manifest.json" ]] \
  && echo "PASS: 2 fresh install wrote manifest synchronously (no wait)" \
  || { echo "FAIL: 2 manifest absent when hook returned"; FAIL=$((FAIL+1)); }

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
if echo "$OUT8" | grep -q '"additionalContext"' && echo "$OUT8" | grep -q 'v9.9.9' && echo "$OUT8" | grep -q '/claudemd-refresh'; then
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

# Case 11b (v0.23.11): ls-remote FAILURE must still consume the 24h budget —
# touch the sentinel even when the network probe fails. Pre-fix the touch only
# happened after a successful semver fetch, so offline users re-ran the 3s
# `git ls-remote` on EVERY SessionStart.
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" 2>/dev/null || true
CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-fail.sh" \
CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
DISABLE_UPSTREAM_CHECK=0 \
  bash "$HOOK" <<<'{}' >/dev/null 2>&1
if [[ -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" ]]; then
  echo "PASS: 11b ls-remote failure still writes 24h sentinel"
else
  echo "FAIL: 11b sentinel absent after failed probe (re-runs every session)"; FAIL=$((FAIL+1))
fi

# Case 11c (v0.23.11): non-semver remote tag (e.g. a `nightly` ref) must also
# consume the budget — pre-fix the strict-semver gate `return 0`'d before touch.
cat > "$TMP_HOME/mock-ls-remote-nonsemver.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'abc123\trefs/tags/nightly\n'
MOCK
chmod +x "$TMP_HOME/mock-ls-remote-nonsemver.sh"
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" 2>/dev/null || true
CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-nonsemver.sh" \
CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
DISABLE_UPSTREAM_CHECK=0 \
  bash "$HOOK" <<<'{}' >/dev/null 2>&1
if [[ -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" ]]; then
  echo "PASS: 11c non-semver remote tag still writes 24h sentinel"
else
  echo "FAIL: 11c sentinel absent on non-semver tag"; FAIL=$((FAIL+1))
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

# Case 13 (v0.23.11): a corrupt last-session-summary.json whose `denies` is a
# non-numeric JSON string must NOT crash the SessionStart hook. jq's `// 0`
# only catches null/missing, so the string flowed into `$((denies + ...))` and
# crashed under `set -u` (exit 1, not fail-open). Manifest must match plugin
# version to reach the banner path.
PLUGIN_VER_REAL=$(jq -r .version "$PLUGIN_ROOT/package.json")
echo "{\"version\":\"$PLUGIN_VER_REAL\",\"entries\":[]}" > "$HOME/.claude/.claudemd-manifest.json"
mkdir -p "$HOME/.claude/.claudemd-state"
printf '{"denies":"oops","bypasses":0,"warns":0}' > "$HOME/.claude/.claudemd-state/last-session-summary.json"
touch "$HOME/.claude/.claudemd-state/upstream-check.lastrun"  # skip network
bash "$HOOK" <<<'{}' >/dev/null 2>&1; EC=$?
[[ "$EC" == "0" ]] && echo "PASS: 13 corrupt non-numeric summary fails open (exit 0)" \
  || { echo "FAIL: 13 (exit=$EC)"; FAIL=$((FAIL+1)); }

# Case 14 (v0.23.13): upstream-upgrade banner + session-summary banner firing in
# the SAME SessionStart must emit ONE JSON object, not two concatenated. CC
# parses hook stdout with a strict single-value JSON.parse — two objects are
# invalid JSON and BOTH banners are silently dropped (the upgrade notice
# vanishes exactly when the user also had session activity). `jq -s length`
# counts top-level JSON values: pre-fix this was 2, post-fix it must be 1.
PLUGIN_VER_REAL=$(jq -r .version "$PLUGIN_ROOT/package.json")
echo "{\"version\":\"$PLUGIN_VER_REAL\",\"entries\":[]}" > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" \
      "$HOME/.claude/.claudemd-state/last-session-summary.json.last-shown" 2>/dev/null || true
printf '{"denies":2,"bypasses":1,"warns":0,"top_section":"§8"}' > "$HOME/.claude/.claudemd-state/last-session-summary.json"
OUT14=$(CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-newer.sh" \
        CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
        DISABLE_UPSTREAM_CHECK=0 \
        bash "$HOOK" <<<'{}' 2>/dev/null)
OBJCOUNT14=$(printf '%s' "$OUT14" | jq -s 'length' 2>/dev/null)
if [[ "$OBJCOUNT14" == "1" ]] \
   && echo "$OUT14" | grep -q 'v9.9.9' \
   && echo "$OUT14" | grep -q 'since last turn'; then
  echo "PASS: 14 upstream + summary merge into one valid JSON object"
else
  echo "FAIL: 14 double-emit not merged (objects=$OBJCOUNT14, out: $OUT14)"; FAIL=$((FAIL+1))
fi

# --- v0.27.0 compact-reminder cases ---
# Case 15: source=="compact" emits the §11 re-read banner as exactly ONE JSON
# object (jq -s length — the v0.23.13 double-emit lesson: two concatenated
# objects are invalid JSON and CC drops both).
OUT15=$(bash "$HOOK" <<<'{"session_id":"t","source":"compact"}' 2>/dev/null)
OBJCOUNT15=$(printf '%s' "$OUT15" | jq -s 'length' 2>/dev/null)
if [[ "$OBJCOUNT15" == "1" ]] \
   && echo "$OUT15" | grep -q 'compaction detected' \
   && echo "$OUT15" | grep -q 'DISABLE_COMPACT_REREAD_REMINDER'; then
  echo "PASS: 15 compact source emits single-object §11 reminder"
else
  echo "FAIL: 15 compact banner missing/malformed (objects=$OBJCOUNT15, out: $OUT15)"; FAIL=$((FAIL+1))
fi

# Case 15b (round-16 audit 6.3): the banner must not tell the model to re-read
# spec/core state. Spec v6.27.0 rewrote §11 — core is harness-injected every
# turn and is never re-Read — but this hook kept emitting "re-read the active
# plan + spec state", and the telemetry label on that very emit is
# `§11-post-compaction`: it cited the section it was violating. Case 15 could
# not catch it because `compaction detected` is equally true of the wrong text.
#
# Two arms, so the pair stays honest if EITHER side moves. Arm 1 is the defect
# itself. Arm 3 pins the spec clause the banner is derived from: if someone
# reinstates a spec-re-read in §11, it goes red HERE and sends the reader to
# this comment, instead of leaving the banner free to drift back silently.
# What this does NOT assert: that the banner's wording is *good* — only that it
# names the plan and not the spec. Prose quality is not gate-able here.
SPEC_PC_LINE=$(grep -h 'Post-compaction' "$PLUGIN_ROOT/spec/CLAUDE.md" | head -1)
if echo "$OUT15" | grep -qiE 'spec state|re-read the spec'; then
  echo "FAIL: 15b banner still tells the model to re-read spec state (out: $OUT15)"; FAIL=$((FAIL+1))
elif ! echo "$OUT15" | grep -q 'active plan'; then
  echo "FAIL: 15b banner no longer names the plan as the re-read target (out: $OUT15)"; FAIL=$((FAIL+1))
elif ! printf '%s' "$SPEC_PC_LINE" | grep -q 'never re-Read it'; then
  echo "FAIL: 15b spec §11 no longer says core is never re-Read — revisit this banner (line: $SPEC_PC_LINE)"; FAIL=$((FAIL+1))
else
  echo "PASS: 15b compact banner matches §11 (plan yes, spec/core no)"
fi

# Case 16: DISABLE_COMPACT_REREAD_REMINDER=1 suppresses the banner; exit 0.
OUT16=$(DISABLE_COMPACT_REREAD_REMINDER=1 bash "$HOOK" <<<'{"session_id":"t","source":"compact"}' 2>/dev/null); EC16=$?
if [[ "$EC16" == "0" && -z "$OUT16" ]]; then
  echo "PASS: 16 DISABLE_COMPACT_REREAD_REMINDER=1 suppresses banner"
else
  echo "FAIL: 16 opt-out leaked (ec=$EC16 out: $OUT16)"; FAIL=$((FAIL+1))
fi

# Case 17: compact events must NOT spawn bootstrap even when the manifest is
# missing — compaction is mid-session; install.js runs are session-start
# concerns. Early-exit semantics pinned here.
rm -f "$HOME/.claude/.claudemd-manifest.json" "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
bash "$HOOK" <<<'{"session_id":"t","source":"compact"}' >/dev/null 2>&1
sleep 2
LOG_SIZE17=$(wc -c < "$HOME/.claude/logs/claudemd-bootstrap.log" | tr -d ' ')
if [[ ! -f "$HOME/.claude/.claudemd-manifest.json" && "$LOG_SIZE17" == "0" ]]; then
  echo "PASS: 17 compact source skips bootstrap despite missing manifest"
else
  echo "FAIL: 17 compact event triggered bootstrap (log_size=$LOG_SIZE17)"; FAIL=$((FAIL+1))
fi

# Case 18 (v0.36.0): manifest NEWER than this plugin root → stale-registration
# gate. RED baseline (pre-gate): the hook logged "auto-upgrade: manifest 9.9.9
# → plugin <ver>" and the background install DOWNGRADED the manifest (repro
# 2026-07-11, tasks/manifest-pluginroot-stale-cache.md). Post-gate: no install
# spawn, single-object refresh banner, stale-root rule-hits row, bootstrap log
# records the skip, manifest untouched.
echo '{"version":"9.9.9","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
RULE_LOG_18="$HOME/.claude/logs/claudemd.jsonl"
rm -f "$RULE_LOG_18"
OUT18=$(bash "$HOOK" <<<'{"session_id":"sess-stale-18"}' 2>/dev/null)
sleep 3
OBJ18=$(printf '%s' "$OUT18" | jq -s 'length' 2>/dev/null)
POST18=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null)
if [[ "$OBJ18" == "1" && "$POST18" == "9.9.9" ]] \
   && echo "$OUT18" | grep -q 'stale plugin registration' \
   && echo "$OUT18" | grep -q '/claudemd-refresh' \
   && grep -q 'stale plugin root' "$HOME/.claude/logs/claudemd-bootstrap.log" \
   && jq -e 'select(.hook=="session-start" and .event=="stale-root" and .extra.installed_version=="9.9.9")' "$RULE_LOG_18" >/dev/null 2>&1; then
  echo "PASS: 18 stale-root gate skips downgrade + emits refresh banner + telemetry"
else
  echo "FAIL: 18 (objects=$OBJ18 post_ver=$POST18 out=$OUT18 log=$(head -3 "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null))"
  FAIL=$((FAIL+1))
fi

# --- v0.50.0 bootstrap-failure banner cases ---
# Background install.js failures were invisible in-session (only a
# claudemd-bootstrap.log line). The wrapper now writes a failure sentinel;
# the NEXT SessionStart banners it and consumes the sentinel.
BOOT_SENTINEL="$HOME/.claude/.claudemd-state/bootstrap-failed.json"

# Failure injection: fake `node` shim that exits 1, prepended to PATH — the
# hook's `command -v node` resolves the shim, so install.js "runs" and fails.
mkdir -p "$TMP_HOME/fakebin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP_HOME/fakebin/node"
chmod +x "$TMP_HOME/fakebin/node"

# Case 19: background install failure writes the failure sentinel with the
# attempted from→to versions, and the bootstrap log records the non-zero exit.
rm -f "$BOOT_SENTINEL" "$BOOT_SENTINEL.last-shown" 2>/dev/null || true
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
PATH="$TMP_HOME/fakebin:$PATH" bash "$HOOK" <<<'{}' >/dev/null 2>&1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$BOOT_SENTINEL" ]] && break
  sleep 0.5
done
TO19=$(jq -r '.to // ""' "$BOOT_SENTINEL" 2>/dev/null)
PLUGIN_VER_REAL=$(jq -r .version "$PLUGIN_ROOT/package.json")
if [[ -f "$BOOT_SENTINEL" && "$TO19" == "$PLUGIN_VER_REAL" ]] \
   && grep -q 'non-zero or timed out' "$HOME/.claude/logs/claudemd-bootstrap.log"; then
  echo "PASS: 19 failed background install writes failure sentinel"
else
  echo "FAIL: 19 (sentinel=$([[ -f $BOOT_SENTINEL ]] && echo yes || echo no) to=$TO19 log=$(tail -2 "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null))"
  FAIL=$((FAIL+1))
fi

# Case 19b (round-17 FLW-H1): a DETACHED install that stood down is not a
# failure. install.js exits 3 when another process already holds install.lock;
# the wrapper read every non-zero code as "exited non-zero or timed out" and
# wrote the failure sentinel, so the next session bannered a bootstrap failure
# that had not happened. Before the exit-code split the same run exited 0 and
# took the CLEAR arm instead, erasing a banner a real earlier failure was owed —
# the two opposite wrong answers this one code separates.
rm -f "$BOOT_SENTINEL" "$BOOT_SENTINEL.last-shown" 2>/dev/null || true
printf '#!/usr/bin/env bash\nexit 3\n' > "$TMP_HOME/fakebin/node"
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
PATH="$TMP_HOME/fakebin:$PATH" bash "$HOOK" <<<'{}' >/dev/null 2>&1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  grep -q 'stood down' "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null && break
  sleep 0.5
done
LOG19B=$(cat "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || echo "")
if grep -qF 'bootstrap stood down — another install holds the lock' <<<"$LOG19B" \
   && [[ ! -f "$BOOT_SENTINEL" ]] \
   && ! grep -qF 'non-zero or timed out' <<<"$LOG19B"; then
  echo "PASS: 19b a detached install that stood down writes no failure sentinel"
else
  echo "FAIL: 19b (sentinel=$([[ -f $BOOT_SENTINEL ]] && echo yes || echo no) log=$LOG19B)"
  FAIL=$((FAIL+1))
fi
# Restore the exit-1 shim — every case below this one depends on it.
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP_HOME/fakebin/node"

# Case 20: sentinel present + manifest still mismatched → next SessionStart
# emits exactly ONE JSON banner (the retry spawn is stdout-silent) and
# consumes the sentinel so a healthy follow-up session stays quiet.
[[ -f "$BOOT_SENTINEL" ]] || printf '{"ts":"2026-07-15T00:00:00Z","from":"0.0.1","to":"%s"}\n' "$PLUGIN_VER_REAL" > "$BOOT_SENTINEL"
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
OUT20=$(bash "$HOOK" <<<'{}' 2>/dev/null)
OBJ20=$(printf '%s' "$OUT20" | jq -s 'length' 2>/dev/null)
# Wait out the background retry (real node — it will succeed) so its writes
# can't bleed into later cases.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  V=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
  [[ "$V" == "$PLUGIN_VER_REAL" ]] && break
  sleep 0.5
done
if [[ "$OBJ20" == "1" && ! -f "$BOOT_SENTINEL" ]] \
   && echo "$OUT20" | grep -q 'background upgrade failed' \
   && echo "$OUT20" | grep -q '/claudemd-refresh'; then
  echo "PASS: 20 sentinel + mismatch emits single-object failure banner, consumed"
else
  echo "FAIL: 20 (objects=$OBJ20 sentinel=$([[ -f $BOOT_SENTINEL ]] && echo kept || echo gone) out: $OUT20)"
  FAIL=$((FAIL+1))
fi

# Case 21: sentinel present but versions MATCH (state self-healed, e.g. a
# manual /claudemd-refresh succeeded) → no banner, sentinel silently removed.
printf '{"ts":"2026-07-15T00:00:00Z","from":"0.0.1","to":"%s"}\n' "$PLUGIN_VER_REAL" > "$BOOT_SENTINEL"
echo "{\"version\":\"$PLUGIN_VER_REAL\",\"entries\":[]}" > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/last-session-summary.json" 2>/dev/null || true
touch "$HOME/.claude/.claudemd-state/upstream-check.lastrun"  # skip network
OUT21=$(bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT21" && ! -f "$BOOT_SENTINEL" ]]; then
  echo "PASS: 21 version-match clears stale failure sentinel without banner"
else
  echo "FAIL: 21 (sentinel=$([[ -f $BOOT_SENTINEL ]] && echo kept || echo gone) out: $OUT21)"
  FAIL=$((FAIL+1))
fi

# Case 22: DISABLE_BOOTSTRAP_FAIL_BANNER=1 suppresses the banner on the
# mismatch path (failing retry keeps the sentinel for a later enabled session).
printf '{"ts":"2026-07-15T00:00:00Z","from":"0.0.1","to":"%s"}\n' "$PLUGIN_VER_REAL" > "$BOOT_SENTINEL"
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
OUT22=$(DISABLE_BOOTSTRAP_FAIL_BANNER=1 PATH="$TMP_HOME/fakebin:$PATH" bash "$HOOK" <<<'{}' 2>/dev/null)
sleep 1
if [[ -z "$OUT22" && -f "$BOOT_SENTINEL" ]]; then
  echo "PASS: 22 DISABLE_BOOTSTRAP_FAIL_BANNER=1 suppresses banner, keeps sentinel"
else
  echo "FAIL: 22 (sentinel=$([[ -f $BOOT_SENTINEL ]] && echo yes || echo no) out: $OUT22)"
  FAIL=$((FAIL+1))
fi

# Case 23 (v0.55.0): marketplace cache holds a build NEWER than the running
# plugin root → local stale-registration banner fires, with NO network (the
# ls-remote mock hard-fails, proving the check is cache-local). This is the
# axis upstream_check is blind to: after a release + marketplace update,
# cache max == remote tag, so remote>local never fires — reproduced
# 2026-07-25 (running 0.52.0, cache + remote both 0.54.0, zero banners).
mkdir -p "$TMP_HOME/cache/9.9.9"
rm -f "$HOME/.claude/.claudemd-state/upstream-check.lastrun" 2>/dev/null || true
rm -f "$HOME/.claude/.claudemd-state/last-session-summary.json" 2>/dev/null || true
echo "{\"version\":\"$PLUGIN_VER_REAL\",\"entries\":[]}" > "$HOME/.claude/.claudemd-manifest.json"
OUT23=$(CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-fail.sh" \
        CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
        DISABLE_UPSTREAM_CHECK=0 \
        bash "$HOOK" <<<'{}' 2>/dev/null)
if echo "$OUT23" | grep -q 'stale plugin registration' \
   && echo "$OUT23" | grep -q 'v9.9.9' \
   && echo "$OUT23" | grep -q '/claudemd-refresh'; then
  echo "PASS: 23 stale-cache banner fires when cache max > running root (network-free)"
else
  echo "FAIL: 23 stale-cache banner missing (out: $OUT23)"; FAIL=$((FAIL+1))
fi

# Case 24: DISABLE_UPSTREAM_CHECK=1 suppresses the stale-cache banner too
# (same knob as the remote upstream banner — one env var governs both axes).
rm -f "$HOME/.claude/.claudemd-state/last-session-summary.json" 2>/dev/null || true
OUT24=$(CLAUDEMD_LS_REMOTE_CMD="$TMP_HOME/mock-ls-remote-fail.sh" \
        CLAUDEMD_CACHE_PARENT="$TMP_HOME/cache" \
        DISABLE_UPSTREAM_CHECK=1 \
        bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT24" ]]; then
  echo "PASS: 24 DISABLE_UPSTREAM_CHECK=1 suppresses stale-cache banner"
else
  echo "FAIL: 24 banner leaked under DISABLE_UPSTREAM_CHECK=1 (out: $OUT24)"; FAIL=$((FAIL+1))
fi
rmdir "$TMP_HOME/cache/9.9.9" 2>/dev/null || true

# --- 2026-07-27 audit (M6): spec content drift on the versions-agree branch ---
# Pre-fix the healthy branch compared version NUMBERS only, so a hand-edited
# ~/.claude/CLAUDE.md matched forever. These cases run on the real $PLUGIN_ROOT
# spec dir with a sandbox $HOME, so the shipped files are the reference.
rm -f "$HOME/.claude/.claudemd-state/last-session-summary.json" 2>/dev/null || true
for f in "$PLUGIN_ROOT"/spec/*.md; do cp "$f" "$HOME/.claude/$(basename "$f")"; done

# Case 25: identical copies → silent (no false banner on a healthy install).
OUT25=$(DISABLE_UPSTREAM_CHECK=1 bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT25" ]]; then
  echo "PASS: 25 identical installed spec emits no drift banner"
else
  echo "FAIL: 25 drift banner on a clean install (out: $OUT25)"; FAIL=$((FAIL+1))
fi

# Case 26: one byte appended to an installed spec file → banner naming that file.
printf '\n<!-- hand edit -->\n' >> "$HOME/.claude/CLAUDE.md"
OUT26=$(DISABLE_UPSTREAM_CHECK=1 bash "$HOOK" <<<'{}' 2>/dev/null)
if echo "$OUT26" | grep -q 'installed spec differs' && echo "$OUT26" | grep -q 'CLAUDE.md'; then
  echo "PASS: 26 hand-edited installed spec raises the drift banner"
else
  echo "FAIL: 26 drift banner missing for an edited CLAUDE.md (out: $OUT26)"; FAIL=$((FAIL+1))
fi

# Case 27: the banner is one JSON object, not two concatenated ones — CC parses
# hook stdout with a strict single-value JSON.parse
# (feedback_hook_stdout_single_json_object).
COUNT27=$(printf '%s' "$OUT26" | jq -s 'length' 2>/dev/null || echo "unparseable")
if [[ "$COUNT27" == "1" ]]; then
  echo "PASS: 27 drift banner keeps the single-JSON-object stdout contract"
else
  echo "FAIL: 27 stdout was not exactly one JSON object (got: $COUNT27)"; FAIL=$((FAIL+1))
fi

# Case 28: kill switch.
OUT28=$(DISABLE_UPSTREAM_CHECK=1 DISABLE_SPEC_DRIFT_BANNER=1 bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT28" ]]; then
  echo "PASS: 28 DISABLE_SPEC_DRIFT_BANNER=1 suppresses the drift banner"
else
  echo "FAIL: 28 drift banner leaked under its kill switch (out: $OUT28)"; FAIL=$((FAIL+1))
fi

# --- 2026-07-28: SPEC_DRIFT_IGNORE, the per-file escape ---
# The watched set includes OPERATOR.md, a human runbook a user may annotate in
# their own copy. With only the all-or-nothing switch, one annotated line meant a
# banner every session and the only escape also stopped watching CLAUDE.md — a
# gate that cries wolf ends up disabled. 28c is the control: the skip must be
# per-file, not a second kill switch wearing a filename.
OUT28B=$(DISABLE_UPSTREAM_CHECK=1 SPEC_DRIFT_IGNORE=CLAUDE.md bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT28B" ]]; then
  echo "PASS: 28b SPEC_DRIFT_IGNORE skips the named file"
else
  echo "FAIL: 28b ignored file still raised the banner (out: $OUT28B)"; FAIL=$((FAIL+1))
fi

OUT28C=$(DISABLE_UPSTREAM_CHECK=1 SPEC_DRIFT_IGNORE=OPERATOR.md bash "$HOOK" <<<'{}' 2>/dev/null)
if echo "$OUT28C" | grep -q 'installed spec differs' && echo "$OUT28C" | grep -q 'CLAUDE.md'; then
  echo "PASS: 28c ignoring one file leaves the others watched"
else
  echo "FAIL: 28c SPEC_DRIFT_IGNORE behaved as a global kill switch (out: $OUT28C)"; FAIL=$((FAIL+1))
fi

if echo "$OUT26" | grep -q 'SPEC_DRIFT_IGNORE='; then
  echo "PASS: 28d the banner names the per-file escape at the moment it is needed"
else
  echo "FAIL: 28d banner does not mention SPEC_DRIFT_IGNORE (out: $OUT26)"; FAIL=$((FAIL+1))
fi

# 28e: the banner joins filenames with ", ", so the value it suggests must
# survive being COPIED OUT OF THE BANNER AND PASTED INTO A SHELL — unquoted,
# `SPEC_DRIFT_IGNORE=CLAUDE.md, OPERATOR.md` assigns the first name and then tries
# to run `OPERATOR.md`. Asserting a hand-quoted value here would test the parser,
# not the hint (2026-07-28 review). This lifts the assignment out of the banner
# text and evals it, so the thing under test is what the user actually sees.
printf '\n<!-- hand edit -->\n' >> "$HOME/.claude/OPERATOR.md"
OUT28D2=$(DISABLE_UPSTREAM_CHECK=1 bash "$HOOK" <<<'{}' 2>/dev/null)
SUGGESTED=$(printf '%s' "$OUT28D2" | jq -r '.hookSpecificOutput.additionalContext' 2>/dev/null \
            | grep -oE 'SPEC_DRIFT_IGNORE="[^"]*"')
OUT28E=$(eval "export $SUGGESTED"; DISABLE_UPSTREAM_CHECK=1 bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -n "$SUGGESTED" && -z "$OUT28E" ]]; then
  echo "PASS: 28e the banner's own suggestion, pasted verbatim, silences it"
else
  echo "FAIL: 28e suggestion '$SUGGESTED' did not suppress both files (out: $OUT28E)"; FAIL=$((FAIL+1))
fi
cp "$PLUGIN_ROOT/spec/OPERATOR.md" "$HOME/.claude/OPERATOR.md"

# Case 29: an absent installed spec file is not reported as DRIFT — it gets its
# own banner instead (Case 39). Both halves matter and this case owns the first:
# the two states have different fixes (/claudemd-update vs /claudemd-install),
# so collapsing absence into the drift wording would send the user to a command
# that diffs a file which is not there.
#
# Until 2026-09-08 this case asserted SILENCE, on the reading that install.js
# decides which files ship to ~/.claude and one this version does not install
# must not raise a banner. That case is hypothetical — paths.js#SPEC_FILES is
# the install list and it is every .md the hook's glob returns — while the case
# the silence actually covered is real: the user's spec was deleted.
rm -f "$HOME/.claude/CLAUDE.md"
OUT29=$(DISABLE_UPSTREAM_CHECK=1 bash "$HOOK" <<<'{}' 2>/dev/null)
CTX29=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT29" 2>/dev/null)
if grep -qF 'MISSING' <<<"$CTX29" && ! grep -qF 'differs from the shipped spec' <<<"$CTX29"; then
  echo "PASS: 29 absent installed spec file is reported as missing, not as drift"
else
  echo "FAIL: 29 absent file mis-classified (out: $OUT29)"; FAIL=$((FAIL+1))
fi
cp "$PLUGIN_ROOT/spec/CLAUDE.md" "$HOME/.claude/CLAUDE.md"

# --- v0.75.0 sync fresh-install bootstrap ---
# The three cases below pin WHICH path each state takes, read off the bootstrap
# log's own header line. Case 2 already proved the fresh path lands the manifest
# before the hook returns; these prove that is a deliberate branch and not an
# accident of a fast machine — an async spawn that happened to win the race
# would satisfy Case 2 on this box and fail it on a loaded CI runner.
SYNC_MARK='fresh-install bootstrap (sync)'

# Case 30: fresh state → sync header in the log, and the manifest is already
# there. Distinct from Case 2 in that it names the branch, not just the effect.
rm -f "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_TXT=$(cat "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || echo "")
if [[ -z "$STDERR" ]] && grep -qF "$SYNC_MARK" <<<"$LOG_TXT" \
   && [[ -f "$HOME/.claude/.claudemd-manifest.json" ]]; then
  echo "PASS: 30 fresh install takes the sync branch"
else
  echo "FAIL: 30 fresh install did not take the sync branch (stderr=$STDERR log=$LOG_TXT)"
  FAIL=$((FAIL+1))
fi

# Case 31: CLAUDEMD_FORCE_ASYNC_BOOTSTRAP=1 restores the pre-0.75.0 behavior on
# the same fresh state — the escape hatch has to actually reach the old path,
# or it is a knob that only looks like one.
rm -f "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
STDERR=$(CLAUDEMD_FORCE_ASYNC_BOOTSTRAP=1 bash "$HOOK" <<<'{}' 2>&1)
# The detached header is written by hook_spawn_install's BACKGROUND subshell, so
# reading the log the instant the hook returns races it (pre-tag review NOTE 3).
# The parent only spawns jq + hook_record before exiting, so the child normally
# wins on an idle box — which is exactly why an unordered read passes here and
# flakes red on a loaded CI runner. Poll for the header, the same idiom this
# case already uses below for the manifest. The NEGATIVE half (no sync marker)
# is race-free: a marker that is never written cannot appear late.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  grep -qF 'SessionStart bootstrap' "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null && break
  sleep 0.5
done
LOG_TXT=$(cat "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || echo "")
if [[ -z "$STDERR" ]] && ! grep -qF "$SYNC_MARK" <<<"$LOG_TXT" \
   && grep -qF 'SessionStart bootstrap' <<<"$LOG_TXT"; then
  echo "PASS: 31 CLAUDEMD_FORCE_ASYNC_BOOTSTRAP=1 restores the detached path"
else
  echo "FAIL: 31 force-async knob did not reach the detached path (stderr=$STDERR log=$LOG_TXT)"
  FAIL=$((FAIL+1))
fi
# Let the detached install settle before the next case rewrites the manifest —
# and before the EXIT trap removes the dir out from under it.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -f "$HOME/.claude/.claudemd-manifest.json" ]] && break
  sleep 0.5
done

# Case 32: the UPGRADE path stays detached. Blocking session start is justified
# only where there is no spec on disk at all; with an older one already there,
# a few seconds of stale spec is the cheaper failure.
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
echo '{"version":"0.0.1","entries":[]}' > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
STDERR=$(bash "$HOOK" <<<'{}' 2>&1)
LOG_TXT=$(cat "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || echo "")
if [[ -z "$STDERR" ]] && ! grep -qF "$SYNC_MARK" <<<"$LOG_TXT" \
   && grep -qF 'auto-upgrade' <<<"$LOG_TXT"; then
  echo "PASS: 32 version-mismatch upgrade stays on the detached path"
else
  echo "FAIL: 32 upgrade path took the sync branch (stderr=$STDERR log=$LOG_TXT)"
  FAIL=$((FAIL+1))
fi
for _ in 1 2 3 4 5 6 7 8 9 10; do
  NEW_VER=$(jq -r .version "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
  [[ -n "$NEW_VER" && "$NEW_VER" != "0.0.1" ]] && break
  sleep 0.5
done

# Case 32b (round-17 FLW-H1): a held install.lock must stand down VISIBLY.
# install.js returned `skipped-locked` with exit 0, so this hook took the
# success arm: it cleared the bootstrap-failed sentinel and recorded a
# `bootstrap-sync` row for a run that copied nothing. Three sandboxed sessions
# were measured at rc 0, empty stdout, and neither manifest nor spec on disk.
# The assertion that discriminates is the NEGATIVE one — no `bootstrap-sync`
# row — because the log line and the manifest check both passed before the fix
# too (the log said "(sync)", the manifest was simply never written).
MANIFEST_32B_SAVE=$(cat "$HOME/.claude/.claudemd-manifest.json" 2>/dev/null || echo "")
rm -f "$HOME/.claude/.claudemd-manifest.json"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
: > "$HOME/.claude/logs/claudemd-bootstrap.log"
RULE_LOG_32B="$HOME/.claude/logs/claudemd.jsonl"
rm -f "$RULE_LOG_32B"
mkdir -p "$HOME/.claude/.claudemd-state"
# A REAL running process holds it. A made-up pid no longer works: since round-17
# install.js takes over a lock whose owner is gone, so `pid: 999999` would
# describe an abandoned lock and this case would test the opposite branch.
sleep 60 &
LOCK_PID_32B=$!
printf '{"pid":%s,"startedAt":"%s"}\n' "$LOCK_PID_32B" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$HOME/.claude/.claudemd-state/install.lock"
STDERR=$(bash "$HOOK" <<<'{"session_id":"sess-standdown-32b"}' 2>&1)
LOG_TXT=$(cat "$HOME/.claude/logs/claudemd-bootstrap.log" 2>/dev/null || echo "")
kill "$LOCK_PID_32B" 2>/dev/null || true
wait "$LOCK_PID_32B" 2>/dev/null || true
rm -f "$HOME/.claude/.claudemd-state/install.lock"
if [[ -z "$STDERR" ]] \
   && grep -qF 'stood down — another install holds the lock' <<<"$LOG_TXT" \
   && [[ ! -f "$HOME/.claude/.claudemd-manifest.json" ]] \
   && ! grep -qF 'retrying detached' <<<"$LOG_TXT" \
   && ! jq -e 'select(.hook=="session-start" and .event=="bootstrap-sync")' "$RULE_LOG_32B" >/dev/null 2>&1 \
   && jq -e 'select(.hook=="session-start" and .event=="bootstrap-stand-down")' "$RULE_LOG_32B" >/dev/null 2>&1; then
  echo "PASS: 32b a held lock stands down without claiming an install"
else
  echo "FAIL: 32b held lock reported as an install (stderr=$STDERR manifest=$([[ -f "$HOME/.claude/.claudemd-manifest.json" ]] && echo yes || echo no) rows=$(jq -r 'select(.hook=="session-start") | .event' "$RULE_LOG_32B" 2>/dev/null | tr '\n' ',') log=$LOG_TXT)"
  FAIL=$((FAIL+1))
fi
[[ -n "$MANIFEST_32B_SAVE" ]] && printf '%s\n' "$MANIFEST_32B_SAVE" > "$HOME/.claude/.claudemd-manifest.json"
rm -f "$RULE_LOG_32B"

# --- v0.75.0 user-content overwrite banner ---
# install.js has warned on stderr since v0.5.3 that it moved a hand-written
# ~/.claude/CLAUDE.md aside, but every bootstrap path redirects stderr into
# claudemd-bootstrap.log — so on the default install route (no /claudemd-install)
# the notice was unreachable and the user's user-global instructions silently
# stopped applying. These cases pin that it now reaches stdout as a banner, once.
UC_SENTINEL="$HOME/.claude/.claudemd-state/user-content-backup.json"
uc_reset_fresh() {
  rm -f "$HOME/.claude/.claudemd-manifest.json" "$UC_SENTINEL"
  rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
  printf '# My personal instructions\nAlways reply in 中文.\n' > "$HOME/.claude/CLAUDE.md"
}

# Case 33: the banner lands in the SAME session as the overwrite, and stdout is
# still ONE JSON object — CC parses it with a strict single-value JSON.parse, so
# a second object here would silently drop every banner, not just this one.
uc_reset_fresh
OUT33=$(bash "$HOOK" <<<'{}' 2>/dev/null)
CTX33=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT33" 2>/dev/null || echo "")
# The backup path is matched by SHAPE, and separately confirmed to exist on
# disk — never by interpolating $HOME into an ERE. That spelling failed on
# macOS CI only: BSD mktemp leaves the `//` that `"${TMPDIR:-/tmp}/…"` creates
# when $TMPDIR ends in a slash (GNU mktemp folds it), so $HOME carried a double
# slash while the path Node wrote into the banner was normalized to one. A
# filesystem path is not a regex — any `+` or `.` in a temp dir breaks it the
# same way on any platform. Checking the directory is really there is also the
# stronger claim: the message is only useful if it names a file that exists.
# Pulled OUT of the message rather than guessed from the directory: earlier
# cases leave their own backup dirs behind, so any `ls | head -1` picks a
# stale one and tests something other than what the user was just told.
UC_BK=$(grep -oE '/[^ ]*/\.claude/backup-[0-9]{8}T[0-9]{6}[0-9]*Z/CLAUDE\.md' <<<"$CTX33" | head -1)
if [[ "$(jq -s 'length' <<<"$OUT33" 2>/dev/null)" == "1" ]] \
   && grep -qF 'CLAUDEMD_SPEC_ACTION=restore' <<<"$CTX33" \
   && [[ -n "$UC_BK" && -f "$UC_BK" ]] \
   && grep -qF 'My personal instructions' "$UC_BK"; then
  echo "PASS: 33 user-content overwrite is bannered in-session with the backup path"
else
  echo "FAIL: 33 no in-session user-content banner (out=$OUT33 backup=$UC_BK)"; FAIL=$((FAIL+1))
fi

# Case 34: consume-once. The sentinel is removed, so the next session is silent —
# a banner that repeats every session is one users learn to ignore.
if [[ ! -f "$UC_SENTINEL" ]] && [[ -z "$(bash "$HOOK" <<<'{}' 2>/dev/null)" ]]; then
  echo "PASS: 34 user-content banner fires once and consumes its sentinel"
else
  echo "FAIL: 34 sentinel survived or banner repeated"; FAIL=$((FAIL+1))
fi

# Case 35: no false positive. A fresh install with no pre-existing CLAUDE.md
# overwrites nothing of the user's, so nothing is claimed.
rm -f "$HOME/.claude/.claudemd-manifest.json" "$UC_SENTINEL"
rm -f "$HOME/.claude/.claudemd-state/installed.json" "$HOME/.claude/CLAUDE.md" 2>/dev/null || true
OUT35=$(bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT35" ]]; then
  echo "PASS: 35 no user-content banner when nothing of the user's was overwritten"
else
  echo "FAIL: 35 banner emitted on a clean fresh install (out=$OUT35)"; FAIL=$((FAIL+1))
fi

# Case 36: DISABLE_USER_CONTENT_BANNER=1 suppresses the banner AND consumes the
# sentinel. Both halves are the assertion: an opt-out that returned past the
# sentinel would leave a fixed-name singleton no reaper names (clean-residue's
# STATE_EPHEMERAL is a per-session allowlist), and unsetting the knob later
# would fire a banner naming a backup dir prune may have evicted.
uc_reset_fresh
OUT36=$(DISABLE_USER_CONTENT_BANNER=1 bash "$HOOK" <<<'{}' 2>/dev/null)
if [[ -z "$OUT36" ]] && [[ ! -f "$UC_SENTINEL" ]]; then
  echo "PASS: 36 DISABLE_USER_CONTENT_BANNER=1 suppresses the notice and leaves no residue"
else
  echo "FAIL: 36 kill-switch did not suppress, or leaked the sentinel (out=$OUT36)"; FAIL=$((FAIL+1))
fi
rm -f "$UC_SENTINEL"

# Case 36b: the sentinel is written BEFORE the rename it records (install.js,
# Round-14 SCR-H1), so a kill in between leaves a sentinel naming a backup dir
# that does not hold the file. That is a DIFFERENT state from a completed
# overwrite — the user's instructions are most likely still in place — and this
# banner must say so instead of telling them their file was moved somewhere it
# is not. Driven with a hand-written sentinel over an already-installed manifest
# so no bootstrap runs and rewrites it.
uc_reset_fresh
bash "$HOOK" <<<'{}' >/dev/null 2>&1
UC_EMPTY="$HOME/.claude/backup-20200101T000000000Z"
mkdir -p "$UC_EMPTY" "$HOME/.claude/.claudemd-state"
jq -cn --arg d "$UC_EMPTY" '{ts:"2026-09-07T00:00:00Z",backupDir:$d}' > "$UC_SENTINEL"
OUT36B=$(bash "$HOOK" <<<'{}' 2>/dev/null)
CTX36B=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT36B" 2>/dev/null || echo "")
if grep -qF 'an install was interrupted' <<<"$CTX36B" \
   && grep -qF "$UC_EMPTY" <<<"$CTX36B" \
   && ! grep -qF 'NO LONGER in effect' <<<"$CTX36B" \
   && [[ ! -f "$UC_SENTINEL" ]]; then
  echo "PASS: 36b an interrupted move is reported as interrupted, not as a completed backup"
else
  echo "FAIL: 36b (out=$OUT36B)"; FAIL=$((FAIL+1))
fi
rm -rf "$UC_EMPTY"
rm -f "$UC_SENTINEL"

# Case 36c: the backup entry is a DANGLING SYMLINK, which is what createBackup
# leaves for a stow/chezmoi spec — it re-points the link into the backup dir
# rather than copying bytes, and install classifies an unreadable ~/.claude/
# CLAUDE.md as user content. `-e` follows links, so a fully SUCCESSFUL install
# in exactly the dotfiles shape those two blocks exist for was reported as
# interrupted, and the banner naming CLAUDEMD_SPEC_ACTION=restore — the one the
# user needs — was suppressed (v0.81.0 pre-tag review, MEDIUM-1).
uc_reset_fresh
bash "$HOOK" <<<'{}' >/dev/null 2>&1
UC_LINKDIR="$HOME/.claude/backup-20200102T000000000Z"
mkdir -p "$UC_LINKDIR" "$HOME/.claude/.claudemd-state"
ln -s "$HOME/dotfiles-gone/CLAUDE.md" "$UC_LINKDIR/CLAUDE.md"
jq -cn --arg d "$UC_LINKDIR" '{ts:"2026-09-07T00:00:00Z",backupDir:$d}' > "$UC_SENTINEL"
OUT36C=$(bash "$HOOK" <<<'{}' 2>/dev/null)
CTX36C=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT36C" 2>/dev/null || echo "")
if grep -qF 'NO LONGER in effect' <<<"$CTX36C" \
   && grep -qF 'CLAUDEMD_SPEC_ACTION=restore' <<<"$CTX36C" \
   && ! grep -qF 'an install was interrupted' <<<"$CTX36C" \
   && [[ ! -f "$UC_SENTINEL" ]]; then
  echo "PASS: 36c a backed-up dangling symlink is a completed move, not an interrupted one"
else
  echo "FAIL: 36c (out=$OUT36C)"; FAIL=$((FAIL+1))
fi
rm -rf "$UC_LINKDIR"
rm -f "$UC_SENTINEL"

# Case 37: the two guards this release added to the pre-bootstrap exits. They
# are the paths that FIX the banner-loss bug (a pending consume-once banner used
# to be dropped when the hook bailed before the install), so leaving them
# uncovered would let the fix regress silently (pre-tag review NOTE 6).
# Driven with a pending bootstrap-failed sentinel (same shape Cases 20/22 use)
# and a PATH that carries jq but not node.
rm -f "$HOME/.claude/.claudemd-manifest.json" "$UC_SENTINEL"
rm -f "$HOME/.claude/.claudemd-state/installed.json" 2>/dev/null || true
mkdir -p "$HOME/.claude/.claudemd-state"
printf '{"ts":"2026-09-05T00:00:00Z","from":"0.74.2","to":"0.75.0"}\n' \
  > "$HOME/.claude/.claudemd-state/bootstrap-failed.json"
NODELESS_PATH="$(dirname "$(command -v jq)"):/usr/bin:/bin"
if PATH="$NODELESS_PATH" command -v node >/dev/null 2>&1; then
  echo "PASS: 37 node-absent guard (skipped — node reachable from a stripped PATH here)"
else
  OUT37=$(PATH="$NODELESS_PATH" bash "$HOOK" <<<'{}' 2>/dev/null)
  if [[ "$(jq -s 'length' <<<"$OUT37" 2>/dev/null)" == "1" ]] \
     && grep -qF 'background upgrade failed' <<<"$OUT37"; then
    echo "PASS: 37 node-absent still emits its pending banner, as one object"
  else
    echo "FAIL: 37 pending banner dropped when node is absent (out=$OUT37)"; FAIL=$((FAIL+1))
  fi
fi
rm -f "$HOME/.claude/.claudemd-state/bootstrap-failed.json"* 2>/dev/null || true

# ── QA 2026-09-08: two self-heal gaps ──────────────────────────────────────
#
# Case 38: a manifest that EXISTS but does not PARSE. Pre-fix this read as an
# installed state: the version probe pulls `.version` with jq, gets empty, and
# the "skip when either side is unknown" guard — written for pre-0.1.9 manifests
# that legitimately lack .version — exits 0. So the session after a truncated
# write repaired nothing, and neither did any session after that, while
# /claudemd-doctor called the file "missing" and sent the user to
# `/plugin install`, a no-op on an installed plugin. install.js writes this file
# atomically and last, so re-entering the bootstrap IS the repair.
echo '{{{not json' > "$HOME/.claude/.claudemd-manifest.json"
bash "$HOOK" <<<'{}' >/dev/null 2>&1
if jq -e . "$HOME/.claude/.claudemd-manifest.json" >/dev/null 2>&1 \
   && [[ "$(jq '.entries | length' "$HOME/.claude/.claudemd-manifest.json")" -gt 0 ]]; then
  echo "PASS: 38 unparseable manifest re-bootstraps instead of exiting silently"
else
  echo "FAIL: 38 unparseable manifest left unrepaired"; FAIL=$((FAIL+1))
fi

# Case 38b: the jq gate. Without jq we cannot tell "corrupt" from "legacy, no
# .version", and the historical skip is the safer read of an ambiguous file —
# it must NOT turn into a bootstrap loop on every session.
JQLESS_DIR=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-nojq-XXXXXX")
for b in bash node cat rm mkdir cp mv date wc sed grep tr find sort head tail chmod git; do
  P=$(command -v "$b" 2>/dev/null) && ln -sf "$P" "$JQLESS_DIR/$b"
done
echo '{{{not json' > "$HOME/.claude/.claudemd-manifest.json"
PATH="$JQLESS_DIR" bash "$HOOK" <<<'{}' >/dev/null 2>&1
if [[ "$(cat "$HOME/.claude/.claudemd-manifest.json")" == '{{{not json' ]]; then
  echo "PASS: 38b jq-absent leaves the ambiguous manifest alone (no blind rewrite)"
else
  echo "FAIL: 38b jq-absent rewrote a manifest it could not adjudicate"; FAIL=$((FAIL+1))
fi
rm -rf "$JQLESS_DIR"
# Repair the manifest for the cases below.
bash "$HOOK" <<<'{}' >/dev/null 2>&1

# Case 39: an installed spec file that is GONE. `Absent is not drift` used to
# skip it outright, so an EDITED spec bannered while a DELETED one said nothing
# — and CC reads ~/.claude/CLAUDE.md as user-global instructions, so absence
# silently unloads the whole spec. The fix differs from drift's, so the banner
# must name /claudemd-install rather than /claudemd-update.
cp "$HOME/.claude/CLAUDE.md" "$HOME/CLAUDE.md.bak"
rm -f "$HOME/.claude/CLAUDE.md"
OUT39=$(bash "$HOOK" <<<'{}' 2>/dev/null)
CTX39=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT39" 2>/dev/null)
if [[ "$(jq -s 'length' <<<"$OUT39" 2>/dev/null)" == "1" ]] \
   && grep -qF 'MISSING' <<<"$CTX39" \
   && grep -qF 'CLAUDE.md' <<<"$CTX39" \
   && grep -qF '/claudemd-install' <<<"$CTX39"; then
  echo "PASS: 39 deleted spec file raises a banner naming /claudemd-install"
else
  echo "FAIL: 39 deleted spec was silent or mis-advised (ctx=$CTX39)"; FAIL=$((FAIL+1))
fi
cp "$HOME/CLAUDE.md.bak" "$HOME/.claude/CLAUDE.md"; rm -f "$HOME/CLAUDE.md.bak"

# Case 39d (v0.84.0 pre-ship review, M3): the four files are not read the same
# way, so one sentence cannot be true of all of them. Only ~/.claude/CLAUDE.md is
# injected by the harness every session; CLAUDE-extended.md is read on demand per
# §2.2, and OPERATOR.md / CLAUDE-changelog.md are not read by Claude Code at all.
# The banner claimed "the spec is not loaded this session" for whichever file
# went missing, which is false for three of the four.
cp "$HOME/.claude/OPERATOR.md" "$HOME/OPERATOR.md.bak"
rm -f "$HOME/.claude/OPERATOR.md"
CTX39D=$(bash "$HOOK" <<<'{}' 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // ""')
if grep -qF 'OPERATOR.md' <<<"$CTX39D" \
   && grep -qF 'core spec is still loaded' <<<"$CTX39D" \
   && ! grep -qF 'not loaded this session' <<<"$CTX39D"; then
  echo "PASS: 39d a non-injected spec file is reported without claiming the spec went unloaded"
else
  echo "FAIL: 39d wrong consequence for a non-injected file (ctx=$CTX39D)"; FAIL=$((FAIL+1))
fi
cp "$HOME/OPERATOR.md.bak" "$HOME/.claude/OPERATOR.md"; rm -f "$HOME/OPERATOR.md.bak"

# Case 39e: and CLAUDE.md itself still earns the strong sentence — the severe
# case must not be softened by the fix for the mild one.
cp "$HOME/.claude/CLAUDE.md" "$HOME/CLAUDE.md.bak2"
rm -f "$HOME/.claude/CLAUDE.md"
CTX39E=$(bash "$HOOK" <<<'{}' 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // ""')
if grep -qF 'core spec is not loaded this session' <<<"$CTX39E"; then
  echo "PASS: 39e a missing CLAUDE.md still says the core spec is not loaded"
else
  echo "FAIL: 39e lost the severe case (ctx=$CTX39E)"; FAIL=$((FAIL+1))
fi
cp "$HOME/CLAUDE.md.bak2" "$HOME/.claude/CLAUDE.md"; rm -f "$HOME/CLAUDE.md.bak2"

# Case 39b: control — a healthy install must stay silent on this axis. Without
# it, a banner that fired unconditionally would pass Case 39.
OUT39B=$(bash "$HOOK" <<<'{}' 2>/dev/null)
if ! grep -qF 'MISSING' <<<"$OUT39B"; then
  echo "PASS: 39b healthy install raises no missing-spec banner"
else
  echo "FAIL: 39b missing-spec banner fired on a healthy install (out=$OUT39B)"; FAIL=$((FAIL+1))
fi

# Case 39c: drift still reports as drift. The missing-spec branch returns early,
# so an edited-but-present file must not be swallowed by it.
printf 'locally edited\n' > "$HOME/.claude/OPERATOR.md"
OUT39C=$(bash "$HOOK" <<<'{}' 2>/dev/null)
CTX39C=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT39C" 2>/dev/null)
if grep -qF 'differs from the shipped spec' <<<"$CTX39C" && grep -qF 'OPERATOR.md' <<<"$CTX39C"; then
  echo "PASS: 39c an edited spec still reports as drift, not as missing"
else
  echo "FAIL: 39c drift banner lost to the missing-spec branch (ctx=$CTX39C)"; FAIL=$((FAIL+1))
fi
cp "$PLUGIN_ROOT/spec/OPERATOR.md" "$HOME/.claude/OPERATOR.md"

# Case 40 (hook-root ground truth): a compact-source SessionStart still
# records the root it fired from. This is precisely the case the OLD line
# order could not reach — PLUGIN_ROOT used to be assigned AFTER the compact
# early-exit, so a compact invocation returned before the variable existed.
RESOLVED_PLUGIN_ROOT="$(cd "$PLUGIN_ROOT" && pwd)"
HOOKROOT_STATE="$HOME/.claude/.claudemd-state/hook-root.json"
rm -f "$HOOKROOT_STATE"
bash "$HOOK" <<<'{"session_id":"root-t","source":"compact"}' >/dev/null 2>/dev/null
if [[ -f "$HOOKROOT_STATE" ]] \
   && grep -qF "\"root\":\"$RESOLVED_PLUGIN_ROOT\"" "$HOOKROOT_STATE" 2>/dev/null \
   && grep -qF '"sid":"root-t"' "$HOOKROOT_STATE" 2>/dev/null; then
  echo "PASS: 40 compact source records the hook root"
else
  echo "FAIL: 40 compact source did not record the hook root (state: $(cat "$HOOKROOT_STATE" 2>/dev/null))"; FAIL=$((FAIL+1))
fi

# Case 41 (G7 ledger injection). The ledger is the artifact a long task carries
# across a compaction; these cover both directions, because "no ledger" and
# "ledger read" must not produce the same output.
LEDGER_PROJ="$HOME/ledgerproj"
mkdir -p "$LEDGER_PROJ/tasks"
cat > "$LEDGER_PROJ/tasks/demo-ledger.md" <<'LEDGEREOF'
# Ledger — demo

## Goal

LEDGER-GOAL-TEXT

## Decisions

- D1: LEDGER-DECISION-TEXT

## Verified-done

- LEDGER-VERIFIED-TEXT

## Open

- LEDGER-OPEN-TEXT

## Next

LEDGER-NEXT-TEXT
LEDGEREOF

OUT41=$(bash "$HOOK" <<<"{\"session_id\":\"lg\",\"source\":\"compact\",\"cwd\":\"$LEDGER_PROJ\"}" 2>/dev/null)
CTX41=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT41" 2>/dev/null)
if [[ "$(jq -s 'length' <<<"$OUT41" 2>/dev/null)" == "1" ]] \
   && grep -qF 'LEDGER-DECISION-TEXT' <<<"$CTX41" \
   && grep -qF 'LEDGER-NEXT-TEXT' <<<"$CTX41" \
   && grep -qF 'compaction detected' <<<"$CTX41"; then
  echo "PASS: 41 compact with a ledger injects Decisions + Next in ONE object, alongside the re-read reminder"
else
  echo "FAIL: 41 ledger injection missing or split across objects (objs=$(jq -s 'length' <<<"$OUT41" 2>/dev/null), ctx=$CTX41)"; FAIL=$((FAIL+1))
fi

# Only those two sections. A banner that carried Verified-done would spend the
# context the compaction was trying to recover, and Goal/Open are re-derivable
# from the work itself.
if ! grep -qF 'LEDGER-VERIFIED-TEXT' <<<"$CTX41" \
   && ! grep -qF 'LEDGER-OPEN-TEXT' <<<"$CTX41" \
   && ! grep -qF 'LEDGER-GOAL-TEXT' <<<"$CTX41"; then
  echo "PASS: 41b only Decisions and Next are carried — Goal / Verified-done / Open are not"
else
  echo "FAIL: 41b the banner carried a section it should not (ctx=$CTX41)"; FAIL=$((FAIL+1))
fi

# The other direction: same event, no ledger on disk.
NOLEDGER_PROJ="$HOME/noledgerproj"
mkdir -p "$NOLEDGER_PROJ/tasks"
OUT41C=$(bash "$HOOK" <<<"{\"session_id\":\"lg\",\"source\":\"compact\",\"cwd\":\"$NOLEDGER_PROJ\"}" 2>/dev/null)
CTX41C=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT41C" 2>/dev/null)
if grep -qF 'compaction detected' <<<"$CTX41C" && ! grep -qF 'long-task ledger' <<<"$CTX41C"; then
  echo "PASS: 41c compact with no ledger still emits the re-read reminder and nothing about a ledger"
else
  echo "FAIL: 41c no-ledger path wrong (ctx=$CTX41C)"; FAIL=$((FAIL+1))
fi

# A ledger whose section headings were renamed yields nothing rather than the
# wrong half of the file.
cat > "$NOLEDGER_PROJ/tasks/renamed-ledger.md" <<'LEDGEREOF'
## Choices

- D1: RENAMED-DECISION-TEXT

## Up next

RENAMED-NEXT-TEXT
LEDGEREOF
OUT41D=$(bash "$HOOK" <<<"{\"session_id\":\"lg\",\"source\":\"compact\",\"cwd\":\"$NOLEDGER_PROJ\"}" 2>/dev/null)
CTX41D=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT41D" 2>/dev/null)
if ! grep -qF 'RENAMED-DECISION-TEXT' <<<"$CTX41D" && ! grep -qF 'long-task ledger' <<<"$CTX41D"; then
  echo "PASS: 41d a ledger with renamed headings is skipped, not partially read"
else
  echo "FAIL: 41d renamed-heading ledger leaked into the banner (ctx=$CTX41D)"; FAIL=$((FAIL+1))
fi
rm -f "$NOLEDGER_PROJ/tasks/renamed-ledger.md"

# Sub-feature kill-switch.
OUT41E=$(DISABLE_LEDGER_INJECT=1 bash "$HOOK" <<<"{\"session_id\":\"lg\",\"source\":\"compact\",\"cwd\":\"$LEDGER_PROJ\"}" 2>/dev/null)
CTX41E=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT41E" 2>/dev/null)
if ! grep -qF 'LEDGER-DECISION-TEXT' <<<"$CTX41E" && grep -qF 'compaction detected' <<<"$CTX41E"; then
  echo "PASS: 41e DISABLE_LEDGER_INJECT=1 drops the ledger half and keeps the reminder"
else
  echo "FAIL: 41e kill-switch wrong (ctx=$CTX41E)"; FAIL=$((FAIL+1))
fi

# A stale ledger is not the state of anything. Age it past the window.
touch -t 200001010000 "$LEDGER_PROJ/tasks/demo-ledger.md" 2>/dev/null
OUT41F=$(bash "$HOOK" <<<"{\"session_id\":\"lg\",\"source\":\"compact\",\"cwd\":\"$LEDGER_PROJ\"}" 2>/dev/null)
CTX41F=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT41F" 2>/dev/null)
if ! grep -qF 'LEDGER-DECISION-TEXT' <<<"$CTX41F"; then
  echo "PASS: 41f a ledger older than the age window is not injected"
else
  echo "FAIL: 41f stale ledger injected (ctx=$CTX41F)"; FAIL=$((FAIL+1))
fi
touch "$LEDGER_PROJ/tasks/demo-ledger.md"

# Case 42 (pre-ship H4): the injected text is actually capped.
# `cut -c1-N` is PER LINE, so the first version bounded each line and nothing
# bounded the total — a 400-line ledger produced a 24,000-character banner, into
# the context a compaction had just been run to reclaim. Both a many-lines and a
# long-line ledger are driven, because a per-line cap passes the second and
# fails the first.
#
# Generated with one `awk`, not with shell loops / `head -c /dev/zero` / `tr
# '\0'`. The first spelling used all three and the macOS leg took the suite from
# 20s to a 300s timeout while Linux ran it in 22s; `tr` with a NUL operand is the
# one construct there that BSD and GNU do not agree on. The bodies below are
# sized just past the 1600 cap rather than 10-30x past it — a cap either holds or
# it does not, and the extra bytes only bought the timeout.
BIG_PROJ="$HOME/bigledgerproj"
mkdir -p "$BIG_PROJ/tasks"

# 60 lines x ~55 chars = ~3300 chars: over the cap, cheap to build and to read.
awk 'BEGIN {
  print "## Decisions"; print ""
  for (i = 1; i <= 60; i++) print "- D" i ": decision line " i " with enough text to matter"
  print ""; print "## Next"; print ""; print "keep going"
}' > "$BIG_PROJ/tasks/big-ledger.md"
OUT42=$(bash "$HOOK" <<<"{\"session_id\":\"big\",\"source\":\"compact\",\"cwd\":\"$BIG_PROJ\"}" 2>/dev/null)
CTX42=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT42" 2>/dev/null)
CTX42_LEN=${#CTX42}
if (( CTX42_LEN > 0 && CTX42_LEN < 2600 )); then
  echo "PASS: 42 a 60-line ledger is capped (banner ${CTX42_LEN} chars: 1600 cap + the reminder)"
else
  echo "FAIL: 42 many-line ledger not capped (banner ${CTX42_LEN} chars)"; FAIL=$((FAIL+1))
fi

# One line, over the cap. This shape PASSED under the per-line `cut`, so it is
# the control that keeps case 42 honest about which bound it measures.
awk 'BEGIN {
  print "## Decisions"; print ""
  s = ""; for (i = 0; i < 2500; i++) s = s "y"; print s
  print ""; print "## Next"; print ""; print "keep going"
}' > "$BIG_PROJ/tasks/big-ledger.md"
OUT42B=$(bash "$HOOK" <<<"{\"session_id\":\"big\",\"source\":\"compact\",\"cwd\":\"$BIG_PROJ\"}" 2>/dev/null)
CTX42B=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT42B" 2>/dev/null)
CTX42B_LEN=${#CTX42B}
if (( CTX42B_LEN > 0 && CTX42B_LEN < 2600 )); then
  echo "PASS: 42b a single 2500-char line is capped too (banner ${CTX42B_LEN} chars)"
else
  echo "FAIL: 42b long-line ledger not capped (banner ${CTX42B_LEN} chars)"; FAIL=$((FAIL+1))
fi

# The cap must not be able to emit invalid UTF-8: jq encodes this string, and a
# truncated multibyte tail would make the whole envelope fail to build, taking
# the §11 re-read reminder down with the ledger. jq slices by codepoint, which
# is why the cap lives there rather than in `cut`.
awk 'BEGIN {
  print "## Decisions"; print ""
  for (i = 1; i <= 60; i++) print "- D" i ": 决定 " i ",中文字符串用来测试多字节截断的边界"
  print ""; print "## Next"; print ""; print "继续"
}' > "$BIG_PROJ/tasks/big-ledger.md"
OUT42C=$(bash "$HOOK" <<<"{\"session_id\":\"big\",\"source\":\"compact\",\"cwd\":\"$BIG_PROJ\"}" 2>/dev/null)
if [[ "$(jq -s 'length' <<<"$OUT42C" 2>/dev/null)" == "1" ]] \
   && jq -e '.hookSpecificOutput.additionalContext | length > 0' <<<"$OUT42C" >/dev/null 2>&1 \
   && grep -qF 'compaction detected' <<<"$(jq -r '.hookSpecificOutput.additionalContext' <<<"$OUT42C")"; then
  echo "PASS: 42c a multibyte ledger still produces one valid object carrying both banners"
else
  echo "FAIL: 42c multibyte truncation broke the envelope (out=$OUT42C)"; FAIL=$((FAIL+1))
fi
rm -rf "$BIG_PROJ"

# Case 43 (pre-ship behaviour M1): `resume` delivers the ledger on every
# manifest state, not only the two that happen to reach merge_banners. The
# stale-root row is the one that matters: that is the session being told to run
# /claudemd-refresh, so it is a long session, so it is one that will compact.
RES_PROJ="$HOME/resumeproj"
mkdir -p "$RES_PROJ/tasks"
printf '## Decisions\n\n- D1: RESUME-DECISION-TEXT\n\n## Next\n\nRESUME-NEXT-TEXT\n' > "$RES_PROJ/tasks/r-ledger.md"
RES_MANIFEST="$HOME/.claude/.claudemd-manifest.json"
cp "$RES_MANIFEST" "$HOME/manifest.bak" 2>/dev/null || true

res_case() {
  local label="$1" expect="$2"
  local out ctx objs
  out=$(bash "$HOOK" <<<"{\"session_id\":\"res\",\"source\":\"resume\",\"cwd\":\"$RES_PROJ\"}" 2>/dev/null)
  objs=$(jq -s 'length' <<<"$out" 2>/dev/null)
  ctx=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$out" 2>/dev/null)
  if [[ "$objs" != "0" && "$objs" != "1" ]]; then
    echo "FAIL: 43 $label emitted $objs JSON objects (must be at most 1)"; FAIL=$((FAIL+1)); return
  fi
  if [[ "$expect" == "yes" ]]; then
    if grep -qF 'RESUME-DECISION-TEXT' <<<"$ctx"; then
      echo "PASS: 43 resume delivers the ledger on the $label manifest state"
    else
      echo "FAIL: 43 resume dropped the ledger on the $label manifest state (objs=$objs ctx=$ctx)"; FAIL=$((FAIL+1))
    fi
  fi
}

# manifest with no .version — used to be a bare `exit 0` before any banner existed
printf '{}\n' > "$RES_MANIFEST"
res_case "no-.version" yes

# installed version NEWER than the plugin — the stale-root branch, which
# printed its own single object and exited
PLUGIN_SEMVER=$(jq -r '.version' "$PLUGIN_ROOT/package.json" 2>/dev/null)
printf '{"version":"99.9.9"}\n' > "$RES_MANIFEST"
OUT43B=$(bash "$HOOK" <<<"{\"session_id\":\"res\",\"source\":\"resume\",\"cwd\":\"$RES_PROJ\"}" 2>/dev/null)
CTX43B=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$OUT43B" 2>/dev/null)
if [[ "$(jq -s 'length' <<<"$OUT43B" 2>/dev/null)" == "1" ]] \
   && grep -qF 'RESUME-DECISION-TEXT' <<<"$CTX43B" \
   && grep -qF 'stale plugin registration' <<<"$CTX43B"; then
  echo "PASS: 43b the stale-root resume carries BOTH its own banner and the ledger, in one object"
else
  echo "FAIL: 43b stale-root resume lost a banner (objs=$(jq -s 'length' <<<"$OUT43B" 2>/dev/null) ctx=$CTX43B)"; FAIL=$((FAIL+1))
fi

# version match — the path that already worked, kept as the control
printf '{"version":"%s"}\n' "$PLUGIN_SEMVER" > "$RES_MANIFEST"
res_case "version-match" yes
cp "$HOME/manifest.bak" "$RES_MANIFEST" 2>/dev/null || true
rm -rf "$RES_PROJ"

# Case 44 (pre-ship behaviour L7): a negative cap must not defeat the cap.
# `--argjson max -5` makes jq read `.[0:-5]` as "all but the last 5", and
# `length > -5` is always true, so one character restored the whole H4 defect.
CAP_PROJ="$HOME/capproj"
mkdir -p "$CAP_PROJ/tasks"
awk 'BEGIN {
  print "## Decisions"; print ""
  for (i = 1; i <= 60; i++) print "- D" i ": decision line " i " with enough text to matter"
  print ""; print "## Next"; print ""; print "go"
}' > "$CAP_PROJ/tasks/cap-ledger.md"
CAP_OK=1
for bad in -5 abc 1e9 ""; do
  o=$(CLAUDEMD_LEDGER_MAX_BYTES="$bad" bash "$HOOK" <<<"{\"session_id\":\"cap\",\"source\":\"compact\",\"cwd\":\"$CAP_PROJ\"}" 2>/dev/null)
  c=$(jq -r '.hookSpecificOutput.additionalContext // ""' <<<"$o" 2>/dev/null)
  if (( ${#c} >= 2600 )); then
    CAP_OK=0
    echo "      cap defeated by CLAUDEMD_LEDGER_MAX_BYTES='$bad' (${#c} chars)"
  fi
done
if [[ "$CAP_OK" == "1" ]]; then
  echo "PASS: 44 a negative / non-numeric / huge cap value cannot defeat the cap"
else
  echo "FAIL: 44 an out-of-shape cap value defeated the cap"; FAIL=$((FAIL+1))
fi
rm -rf "$CAP_PROJ"

# Count SUCCESS-capable labels, suffixes included (2026-07-28 review). The old
# regex stopped at [0-9]+, so 11b/11c/28b/28c/28d/28e collapsed into 11 and 28:
# the suite ran 35 assertions and reported "29/29", and a run where every
# suffixed case failed would still have printed a plausible-looking number. This
# repo quotes those totals as release evidence, so the count has to mean
# assertions. Scanning `"PASS:` only (not FAIL) is what makes it exact here —
# a FAIL-only guard emits nothing on a green run, so counting it would overstate.
# Verified: 35 labels, 35 lines emitted.
TOTAL=$(grep -oE '"PASS: [0-9]+[a-z]*' "$0" | grep -oE '[0-9]+[a-z]*$' | sort -u | wc -l | tr -d ' ')
if (( FAIL > 0 )); then
  echo "Tests: $((TOTAL - FAIL))/$TOTAL passed"; exit 1
fi
echo "Tests: $TOTAL/$TOTAL passed"
