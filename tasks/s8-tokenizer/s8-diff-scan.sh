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
    # Join by NOTE, not by line position. `paste` was positional despite this
    # comment claiming otherwise: adding RED rows for a new FN class shifts every
    # later row, so a purely additive corpus edit reported dozens of phantom
    # verdict changes and masked whether any real one occurred. Rows absent from
    # the baseline (i.e. added since it was captured) are reported separately and
    # are NOT failures — an equivalence proof only binds the shared rows.
    awk -F'\t' 'NR==FNR{b[$2]=$1;next}
                { if ($2 in b) { if (b[$2]!=$1) print "DIFF [" $2 "] baseline=" b[$2] " live=" $1 }
                  else print "NEW  [" $2 "] live=" $1 }' "$FILE" "$LIVE"
    DIFFS=$(awk -F'\t' 'NR==FNR{b[$2]=$1;next} ($2 in b) && b[$2]!=$1 {c++} END{print c+0}' "$FILE" "$LIVE")
    # Coverage, printed every run. The baseline is a SNAPSHOT of a corpus that
    # keeps growing: captured 2026-07-15 at 283 rows, and by 2026-08-22 the file
    # held 915 lines of which 598 are evaluated (run_corpus skips blanks and
    # `#` rows). This tool went on printing "OK: 0 verdict changes across
    # corpus" while binding 283/598 = 47% of it — the denominator below is
    # LIVE_ROWS, i.e. 598, so quote that one and not the raw line count.
    # "0 changes" over an unstated fraction is
    # the claim-wider-than-subject shape (audit-2026-08-22 条目 25). Shared rows
    # remain the only ones an equivalence proof CAN bind; what changes is that
    # the fraction is visible, and a baseline under 90% is refused as stale.
    # The join above keys on the NOTE column, so two rows sharing a note collapse
    # into one map entry: the baseline verdict of whichever came last silently
    # binds both, and SHARED over-counts. Zero duplicates today (measured), which
    # is exactly when a guard is cheap to add (2026-08-29 audit R10-19).
    DUP_NOTES=$(cut -f2 "$LIVE" | sort | uniq -d)
    if [[ -n "$DUP_NOTES" ]]; then
      echo "FAIL: corpus note column is the join key and is not unique:" >&2
      printf '%s\n' "$DUP_NOTES" | sed 's/^/      /' >&2
      exit 1
    fi
    LIVE_ROWS=$(grep -c . "$LIVE" || true)
    BASE_ROWS=$(grep -c . "$FILE" || true)
    SHARED=$(awk -F'\t' 'NR==FNR{b[$2]=1;next} ($2 in b){c++} END{print c+0}' "$FILE" "$LIVE")
    rm -f "$LIVE"
    PCT=0
    (( LIVE_ROWS > 0 )) && PCT=$(( SHARED * 100 / LIVE_ROWS ))
    echo "coverage: $SHARED/$LIVE_ROWS corpus rows carry a baseline verdict (${PCT}%); baseline holds $BASE_ROWS"
    if (( DIFFS > 0 )); then echo "FAIL: $DIFFS verdict change(s) among the $SHARED shared row(s)"; exit 1; fi
    if (( PCT < 90 )); then
      echo "STALE: the baseline binds only ${PCT}% of the corpus — re-capture before quoting this as an equivalence proof:"
      echo "       bash tasks/s8-tokenizer/s8-diff-scan.sh capture $FILE"
      exit 1
    fi
    echo "OK: 0 verdict changes across the $SHARED shared row(s)"
    ;;
  *)
    echo "usage: $0 capture <out.tsv> | check <base.tsv>"; exit 2 ;;
esac
