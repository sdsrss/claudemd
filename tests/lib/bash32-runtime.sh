#!/usr/bin/env bash
# bash32-runtime.sh — EXECUTE the hooks and their fixture suites under a real
# bash 3.2, rather than only parsing them.
#
# SINGLE SOURCE for the runtime check that runs in ci.yml AND, whenever a 3.2
# binary is reachable, in tests/run-all.sh. Third file in a family whose first
# two headers each record what a hand-copied scope cost: tests/lib/shell-files.sh
# and tests/lib/bash32-constructs.sh.
#
# Why a THIRD bash-3.2 gate. The two that exist both stop short of running code:
#   - bash32-constructs.sh greps for bash-4 SYNTAX IT KNOWS TO LOOK FOR. It is a
#     pattern list, so it can only ever catch constructs someone already added.
#   - ci.yml's real-3.2 step builds bash 3.2.57 and `bash -n`s every hook source.
#     That catches what 3.2 cannot PARSE — the v0.58.0 `VAR=$(cat <<'EOF' … )`
#     class that took all 15 hooks down on macOS — and nothing else. Its own
#     comment is careful about this: a real 3.2 is present, and it is used to
#     parse.
# A construct can pass both and still die on the line that runs it. `declare -g`
# (bash 4.2), `local -n` (4.3) and `${x@Q}` (4.4) all parse cleanly under 3.2.
# Verified rather than assumed: `declare -g CLAUDEMD_MUT32=1` injected into
# hook_read_event leaves bash32-constructs.sh green, leaves `bash -n` green under
# a real 3.2, and dies at runtime with `declare: -g: invalid option`.
#
# What raised the stakes. v0.71.0 (audit batch H) moved `read -r -d ''`, process
# substitution and `printf -v` + `${!var}` onto the FIRST-PARSE path of all four
# PreToolUse:Bash hooks — the hottest path in the plugin, executed on every Bash
# tool call. Until this gate those constructs had only ever been EXECUTED under
# bash 5; the v0.71.0 pre-tag review recorded bash 3.2 runtime as *unverified*,
# explicitly not as passed. macOS runs these hooks under /bin/bash 3.2, so
# "unverified" there is the whole macOS user base.
#
# Usage:
#   BASH32_BIN=/path/to/bash-3.2 bash tests/lib/bash32-runtime.sh
#   bash tests/lib/bash32-runtime.sh --list    → the suite set, one per line
#
# Without a usable BASH32_BIN the script SKIPs loudly and exits 0: a maintainer
# with no 3.2 build must not be blocked, and the class already has two static
# gates that always run. Set CLAUDEMD_BASH32_REQUIRED=1 — ci.yml does — to turn
# every skip into a hard failure. In CI the binary is built (and cached) two
# steps above, so a missing or wrong-version one is the defect, not the host.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# Floor for the suite set. The globs below resolve 32 suites as of 2026-09-01
# (re-measure with `bash tests/lib/bash32-runtime.sh --list | grep -c .` rather
# than trusting this number). An unexpanded glob — a directory rename, a change
# to the `.test.sh` convention, a source export without tests/ — would otherwise
# run zero suites and report a green 3.2 run over nothing, which is the exact
# "the layer vanished and the run said all green" shape the sibling floors in
# run-all.sh, shell-files.sh and bash32-constructs.sh all exist to close.
BASH32_SUITE_FLOOR=25

