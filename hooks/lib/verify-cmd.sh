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
# failed suite still arrives as a PostToolUse success: 1,974 of 7,080 such runs
# in the maintainer's transcripts printed failures (0.105.0 pre-tag review M1).
# A count of 1+ failed/failing/failures/errors, node's `fail N`, eslint's
# `✖ N`, TAP `not ok N`, a `FAIL` word, cargo's `FAILED`, tsc's `error TSnnnn`.
# Zero counts do not match. A passing test NAMED "... 3 failed attempts" does,
# and is then not logged: the direction that under-counts verification.
FAIL_OUT_RE='(^|[^0-9])[1-9][0-9]*[[:space:]]+(failed|failing|failures?|errors?)([^A-Za-z]|$)|(^|[^A-Za-z])fail[[:space:]]+[1-9]|✖[[:space:]]*[1-9]|(^|[[:space:]])not ok[[:space:]]+[0-9]|(^|[^A-Za-z])FAIL([^A-Za-z]|$)|FAILED|error TS[0-9]+'
