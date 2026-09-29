# shellcheck shell=bash
# verify-cmd.sh — what counts as verification output, in one place: read by
# evidence-gate.sh (Stop, the verdict) and verify-log.sh (PostToolUse, the R3
# fingerprint log), so the two apply the same patterns. They feed them
# different text: evidence-gate reads a truncated command and the joined
# tool_result, verify-log the full command and tool_response, so a very long
# command or a runner that prints only to stderr can still read differently.
# The T1/T2 patterns moved here unchanged from evidence-gate.sh
# (tasks/specs/wtree-evidence.md); FAIL_OUT_RE is verify-log's alone.
# shellcheck disable=SC2034  # read by the sourcing hook

# A smoke entry point, per the G1a anchor. Recognised from the COMMAND rather
# than the output: `npm run smoke` prints whatever the project's suites print,
# and there is no output shape common to every project's smoke entry.
T1_CMD_RE='(^|[;&|[:space:]])((npm|pnpm|yarn|bun)[[:space:]]+run[[:space:]]+smoke|make[[:space:]]+smoke|\.?/?scripts?/smoke)([[:space:]]|$)'
# T2 has two halves, and the split is the whole point. The runner's NAME lives
# in the command; its VERDICT lives in the output. The first draft matched names
# against the output, where they do not appear, so every silent-success verifier
# read as no-evidence — `tsc --noEmit` and `eslint .` print nothing at all when
# clean, and §7's L1 row is literally "lint + typecheck". The hook fired on
# exactly the evidence the spec asks for. Found in pre-ship review.
T2_CMD_RE='(^|[;&|[:space:]])((cargo|go|npm|pnpm|yarn|bun|deno)[[:space:]]+(test|check)|(npm|pnpm|yarn|bun)[[:space:]]+run[[:space:]]+(test|check|lint|typecheck|types|build|verify)|(npx[[:space:]]+)?(tsc|eslint|prettier|jest|vitest|mocha|ava|biome|ruff|mypy|shellcheck)|pytest|python[[:space:]]+-m[[:space:]]+(pytest|unittest)|node[[:space:]]+--test|cargo[[:space:]]+clippy|make[[:space:]]+(test|check|lint)|ctest|gradle[[:space:]]+test|mvn[[:space:]]+test|dotnet[[:space:]]+test|rspec|bundle[[:space:]]+exec[[:space:]]+rspec)([[:space:]]|$)'
# Output verdicts, for runners the command pattern does not name: a
# digit-plus-verdict, a label-colon, a tick/cross, a TAP `ok N`, or go test's
# `ok <pkg> <time>`. Plain prose containing the word "failed" does not match —
# a loose pattern here buys silence, and silence is this hook saying "evidence
# exists".
T2_OUT_RE='[0-9]+[[:space:]]+(passed|failed|pass|fail|tests?|assertions?|suites?)|(^|[^A-Za-z])(tests?|test result|overall|smoke|suites?|pass|fail)[[:space:]]*[:：]|✓|✗|(^|[^A-Za-z])ok[[:space:]]+[0-9]+|(^|[^A-Za-z])ok[[:space:]]+[^[:space:]]+[[:space:]]+[0-9.]+m?s|no[[:space:]]+issues[[:space:]]+found|All[[:space:]]+matched[[:space:]]+files'

# Output that reports failures, for verify-log only (evidence-gate's verdict
# does not read it). A runner piped into `tail` exits with tail's status, so a
# failed suite still arrives as a PostToolUse success. The pre-tag review found
# 1,974 of the 7,080 exit-0 T1/T2 runs in the maintainer's transcripts printing
# failures, 1,908 of them piped into tail/head/grep/tee (0.105.0 review M1).
# A count of 1+ failed/failing/failures/errors, node's `fail N`, eslint's
# `✖ N`, TAP `not ok N`, a `FAIL` word, cargo's `FAILED`, tsc's `error TSnnnn`.
# A zero count does not match the count branches, but the `FAIL` word branch
# ignores what follows it. Passing runs it drops, the direction that
# under-counts verification: `FAIL: 0`, a label such as `_FAIL_BANNER`, a test
# name with `failed` in it, eslint's `✖ 3 problems (0 errors, 3 warnings)`,
# a TAP `not ok N … # TODO`. Counted again 2026-09-29, apart from the 7,080
# above, over top-level and subagent transcripts: of 14,052 exit-0
# T1/T2 runs it drops 3,765, of which 3,176 print a nonzero failure count.
# Of the rest, a hand-built classifier reads 58 to 95 as passing runs (a
# pass summary such as `ℹ fail 0` or "all suites passed" and no failing
# one), 0.5-0.9% of the 10,876 runs with no nonzero failure summary: an
# estimate that moves with the classifier, not a bound. eslint warnings-only
# is at most 11. Narrowing a branch would buy that back
# by logging failed runs as verification, the error R3 cannot absorb, so the
# pattern stays as it is.
FAIL_OUT_RE='(^|[^0-9])[1-9][0-9]*[[:space:]]+(failed|failing|failures?|errors?)([^A-Za-z]|$)|(^|[^A-Za-z])fail[[:space:]]+[1-9]|✖[[:space:]]*[1-9]|(^|[[:space:]])not ok[[:space:]]+[0-9]|(^|[^A-Za-z])FAIL([^A-Za-z]|$)|FAILED|error TS[0-9]+'
