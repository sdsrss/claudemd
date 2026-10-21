#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
# shellcheck disable=SC2015  # `cmd && PASS || FAIL` is the test-assertion idiom here; PASS branch is `echo` which does not fail
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/ship-baseline-check.sh"
MOCKS="$HERE/../fixtures/mock-gh"
TMP_HOME=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME"' EXIT
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

# Case 4b (v0.23.11): incidental `-h` must NOT exempt a real red-CI push.
# Pre-fix the help-exemption grep'd the whole command, so a branch named
# `feature-h` (or a commit msg mentioning `-h` chained before the push)
# matched `-h\b` and silently skipped the §7 CI gate.
cd "$TMP_HOME" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: clean for 4b"
EVENT_BRANCH_H='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push origin feature-h"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_BRANCH_H")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 4b branch -h does not exempt red push" || { echo "FAIL: 4b (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 4c (v0.23.11): real `git push -h` (standalone help flag) still exempts.
EVENT_PUSH_H='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push -h"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_PUSH_H")
[[ -z "$OUT" ]] && echo "PASS: 4c git push -h still exempt" || { echo "FAIL: 4c (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 5: non-push command → pass
OUT=$(run_hook fail-red "$EVENT_COMMIT")
[[ -z "$OUT" ]] && echo "PASS: 5 non-push → pass" || { echo "FAIL: 5 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 6: 2s timeout on slow gh → fail-open pass
#
# The bound is 6s against a 12s stub, not 3s against a 5s one (Round-14 audit
# REL-M2). What this case discriminates is "the hook's own 2s timeout fired" vs
# "the hook waited the stub out"; `date +%s` reads that with 1s granularity, and
# `date +%s%N` is not an option (BSD/macOS date has no %N, and macOS is the leg
# these flakes appeared on). So the fix is to move the two outcomes apart rather
# than to measure more finely: 2s of real work now has 4s of load headroom
# before it can be confused with a 12s wait. This suite is one of the two
# candidate root causes for the pair of unreproducible `1 suite(s) failed` runs
# in the 0.77.0 / 0.78.0 windows.
START=$(date +%s)
OUT=$(run_hook slow "$EVENT_PUSH")
END=$(date +%s)
ELAPSED=$((END - START))
[[ -z "$OUT" && $ELAPSED -le 6 ]] && echo "PASS: 6 slow gh → timeout fail-open (${ELAPSED}s, stub sleeps 12s)" \
  || { echo "FAIL: 6 (elapsed=${ELAPSED}s against a 12s stub — the 2s hook timeout did not fail open; got: $OUT)"; FAIL=$((FAIL + 1)); }

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

# Cases 12-14: v0.17.4 segment-anchor trigger. Pre-fix used the loose
# `[[:space:];&|]` prefix which let comments and heredoc bodies containing
# `git push` fire the trigger. With CI red, the hook would then deny a command
# that doesn't actually push anything. Mirrors v0.9.28 memory-read-check.sh
# segment-anchor + v0.17.3 pre-bash-safety multi-line fix.

EVENT_COMMENT_FULL='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"# git push origin main"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_COMMENT_FULL")
[[ -z "$OUT" ]] && echo "PASS: 12 full-line comment containing git push → pass" \
  || { echo "FAIL: 12 (got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_COMMENT_INLINE='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"ls -la # then run git push later"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_COMMENT_INLINE")
[[ -z "$OUT" ]] && echo "PASS: 13 inline comment containing git push → pass" \
  || { echo "FAIL: 13 (got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_HEREDOC=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"cat <<EOF\ngit push origin main\nEOF"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_HEREDOC")
[[ -z "$OUT" ]] && echo "PASS: 14 heredoc body with git push → pass" \
  || { echo "FAIL: 14 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 15: real chained push after && still denies with red CI — non-regression
# anchor for the segment-anchor regex (must still match real shell separators).
EVENT_CHAIN=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"make && git push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CHAIN")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 15 chained real push after && → deny" \
  || { echo "FAIL: 15 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 16-17 (v0.18.1): retry-cooldown sentinel tracking. Real evidence
# (daagu 5/18-5/20): 3 red CI run URLs each attracted 2 deny events within
# 71-230s, same session — agent saw (a)/(b)/(c) options on 1st deny but
# retried anyway. New sentinel-based 5-min window detects repeat → escalated
# REASON ("SECOND deny ...") + `deny-repeat` audit event.

# Clear sentinel state so Cases 16-17 start fresh (prior cases 2/10/11/15
# created sentinels with session_id="t" that would otherwise trigger repeat
# on Case 16's first call).
rm -rf "$HOME/.claude/.claudemd-state/ship-baseline-recent" 2>/dev/null

# Case 16: 2nd deny on same (session_id, run_url) within 5min → escalated.
EVENT_CASE16='{"session_id":"case16-uuid","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"/tmp"}'
OUT1=$(run_hook fail-red "$EVENT_CASE16")
# 1st deny — must NOT contain "SECOND deny" (regular wording).
if echo "$OUT1" | grep -q "SECOND deny"; then
  echo "FAIL: 16a 1st deny should NOT say SECOND deny (got: $OUT1)"; FAIL=$((FAIL + 1))
else
  echo "PASS: 16a 1st deny → regular wording"
fi
OUT2=$(run_hook fail-red "$EVENT_CASE16")
# 2nd deny within 5min — MUST contain "SECOND deny".
if echo "$OUT2" | grep -q "SECOND deny"; then
  echo "PASS: 16b 2nd deny within 5min → escalated wording"
else
  echo "FAIL: 16b 2nd deny should say SECOND deny (got: $OUT2)"; FAIL=$((FAIL + 1))
fi
# Both responses must still be permissionDecision=deny.
DEC1=$(echo "$OUT1" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
DEC2=$(echo "$OUT2" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
if [[ "$DEC1" == "deny" && "$DEC2" == "deny" ]]; then
  echo "PASS: 16c both denials retain permissionDecision=deny"
else
  echo "FAIL: 16c (dec1=$DEC1, dec2=$DEC2)"; FAIL=$((FAIL + 1))
fi

# Case 17: different session_id, same run_url → NOT repeat (different sentinel
# key). Same fail-red mock; new session_id.
EVENT_CASE17='{"session_id":"case17-uuid","tool_name":"Bash","tool_input":{"command":"git push origin main"},"cwd":"/tmp"}'
OUT3=$(run_hook fail-red "$EVENT_CASE17")
if echo "$OUT3" | grep -q "SECOND deny"; then
  echo "FAIL: 17 different session must not inherit case16 sentinel (got: $OUT3)"; FAIL=$((FAIL + 1))
else
  echo "PASS: 17 different session → regular wording (sentinel keyed by session_id)"
fi

# Cases 18-21 (v0.23.1): heredoc-body strip. v0.17.4 anchor passed bare
# `git push` inside heredoc (Case 14) because no shell separator preceded
# `git`, but missed the real-world pattern: release commit message bodies
# quoting `&& git push --tags` (or `; git push`, `| git push`). Adjacent
# separator + `git push` matched segment-anchor → `git commit` denied even
# though no push occurs, and the (b) escape (`--amend` adding marker) hit
# the same FP → unreachable.

# Case 18: real-world false-positive. Commit body contains `&& git push --tags`
# as prose. Single-quoted heredoc, message-style content.
EVENT_HD_AMP=$(jq -nc '{session_id:"hd-amp","tool_name":"Bash","tool_input":{command:"git add file && git commit -m \"$(cat <<'\''EOF'\''\nci(release): fix release-please && git push --tags race\nEOF\n)\""},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_HD_AMP")
[[ -z "$OUT" ]] && echo "PASS: 18 heredoc body containing '&& git push' → pass" \
  || { echo "FAIL: 18 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 19: semicolon variant. `; git push` inside heredoc body.
EVENT_HD_SEMI=$(jq -nc '{session_id:"hd-semi","tool_name":"Bash","tool_input":{command:"git commit -m \"$(cat <<EOF\nfix: was triggered by; git push --force\nEOF\n)\""},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_HD_SEMI")
[[ -z "$OUT" ]] && echo "PASS: 19 heredoc body containing '; git push' → pass" \
  || { echo "FAIL: 19 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 20: `--amend` escape path. Agent retries with known-red baseline marker;
# body still quotes && git push. Pre-fix: amend also denied → escape unreachable.
# Post-fix: heredoc stripped, amend passes (no real push). HEAD update succeeds.
EVENT_HD_AMEND=$(jq -nc '{session_id:"hd-amend","tool_name":"Bash","tool_input":{command:"git commit --amend -m \"$(cat <<'\''EOF'\''\nknown-red baseline: fixing the workflow itself\nci(release): explicit tag_name && git push --tags\nEOF\n)\""},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_HD_AMEND")
[[ -z "$OUT" ]] && echo "PASS: 20 --amend with marker + git push in body → pass" \
  || { echo "FAIL: 20 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 21: non-regression — real `git commit ... && git push` outside any
# heredoc still triggers + denies on red CI. The strip must not over-reach.
EVENT_REAL_CHAIN=$(jq -nc '{session_id:"real-chain","tool_name":"Bash","tool_input":{command:"git commit -m fix && git push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_REAL_CHAIN")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 21 real chained push outside heredoc → deny (non-regression)" \
  || { echo "FAIL: 21 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 22-24 (v0.23.2): chained-commit-with-marker escape reachability.
# v0.23.1 only checked HEAD for the `known-red baseline:` marker. In the
# typical ship flow (`git commit -m "<body>" && git push origin main`)
# PreToolUse fires BEFORE the commit runs → HEAD has no marker → deny,
# and amend retries chain push the same way → trapped. v0.23.2 also scans
# the proposed CMD payload for the marker.

# Reset HEAD so the marker is NOT in HEAD (otherwise Case 22 would pass
# via the HEAD branch even pre-fix).
cd "$TMP_HOME" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "no marker baseline"
# Clear sentinel so cooldown doesn't pollute these cases.
rm -rf "$HOME/.claude/.claudemd-state/ship-baseline-recent" 2>/dev/null

# Case 22: chained commit+push, marker in -m payload only. Pre-fix: deny.
# Post-fix: pass (CMD scan finds marker).
EVENT_CHAIN_MARKER=$(jq -nc '{session_id:"chain-marker","tool_name":"Bash","tool_input":{command:"git commit -m \"ci(release): fix\n\nknown-red baseline: prior dispatch failed at GH release step\" && git push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CHAIN_MARKER")
[[ -z "$OUT" ]] && echo "PASS: 22 chained commit+push with marker in -m payload → pass" \
  || { echo "FAIL: 22 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 23: amend chained with push, marker in -m. Same as the actual user
# scenario (code-graph-mcp v0.32.3 fix attempt, 2026-05-24).
rm -rf "$HOME/.claude/.claudemd-state/ship-baseline-recent" 2>/dev/null
EVENT_AMEND_MARKER=$(jq -nc '{session_id:"amend-marker","tool_name":"Bash","tool_input":{command:"git commit --amend -m \"ci(release): set explicit tag_name\n\nknown-red baseline: previous dispatch failed at GH Release step\" && git push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_AMEND_MARKER")
[[ -z "$OUT" ]] && echo "PASS: 23 chained amend+push with marker in -m → pass (real user scenario)" \
  || { echo "FAIL: 23 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 24: marker in heredoc body (real release-commit ergonomics).
rm -rf "$HOME/.claude/.claudemd-state/ship-baseline-recent" 2>/dev/null
EVENT_HD_MARKER=$(jq -nc '{session_id:"hd-marker","tool_name":"Bash","tool_input":{command:"git commit -m \"$(cat <<'\''EOF'\''\nci(release): x\n\nknown-red baseline: workflow under repair\nEOF\n)\" && git push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_HD_MARKER")
[[ -z "$OUT" ]] && echo "PASS: 24 chained commit+push with marker in heredoc body → pass" \
  || { echo "FAIL: 24 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 25-26 (v0.23.14): inline `-m "..."` quoted-body FP. v0.23.1 stripped
# heredoc bodies, but the far more common `git commit -m "...prose with
# && git push..."` form still tripped the segment-anchor — a PURE COMMIT (no
# push) was denied on red CI with a nonsensical push-bypass message. Quote-body
# strip (post-flatten) fixes it; a real push is always unquoted, so Case 21
# (chained push outside quotes) still denies.
rm -rf "$HOME/.claude/.claudemd-state/ship-baseline-recent" 2>/dev/null

# Case 25: `&& git push` inside an inline -m quote → pass (pure commit).
EVENT_INLINE_AMP=$(jq -nc '{session_id:"inline-amp","tool_name":"Bash","tool_input":{command:"git commit -m \"fix && git push in docs\""},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_INLINE_AMP")
[[ -z "$OUT" ]] && echo "PASS: 25 inline -m body containing '&& git push' → pass" \
  || { echo "FAIL: 25 (got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 26: semicolon variant inside an inline -m quote → pass.
EVENT_INLINE_SEMI=$(jq -nc '{session_id:"inline-semi","tool_name":"Bash","tool_input":{command:"git commit -m \"see notes; git push --force is banned\""},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_INLINE_SEMI")
[[ -z "$OUT" ]] && echo "PASS: 26 inline -m body containing '; git push' → pass" \
  || { echo "FAIL: 26 (got: $OUT)"; FAIL=$((FAIL + 1)); }


# --- 2026-07-25 deep audit: in-flight runs, uncovered red states, multi-line ---
# Own fixture: Case 3 left a `known-red baseline:` marker in HEAD, which bypasses
# every red verdict below. Reset to a clean HEAD or these all pass for the wrong
# reason (they would stay green against the unfixed hook).
cd "$TMP_HOME" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "clean commit no marker"

# Case 27: newest run still executing, completed run behind it is RED → deny.
# Pre-fix the hook read `.[0].conclusion`, which is null while a run is in
# flight, so it recorded a §7 `pass` and allowed the push. This is the atomic-ship
# normal timing (push main starts CI, tag push follows seconds later).
OUT=$(run_hook in-progress "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 27 in_progress newest, red baseline → deny" \
  || { echo "FAIL: 27 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 28: same shape but the completed baseline is GREEN → pass.
OUT=$(run_hook queued "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 28 queued newest, green baseline → pass" \
  || { echo "FAIL: 28 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 29: nothing completed yet → no baseline color exists. Must not deny, and
# must not be counted as a green pass (own event: pending-no-baseline).
OUT=$(run_hook no-completed "$EVENT_PUSH")
[[ -z "$OUT" ]] && echo "PASS: 29 no completed run → allow without a pass verdict" \
  || { echo "FAIL: 29 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 30-31: the two red conclusions the arm listed but no fixture exercised —
# deleting them from the arm left the suite fully green before this.
OUT=$(run_hook fail-action-required "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 30 action_required → deny" \
  || { echo "FAIL: 30 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

OUT=$(run_hook fail-startup "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 31 startup_failure → deny" \
  || { echo "FAIL: 31 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 32: a push on its own LINE of a multi-line command. A newline is a real
# command separator; flattening it to a space erased the trigger anchor, so the
# gate never fired on the ordinary multi-line bash block.
EVENT_ML=$(jq -nc '{session_id:"ml",tool_name:"Bash",tool_input:{command:"npm test\ngit push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_ML")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 32 multi-line push reaches the gate" \
  || { echo "FAIL: 32 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 33: FP guard — a line-continuation backslash joins lines, so `git \` +
# newline + `push` is one command and must still be seen (not split by the
# newline-to-`;` conversion).
EVENT_CONT=$(jq -nc '{session_id:"cont",tool_name:"Bash",tool_input:{command:"git \\\npush origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CONT")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 33 line-continuation push reaches the gate" \
  || { echo "FAIL: 33 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 34: FP guard — a fake heredoc (`<<` as left-shift) must not blank the
# push that follows it on the next line.
EVENT_FAKE_HD=$(jq -nc '{session_id:"fakehd",tool_name:"Bash",tool_input:{command:"echo $((1<<n))\ngit push origin main"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_FAKE_HD")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 34 fake heredoc does not hide the push" \
  || { echo "FAIL: 34 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 35: FP guard — a REAL heredoc body mentioning a push must stay stripped.
EVENT_REAL_HD=$(jq -nc '{session_id:"realhd",tool_name:"Bash",tool_input:{command:"cat <<EOF\ngit push origin main\nEOF"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_REAL_HD")
[[ -z "$OUT" ]] && echo "PASS: 35 real heredoc body still stripped" \
  || { echo "FAIL: 35 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 36-38 (2026-08-29 audit R10-05): git's GLOBAL flags sit between `git`
# and the subcommand, and the trigger required the two to be adjacent — so
# `git -C /repo push`, the ordinary way to push a repo the shell is not cd'd
# into, cleared this §7 gate silently. HEAD is re-pointed at a commit without a
# `known-red baseline:` marker first: earlier cases leave one in place, and a
# case that passes because of a stale bypass proves nothing.
cd "$TMP_HOME" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "chore: plain commit, no bypass marker"

EVENT_C_PUSH='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git -C /repo push origin main"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_C_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 36 git -C push reaches the §7 gate" \
  || { echo "FAIL: 36 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# The help exemption must survive the global-flag form too: PUSH_SEG is grep'd
# with the same fragment, so `git -C /repo push --help` still yields a segment
# and still exempts. Pre-fix widening only TRIGGER_RE, the segment came back
# empty and a no-op invocation was denied on red CI.
EVENT_C_HELP='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git -C /repo push --help"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_C_HELP")
[[ -z "$OUT" ]] && echo "PASS: 37 git -C push --help still exempt" \
  || { echo "FAIL: 37 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 39-40 (0.70.0 pre-tag review, HIGH-1): an ARGUMENT-LESS push. Every case
# above this point drove `git push origin main`, and hook_trigger_view appends
# `;` to its output — so `git push`, the most common spelling there is, sat
# against a trigger suffix of `([[:space:]]|$)` that matches neither the `;` nor
# end-of-line. This §7 red-CI gate has never fired on it.
EVENT_BARE='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_BARE")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 39 bare 'git push' reaches the §7 gate" \
  || { echo "FAIL: 39 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_BARE_C='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git -C /repo push"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_BARE_C")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 40 bare 'git -C /repo push' reaches the §7 gate" \
  || { echo "FAIL: 40 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# FP guard: the widened suffix must not turn `git push-notes` into a push.
EVENT_PUSHNOTES='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push-notes"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_PUSHNOTES")
[[ -z "$OUT" ]] && echo "PASS: 41 'git push-notes' is not a push" \
  || { echo "FAIL: 41 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# FP guard: a standalone bare word after `git` is a different subcommand.
EVENT_STATUS='{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git status push"},"cwd":"/tmp"}'
OUT=$(run_hook fail-red "$EVENT_STATUS")
[[ -z "$OUT" ]] && echo "PASS: 38 git status push is not a push" \
  || { echo "FAIL: 38 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# --- R11-15 (2026-09-02 audit): judge the repo being PUSHED, not the hook's cwd ---
# TRIGGER_RE has accepted `git -C <dir> push` since R10-05, but every git/gh call
# below it ran bare, so the §7 gate read repo A's CI colour and commit message to
# decide about a push to repo B. Two repos, opposite markers, so each direction
# is pinned separately — the false-PASS direction (case 40) is the one that
# matters, since a silent exemption is invisible.
R15_A="$TMP_HOME"                      # hook cwd
R15_B=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME" "$R15_B"' EXIT
git -C "$R15_B" init -q
git -C "$R15_B" -c user.email=t@t -c user.name=t commit --allow-empty -q -m "clean commit in B"

# Case 42: the known-red marker lives in the TARGET repo (B), not in the hook's
# cwd (A). Pre-fix the hook read A's log, found nothing, and denied.
cd "$R15_A" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: no marker here"
git -C "$R15_B" -c user.email=t@t -c user.name=t commit --allow-empty -q \
  -m "feat: y" -m "known-red baseline: quarantined in B"
EVENT_C_B="{\"session_id\":\"t\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git -C $R15_B push origin main\"},\"cwd\":\"/tmp\"}"
OUT=$(run_hook fail-red "$EVENT_C_B")
[[ -z "$OUT" ]] && echo "PASS: 42 -C <dir> reads the target repo's commit body" \
  || { echo "FAIL: 42 (expected pass via B's known-red marker, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 43 (the false-PASS direction): the marker is in the hook's cwd (A) and the
# target repo (B) is clean. The gate must NOT borrow A's exemption for a push to
# B. Pre-fix it did — red CI, unrelated repo, silently allowed.
cd "$R15_A" && git -c user.email=t@t -c user.name=t commit --allow-empty -q \
  -m "feat: z" -m "known-red baseline: marker in A only"
git -C "$R15_B" -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: clean in B"
OUT=$(run_hook fail-red "$EVENT_C_B")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 43 target repo's clean HEAD is not exempted by the cwd repo's marker" \
  || { echo "FAIL: 43 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Case 44: unresolvable target → unchanged behavior. A bare `git push` with a
# non-repo event cwd must still be judged against the hook's own cwd, exactly as
# before; the fix must never newly deny.
cd "$R15_A" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: clean for 41"
OUT=$(run_hook fail-red "$EVENT_PUSH")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 44 bare push with non-repo cwd falls through to the old behavior" \
  || { echo "FAIL: 44 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 45-47 (pre-tag review of 0.71.4): the `cd <dir>` branch had NO test at
# all — 42/43/44 cover `-C <dir>` and the unresolvable fall-through only — and
# the first cut scanned the whole command with `tail -n1`, so a `cd` AFTER the
# push hijacked resolution and a red-CI push was silently ALLOWED. Both
# directions are pinned here.
cd "$R15_A" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: clean for 45"
git -C "$R15_B" -c user.email=t@t -c user.name=t commit --allow-empty -q \
  -m "feat: w" -m "known-red baseline: marker in B for 45"

EVENT_CD_AFTER=$(jq -nc --arg b "$R15_B" '{session_id:"t",tool_name:"Bash",tool_input:{command:("git push origin main && cd " + $b + " && npm test")},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CD_AFTER")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 45 a cd AFTER the push does not source the exemption from another repo" \
  || { echo "FAIL: 45 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_CD_AFTER_SEMI=$(jq -nc --arg b "$R15_B" '{session_id:"t",tool_name:"Bash",tool_input:{command:("git push origin main ; cd " + $b)},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CD_AFTER_SEMI")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 46 same via ';' rather than '&&'" \
  || { echo "FAIL: 46 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# The legitimate direction must still work, or the fix above is just a revert.
EVENT_CD_BEFORE=$(jq -nc --arg b "$R15_B" '{session_id:"t",tool_name:"Bash",tool_input:{command:("cd " + $b + " && git push origin main")},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CD_BEFORE")
[[ -z "$OUT" ]] && echo "PASS: 47 a cd BEFORE the push does select the target repo" \
  || { echo "FAIL: 47 (expected pass via B's marker, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 48-52 (defect 177a): a push inside a subshell or a command substitution.
# The trigger admitted `^` or a shell separator before `git` and whitespace or a
# separator after `push`, so with CI red `(git push origin main)`,
# `echo $(git push origin main)`, a backtick substitution, and the
# argument-less `(cd sub && git push)` (where `)` follows the verb) were all
# allowed while `git push origin main` was denied. HEAD is clean first: Case 45
# left a known-red marker only in B, but a stale bypass here would prove nothing.
cd "$R15_A" && git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "feat: clean for 48"

EVENT_SUB=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"(git push origin main)"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_SUB")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 48 a push inside ( ) reaches the §7 gate" \
  || { echo "FAIL: 48 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_CSUB=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"echo $(git push origin main)"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_CSUB")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 49 a push inside \$( ) reaches the §7 gate" \
  || { echo "FAIL: 49 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_BTICK=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"echo `git push origin main`"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_BTICK")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 50 a push inside backticks reaches the §7 gate" \
  || { echo "FAIL: 50 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

EVENT_SUB_BARE=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"(cd sub && git push)"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_SUB_BARE")
DEC=$(echo "$OUT" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
[[ "$DEC" == "deny" ]] && echo "PASS: 51 an argument-less push closed by ')' reaches the §7 gate" \
  || { echo "FAIL: 51 (expected deny, got: $OUT)"; FAIL=$((FAIL + 1)); }

# FP guard: `)` joined the suffix, `-` did not, so `git push-notes` stays a
# different command inside a subshell too.
EVENT_SUB_NOTES=$(jq -nc '{session_id:"t",tool_name:"Bash",tool_input:{command:"(git push-notes)"},cwd:"/tmp"}')
OUT=$(run_hook fail-red "$EVENT_SUB_NOTES")
[[ -z "$OUT" ]] && echo "PASS: 52 '(git push-notes)' is not a push" \
  || { echo "FAIL: 52 (expected silent, got: $OUT)"; FAIL=$((FAIL + 1)); }

# Cases 53-62 (defect 177): a `gh run list` that timed out or failed let the push
# through and wrote no row, while a missing jq one step earlier writes a
# `fail-open` row. Two runs of 8 real calls on 2026-10-21: 1.46-1.68 s on 13 of
# 16 against the 2 s budget, 2.84 s on one, a failure after 10 s on two, so the
# silent arm is a routine one. The row is owed only when the pushed repo has a
# github.com remote; for any other remote, or none, `gh` has nothing to look up.
#
# Every run gets a HOME of its own: hook_record_failopen keeps one row per
# (hook, reason) per minute, so a shared HOME would let the second case of a
# reason pass on the first one's throttle.
F177=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX"); trap 'rm -rf "$TMP_HOME" "$R15_B" "$F177"' EXIT
F177_N=0
f177_repo() {  # <dir> [url...] — a worktree whose remotes are the given URLs
  local dir="$1" i=0 url
  shift
  git init -q "$dir" || return 1
  for url in "$@"; do
    git -C "$dir" remote add "r$i" "$url"
    i=$((i + 1))
  done
}
f177_hook() {  # <PATH for the hook> <repo> — sets F177_OUT, F177_ROWS
  local p="$1" repo="$2" ev
  F177_N=$((F177_N + 1))
  F177_HOME="$F177/home-$F177_N"
  mkdir -p "$F177_HOME/.claude"
  ev=$(jq -nc --arg d "$repo" '{session_id:"t",tool_name:"Bash",tool_input:{command:"git push origin main"},cwd:$d}')
  F177_OUT=$(HOME="$F177_HOME" PATH="$p" bash "$HOOK" <<<"$ev" 2>&1)
  F177_ROWS=$(jq -r 'select(.hook=="ship-baseline" and .event=="fail-open") | .extra.reason' \
    "$F177_HOME/.claude/logs/claudemd.jsonl" 2>/dev/null | tr '\n' ' ')
  F177_ROWS=${F177_ROWS% }
}
f177_run() { f177_hook "$MOCKS/$1:$PATH" "$2"; }

F177_GH="$F177/on-github"
f177_repo "$F177_GH" "git@github.com:sdsrss/claudemd.git"
F177_OTHER="$F177/on-gitlab"
f177_repo "$F177_OTHER" "https://gitlab.com/sdsrss/claudemd.git"
F177_NONE="$F177/no-remote"
f177_repo "$F177_NONE"

# Case 53: gh exits 1 in a repo on github.com → still allowed, one gh-failed row.
f177_run exit-1 "$F177_GH"
[[ -z "$F177_OUT" && "$F177_ROWS" == "gh-failed" ]] && echo "PASS: 53 gh exits 1 on a github.com repo → allowed, one gh-failed row" \
  || { echo "FAIL: 53 (expected silent + rows 'gh-failed', got out: $F177_OUT; rows: '$F177_ROWS')"; FAIL=$((FAIL + 1)); }

# Case 54: the other spellings of a github.com remote — https, ssh://, a user in
# the URL, upper case, and github.com as the SECOND remote of the repo.
C54_BAD=""
for urls in "https://github.com/sdsrss/claudemd.git" "ssh://git@github.com/sdsrss/claudemd.git" \
  "https://ci@github.com/sdsrss/claudemd" "git@GitHub.com:sdsrss/claudemd" \
  "https://gitlab.com/x/y.git https://github.com/sdsrss/claudemd"; do
  F177_N=$((F177_N + 1))
  IFS=' ' read -r -a C54_URLS <<<"$urls"
  f177_repo "$F177/form-$F177_N" "${C54_URLS[@]}"
  f177_run exit-1 "$F177/form-$F177_N"
  [[ "$F177_ROWS" == "gh-failed" ]] || C54_BAD+="[$urls → '$F177_ROWS'] "
done
[[ -z "$C54_BAD" ]] && echo "PASS: 54 every github.com remote spelling records gh-failed" \
  || { echo "FAIL: 54 (spellings without a gh-failed row: $C54_BAD)"; FAIL=$((FAIL + 1)); }

# Case 55: gh outlives the 2 s budget → allowed at the budget, one gh-timeout row.
# Same 6 s bound against a 12 s stub as Case 6, for the same reason.
START=$(date +%s)
f177_run slow "$F177_GH"
ELAPSED=$(($(date +%s) - START))
[[ -z "$F177_OUT" && "$F177_ROWS" == "gh-timeout" && $ELAPSED -le 6 ]] \
  && echo "PASS: 55 gh past the 2 s budget on a github.com repo → one gh-timeout row (${ELAPSED}s)" \
  || { echo "FAIL: 55 (expected silent + rows 'gh-timeout' within 6s, got out: $F177_OUT; rows: '$F177_ROWS'; ${ELAPSED}s)"; FAIL=$((FAIL + 1)); }

# Case 56: the same timeout through platform_timeout's own watchdog, the path a
# Mac without coreutils takes. It maps the kill to 124 as GNU timeout does. The
# stub is `slow-single` (see its header for why `slow` takes 12 s here).
START=$(date +%s)
CLAUDEMD_NO_TIMEOUT_BIN=1 f177_run slow-single "$F177_GH"
ELAPSED=$(($(date +%s) - START))
[[ -z "$F177_OUT" && "$F177_ROWS" == "gh-timeout" && $ELAPSED -le 6 ]] \
  && echo "PASS: 56 watchdog timeout on a github.com repo → one gh-timeout row (${ELAPSED}s)" \
  || { echo "FAIL: 56 (expected silent + rows 'gh-timeout' within 6s, got out: $F177_OUT; rows: '$F177_ROWS'; ${ELAPSED}s)"; FAIL=$((FAIL + 1)); }

# Case 57: gh exits 1 where there is no GitHub to ask → no row, as before.
f177_run exit-1 "$F177_OTHER"; C57_OTHER="$F177_OUT|$F177_ROWS"
f177_run exit-1 "$F177_NONE"; C57_NONE="$F177_OUT|$F177_ROWS"
[[ "$C57_OTHER" == "|" && "$C57_NONE" == "|" ]] && echo "PASS: 57 gh exits 1 on a gitlab / remote-less repo → no row" \
  || { echo "FAIL: 57 (expected silent and no row; gitlab: '$C57_OTHER', none: '$C57_NONE')"; FAIL=$((FAIL + 1)); }

# Case 58: the timeout arm is held to the same remote test.
f177_run slow "$F177_OTHER"
[[ -z "$F177_OUT" && -z "$F177_ROWS" ]] && echo "PASS: 58 gh timeout on a gitlab repo → no row" \
  || { echo "FAIL: 58 (expected silent and no row, got out: $F177_OUT; rows: '$F177_ROWS')"; FAIL=$((FAIL + 1)); }

# Case 59: hosts that only contain the string github.com are not github.com.
C59_BAD=""
for url in "https://github.com.example.org/x/y" "https://gitlab.com/github.com/y" \
  "git@notgithub.com:x/y" "/srv/mirrors/github.com/x.git" "https://example.org/github.com:x"; do
  F177_N=$((F177_N + 1))
  f177_repo "$F177/lookalike-$F177_N" "$url"
  f177_run exit-1 "$F177/lookalike-$F177_N"
  [[ -z "$F177_ROWS" ]] || C59_BAD+="[$url → '$F177_ROWS'] "
done
[[ -z "$C59_BAD" ]] && echo "PASS: 59 a URL that merely contains github.com records nothing" \
  || { echo "FAIL: 59 (lookalikes that recorded a row: $C59_BAD)"; FAIL=$((FAIL + 1)); }

# Cases 60-61: a successful call with nothing in it is "no runs yet", not a
# failure — `[]` (what gh prints for that) and empty stdout alike.
f177_run empty-list "$F177_GH"
[[ -z "$F177_OUT" && -z "$F177_ROWS" ]] && echo "PASS: 60 gh prints [] on a github.com repo → no fail-open row" \
  || { echo "FAIL: 60 (expected silent and no fail-open row, got out: $F177_OUT; rows: '$F177_ROWS')"; FAIL=$((FAIL + 1)); }
f177_run empty-output "$F177_GH"
[[ -z "$F177_OUT" && -z "$F177_ROWS" ]] && echo "PASS: 61 gh prints nothing on a github.com repo → no fail-open row" \
  || { echo "FAIL: 61 (expected silent and no fail-open row, got out: $F177_OUT; rows: '$F177_ROWS')"; FAIL=$((FAIL + 1)); }

# Case 62: gh not installed → no row; doctor's own `gh` row reports that. The
# PATH keeps everything else: each PATH directory holding a `gh` is replaced by
# a copy of its links without it. The control runs the same PATH with the exit-1
# stub in front, so a PATH that broke the hook before its gh step (and so wrote
# nothing for an unrelated reason) cannot pass this case.
C62_PATH=""
IFS=: read -r -a C62_DIRS <<<"$PATH"
for d in "${C62_DIRS[@]}"; do
  [[ -n "$d" ]] || continue
  if [[ -x "$d/gh" ]]; then
    F177_N=$((F177_N + 1))
    mkdir -p "$F177/nogh-$F177_N"
    ln -s "$d"/* "$F177/nogh-$F177_N/" 2>/dev/null
    rm -f "$F177/nogh-$F177_N/gh"
    d="$F177/nogh-$F177_N"
  fi
  C62_PATH="${C62_PATH:+$C62_PATH:}$d"
done
f177_hook "$MOCKS/exit-1:$C62_PATH" "$F177_GH"; C62_CONTROL="$F177_ROWS"
f177_hook "$C62_PATH" "$F177_GH"
[[ "$C62_CONTROL" == "gh-failed" && -z "$F177_OUT" && -z "$F177_ROWS" ]] && echo "PASS: 62 gh not installed → no row (control with a failing gh: gh-failed)" \
  || { echo "FAIL: 62 (control rows '$C62_CONTROL' want gh-failed; no-gh out: $F177_OUT; rows: '$F177_ROWS')"; FAIL=$((FAIL + 1)); }

# Total is DERIVED from the assertions in this file rather than hand-written:
# the literal 35 had to be bumped by hand on every addition, which is the same
# drift class the 2026-07-27 audit found in memory-read-check.test.sh.
# Resolved via $HERE, not $0: this suite cd's into its sandbox, so a relative
# $0 no longer names a file by the time we get here — and `grep` on a missing
# path yields an empty count, i.e. a green "0/0 passed".
SELF="$HERE/$(basename "$0")"
TOTAL=$(grep -oE '"(PASS|FAIL): [0-9]+' "$SELF" | grep -oE '[0-9]+$' | sort -nu | wc -l | tr -d ' ')
if (( TOTAL < 35 )); then
  echo "FAILED: assertion inventory came back $TOTAL (< 35) — the count source is wrong"
  exit 1
fi
if (( FAIL > 0 )); then
  echo "Tests: $((TOTAL - FAIL))/$TOTAL passed"
  exit 1
fi
echo "Tests: $TOTAL/$TOTAL passed"
