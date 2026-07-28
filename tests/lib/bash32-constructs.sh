#!/usr/bin/env bash
# bash32-constructs.sh — static backstop for the macOS bash-3.2 regression class.
#
# SINGLE SOURCE for the check that runs in ci.yml AND in tests/run-all.sh
# (v0.62.2). It used to live only as an inline block in the workflow, which cost
# two round-trips in one afternoon:
#   - the scope was hooks/ only, so v0.62.1's new TEST suite shipped `mapfile`
#     and the macOS leg went red on `mapfile: command not found`;
#   - the check was CI-only, so `npm test` could not surface the class at all —
#     the same gap that let a shellcheck failure reach a tag one release earlier.
# Copying the block into run-all.sh would have made it a hand-copied mirror, the
# exact drift shape v0.62.0 exists to close. One file, two callers.
#
# Why static and not runtime: CC runs hooks under the system /bin/bash, which is
# 3.2 on macOS, while both CI legs use bash 5 (Homebrew gnubin on PATH). Neither
# runtime catches these; v0.23.6 shipped `declare -A` this way
# (feedback_macos_shell_portability).
#
# Usage: bash tests/lib/bash32-constructs.sh [file ...]
#        no args → the default scope below. Exit 0 clean, 1 findings.
#        --list  → print the default scope, one existing file per line, and exit.
#
# `--list` exists so the OTHER bash-3.2 gate — ci.yml's real-3.2 `bash -n` parse
# step, which builds bash 3.2.57 and cannot run locally — consumes the same file
# set instead of hand-listing its own (2026-07-28). It had drifted to
# `hooks/*.sh hooks/lib/*.sh tests/lib/*.sh`, i.e. narrower than the pattern gate
# it backs up: a `$(cat <<EOF …)` in tests/hooks/ would have been invisible to the
# gate whose entire purpose is that construct. Two gates for one class must not
# have two scopes (feedback_gate_scope_must_cover_its_subject).

set -uo pipefail

# declare/local/typeset with any -...A flag cluster (associative arrays);
# mapfile / readarray; array and pattern case-modification (${x^^} ${x[@],,}).
# Comments are stripped per line first, so prose naming a construct — including
# this file's own header and the fix-notes in mem-audit.sh — does not trip it.
# The two bare-word alternatives are spliced from fragments so this line does not
# match ITSELF — a detector whose definition site is its own first finding reports
# a permanent false positive and teaches everyone to ignore it
# (feedback_self_referential_marker_regex). The `declare|local|typeset` branch
# needs no splice: it only matches a real `declare -A`, not this alternation.
BASH32_PATTERN='(declare|local|typeset)[[:space:]]+-[A-Za-z]*A|map'"'"'file|read'"'"'array|\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?(\^\^|,,|\^|,)'
BASH32_PATTERN="${BASH32_PATTERN//\'/}"

bash32_scan() {
  local found=0 f m
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    m=$(sed -E 's/^[[:space:]]*#.*$//; s/[[:space:]]#.*$//' "$f" | grep -nE "$BASH32_PATTERN") || continue
    echo "bash 4+ construct in $f (breaks macOS /bin/bash 3.2):"
    printf '%s\n' "$m" | sed 's|^|  |'
    found=1
  done
  return "$found"
}

# Default scope: everything bash 3.2 has to run — the hooks themselves and the
# suites that exercise them under /bin/bash. Scripts under scripts/ are node or
# developer-invoked and are deliberately out of scope.
bash32_default_scope() {
  local root="${1:-.}" f
  for f in \
    "$root"/hooks/*.sh \
    "$root"/hooks/lib/*.sh \
    "$root"/tests/*.sh \
    "$root"/tests/lib/*.sh \
    "$root"/tests/hooks/*.sh \
    "$root"/tests/integration/*.sh
  do
    [[ -f "$f" ]] && printf '%s\n' "$f"
  done
  return 0
}

# Floor for EVERY consumer of the default scope. An unexpanded glob or a wrong
# root would emit an empty set, and a scan over nothing exits 0 with "OK: no
# bash 4+ constructs" — the same "the layer vanished and the run said all green"
# shape run-all.sh's suite floors close. Current count is 49, so the floor leaves
# 9 files of churn headroom while still catching a whole directory going missing.
#
# 2026-07-28 review: this guard first landed inside the --list branch only, so the
# DEFAULT path — the one ci.yml's pattern step and run-all.sh actually call — kept
# the hole the floor was added to close. A gate that guards one of its two entry
# points is the same defect as a gate that scans one of two directories.
BASH32_SCOPE_FLOOR=40

# Resolve the default scope, enforce the floor, print one file per line. Callers
# that bypass this (explicit file args) opt out deliberately.
bash32_checked_scope() {
  local root list n
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  list=$(bash32_default_scope "$root")
  n=$(printf '%s\n' "$list" | grep -c .)
  if (( n < BASH32_SCOPE_FLOOR )); then
    echo "FAIL: default scope resolved only $n file(s) (floor $BASH32_SCOPE_FLOOR) — glob matched nothing or the layout moved" >&2
    return 1
  fi
  printf '%s\n' "$list"
}

# Executed directly (not sourced) → run the scan.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "${1:-}" == "--list" ]]; then
    bash32_checked_scope || exit 1
    exit 0
  fi
  if (( $# > 0 )); then
    bash32_scan "$@" || exit 1
  else
    _files=()
    while IFS= read -r _f; do
      [[ -n "$_f" ]] && _files+=("$_f")
    done < <(bash32_checked_scope) || true
    if (( ${#_files[@]} < BASH32_SCOPE_FLOOR )); then
      echo "FAIL: refusing to report a clean scan over ${#_files[@]} file(s) (floor $BASH32_SCOPE_FLOOR)" >&2
      exit 1
    fi
    bash32_scan ${_files[@]+"${_files[@]}"} || exit 1
  fi
  echo "OK: no bash 4+ constructs in hooks or test suites (macOS bash 3.2 safe)"
fi
