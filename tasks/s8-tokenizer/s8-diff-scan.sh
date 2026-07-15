#!/usr/bin/env bash
# s8-diff-scan.sh — equivalence proof for the §8 shared-tokenizer refactor.
#
#   s8-diff-scan.sh capture <out.tsv>   drive the LIVE hook over the corpus, write
#                                       "<verdict>\t<note>" per row (baseline snapshot)
#   s8-diff-scan.sh check   <base.tsv>  re-drive the LIVE hook, report any row whose
#                                       verdict differs from the baseline; exit 1 if any
#
# The hook must run in place (hooks/pre-bash-safety-check.sh) — it resolves LIB_DIR
# relative to its own path, so a copy elsewhere fails-open and allows everything. Hence
# we snapshot VERDICTS (not a hook copy) before touching the hook, then compare live
# output to the snapshot after each refactor step. Mirrors the corpus runner's event
# shape (tests/hooks/pre-bash-safety.test.sh run_case).
set -uo pipefail
MODE="${1:-}"; FILE="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
HOOK="$ROOT/hooks/pre-bash-safety-check.sh"
CORPUS="$ROOT/tests/fixtures/bash-safety/corpus.tsv"
TMP_HOME=$(mktemp -d); trap 'rm -rf "$TMP_HOME"' EXIT
export HOME="$TMP_HOME"
unset BASH_SAFETY_INDIRECT_CALL

verdict() { # $1=cmd $2=env → "deny" | "allow"
  local cmd="$1" env="$2" fix out dec
  fix=$(mktemp)
  jq -cn --arg c "$cmd" '{session_id:"t",tool_name:"Bash",tool_input:{command:$c}}' > "$fix"
  if [[ -n "$env" ]]; then out=$(env "$env" bash "$HOOK" < "$fix" 2>/dev/null)
  else out=$(bash "$HOOK" < "$fix" 2>/dev/null); fi
  rm -f "$fix"
  dec=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null)
  [[ "$dec" == "deny" ]] && printf 'deny' || printf 'allow'
}

# Emit "<verdict>\t<note>" for every corpus row to stdout.
run_corpus() {
  while IFS=$'\t' read -r label note cmd env || [[ -n "$label" ]]; do
    [[ -z "$label" || "$label" == \#* ]] && continue
    cmd="${cmd//__NL__/$'\n'}"
    printf '%s\t%s\n' "$(verdict "$cmd" "${env:-}")" "$note"
  done < "$CORPUS"
}

case "$MODE" in
  capture)
    [[ -n "$FILE" ]] || { echo "usage: capture <out.tsv>"; exit 2; }
    run_corpus > "$FILE"
    echo "captured $(wc -l < "$FILE" | tr -d ' ') baseline verdicts to $FILE"
    ;;
  check)
    [[ -f "$FILE" ]] || { echo "usage: check <base.tsv> (missing)"; exit 2; }
    LIVE=$(mktemp); run_corpus > "$LIVE"
    DIFFS=0
    # Join by note (line order is stable — same corpus, same skip rules).
    paste "$FILE" "$LIVE" | while IFS=$'\t' read -r bv bn lv ln; do
      if [[ "$bv" != "$lv" ]]; then echo "DIFF [$bn] baseline=$bv live=$lv"; fi
    done
    # Recount outside the subshell-pipe (while-pipe can't export DIFFS).
    DIFFS=$(paste "$FILE" "$LIVE" | awk -F'\t' '$1!=$3{c++} END{print c+0}')
    rm -f "$LIVE"
    if (( DIFFS > 0 )); then echo "FAIL: $DIFFS verdict change(s)"; exit 1; fi
    echo "OK: 0 verdict changes across corpus"
    ;;
  *)
    echo "usage: $0 capture <out.tsv> | check <base.tsv>"; exit 2 ;;
esac
