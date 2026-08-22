#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

# Env hygiene (QA ISSUE-001): scrub user-tunable claudemd knobs inherited from
# the invoking shell — 15 suites assert on rule-hits logging / opt-in defaults
# and go red under e.g. DISABLE_RULE_HITS_LOG=1. Suites that need a knob set
# it explicitly per-case.
# shellcheck source=lib/env-hygiene.sh
source "$HERE/lib/env-hygiene.sh" && claudemd_reset_test_env
# Per-suite wall-clock guard (TEST-1): bound each bash suite so one hung test
# can't stall the whole run to the CI job-level kill. node --test gets its own
# per-test timeout below.
# shellcheck source=lib/run-suite.sh
source "$HERE/lib/run-suite.sh"

# Repo-write guard (2026-07-25 audit): no test or script may commit into the
# real repository. This is a CLASS gate, not a per-file one — `perf-baseline.sh`
# escaped through for two months precisely because only the files someone
# thought to check were checked: its `git commit --allow-empty -m noop` probe
# ran in the CALLER's cwd and left 46 empty commits on main across two clusters
# (6 on 2026-05-10, 40 on 2026-07-17), pushed with the next release. Two lines
# here cover every existing and future suite. Zero FP risk: a suite that needs
# commits must make them in its own mktemp sandbox (§8.V3).
GUARD_REPO="$(cd "$HERE/.." && pwd)"
COMMITS_BEFORE=$(git -C "$GUARD_REPO" rev-list --count HEAD 2>/dev/null || echo skip)
# The commit count is only HALF of "wrote into the real repo" (2026-07-25 audit):
# a suite that modifies a tracked file or drops an untracked artifact never
# commits, so the counter above stays equal and the guard reported PASS. On the
# atomic-ship path that artifact gets swept into the release commit in the same
# turn. Snapshot the working tree too.
PORCELAIN_BEFORE=$(git -C "$GUARD_REPO" status --porcelain 2>/dev/null || echo skip)

# Suite-count floors (2026-07-27 audit, M7). Both shell loops guard with
# `[[ -f "$t" ]] || continue`, so an unexpanded glob — a directory rename, a
# change to the `.test.sh` suffix convention, a bad checkout — skipped the ENTIRE
# layer while FAIL stayed 0 and the run printed "OVERALL: all suites passed".
# The Node leg is not exposed this way (an unexpanded glob reaches `node --test`,
# which errors). Floors are deliberately below the current counts: they catch a
# layer vanishing, not normal suite churn.
HOOK_SUITE_FLOOR=20
INTEGRATION_SUITE_FLOOR=2
HOOK_SUITES=0
INTEGRATION_SUITES=0

