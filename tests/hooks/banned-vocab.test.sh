#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/banned-vocab-check.sh"
FIX="$HERE/../fixtures/events"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

# v0.21.2 — test hermeticity. Users who set CLAUDEMD_PATH2_DRY_RUN=1 or
# BANNED_VOCAB_PROSE_SCAN=0 in ~/.claude/settings.json carry those env vars
# into npm test subprocesses. Cases 25-33 (Path 2 expected-deny) would
# silently degrade to "pass under dry-run", masking real regressions. Clear
# all banned-vocab-related toggles at suite entry; per-case env prefixes still
# set what they need (e.g. case 34 sets CLAUDEMD_PATH2_DRY_RUN=1 explicitly).
unset CLAUDEMD_PATH2_DRY_RUN
unset BANNED_VOCAB_PROSE_SCAN
unset DISABLE_BANNED_VOCAB_HOOK
unset DISABLE_CLAUDEMD_HOOKS

FAIL=0

assert_pass() {
  local name="$1" fix="$2" extra="${3:-}"
  local out
  out=$(eval "$extra bash \"$HOOK\"" < "$fix" 2>&1)
  if [[ -z "$out" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected empty stdout, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

assert_deny() {
  local name="$1" fix="$2"
  local out decision
  out=$(bash "$HOOK" < "$fix" 2>&1)
  decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
  if [[ "$decision" == "deny" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected deny, got: $out)"
    FAIL=$((FAIL + 1))
  fi
}

assert_pass "1: non-Bash Edit → pass" "$FIX/edit-tool.json"
assert_pass "2: git log → pass" "$FIX/bash-git-log.json"
assert_pass "3: clean commit → pass" "$FIX/bash-commit-clean.json"
assert_deny "4: EN significantly → deny" "$FIX/bash-commit-banned-en.json"
assert_deny "5: 中文 显著提升 → deny" "$FIX/bash-commit-banned-zh.json"
assert_pass "6: [allow-banned-vocab] escape → pass" "$FIX/bash-commit-with-escape.json"
assert_pass "7: DISABLE_CLAUDEMD_HOOKS=1 → pass" \
  "$FIX/bash-commit-banned-en.json" "DISABLE_CLAUDEMD_HOOKS=1"
assert_pass "8: DISABLE_BANNED_VOCAB_HOOK=1 → pass" \
  "$FIX/bash-commit-banned-en.json" "DISABLE_BANNED_VOCAB_HOOK=1"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'it should work now'"},"cwd":"/tmp"}
EOF
assert_deny "9: should work hedge → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'cache layer is 70% faster'"},"cwd":"/tmp"}
EOF
assert_deny "10: 70% faster baseline-less → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'cache: 380ms to 95ms latency'"},"cwd":"/tmp"}
EOF
assert_pass "11: baselined ratio → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
echo 'not json' > "$TMP_FIX"
assert_pass "12: malformed JSON stdin → fail-open pass" "$TMP_FIX"
rm -f "$TMP_FIX"

# --- baseline-context exemption (v0.1.8) ---

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'perf: rendering 240ms → 72ms (70% faster)'"},"cwd":"/tmp"}
EOF
assert_pass "13: ratio + → baseline → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'fix: it should work → now verified'"},"cwd":"/tmp"}
EOF
assert_deny "14: hedge + → does NOT escape deny (ratio-only exemption)" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m '缓存: 380ms → 95ms (70% 更快)'"},"cwd":"/tmp"}
EOF
assert_pass "15: 中文 ratio + → baseline → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

