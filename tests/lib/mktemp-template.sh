#!/usr/bin/env bash
# mktemp-template.sh — every sandbox this repo makes must be NAMEABLE by the
# tool that cleans up after it.
#
# `mktemp -d` with no template yields `tmp.XXXXXXXXXX`. `/claudemd-clean-residue`
# matches on the `claudemd-` prefix, so the repo's own recycler was blind to the
# largest class of residue the repo's own tests produced — 150-250 stray $TMPDIR
# directories a day, 2.6 GB across 524 directories in total, measured
# 2026-09-02 (audit R11-38). Same shape as
# feedback_gate_scope_must_cover_its_subject, except here the gate and its
# subject belong to the same project.
#
# Usage: bash tests/lib/mktemp-template.sh          → exit 0 clean, 1 with offenders on stdout
#        bash tests/lib/mktemp-template.sh --list   → every judged call site, one per line
#
# Paths are printed relative to the repo root; the caller must be cd'd there.
# MKTEMP_GATE_ROOT overrides the repository judged (test seam: the control in
# tests/scripts/mktemp-template-gate.test.js runs this file against fixtures).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${MKTEMP_GATE_ROOT:-$(cd "$HERE/../.." && pwd)}"

# Floor, for the same reason tests/lib/shell-files.sh has one: `git ls-files`
# prints nothing outside a checkout, and a gate that judges zero call sites
# reports "clean" indistinguishably from a gate whose matcher broke
# (feedback_gate_must_report_its_cardinality). The gate printed 96 on
# 2026-09-02 (its own "-- N mktemp call site(s)" line); the floor is set below
# that with room to delete a suite, but far enough above zero that a matcher
# returning nothing cannot pass.
MKTEMP_CALL_FLOOR=${MKTEMP_CALL_FLOOR:-80}

# The one exclusion, named rather than silent: this file quotes the invocation
# syntax it looks for, so the matcher matches its own pattern string. Same
# self-reference the repo already handles by name in
# scripts/lint-argv.js#FILE_ALLOWLIST ('this gate (the detector itself)') and
# warned about in feedback_self_referential_marker_regex. Kept to ONE path so it
# cannot quietly grow into a skip list.
SELF='tests/lib/mktemp-template.sh'

# One line of shell → the mktemp CALLS on it, one per output line, each cut at
# the closing `)` / backtick or end of line. Judging the call and not the whole
# line is what stops a trailing comment from vouching for the code before it:
# `D=$(mktemp -d) # XXXXXX` used to pass, because the old check was a
# whole-line `grep -v XXXX` after stripping only FULL-line comments (0.72.0
# pre-tag review, MEDIUM-3). `$( mktemp` with a space after the paren is a call
# too (LOW-1). Only the three CALL shapes are extracted — the word `mktemp`
# inside an error string (`|| { echo "FAIL: mktemp"; exit 1; }`) is not a call.
# Known limit: a template built from a nested `$(...)` is cut at the inner `)`.
mktemp_calls_on_line() {
  grep -oE '\$\([[:space:]]*mktemp[^)`]*|`mktemp[^`]*|^[[:space:]]*mktemp[^)`]*' <<<"$1"
}

mktemp_call_sites() {
  cd "$REPO" || return 1
  local f
  git ls-files '*.sh' 2>/dev/null | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    [[ "$f" == "$SELF" ]] && continue
    # Comment lines are documentation, not calls — the repo has a long history of
    # gates reading prose as code (feedback_gate_reads_prose_not_code), and
    # hooks/pre-bash-safety-check.sh's header quotes a dozen mktemp shapes.
    #
    # An ESCAPED `\$(mktemp` is test DATA fed to the hook under test and must keep
    # its exact spelling, so it is excluded by construction, not by an allowlist.
    sed -E 's/^[[:space:]]*#.*$//' "$f" \
      | grep -nE '\$\([[:space:]]*mktemp|`mktemp|^[[:space:]]*mktemp[[:space:]]' \
      | grep -v '\\\$(mktemp' \
      | sed "s|^|$f:|"
  done
}

if [[ "${1:-}" == "--list" ]]; then
  mktemp_call_sites
  exit 0
fi

CALLS=$(mktemp_call_sites)
N=$(printf '%s' "$CALLS" | grep -c . || true)
if [[ "$N" -lt "$MKTEMP_CALL_FLOOR" ]]; then
  echo "FAIL: only $N mktemp call site(s) resolved (floor $MKTEMP_CALL_FLOOR) — the matcher stopped matching, so this gate is judging nothing"
  exit 1
fi

# A site is an offender when ANY mktemp call on that line lacks a template.
UNTEMPLATED=''
while IFS= read -r site; do
  [[ -n "$site" ]] || continue
  code=${site#*:*:}
  # `grep .` reading to EOF, not `grep -q`: under pipefail -q closes the pipe on
  # its first hit and the upstream SIGPIPE turns the whole test false
  # (feedback_pipefail_grep_q_sigpipe) — an offender would then pass.
  if mktemp_calls_on_line "$code" | grep -v 'XXXX' | grep . >/dev/null; then
    UNTEMPLATED="${UNTEMPLATED}${site}"$'\n'
  fi
done <<<"$CALLS"

if [[ -n "$UNTEMPLATED" ]]; then
  echo "FAIL: mktemp without a template — the result is tmp.XXXXXXXXXX, which /claudemd-clean-residue cannot see."
  echo "      Use a reapable prefix, e.g.  D=\$(mktemp -d \"\${TMPDIR:-/tmp}/claudemd-test-XXXXXX\")"
  printf '%s' "$UNTEMPLATED" | sed 's/^/      /'
  exit 1
fi

echo "-- $N mktemp call site(s), all templated with a reapable prefix"