echo "== Shell hook tests =="
for t in "$HERE"/hooks/*.test.sh; do
  [[ -f "$t" ]] || continue
  HOOK_SUITES=$((HOOK_SUITES + 1))
  echo "-- $(basename "$t")"
  # 300s, not the 120s default (v0.64.1). pre-bash-safety.test.sh drives one hook
  # process per corpus row, and v0.64.0 took that corpus 500 → 598 rows: 65s on
  # Linux here, and macOS runners are ~4x slower at process creation, so the leg
  # blew the 120s cap and the v0.64.0 tag went red on a TIMEOUT with every
  # assertion passing (`# fail 0`, every suite printing N/N). Same reasoning the
  # node cap above already documents: a real hang is INFINITE, so 300s catches it
  # exactly as well as 120s and the only cost is minutes to report a hang someone
  # is already debugging. The per-row spawn is the actual cost driver and is filed
  # rather than fixed here — see tasks/audit-2026-07-27-deferred.md.
  run_suite "$t" 300 || FAIL=$((FAIL + 1))
done

echo "== Node.js script tests =="
# --test-timeout caps EACH test (ms); a single deadlocked test fails instead of
# hanging the run (Node ≥20 default is Infinity).
#
# 180s, not 60s (2026-07-15). The cap must be a multiple of the SLOWEST platform's
# real duration, not the fastest. doctor.test.js is spawn-bound (~15s on Linux CI,
# user≈sys≈8s), and macOS runners are roughly 4x slower at process creation — so it
# lands near 60s there and the old cap had ~zero margin. It went red on the v0.47.2
# and v0.47.3 releases (green on re-run: pure runner-speed luck), then twice in a row
# on v0.47.4 once +5 tests added ~0.5s of local load. Every one of those reported
# `# fail 0` with `failureType: 'testTimeoutFailure'` at `location: …:1:1` — the FILE
# blew the cap, no assertion failed. A real deadlock hangs FOREVER, so 180s catches it
# exactly as well as 60s; the only cost is 2 extra minutes to report a hang that
# already means someone is debugging. This keeps the TEST-1 guard while giving macOS
# the same ~4x margin Linux had. Fixing the cause (cutting doctor.test.js's spawn
# count) stays open — see the deferred item.
# The node leg runs against an ISOLATED TMPDIR so its sandbox disposal can be
# measured (2026-08-16 user-journey E2E). Every `npm test` was leaking 4 mkdtemp
# dirs into the user's real TMPDIR — 2 in sampling-audit.test.js (no rmSync at
# all) and 2 in toggle.test.js (the mkdtempSync was inlined into a spawnSync env
# literal, so the path was never bound to a name and could not be removed). They
# accumulate forever, which is exactly the §8.V4 residue class this plugin's own
# Stop hook exists to flag. Counting `mkdtempSync` against `rmSync` per file does
# NOT find them (a beforeEach/afterEach pair covers many tests, so the counts
# legitimately disagree); running the suite in a known-empty dir and inventorying
# what survives is the only reading that means anything.
# Two steps, not `NODE_TMP=$(cd "$(mktemp -d)" && pwd -P)`. That one-liner FAILS
# OPEN: when mktemp fails (TMPDIR pointing at a stale path, /tmp read-only — a
# condition this file's own /tmp-writes gate cites as observed), the substitution
# is empty, `cd ""` is a bash no-op returning 0, and `pwd -P` prints the CURRENT
# directory. NODE_TMP then becomes the repo root and the cleanup below `rm -rf`s
# it. A `[[ -n "$NODE_TMP" ]]` guard does not help — the string is non-empty,
# just wrong. Verified: `TMPDIR=/nonexistent bash -c 'X=$(cd "$(mktemp -d)" && pwd -P)'`
# yields the cwd. Physical-path resolution is still needed (macOS /var → /private/var).
NODE_TMP=$(mktemp -d) || { echo "FAIL: mktemp -d failed — cannot isolate the node leg"; exit 1; }
NODE_TMP=$(cd "$NODE_TMP" && pwd -P) || { echo "FAIL: cannot resolve $NODE_TMP"; exit 1; }
if ! TMPDIR="$NODE_TMP" node --test --test-timeout=180000 "$HERE"/scripts/*.test.js; then
  FAIL=$((FAIL + 1))
fi
# `node-compile-cache` is Node's own, not a suite's to clean — allowlisted by
# EXACT name, not `node-*`: the glob form silently ignores anything a real leak
# could be named (`node-fixture-XXXX`), which is the gate being wider than its
# stated subject. `-printf` is GNU-only — BSD/macOS find has no such primary, and
# the macOS CI leg would report an empty (always-passing) list. Strip with sed.
NODE_LEAKS=$(find "$NODE_TMP" -maxdepth 1 -mindepth 1 ! -name 'node-compile-cache' 2>/dev/null | sed 's|.*/||')
if [[ -n "$NODE_LEAKS" ]]; then
  echo "FAIL: node test suite(s) left sandbox dirs behind (§8.V4 — dispose in a finally/afterEach):"
  printf '%s\n' "$NODE_LEAKS" | sed 's/^/      /'
  FAIL=$((FAIL + 1))
else
  echo "-- node suites left 0 sandbox dirs behind"
fi
[[ -n "$NODE_TMP" ]] && rm -rf "$NODE_TMP"

