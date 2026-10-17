#!/usr/bin/env bash
# Env hygiene: scrub inherited claudemd knobs so a direct `bash <this-file>` run
# matches run-all.sh behavior (which scrubs once for the whole suite pass).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/env-hygiene.sh" && claudemd_reset_test_env
set -uo pipefail

LIB="$(cd "$(dirname "$0")/../../hooks/lib" && pwd)/hook-common.sh"
FAIL=0

run_case() {
  local name="$1" expected="$2" actual
  actual=$(eval "$3" 2>&1)
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# hook_kill_switch
run_case "kill_switch plugin-wide" "BLOCKED" \
  "DISABLE_CLAUDEMD_HOOKS=1 bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

run_case "kill_switch per-hook" "BLOCKED" \
  "DISABLE_BANNED_VOCAB_HOOK=1 bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

run_case "kill_switch not set" "OPEN" \
  "unset DISABLE_CLAUDEMD_HOOKS DISABLE_BANNED_VOCAB_HOOK; bash -c 'source $LIB; hook_kill_switch BANNED_VOCAB && echo OPEN || echo BLOCKED'"

# hook_require_jq
run_case "require_jq present" "YES" \
  "bash -c 'source $LIB; hook_require_jq && echo YES || echo NO'"

# hook_read_event
run_case "read_event stdin" '{"foo":1}' \
  "echo '{\"foo\":1}' | bash -c 'source $LIB; hook_read_event'"

run_case "read_event empty" "" \
  "echo '' | bash -c 'source $LIB; hook_read_event' 2>/dev/null"

# hook_deny
run_case "deny emits json" "deny" \
  "bash -c 'source $LIB; hook_deny test-hook \"reason text\"' | jq -r .hookSpecificOutput.permissionDecision"

# hook_strip_heredoc_bodies — indented terminator (2026-07-27 audit, L1).
# A plain `<<EOF` ends only at an EOF in column 0; the pre-fix stripper accepted
# an indented one, stopped early, and handed the remaining BODY to the detectors
# as commands. `<<-EOF` legitimately accepts a TAB-indented terminator, which is
# why this case lives here rather than in the tab-separated §8 corpus.
run_case "heredoc plain form ignores an indented terminator" "yes" \
  "printf 'cat <<EOF\nbody\n   EOF\nrm -rf \\\$EVIL\nEOF\n' | bash -c 'source $LIB; hook_strip_heredoc_bodies' | grep -q 'rm -rf' && echo no || echo yes"

run_case "heredoc dash form accepts a tab-indented terminator" "yes" \
  "printf 'cat <<-EOF\nbody\n\tEOF\nrm -rf \\\$EVIL\n' | bash -c 'source $LIB; hook_strip_heredoc_bodies' | grep -q 'rm -rf' && echo yes || echo no"

# hook_memfile_was_read — 2026-09-02 audit R11-28.
#
# "Has this memory file been opened this session?" was answered two different
# ways: memory-read-check.sh anchored on a tool-input `file_path` FIELD (R10-01,
# after a bare substring let the deny gate be satisfied by the HINT's own
# banner), while memory-prompt-hint.sh kept the bare substring the deny gate had
# already been fixed away from — and its banner embeds the absolute path, so the
# hint's own previous output counted as "read". One predicate, one home.
MEMT=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-test-XXXXXX") || exit 1
trap 'rm -rf "$MEMT"' EXIT
MEMFILE="$MEMT/memory/feedback_x.md"

printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"'"$MEMFILE"'"}}]}}' > "$MEMT/compact.jsonl"
printf '%s\n' '{"tool_use": {"input": {"file_path": "'"$MEMFILE"'"}}}' > "$MEMT/spaced.jsonl"
printf '%s\n' '{"hookSpecificOutput":{"additionalContext":"[claudemd] read the file: '"$MEMFILE"'"}}' > "$MEMT/banner.jsonl"

run_case "memfile_was_read compact Read event" "YES" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/compact.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"

run_case "memfile_was_read pretty-printed field" "YES" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/spaced.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"

# The whole point: a hint banner quoting the path is not a file open.
run_case "memfile_was_read hint banner is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/banner.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"

run_case "memfile_was_read missing transcript" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/nope.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"

run_case "memfile_was_read no args" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read && echo YES || echo NO'"