# --- message-body scope (v0.1.9) — banned vocab in CMD tokens outside the message body must not deny ---

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"COMMIT_FLAG_SIGNIFICANTLY=1 git commit -m 'fix: correct typo in README'"},"cwd":"/tmp"}
EOF
assert_pass "16: banned word in env prefix, clean message → pass (message-scope)" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git -c log.showSignature=true commit -m 'fix: token parser'"},"cwd":"/tmp"}
EOF
assert_pass "17: git -c config flag, clean message → pass (message-scope)" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -m 'fix: X' -m 'it should work under load'"},"cwd":"/tmp"}
EOF
assert_deny "18: hedge in second -m body → deny (multi -m)" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit --message=\"显著改善 rendering\""},"cwd":"/tmp"}
EOF
assert_deny "19: --message= form with 中文 hedge → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -F /tmp/msg.txt"},"cwd":"/tmp"}
EOF
assert_pass "20: -F file (no -m captured, fallback to CMD scan — clean CMD) → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

# --- v0.17.4: segment-anchor trigger regex — `git commit` in comments / heredoc
# bodies / inline comments no longer false-triggers. Pre-fix used the loose
# `[[:space:];&|]` prefix which matched any space — meaning `# git commit ...`
# fired the trigger, the message-extract regex still found `-m "..."` inside
# the comment, and the hook denied a non-existent commit. Mirrors v0.9.28
# memory-read-check.sh segment-anchor + v0.17.3 pre-bash-safety multi-line fix.

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"# git commit -m 'significantly faster routing'"},"cwd":"/tmp"}
EOF
assert_pass "21: full-line comment with banned-vocab git commit → pass (not a real cmd)" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"ls -la # git commit -m \"robust impl\""},"cwd":"/tmp"}
EOF
assert_pass "22: inline trailing comment with banned-vocab git commit → pass" "$TMP_FIX"
rm -f "$TMP_FIX"

TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"cat <<EOF\ngit commit -m \"significantly\"\nEOF"},"cwd":"/tmp"}
EOF
assert_pass "23: heredoc body containing git commit -m banned → pass (heredoc body, not exec)" "$TMP_FIX"
rm -f "$TMP_FIX"

# Anchor non-regression: real `make && git commit ...` chain still denies.
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"make && git commit -m 'significantly faster'"},"cwd":"/tmp"}
EOF
assert_deny "24: real chained git commit after && — segment-anchor still fires → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# ============================================================================
# v0.21.0 Path 2: ship-verb prose scan tests
# ============================================================================
# Each case writes a fake transcript at the CC-encoded path
# ($HOME/.claude/projects/<encoded>/<sid>.jsonl) containing an assistant turn,
# then drives the hook with a ship-verb command + the matching session_id +
# cwd. Asserts deny / pass per case intent.

mk_prose_transcript() {
  # $1 = cwd, $2 = sid, $3 = assistant text
  local cwd="$1" sid="$2" txt="$3"
  local encoded transcript_dir transcript
  encoded=$(printf '%s' "$cwd" | tr '/._' '-')
  transcript_dir="$HOME/.claude/projects/${encoded}"
  transcript="$transcript_dir/${sid}.jsonl"
  mkdir -p "$transcript_dir"
  # User msg + assistant msg minimal shape.
  jq -cn --arg t "$txt" '{type:"assistant",message:{role:"assistant",content:[{type:"text",text:$t}]}}' > "$transcript"
}

mk_prose_event() {
  # $1 = cmd, $2 = cwd, $3 = sid
  jq -cn --arg c "$1" --arg w "$2" --arg s "$3" \
    '{session_id:$s,tool_name:"Bash",tool_input:{command:$c},cwd:$w}'
}

