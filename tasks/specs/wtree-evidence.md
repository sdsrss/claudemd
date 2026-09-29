---
status: implemented
revision: 1
---

# "Verified" bound to the working-tree content fingerprint — log only (R3)

Source: docs/oss-benchmark-2026-09-28.md §4 R3 (local-only benchmark doc), after gstack's `gstack-wtree` / `gstack-evidence` (MIT). Authorized as L3 by the user on 2026-09-29, behind a new opt-in switch, logging only.

## goal

Record enough to answer, offline: was the content a completion claim was made on ever verified by a passing run? — independently of which channel edited the files, and without parsing shell.

## non-goals

- No verdict changes anywhere. evidence-gate keeps its transcript-based verdict; this collects the second opinion beside it.
- No delivery to the model (that is R5; a fingerprint verdict may feed it only after it beats the current verdict on labeled data).
- No ship-bookkeeping exemption (gstack's `--allow-paths`) yet: it matters only once a verdict depends on the fingerprint.

## constraints

1. Fingerprint = `git write-tree` of the whole working tree staged into a TEMP index seeded from a copy of the real one (`hooks/lib/wtree.sh`, ported from gstack with its MIT notice). The real index is never touched.
2. Recording points: a passing verification command (`verify-log.sh`, PostToolUse(Bash) — PostToolUse fires only on success) using evidence-gate's own T1/T2 patterns, moved unchanged into `hooks/lib/verify-cmd.sh`; and each completion claim (`evidence-gate.sh`, rows `claim-wtree` with its verdict, silent verdicts included).
3. Opt-in `EVIDENCE_WTREE=1` (the claim side also needs `EVIDENCE_GATE=1`). Kill switch `DISABLE_VERIFY_LOG_HOOK=1`.
4. Bounded at 2 s per fingerprint (`platform_timeout`); failure or a non-repo means no row, never a delay beyond that.
5. Disclosed side effect: untracked, non-ignored file contents enter `.git/objects` as unreachable objects until `git gc`.

## success-criteria

1. `tests/hooks/verify-log.test.sh`: fingerprint equals `HEAD^{tree}` on a clean tree; ignored files do not move it; an untracked file and a heredoc rewrite do, and restoring the file restores it; the real index is byte-identical after a call (a mutation that stages into the real index turns this red); no temp index is left; non-repo and no-commit repos give no fingerprint; verify-log logs T1 / T2 / T2-output with the right tree and ignores `ls`, non-repos and the kill switch; evidence-gate logs `claim-wtree` only with the switch.
2. `scripts/offline-eval/wtree-verdicts.mjs` cross-tabulates the two verdicts (`tests/scripts/wtree-verdicts.test.js`).
3. Measured timing: 27 ms for one fingerprint on this repo (clean, 490 tracked files) on 2026-09-29; the benchmark measured 18–45 ms here and 27–224 ms on 229–3,594-file repos.
4. Pre-registered for the comparison (from the benchmark doc): on the R4(a) hand-labeled turns, compare the precision and recall of the two verdicts; the fingerprint verdict goes to R5 delivery only at precision ≥ 0.8. Hook p99 < 500 ms. Not measured yet: needs log rows from real sessions with the switch on.

## open-questions

1. Cross-session credit: a run in another session on the identical content is reported separately (`wtree-verified-other-session`); whether it should count is for the comparison to show.
2. Monorepos: the fingerprint is of the repo containing the event's `cwd`, not of the package a command `cd`s into.

# Change log

- r1 (2026-09-29): implemented as above.