echo "== Integration tests =="
for t in "$HERE"/integration/*.test.sh; do
  [[ -f "$t" ]] || continue
  INTEGRATION_SUITES=$((INTEGRATION_SUITES + 1))
  echo "-- $(basename "$t")"
  run_suite "$t" 300 || FAIL=$((FAIL + 1))
done

# Shellcheck, locally (v0.62.1). CI has gated this at warning+ since the 2026-07-24
# audit, but the local suite did not — so v0.62.0 shipped a tag whose CI went red on
# SC2034 that `npm test` had no way to surface. The pre-ship runbook's "npm test
# green locally" step can only mean something if it runs what CI runs.
#
# Scope is every TRACKED .sh, a superset of ci.yml's explicit list, deliberately:
# a hand-copied mirror of that list is the drift shape this release exists to fix.
# Superset errs toward failing locally on a file CI ignores — the safe direction.
# bash 3.2 construct gate, same source CI calls (v0.62.2). Local bash is 5.x, so
# a `mapfile` in a test suite runs fine here and dies on the macOS leg — which is
# how v0.62.1 reached a tag. Static scan, no bash 3.2 required to run it.
echo "== bash 3.2 constructs =="
if ! bash "$HERE/lib/bash32-constructs.sh"; then
  echo "FAIL: bash 4+ construct(s) found — these break the macOS /bin/bash 3.2 the hooks run under"
  FAIL=$((FAIL + 1))
fi

# No hand-built /tmp paths in test suites (2026-07-28). mem-audit.test.sh and
# transcript-structure-scan.test.sh captured stderr to `2>/tmp/<name>-$$`, which
# dies with "Read-only file system" wherever /tmp is not writable (agent sandbox,
# hardened CI image) — and it fails as 15 assertions reporting EMPTY stderr, i.e.
# it looks exactly like a hook regression. Every suite already mktemp's a sandbox
# for $HOME; writes belong there. Comment lines are stripped first so prose about
# /tmp (and the corpus's `rm -rf /tmp/foo` FP rows, which are .tsv anyway) is not
# a finding. Controls when this was added: 15 hits on the two pre-fix files, 0 on
# the fixed tree.
echo "== Test-suite /tmp writes =="
TEST_SH=$(git -C "$GUARD_REPO" ls-files 'tests/*.sh' 2>/dev/null)
TEST_SH_COUNT=$(printf '%s\n' "$TEST_SH" | grep -c . || true)
if (( TEST_SH_COUNT < 20 )); then
  # Same degrade shape as the Shellcheck section below, deliberately. The
  # surviving reason is `git archive` / a source export with no git index, where
  # this static check cannot run at all; `npm test` from an extracted npm package
  # is NOT one of them — .npmignore whitelists 7 files and tests/ is not among
  # them, so the suite is not there to run (audit-2026-08-22 条目 22 — the
  # comment claimed the opposite for as long as the branch existed).
  # Loud SKIP there, hard FAIL under CI where a missing index IS the defect.
  echo "SKIP: only $TEST_SH_COUNT tracked test .sh file(s) resolved (floor 20) — not a git checkout?"
  [[ -n "${CI:-}" ]] && { echo "FAIL: that SKIP is not acceptable under CI"; FAIL=$((FAIL + 1)); }
else
  TMP_WRITES=$(cd "$GUARD_REPO" && printf '%s\n' "$TEST_SH" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    sed -E 's/^[[:space:]]*#.*$//' "$f" \
      | grep -nE '(>>?|2>|&>)[[:space:]]*/tmp/|(mkdir|touch|cp|mv)[[:space:]]+[^|]*[[:space:]]/tmp/' \
      | sed "s|^|$f:|"
  done)
  if [[ -n "$TMP_WRITES" ]]; then
    echo "FAIL: test suite(s) write to a hand-built /tmp path — use the suite's mktemp sandbox:"
    printf '%s\n' "$TMP_WRITES" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  else
    echo "-- $TEST_SH_COUNT test suite(s) keep their writes inside mktemp sandboxes"
  fi
fi

# Fail-open mktemp (2026-08-16 pre-tag review). `X=$(cd "$(mktemp -d)" && pwd -P)`
# reads as "make a sandbox and resolve its physical path", but on mktemp failure
# the inner substitution is empty, `cd ""` is a bash no-op returning 0, and
# `pwd -P` prints the CURRENT directory — so X becomes the repo root and the
# suite's own `rm -rf "$X"` / EXIT trap deletes the working tree. A `[[ -n "$X" ]]`
# guard is inert against it (non-empty, just wrong). Five tracked files carried
# the shape; the correct form is two statements with an explicit `|| exit`.
# Class gate rather than five fixed call sites, because the one-liner is the
# obvious thing to type the next time someone needs a physical-path sandbox.
# Matches the unquoted `cd $(mktemp -d)` and `pushd` spellings too: the first
# draft required the double-quoted `cd "$(mktemp` form exactly, so two of the
# three ways to type the same fail-open walked past a gate named for the class
# (audit-2026-08-22 条目 24).
echo "== Fail-open mktemp =="
MKTEMP_SH=$(git -C "$GUARD_REPO" ls-files '*.sh' 2>/dev/null)
if [[ -z "$MKTEMP_SH" ]]; then
  echo "SKIP: no tracked .sh files resolved (not a git checkout?)"
  [[ -n "${CI:-}" ]] && { echo "FAIL: that SKIP is not acceptable under CI"; FAIL=$((FAIL + 1)); }
