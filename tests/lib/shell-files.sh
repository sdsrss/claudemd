#!/usr/bin/env bash
# shell-files.sh — the tracked shell-file set, single-sourced for every consumer.
#
# SINGLE SOURCE for the shellcheck scope used by ci.yml AND tests/run-all.sh
# (2026-08-29 audit R10-18c). The workflow used to carry its own list — the
# tool invoked at `--severity=warning` over these seven globs:
#
#     hooks/*.sh hooks/lib/*.sh scripts/*.sh tests/lib/*.sh tests/hooks/*.sh
#     tests/integration/*.sh tests/run-all.sh tasks/s8-tokenizer/*.sh
#
# (spelled without the tool's own name at the start of a comment line: `# shell`
# + `check` there is parsed as a DIRECTIVE, and quoting the old command verbatim
# made this file fail the very gate it feeds — SC1072/SC1073, caught on the
# first full run.)
#
# — seven hand-written globs that were a proper SUBSET of what run-all.sh checks
# (`git ls-files '*.sh'`). The audit offered a choice: drop the blocking CI step
# and rely on run-all's wider one (losing "fail two minutes earlier"), or keep
# both and keep maintaining the copy. Neither was necessary; the copy was. Both
# callers now read this file, so the CI step keeps failing early AND cannot be
# narrower than the gate it front-runs (feedback_gate_scope_must_cover_its_subject).
#
# The same shape as tests/lib/bash32-constructs.sh, for the same reason and with
# the same floor discipline — that file's own header records what a hand-copied
# scope cost the first time.
#
# Usage: bash tests/lib/shell-files.sh   → one tracked .sh path per line, exit 0.
#        source tests/lib/shell-files.sh → defines shell_files_checked_scope.
#
# Paths are printed relative to the repo root, so a caller must be cd'd there
# (both callers are).

set -uo pipefail

# Floor for every consumer. `git ls-files` prints nothing at all outside a git
# checkout and prints nothing useful from a partial one — and shellcheck over an
# empty argument list reads its stdin, which under CI is closed, so it exits 0
# and the step passes having checked nothing. The count is 61 as of 2026-09-01
# — the first draft said 60, written before this file was itself tracked, i.e. a
# stale figure inside the file whose job is to be the one place it is written
# down. Re-measure with `bash tests/lib/shell-files.sh | grep -c .` rather than
# trusting this number. 40 leaves churn headroom while still catching a whole
# directory going missing.
SHELL_FILES_FLOOR=40

# Resolve the tracked .sh set, enforce the floor, print one path per line.
shell_files_checked_scope() {
  local root list n
  root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  list=$(git -C "$root" ls-files '*.sh' 2>/dev/null)
  n=$(printf '%s\n' "$list" | grep -c .)
  if (( n < SHELL_FILES_FLOOR )); then
    echo "FAIL: tracked .sh set resolved only $n file(s) (floor $SHELL_FILES_FLOOR) —" >&2
    echo "      not a git checkout, or the layout moved. Refusing to report a scan" >&2
    echo "      over a set this short as a pass." >&2
    return 1
  fi
  printf '%s\n' "$list"
}

# Executed directly (not sourced) → print the scope.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  shell_files_checked_scope "$@"
  exit $?
fi
