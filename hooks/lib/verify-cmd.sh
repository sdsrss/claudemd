# shellcheck shell=bash
# verify-cmd.sh — what counts as verification output, in one place: read by
# evidence-gate.sh (Stop, the verdict) and verify-log.sh (PostToolUse, the R3
# fingerprint log), so the two cannot disagree about which command verified.
# Moved here unchanged from evidence-gate.sh (tasks/specs/wtree-evidence.md).
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
