---
status: implemented
revision: 1
---

# debug.md at the moment a test run fails (R6(a))

Source: docs/oss-benchmark-2026-09-28.md §4 R6(a) (local-only benchmark doc). Authorized as L3 by the user on 2026-09-29, on the condition that the reach gap is measured first and the work is dropped if the gap is small.

## goal

When a test run fails, the rule for that moment — the same failure signature three times means stop patching and diagnose (`debug.md`, §6) — is in the model's context, whether or not the user's prompt contained a debugging word.

## non-goals

- No change to `debug.md`'s text, to tier-2 triggers, or to `rework-breaker.sh` (its G2 evaluation window runs to 2026-10-26 and a verdict change there would truncate it; R6(b), the "change topology" wording, waits for that).
- No new HARD rule; nothing blocks.
- Not a claim that the module changes outcomes. This measures and fixes REACH only.

## constraints

1. Event: `PostToolUseFailure`, matcher `Bash`. Probe 2026-09-29 on Claude Code 2.1.284: a Bash call exiting non-zero fires `PostToolUseFailure` and not `PostToolUse`; `error` holds `Exit code N` plus stderr; the model quoted back a token from the hook's `additionalContext`.
2. Opt-in `DEBUG_ON_TEST_FAILURE=1`, default OFF (§EXT §13.3, behaviour layer). Kill switch `DISABLE_TEST_FAILURE_DEBUG_HOOK=1`.
3. Once per session, SHARED with tier 2: the same `modinj-<sid>.list`, in both directions.
4. One wrapper for both injecting hooks: `hooks/lib/spec-module.sh` (body without frontmatter and build comment; the `[claudemd] system-injected` framing with the reason).
5. Test runners only (not lint/typecheck), at command position — the set the reach was measured with.
6. Interrupts (`is_interrupt: true`) are not failures.

## success-criteria

1. Reach measured before building, decision rule pre-registered (`tasks/r6-debug-reach/PREREG.md`, local): 70 sessions since 2026-09-05 with a failed test run; 44 (0.629) had no prompt matching the debug trigger at or before the first failure. Rule was n ≥ 30 and gap ≥ 0.50 → build. Met.
2. `tests/hooks/test-failure-debug.test.sh`: opt-in, injection on the right event, once per session, shared list both ways, runner vs non-runner commands (including `grep pytest src` and `echo "run npm test later"`), interrupts, kill switch, telemetry row, missing module.
3. `npm run check` green; the hook registered in `hooks/hooks.json`, the registry, the toggle list, README, ARCHITECTURE, HOOK-PROTOCOL and RULE-HITS-SCHEMA.

## open-questions

1. Outcome: does the module change what happens after a failure (fewer repeated edits of the same file, earlier root-cause)? Needs an offline-eval fixture where the obvious patch fails repeatedly; shared with R6(b). Not measured.
2. Deliberate RED runs (TDD) count as failures and draw the module once per session. Acceptable at once-per-session; revisit if the module is read as a nag.

# Change log

- r1 (2026-09-29): implemented as above.
