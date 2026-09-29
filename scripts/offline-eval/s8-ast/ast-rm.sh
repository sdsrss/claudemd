#!/usr/bin/env bash
# ast-rm.sh — OFFLINE RESEARCH ONLY. This is not a gate and nothing registers it
# as a hook: it judges one Bash command against the §8 rm-rf-var rule from a
# parsed AST, so scripts/offline-eval/s8-shadow.mjs can compare that judgement
# with the shipped text gate (hooks/pre-bash-safety-check.sh). Proposal R2 step 1
# ("shadow"), docs/oss-benchmark-2026-09-28.md; ported from the r1 prototype v6.
#
# Usage:  SHFMT=/path/to/shfmt bash ast-rm.sh < command.txt
# Prints one line:
#   deny <var> [<var>…]   an rm -r/-f (or find -delete / -exec rm) target holds
#                         a variable the rule does not consider validated
#   allow                 no such target
#   parse-error           shfmt rejected the command (or a `bash -c` / eval
#                         string inside it); a production arm would fall back
#                         to the text gate here
#   error                 rm-arm.jq itself failed (exit 3)
# Exit codes: 0 judged | 2 shfmt missing or older than 3.14.0 | 3 arm error.
#
# Dependency: shfmt (mvdan/sh) >= 3.14.0, taken from $SHFMT and never fetched.
# 3.14.0 changed the JSON encoding of operators from integers to strings such as
# ":?" (mvdan/sh CHANGELOG, #1321); rm-arm.jq reads the string form, so an older
# binary would silently judge every guard as absent. Measured with v3.14.1
# linux/amd64, sha256
#   76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf
# (equal to the GitHub release asset digest). tests/scripts/s8-shadow.test.js
# pins the parts of the JSON schema rm-arm.jq depends on.
#
# The command is only parsed, never executed: shfmt reads it on stdin and
# jq reads shfmt's JSON. Nested `bash -c` / eval strings are re-parsed the
# same way, up to depth 3. The policy lives in rm-arm.jq (see its header).
#
# The gate's switches for this rule are honoured, so a comparison measures
# policy rather than configuration: DISABLE_PRE_BASH_SAFETY_HOOK=1 and the
# [allow-rm-rf-var] token allow; BASH_SAFETY_INDIRECT_CALL=0 stops the
# re-parse of `bash -c` / eval strings. S8_AST_ABLATE=piece,… is a research
# knob (rm-arm.jq's header; `knobs` here turns the three switches off).
set -uo pipefail
# shfmt offsets are byte offsets; make ${s:off:len} byte-indexed too.
export LC_ALL=C
HERE="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
ARM="$HERE/rm-arm.jq"

if [[ -z "${SHFMT:-}" ]] || [[ ! -x "$SHFMT" ]]; then
  echo "ast-rm.sh: set SHFMT to an executable shfmt >= 3.14.0 (got '${SHFMT:-}')." >&2
  echo "ast-rm.sh: this is offline research tooling; it does not download shfmt." >&2
  exit 2