else
  FAILOPEN=$(cd "$GUARD_REPO" && printf '%s\n' "$MKTEMP_SH" | while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    sed -E 's/^[[:space:]]*#.*$//' "$f" | grep -nE '(cd|pushd)[[:space:]]+"?\$\(mktemp' | sed "s|^|$f:|"
  done)
  if [[ -n "$FAILOPEN" ]]; then
    echo "FAIL: fail-open mktemp — \`cd \"\$(mktemp -d)\"\` yields the CWD when mktemp fails."
    echo "      Use two statements: X=\$(mktemp -d) || exit 1; X=\$(cd \"\$X\" && pwd -P) || exit 1"
    printf '%s\n' "$FAILOPEN" | sed 's/^/      /'
    FAIL=$((FAIL + 1))
  else
    echo "-- $(printf '%s\n' "$MKTEMP_SH" | wc -l | tr -d ' ') shell file(s) free of fail-open mktemp"
  fi
fi

echo "== Shellcheck =="
if command -v shellcheck >/dev/null 2>&1; then
  SHELL_FILES=$(git -C "$GUARD_REPO" ls-files '*.sh' 2>/dev/null)
  if [[ -z "$SHELL_FILES" ]]; then
    echo "SKIP: no tracked .sh files resolved (not a git checkout?)"
    [[ -n "${CI:-}" ]] && { echo "FAIL: that SKIP is not acceptable under CI"; FAIL=$((FAIL + 1)); }
  else
    # shellcheck disable=SC2086  # word splitting is the point: one arg per file
    if (cd "$GUARD_REPO" && shellcheck --severity=warning $SHELL_FILES); then
      echo "-- shellcheck: $(printf '%s\n' "$SHELL_FILES" | wc -l | tr -d ' ') file(s) clean at warning+"
    else
      echo "FAIL: shellcheck reported warning+ findings, or could not be run over them"
      FAIL=$((FAIL + 1))
    fi
  fi
else
  # A skip that stays green under CI would rebuild the exact hole this section
  # closes: npm-publish.yml installs shellcheck and then runs this suite, so if
  # that install is ever dropped the publish gate silently stops checking.
  echo "SKIP: shellcheck not installed — install it to see this class before pushing"
  [[ -n "${CI:-}" ]] && { echo "FAIL: shellcheck must be installed in CI"; FAIL=$((FAIL + 1)); }
fi

if (( HOOK_SUITES < HOOK_SUITE_FLOOR )); then
  echo "FAIL: only $HOOK_SUITES shell hook suite(s) ran (floor $HOOK_SUITE_FLOOR) — the glob matched nothing or the layer moved."
  FAIL=$((FAIL + 1))
fi
if (( INTEGRATION_SUITES < INTEGRATION_SUITE_FLOOR )); then
  echo "FAIL: only $INTEGRATION_SUITES integration suite(s) ran (floor $INTEGRATION_SUITE_FLOOR) — the glob matched nothing or the layer moved."
  FAIL=$((FAIL + 1))
fi

COMMITS_AFTER=$(git -C "$GUARD_REPO" rev-list --count HEAD 2>/dev/null || echo skip)
if [[ "$COMMITS_BEFORE" != "skip" && "$COMMITS_BEFORE" != "$COMMITS_AFTER" ]]; then
  echo "FAIL: the suite committed into the real repo ($COMMITS_BEFORE -> $COMMITS_AFTER)."
  echo "      A test or script wrote commits outside its sandbox — find it with:"
  echo "      git -C \"$GUARD_REPO\" log --oneline HEAD~$((COMMITS_AFTER - COMMITS_BEFORE))..HEAD"
  FAIL=$((FAIL + 1))
fi
PORCELAIN_AFTER=$(git -C "$GUARD_REPO" status --porcelain 2>/dev/null || echo skip)
if [[ "$PORCELAIN_BEFORE" != "skip" && "$PORCELAIN_BEFORE" != "$PORCELAIN_AFTER" ]]; then
  echo "FAIL: the suite changed the real working tree (uncommitted writes)."
  echo "      Diff of \`git status --porcelain\` before -> after:"
  diff <(printf '%s\n' "$PORCELAIN_BEFORE") <(printf '%s\n' "$PORCELAIN_AFTER") | sed 's/^/      /'
  FAIL=$((FAIL + 1))
fi

if (( FAIL > 0 )); then
  echo "OVERALL: $FAIL suite(s) failed"
  exit 1
fi
echo "OVERALL: all suites passed"
