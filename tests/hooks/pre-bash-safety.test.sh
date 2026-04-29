#!/usr/bin/env bash
# pre-bash-safety hook tests — corpus-driven.
# Cases live in tests/fixtures/bash-safety/corpus.tsv (label / note / cmd / env).
# This runner loads the corpus and drives the hook for each row, asserting
# allow vs deny by label. The corpus is the single source of truth for
# regression cases; new cases go in the .tsv, not here.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HERE/../../hooks/pre-bash-safety-check.sh"
CORPUS="$HERE/../fixtures/bash-safety/corpus.tsv"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"

if [[ ! -f "$CORPUS" ]]; then
  echo "FAIL: corpus missing at $CORPUS"; exit 1
fi

PASS=0; FAIL=0

run_case() {
  local label="$1" note="$2" cmd="$3" env="$4"
  # __NL__ marker → LF (heredoc cases). Other backslash sequences pass through.
  cmd="${cmd//__NL__/$'\n'}"
  local fix out decision
  fix=$(mktemp)
  jq -cn --arg c "$cmd" '{session_id:"t",tool_name:"Bash",tool_input:{command:$c}}' > "$fix"
  if [[ -n "$env" ]]; then
    out=$(env "$env" bash "$HOOK" < "$fix" 2>&1)
  else
    out=$(bash "$HOOK" < "$fix" 2>&1)
  fi
  rm -f "$fix"

  case "$label" in
    pass)
      if [[ -z "$out" ]]; then
        PASS=$((PASS + 1))
      else
        echo "FAIL [pass]: $note (got: $out)"
        FAIL=$((FAIL + 1))
      fi
      ;;
    deny)
      decision=$(echo "$out" | jq -r .hookSpecificOutput.permissionDecision 2>/dev/null)
      if [[ "$decision" == "deny" ]]; then
        PASS=$((PASS + 1))
      else
        echo "FAIL [deny]: $note (expected deny, got: $out)"
        FAIL=$((FAIL + 1))
      fi
      ;;
    *)
      echo "FAIL [bad-label]: $note (label=$label)"
      FAIL=$((FAIL + 1))
      ;;
  esac
}

# Drive the corpus.
while IFS=$'\t' read -r label note cmd env || [[ -n "$label" ]]; do
  # Skip blanks and comment lines (corpus comments start with `#`).
  [[ -z "$label" ]] && continue
  [[ "$label" == \#* ]] && continue
  run_case "$label" "$note" "$cmd" "${env:-}"
done < "$CORPUS"

# Inline edge case: malformed-JSON stdin must fail-open silently. Not a
# corpus case — corpus is "given valid event, hook produces correct
# allow/deny"; this exercises the parser robustness path.
TMP_FIX=$(mktemp)
echo 'not json' > "$TMP_FIX"
out=$(bash "$HOOK" < "$TMP_FIX" 2>&1)
rm -f "$TMP_FIX"
if [[ -z "$out" ]]; then
  PASS=$((PASS + 1))
else
  echo "FAIL: malformed JSON stdin should fail-open (got: $out)"
  FAIL=$((FAIL + 1))
fi

TOTAL=$((PASS + FAIL))
if (( FAIL > 0 )); then
  echo "Tests: $PASS/$TOTAL passed"
  exit 1
fi
echo "Tests: $PASS/$TOTAL passed"