fi
ver=$("$SHFMT" --version 2>/dev/null) || ver=""
if [[ ! "$ver" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  echo "ast-rm.sh: cannot read the shfmt version from '$SHFMT' (got '$ver')." >&2
  exit 2
fi
maj=${BASH_REMATCH[1]}
min=${BASH_REMATCH[2]}
if (( maj < 3 || (maj == 3 && min < 14) )); then
  echo "ast-rm.sh: shfmt $ver is older than 3.14.0; its JSON encodes operators as" >&2
  echo "ast-rm.sh: integers and rm-arm.jq would read every \${VAR:?} guard as absent." >&2
  exit 2
fi

# Undo one layer of shell quoting on a word the parent shell hands to a child
# shell (`bash -c WORD`) or to eval: the text the child parses. A double-quoted
# word loses the backslash before $ ` " \ and a backslash-newline pair, as bash
# does inside double quotes; any other shape is passed through unchanged.
dequote() {
  local w="$1" out="" i c n
  case "$w" in
    \'*\')
      printf '%s' "${w:1:${#w}-2}"
      return
      ;;
    \"*\")
      w="${w:1:${#w}-2}"
      n=${#w}
      for (( i = 0; i < n; i++ )); do
        c="${w:i:1}"
        if [[ "$c" == '\' ]] && (( i + 1 < n )); then
          case "${w:i+1:1}" in
            '$' | '`' | '"' | '\')
              out+="${w:i+1:1}"
              i=$((i + 1))
              continue
              ;;
            $'\n')
              i=$((i + 1))
              continue
              ;;
          esac
        fi
        out+="$c"
      done
      printf '%s' "$out"
      return
      ;;
  esac
  printf '%s' "$w"
}

# scan TEXT DEPTH OUTER → one line per finding: `DENY <var>`, `PARSE_ERROR`,
# `DEPTH`. OUTER is the JSON array of names guarded (${VAR:?}) by the scans
# above this one: the gate credits a guard anywhere in the command text, the
# unwrapped `bash -c` string included.
scan() {
  local src="$1" depth="$2" outer="$3" json found kind a spans span inner piece guards="[]"
  json=$(printf '%s' "$src" | "$SHFMT" --to-json 2>/dev/null) || {
    echo "PARSE_ERROR"
    return
  }
  # A jq failure must not read as "no finding": that is a silent allow.
  found=$(printf '%s' "$json" | jq -r --argjson outer "$outer" --argjson ablate "$ABLATE" -f "$ARM") || {
    echo "ARM_ERROR"
    return
  }
  while IFS=$'\t' read -r kind a _; do
    case "$kind" in
      DENY) echo "DENY $a" ;;
      GUARDS) guards="$a" ;;
      INNER)
        # The gate's own opt-out for indirect calls (BASH_SAFETY_INDIRECT_CALL=0).
        [[ "${BASH_SAFETY_INDIRECT_CALL:-1}" == 0 && ",${S8_AST_ABLATE:-}," != *,knobs,* ]] && continue
        if (( depth >= 3 )); then
          echo "DEPTH"
          continue
        fi
        # a = comma-separated start:end byte spans; eval joins its words with
        # spaces, a `bash -c` script is a single span.
        inner=""
        IFS=',' read -r -a spans <<<"$a"
        for span in "${spans[@]}"; do
          piece=$(dequote "${src:${span%%:*}:$((${span##*:} - ${span%%:*}))}")
          inner+="${inner:+ }$piece"
        done
        scan "$inner" $((depth + 1)) "$guards"
        ;;
    esac
  done <<<"$found"
}

# S8_AST_ABLATE=piece,… — research knob, see rm-arm.jq's header.
ABLATE='[]'
if [[ -n "${S8_AST_ABLATE:-}" ]]; then
  ABLATE=$(jq -nc --arg a "$S8_AST_ABLATE" '$a | split(",") | map(select(length > 0))') || exit 3
fi

cmd=$(cat)
# The gate's switches for this rule, honoured so a comparison measures policy,
# not configuration: the hook's kill switch, and the per-command token (matched
# on the raw text, as the gate does, so it also counts inside a string).
if [[ ",${S8_AST_ABLATE:-}," != *,knobs,* ]] \
  && [[ "${DISABLE_PRE_BASH_SAFETY_HOOK:-}" == 1 || "$cmd" == *'[allow-rm-rf-var]'* ]]; then
  echo "allow"
  exit 0
fi
res=$(scan "$cmd" 0 "[]")
if grep -q '^ARM_ERROR' <<<"$res"; then
  echo "error"
  exit 3
elif grep -q '^PARSE_ERROR' <<<"$res"; then
  echo "parse-error"
elif grep -q '^DENY' <<<"$res"; then
  echo "deny $(grep '^DENY' <<<"$res" | cut -d' ' -f2 | sort -u | tr '\n' ' ' | sed 's/ $//')"
else
  echo "allow"
fi
