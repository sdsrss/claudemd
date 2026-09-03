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

if (( FAIL > 0 )); then
  echo "FAILED: $FAIL case(s)"
  exit 1
fi
echo "All cases passed"