# The suite set: every fixture-driven suite run-all.sh executes under bash. Same
# two globs run-all.sh loops over, deliberately — two gates over one class must
# not have two scopes (feedback_gate_scope_must_cover_its_subject). tests/lib/
# and tests/*.sh are NOT here: they are libraries and the runner itself, covered
# by the static gate's wider scope and executed transitively by the suites below.
bash32_runtime_suites() {
  local f
  for f in "$ROOT"/tests/hooks/*.test.sh "$ROOT"/tests/integration/*.test.sh; do
    [[ -f "$f" ]] && printf '%s\n' "$f"
  done
  return 0
}

bash32_checked_suites() {
  local list n
  list=$(bash32_runtime_suites)
  n=$(printf '%s\n' "$list" | grep -c .)
  if (( n < BASH32_SUITE_FLOOR )); then
    echo "FAIL: suite set resolved only $n suite(s) (floor $BASH32_SUITE_FLOOR) — the glob matched nothing or the layout moved" >&2
    return 1
  fi
  printf '%s\n' "$list"
}

if [[ "${1:-}" == "--list" ]]; then
  bash32_checked_suites || exit 1
  exit 0
fi

# --- resolve the interpreter -------------------------------------------------

REQUIRED="${CLAUDEMD_BASH32_REQUIRED:-}"
skip_or_fail() {
  echo "SKIP: $1"
  if [[ -n "$REQUIRED" ]]; then
    echo "FAIL: that SKIP is not acceptable here — CLAUDEMD_BASH32_REQUIRED is set" >&2
    exit 1
  fi
  exit 0
}

B32="${BASH32_BIN:-}"
if [[ -z "$B32" ]]; then
  skip_or_fail "BASH32_BIN is unset — no bash 3.2 to run the hooks under.
      Build one and re-run:
        curl -sSLo b.tgz https://ftp.gnu.org/gnu/bash/bash-3.2.57.tar.gz
        tar xzf b.tgz && cd bash-3.2.57 && ./configure -q --without-bash-malloc && make -s
        BASH32_BIN=\$PWD/bash bash tests/lib/bash32-runtime.sh"
fi
[[ -x "$B32" ]] || skip_or_fail "BASH32_BIN=$B32 is not an executable"

# The binary must BE 3.2. Without this a stale env var, a wrong cache key or a
# plain typo pointing at /bin/bash makes every suite pass under bash 5 and the
# step report "all suites passed under bash 3.2" — a gate certifying the very
# interpreter it exists to look past.
B32_VER="$("$B32" --version 2>/dev/null | head -1)"
case "$B32_VER" in
  *"version 3.2"*) : ;;
  *) echo "FAIL: BASH32_BIN=$B32 is not bash 3.2 — reports: ${B32_VER:-<no output>}" >&2; exit 1 ;;
esac

# --- put it on PATH ----------------------------------------------------------

# The suites spawn hooks as `bash "$HOOK"` and the hooks carry
# `#!/usr/bin/env bash`, so the interpreter is chosen by PATH at every level. A
# shim named `bash` ahead of the real one therefore reaches the whole tree — the
# suites, the hooks they drive, and the libraries those source — without editing
# several hundred call sites into a variable they would then drift away from.
# Trap installed BEFORE mktemp, against an empty variable: armed after the
# assignment there is a window where a signal leaves the directory behind, and
# §8.V4 makes disposal the creating task's job, not a later sweep's
# (feedback_fix_creates_same_class_instance).
SHIM=""
trap 'if [ -n "$SHIM" ]; then rm -rf "$SHIM"; fi' EXIT
SHIM=$(mktemp -d) || { echo "FAIL: mktemp -d failed — cannot build the interpreter shim" >&2; exit 1; }
printf '#!/bin/sh\nexec %s "$@"\n' "$B32" > "$SHIM/bash" || exit 1
chmod +x "$SHIM/bash" || exit 1
export PATH="$SHIM:$PATH"

# REACH assertion. Everything below is worthless if the shim is not the `bash`
# the suites actually get: a PATH ordering mistake, a read-only mktemp, a shell
# that resolved `bash` before this line, and the run is bash 5 wearing a 3.2
# label — green, and meaningless. Ask the interpreter itself.
REACHED="$(bash -c 'printf "%s" "$BASH_VERSION"' 2>/dev/null)"
case "$REACHED" in
  3.2*) : ;;
  *) echo "FAIL: the shim is not in effect — \`bash\` on PATH reports BASH_VERSION=${REACHED:-<none>}, not 3.2" >&2; exit 1 ;;
esac

# --- run ---------------------------------------------------------------------

# shellcheck source=run-suite.sh
source "$HERE/run-suite.sh"

SUITES=$(bash32_checked_suites) || exit 1
COUNT=$(printf '%s\n' "$SUITES" | grep -c .)
echo "== bash 3.2 runtime: $COUNT suite(s) under $B32_VER =="

FAILED=0
RAN=0
while IFS= read -r t; do
  [[ -n "$t" ]] || continue
  RAN=$((RAN + 1))
  # 600s, double run-all.sh's 300s cap. Same reasoning that file records for
  # raising 120 → 300: a real hang is infinite, so a longer cap catches it just
  # as well, and the only cost is minutes on a run someone is already debugging.
  # 3.2 is slower than 5.x at the per-row spawns pre-bash-safety.test.sh drives,
  # and this leg exists to report portability, not to time it.
  if ! run_suite "$t" 600 >"$SHIM/out.log" 2>&1; then
    FAILED=$((FAILED + 1))
    echo "FAIL: $(basename "$t") under bash 3.2"
    grep -E '^(FAIL|FAILED|TIMEOUT|not ok)' "$SHIM/out.log" | head -8 | sed 's/^/      /'
  fi
done <<EOF
$SUITES
EOF

if (( RAN < BASH32_SUITE_FLOOR )); then
  echo "FAIL: only $RAN suite(s) ran (floor $BASH32_SUITE_FLOOR) — refusing to report a green 3.2 run over that few" >&2
  exit 1
fi
if (( FAILED > 0 )); then
  echo "OVERALL: $FAILED of $RAN suite(s) failed under bash 3.2 (they pass under 5.x — this is a macOS /bin/bash portability defect)"
  exit 1
fi
echo "OK: all $RAN suite(s) pass with the hooks EXECUTED under $B32_VER"