# Bash-channel reads (2026-09-26). In bypassPermissions mode the harness tells
# the agent to read with cat / sed -n / head, and the field-anchored test above
# never sees those: two of that day's twelve live §11 denies named a memory file
# the session had already `cat`-ed. Rows are shaped like real Claude Code rows —
# an assistant tool_use, then the user row carrying its tool_result.
mkbash() { # FILE ID COMMAND [IS_ERROR]  — IS_ERROR "none" writes no result row
  jq -cn --arg id "$2" --arg c "$3" \
    '{type:"assistant",message:{role:"assistant",content:[{type:"tool_use",id:$id,name:"Bash",input:{command:$c}}]}}' > "$1"
  [[ "${4:-false}" == none ]] && return 0
  jq -cn --arg id "$2" --argjson e "${4:-false}" \
    '{type:"user",message:{role:"user",content:[{tool_use_id:$id,type:"tool_result",content:"x",is_error:$e}]}}' >> "$1"
}
mkbash "$MEMT/b_cat.jsonl"   t1 "cat $MEMFILE; git status --short"
mkbash "$MEMT/b_sed.jsonl"   t2 "cd /x && sed -n '1,80p' \"$MEMFILE\""
mkbash "$MEMT/b_tilde.jsonl" t3 "head -40 ~/memory/feedback_x.md"
mkbash "$MEMT/b_deny.jsonl"  t4 "cat $MEMFILE && git push" true
mkbash "$MEMT/b_now.jsonl"   t5 "cat $MEMFILE && git push" none
mkbash "$MEMT/b_edit.jsonl"  t6 "sed -i 's/a/b/' $MEMFILE"
mkbash "$MEMT/b_echo.jsonl"  t7 "echo $MEMFILE; grep -n covers $MEMFILE"
mkbash "$MEMT/b_node.jsonl"  t8 "node - <<'EOF'
const p='$MEMFILE';
EOF"
mkbash "$MEMT/b_other.jsonl" t9 "cat $MEMT/memory/feedback_x.md.bak"

run_case "memfile_was_read Bash cat" "YES" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_cat.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read Bash sed -n, quoted path, after cd" "YES" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_sed.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read Bash head on a ~/ path" "YES" \
  "HOME=$MEMT bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_tilde.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
# The call being gated is already in the transcript when PreToolUse fires, and a
# denied call leaves an is_error result: neither ran, so neither read anything.
run_case "memfile_was_read denied Bash call is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_deny.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read the pending call itself is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_now.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read sed -i is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_edit.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read echo/grep naming the path is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_echo.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read path inside a script body is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_node.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read cat of a longer sibling path is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_other.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
# D#301 follow-up: `cat > FILE <<EOF` / `cat >> FILE <<EOF` WRITE the memory
# file, and the reader word in front made them count as reads. The one shape of
# this family the transcripts on disk hold (43 such segments in 714 Bash
# commands naming a memory file, 2026-10-17); the heredoc-body and >/dev/null
# shapes D#301 named had 0.
mkbash "$MEMT/b_write.jsonl"  t10 "cat > $MEMFILE <<'EOF'
new text
EOF"
mkbash "$MEMT/b_append.jsonl" t11 "cat >> \"$MEMFILE\" <<'EOF'
more text
EOF"
run_case "memfile_was_read cat > FILE (a write) is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_write.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
run_case "memfile_was_read cat >> \"FILE\" (an append) is not a read" "NO" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_append.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
# 0.112.0 pre-tag review: `<>` opens the file for reading too, so `cat <>F`
# reads it; only `>`, `>>` and `>|` make F a write target.
mkbash "$MEMT/b_rw.jsonl" t12 "cat <>$MEMFILE"
run_case "memfile_was_read cat <>FILE (read-write) is a read" "YES" \
  "bash -c 'source $LIB; hook_memfile_was_read \"$MEMT/b_rw.jsonl\" \"$MEMFILE\" && echo YES || echo NO'"