# Case 25: prior-turn `significantly` + `git commit` w/ CLEAN message → deny (Path 2 fires)
PCWD="/work/p25"
PSID="sess25"
mk_prose_transcript "$PCWD" "$PSID" "The fix significantly improves throughput."
EVENT_25=$(mk_prose_event "git commit -m 'fix: throughput'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_25" > "$TMP_FIX"
assert_deny "25: prior prose 'significantly' + clean commit msg → deny (Path 2)" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 26: prior-turn `robust` + `git push` → deny (Path 2 covers push)
PCWD="/work/p26"
PSID="sess26"
mk_prose_transcript "$PCWD" "$PSID" "Implementation is robust under concurrent writes."
EVENT_26=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_26" > "$TMP_FIX"
assert_deny "26: prior prose 'robust' + git push → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 27: prior-turn `comprehensive` + `gh release create` → deny
PCWD="/work/p27"
PSID="sess27"
mk_prose_transcript "$PCWD" "$PSID" "Release covers a comprehensive set of fixes."
EVENT_27=$(mk_prose_event "gh release create v1.2.3 --title 'Release v1.2.3'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_27" > "$TMP_FIX"
assert_deny "27: prior prose 'comprehensive' + gh release create → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 28: bypass token in CURRENT command shorts circuits Path 2 even with prior prose hit
PCWD="/work/p28"
PSID="sess28"
mk_prose_transcript "$PCWD" "$PSID" "The fix significantly improves throughput."
EVENT_28=$(mk_prose_event "git commit -m 'fix [allow-banned-vocab]'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_28" > "$TMP_FIX"
assert_pass "28: [allow-banned-vocab] token in CMD bypasses Path 2 prose scan" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 29: BANNED_VOCAB_PROSE_SCAN=0 opt-out → no deny even with prior prose hit
PCWD="/work/p29"
PSID="sess29"
mk_prose_transcript "$PCWD" "$PSID" "Implementation is robust under load."
EVENT_29=$(mk_prose_event "git commit -m 'fix: load handling'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_29" > "$TMP_FIX"
assert_pass "29: BANNED_VOCAB_PROSE_SCAN=0 opt-out keeps Path 1 only" "$TMP_FIX" "BANNED_VOCAB_PROSE_SCAN=0"
rm -f "$TMP_FIX"

# Case 30: non-ship verb (`git status`) + prior prose hit → no deny (filter excludes)
PCWD="/work/p30"
PSID="sess30"
mk_prose_transcript "$PCWD" "$PSID" "Output is significantly cleaner now."
EVENT_30=$(mk_prose_event "git status" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_30" > "$TMP_FIX"
assert_pass "30: non-ship verb (git status) → Path 2 filter rejects, pass" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 31: ship verb + prophylactic-only word (`production-ready`) → no deny
# (Path 2 scans HIGH-FIRE region only; production-ready is prophylactic.)
PCWD="/work/p31"
PSID="sess31"
mk_prose_transcript "$PCWD" "$PSID" "The code is production-ready and well-tested."
EVENT_31=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_31" > "$TMP_FIX"
assert_pass "31: ship verb + prophylactic-only word → no deny (high-fire region only)" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 32: ship verb but transcript file absent → fail-open silent
PCWD="/work/p32"
PSID="sess32"
# Intentionally do NOT create transcript file.
EVENT_32=$(mk_prose_event "git commit -m 'clean msg'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_32" > "$TMP_FIX"
assert_pass "32: missing transcript → Path 2 fail-open silent" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 33: prior-turn 中文 `显著改善` + git commit clean → deny (中文 high-fire)
PCWD="/work/p33"
PSID="sess33"
mk_prose_transcript "$PCWD" "$PSID" "性能显著改善了。"
EVENT_33=$(mk_prose_event "git commit -m 'perf: optimize lookup'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_33" > "$TMP_FIX"
assert_deny "33: 中文 高频 prose hit + clean commit msg → deny (Path 2 中文)" "$TMP_FIX"
rm -f "$TMP_FIX"

# ============================================================================
# v0.21.1: CLAUDEMD_PATH2_DRY_RUN observability flag
# ============================================================================
# When the env flag is set, Path 2 logs a `deny-prose-dry-run` event instead of
# emitting deny JSON. Operators staging the rollout grep rule-hits.jsonl to
# measure TP vs FP rate before committing to live enforcement. Same input as
# case 25 (would deny under default), inverted assertion to pass.

PCWD="/work/p34"
PSID="sess34"
mk_prose_transcript "$PCWD" "$PSID" "The fix significantly improves throughput."
EVENT_34=$(mk_prose_event "git commit -m 'fix: throughput'" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_34" > "$TMP_FIX"
assert_pass "34: CLAUDEMD_PATH2_DRY_RUN=1 logs but does NOT deny" "$TMP_FIX" "CLAUDEMD_PATH2_DRY_RUN=1"
rm -f "$TMP_FIX"

# Case 35: dry-run leaves a `deny-prose-dry-run` row in rule-hits.jsonl. This
# is the observability contract — without the event row, dry-run would be
# silent and operators couldn't measure FP rate.
PCWD="/work/p35"
PSID="sess35"
mk_prose_transcript "$PCWD" "$PSID" "Implementation is robust under load."
EVENT_35=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_35" > "$TMP_FIX"
RULE_HITS_LOG="$HOME/.claude/logs/claudemd.jsonl"
# Ensure log dir exists; hook will create file. Truncate to scope this assertion.
mkdir -p "$(dirname "$RULE_HITS_LOG")"
: > "$RULE_HITS_LOG"
CLAUDEMD_PATH2_DRY_RUN=1 bash "$HOOK" < "$TMP_FIX" >/dev/null 2>&1
if grep -q '"event":"deny-prose-dry-run"' "$RULE_HITS_LOG" 2>/dev/null; then
  echo "PASS: 35: dry-run emits deny-prose-dry-run row in rule-hits.jsonl"
else
  echo "FAIL: 35: expected deny-prose-dry-run row, log contents:"
  cat "$RULE_HITS_LOG"
  FAIL=$((FAIL + 1))
fi
rm -f "$TMP_FIX"

# ============================================================================
# v0.23.19 Path 2 FP fixes: identifier/path mentions + turn boundary
# ============================================================================
# Field report (claudemd.txt, bat-html-website session 2026-06-12): pushing
# branch docs/comprehensive-audit-2026-06-12 was denied 3× in a row because
# (a) `\b`-anchored patterns match INSIDE slashed/hyphenated identifiers
# ('-' and '/' are word boundaries), and (b) the scan concatenated ALL
# assistant text in the tail-200 window, so a slip in an EARLIER turn kept
# re-firing after the user intervened and the agent re-calibrated.
# Shape variants per feedback_test_coverage_shape_fp_class: slashed path /
# backtick-wrapped / fenced block / bare-prose regression guard.

mk_prose_transcript_multi() {
  # $1 = cwd, $2 = sid; remaining args = pre-built JSONL entry strings
  local cwd="$1" sid="$2"
  shift 2
  local encoded transcript_dir transcript line
  encoded=$(printf '%s' "$cwd" | tr '/._' '-')
  transcript_dir="$HOME/.claude/projects/${encoded}"
  mkdir -p "$transcript_dir"
  transcript="$transcript_dir/${sid}.jsonl"
  : > "$transcript"
  for line in "$@"; do printf '%s\n' "$line" >> "$transcript"; done
}
ent_assistant() {
  jq -cn --arg t "$1" '{type:"assistant",message:{role:"assistant",content:[{type:"text",text:$t}]}}'
}
ent_user_prompt() {
  # Real typed prompt: STRING content (feedback_cc_user_content_string_vs_array)
  jq -cn --arg t "$1" '{type:"user",message:{role:"user",content:$t}}'
}
ent_user_toolresult() {
  # Mid-turn tool_result: ARRAY content — must NOT count as a turn boundary
  jq -cn '{type:"user",message:{role:"user",content:[{type:"tool_result",tool_use_id:"tu1",content:[{type:"text",text:"ok"}]}]}}'
}

# Case 36: high-fire word only inside a slashed branch token → pass (was the
# field-report deny loop; byte-near the real artifact).
PCWD="/work/p36"
PSID="sess36"
mk_prose_transcript "$PCWD" "$PSID" "审计完成。已创建分支 docs/comprehensive-audit-2026-06-12,推送后创建 PR。"
EVENT_36=$(mk_prose_event "git push -u origin docs/comprehensive-audit-2026-06-12" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_36" > "$TMP_FIX"
assert_pass "36: high-fire word inside slashed branch token → no deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 37: high-fire word only inside an inline backtick span → pass.
PCWD="/work/p37"
PSID="sess37"
mk_prose_transcript "$PCWD" "$PSID" 'Dropped the `comprehensive` wording from the README heading.'
EVENT_37=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_37" > "$TMP_FIX"
assert_pass "37: high-fire word inside backtick span → no deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 38: high-fire word only inside a fenced code block → pass.
PCWD="/work/p38"
PSID="sess38"
FENCED=$'Updated the doc excerpt:\n```\nThis is a comprehensive guide\n```\nPushing now.'
mk_prose_transcript "$PCWD" "$PSID" "$FENCED"
EVENT_38=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_38" > "$TMP_FIX"
assert_pass "38: high-fire word inside fenced code block → no deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 39: regression guard — bare prose violation NEXT TO a path token still
# denies (sanitizer must not eat surrounding prose).
PCWD="/work/p39"
PSID="sess39"
mk_prose_transcript "$PCWD" "$PSID" "The fix significantly improves throughput. Branch docs/comprehensive-audit-2026-06-12 pushed."
EVENT_39=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_39" > "$TMP_FIX"
assert_deny "39: bare prose violation beside path token → still deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 40: violation in a PRIOR turn (before a real typed user prompt) must
# not deny the current turn's clean ship attempt.
PCWD="/work/p40"
PSID="sess40"
mk_prose_transcript_multi "$PCWD" "$PSID" \
  "$(ent_assistant 'Release covers a comprehensive set of fixes.')" \
  "$(ent_user_prompt '继续推送')" \
  "$(ent_assistant 'Branch renamed; pushing with calibrated notes (12/12 tests).')"
EVENT_40=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_40" > "$TMP_FIX"
assert_pass "40: prior-turn violation before real user prompt → no deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 41: a tool_result user entry (ARRAY content) is mid-turn, NOT a turn
# boundary — same-turn violation before it still denies.
PCWD="/work/p41"
PSID="sess41"
mk_prose_transcript_multi "$PCWD" "$PSID" \
  "$(ent_assistant 'The fix significantly improves throughput.')" \
  "$(ent_user_toolresult)" \
  "$(ent_assistant 'Tests green; pushing.')"
EVENT_41=$(mk_prose_event "git push origin main" "$PCWD" "$PSID")
TMP_FIX=$(mktemp); printf '%s' "$EVENT_41" > "$TMP_FIX"
assert_deny "41: tool_result entry is not a turn boundary → same-turn deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# --- Combined short-flag message extraction (`-am` / `-vam`). `git commit -am
# "…"` is one of the most common forms; pre-fix it fell through to the whole-CMD
# fallback, so a banned word in a CHAINED segment falsely denied a clean commit
# that the identical `-m` form passed. `-[[:alpha:]]*m` now isolates the message.

# Case 42: `-am` message clean, banned word only in a CHAINED command → pass
# (message is isolated; pre-fix the whole-CMD fallback flagged "comprehensive").
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -am \"clean fix\" && npm run comprehensive-tests"},"cwd":"/tmp"}
EOF
assert_pass "42: -am clean msg + banned word in chained cmd → pass (message isolated)" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 43: banned vocab INSIDE the `-am` message body → still deny.
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -am \"significantly faster now\""},"cwd":"/tmp"}
EOF
assert_deny "43: banned vocab in -am message body → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

# Case 44: three-flag block `-vam` (verbose+all+message) with banned message → deny.
TMP_FIX=$(mktemp)
cat > "$TMP_FIX" <<'EOF'
{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git commit -vam \"add robust error handling\""},"cwd":"/tmp"}
EOF
assert_deny "44: -vam combined flag block with banned message → deny" "$TMP_FIX"
rm -f "$TMP_FIX"

if (( FAIL > 0 )); then
  echo "Tests: $((44 - FAIL))/44 passed"
  exit 1
fi
echo "Tests: 44/44 passed"