# Cost (same review): skipping write targets kept the loop going over every
# occurrence, each step O(line length), so one 81 KB line repeating
# `> F` took 6.2 s under bash 3.2 (0.111.0: 61 ms, it stopped at the first);
# repeating an unterminated `Fx` was already 3.0 s there. The hook's limit
# is 3 s, and a killed hook allows. At most 16 occurrences per segment are
# examined now. Discriminates under bash 3.2 (bash32-runtime.sh, macOS CI);
# bash 5.x took under 1 s either way.
for shape in "> $MEMFILE " "${MEMFILE}x "; do
  line="cat"
  for ((i = 0; i < 81000 / ${#shape}; i++)); do line+=" $shape"; done
  mkbash "$MEMT/b_long.jsonl" t13 "$line"
  t0=$(date +%s%N 2>/dev/null)
  bash -c "source $LIB; hook_memfile_was_read \"$MEMT/b_long.jsonl\" \"$MEMFILE\"" >/dev/null 2>&1
  t1=$(date +%s%N 2>/dev/null)
  if [[ "$t0" =~ ^[0-9]+$ && "$t1" =~ ^[0-9]+$ ]]; then
    ms=$(((t1 - t0) / 1000000))
    if ((ms < 2500)); then
      echo "PASS: memfile_was_read 81 KB line of '${shape:0:2}…' in ${ms} ms (< 2500)"
    else
      echo "FAIL: memfile_was_read 81 KB line of '${shape:0:2}…' took ${ms} ms (limit 2500, hook timeout 3000)"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "  (memfile_was_read timing: this date has no %N; skipped)"
  fi
done

# Consumer gate. Extraction, not a list: any hook that resolves a path inside the
# memory dir has to answer this question, and must answer it here. Without this
# join the extraction fixes today's two copies and nothing holds the third
# (feedback_extraction_needs_consumer_gate).
HOOKS_DIR="$(cd "$(dirname "$0")/../../hooks" && pwd)"
CONSUMERS=()
OFFENDERS=()
PRIVATE=()
for f in "$HOOKS_DIR"/*.sh; do
  # Comment lines dropped first: this test's own subject is described in prose
  # inside those files, and a gate that counts prose as code reads green on a
  # comment and red on an explanation.
  code=$(sed 's/^[[:space:]]*#.*$//' "$f")
  case "$code" in
    *'MEM_DIR'*)
      CONSUMERS+=("$(basename "$f")")
      case "$code" in
        *hook_memfile_was_read*) ;;
        *) OFFENDERS+=("$(basename "$f")") ;;
      esac
      ;;
  esac
  case "$code" in
    *'file_path\":\"'*|*'file_path":"'*) PRIVATE+=("$(basename "$f")") ;;
  esac
done

if (( ${#CONSUMERS[@]} < 2 )); then
  echo "FAIL: memory-dir consumer extraction found ${#CONSUMERS[@]} hook(s) — a consumer gate must never validate an empty set"
  FAIL=$((FAIL + 1))
else
  echo "PASS: ${#CONSUMERS[@]} hook(s) resolve memory-dir paths (${CONSUMERS[*]})"
fi

if (( ${#OFFENDERS[@]} > 0 )); then
  echo "FAIL: hook(s) deciding 'was this memory file read' without hook_memfile_was_read: ${OFFENDERS[*]}"
  FAIL=$((FAIL + 1))
else
  echo "PASS: every memory-dir consumer uses the shared predicate"
fi

if (( ${#PRIVATE[@]} > 0 )); then
  echo "FAIL: hook(s) with a private file_path transcript match: ${PRIVATE[*]} — the field anchor lives in hook-common.sh"
  FAIL=$((FAIL + 1))
else
  echo "PASS: no hook keeps a private file_path matcher"
fi

# hook_record_plugin_root — the one bit no other mechanism carries (see the
# function's own header in hook-common.sh for why BASH_SOURCE is the only
# observer). Uses the shared assert vocabulary (R11-27) rather than run_case:
# these cases assert file CONTENTS and exit status, not a single stdout string.
# shellcheck source=../lib/assert.sh
source "$(cd "$(dirname "$0")" && pwd)/../lib/assert.sh"
# shellcheck source=../../hooks/lib/hook-common.sh
source "$LIB"

HOOKROOT_SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/claudemd-hookroot.XXXXXX") || exit 1
HOOKROOT_FILE="$HOOKROOT_SANDBOX/.claude/.claudemd-state/hook-root.json"

# A root that is not a directory records nothing.
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$HOOKROOT_SANDBOX/absent" "sid-1"
if [[ -f "$HOOKROOT_FILE" ]]; then HOOKROOT_RC=0; else HOOKROOT_RC=1; fi
assert_status "hook_record_plugin_root: no record for a root that does not exist" 1 "$HOOKROOT_RC"

mkdir -p "$HOOKROOT_SANDBOX/fake-root"
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$HOOKROOT_SANDBOX/fake-root" "sid-1"
assert_contains "hook_record_plugin_root: records the root it was handed" \
  "\"root\":\"$HOOKROOT_SANDBOX/fake-root\"" "$(cat "$HOOKROOT_FILE" 2>/dev/null)"
assert_contains "hook_record_plugin_root: records the session id" \
  '"sid":"sid-1"' "$(cat "$HOOKROOT_FILE" 2>/dev/null)"

# A path carrying a JSON metacharacter records nothing and leaves the prior
# record intact, rather than emitting a file the reader will throw away.
mkdir -p "$HOOKROOT_SANDBOX/quo\"te"
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$HOOKROOT_SANDBOX/quo\"te" "sid-2"
assert_contains "hook_record_plugin_root: a quote-carrying root leaves the prior record intact" \
  '"sid":"sid-1"' "$(cat "$HOOKROOT_FILE" 2>/dev/null)"

# Same failure class, different metacharacter: a raw newline in the root also
# records nothing and leaves the prior record intact.
NEWLINE_ROOT="$HOOKROOT_SANDBOX/new"$'\n'"line"
mkdir -p "$NEWLINE_ROOT" 2>/dev/null
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$NEWLINE_ROOT" "sid-3"
assert_contains "hook_record_plugin_root: a newline-carrying root leaves the prior record intact" \
  '"sid":"sid-1"' "$(cat "$HOOKROOT_FILE" 2>/dev/null)"

# HK-M3 (round-17): an EMPTY sid must carry the recorded one forward, not blank
# it. session-end-check.sh calls this before parsing its event and passed
# `${CLAUDE_SESSION_ID:-}`, a variable Claude Code never exports, so every clean
# exit rewrote the file with `"sid":""` — and the sid is how doctor tells "the
# session that is running recorded this" from "an older one left it".
mkdir -p "$HOOKROOT_SANDBOX/second-root"
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$HOOKROOT_SANDBOX/second-root" ""
assert_contains "hook_record_plugin_root: an empty sid keeps the recorded one" \
  '"sid":"sid-1"' "$(cat "$HOOKROOT_FILE" 2>/dev/null)"
# The control: the ROOT still updates on that same call, so the carry-over is a
# carry-over and not a silent no-op that would hide a stale root.
assert_contains "hook_record_plugin_root: an empty sid still updates the root" \
  "\"root\":\"$HOOKROOT_SANDBOX/second-root\"" "$(cat "$HOOKROOT_FILE" 2>/dev/null)"
# And a non-empty sid still overwrites — the carry-over must not become a lock.
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$HOOKROOT_SANDBOX/second-root" "sid-9"
assert_contains "hook_record_plugin_root: a real sid still replaces the recorded one" \
  '"sid":"sid-9"' "$(cat "$HOOKROOT_FILE" 2>/dev/null)"

# HK-M2 (round-17): its own kill switch. DISABLE_RULE_HITS_LOG covers the jsonl
# and nothing else, so a sandboxed probe that set only that one was still
# rewriting this file in the live state dir on every session start and end.
HOOKROOT_PRE=$(cat "$HOOKROOT_FILE" 2>/dev/null)
HOME="$HOOKROOT_SANDBOX" DISABLE_HOOK_ROOT_RECORD=1 \
  hook_record_plugin_root "$HOOKROOT_SANDBOX/fake-root" "sid-switched-off"
assert_eq "hook_record_plugin_root: DISABLE_HOOK_ROOT_RECORD=1 writes nothing" \
  "$HOOKROOT_PRE" "$(cat "$HOOKROOT_FILE" 2>/dev/null)"
# Control: the same call without the switch DOES write, so the case above is
# about the switch and not about an argument that was never going to record.
HOME="$HOOKROOT_SANDBOX" hook_record_plugin_root "$HOOKROOT_SANDBOX/fake-root" "sid-switched-off"
assert_contains "hook_record_plugin_root: the same call records with the switch unset" \
  '"sid":"sid-switched-off"' "$(cat "$HOOKROOT_FILE" 2>/dev/null)"

rm -rf "${HOOKROOT_SANDBOX:?}"

# D#213: no program is read from a here-doc at source time. bash 3.2 (macOS
# /bin/bash) writes every here-doc to a temp file; with none writable the
# variable stayed unset, and its consumers under `set -u` died or went silent
# (banned-vocab's Path 2 let the push through). The programs are single-quoted
# literals now. Static half: no `read -r -d '' NAME <<` is left under hooks/.
# Runtime half: under a zero file-size limit, sourcing the libraries leaves the
# three library programs set and prints no temp-file error; it discriminates
# only under bash ≤5.0 (bash32-runtime.sh, macOS CI), where 5.1+ uses a pipe.
HOOKS_DIR="$(cd "$(dirname "$LIB")/.." && pwd)"
LEFT_HD=$(grep -rnE "read -r -d '' [A-Za-z_]+ <<" "$HOOKS_DIR" --include='*.sh' || true)
assert_eq "D#213: no source-time here-doc assignment left under hooks/" "" "$LEFT_HD"
# shellcheck disable=SC2016  # the inner shell expands
NOTMP_OUT=$( (trap '' XFSZ; ulimit -f 0; bash -c 'source "$1" && source "$2"
  for v in HOOK_HEREDOC_AWK HOOK_USER_TURN_JQ MEMTAGS_AWK; do
    [[ -n "${!v:-}" ]] && printf "%s=set " "$v" || printf "%s=EMPTY " "$v"
  done' _ "$LIB" "$(dirname "$LIB")/memory-tags.sh") 2>&1)
assert_eq "D#213: no temp file writable → the library programs are set, no error" \
  "HOOK_HEREDOC_AWK=set HOOK_USER_TURN_JQ=set MEMTAGS_AWK=set " "$NOTMP_OUT"

FAIL=$((FAIL + CLAUDEMD_ASSERT_FAIL))

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
