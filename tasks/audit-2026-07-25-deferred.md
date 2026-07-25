# 2026-07-25 audit — deferred / operator-decision items

Source: `docs/comprehensive-audit-2026-07-25-v0.55.0.md`. The fix batch (same day) closed
F1 curl-sh canon (F19), rm-rf-var scratch friction (F20), audit.js selfCompliance wiring,
YIELD_ASK_RE 么 over-match, §10-V fence parity, telemetry hook_version, spec v6.22.0
level/precedence seam + 2 join tests, shellcheck full-scope + env-prefix bug, docs sync.
Below is what was deliberately NOT done — each needs an operator decision or belongs to
a batch review, not a fix pass.

## Attempted and REVERTED same day — do not re-attempt from text scanning

**§8-rm-rf-var temp-root literal provenance (F20)**: built to close the 86%-of-denies
scratch-cleanup friction (`D=/tmp/job.1; rm -rf "$D"`), then reverted after adversarial
review broke it four ways in one pass, three sandbox-confirmed deleting real directories:
backslash-escaped traversal (`D=/tmp/\.\./\.\./etc` — hook text ≠ runtime value),
subshell/short-circuit/pipeline assignments that never bind the parent shell yet land at a
"segment head", `..` residue appended to a validated var, and `IFS` both word-splitting an
unquoted target and truncating the captured RHS to a prefix. Root cause is the one
`tasks/specs/s8-literal-provenance.md` already records: **text position is not command
position, and a captured RHS that merely PREFIXES the runtime value proves nothing**. The
class needs a real parser; §8 is a guardrail, not a parser. All 28 break commands are
pinned as `deny` corpus rows (F21) so a re-attempt cannot pass silently.

What DID ship from that attempt (deny-direction or independent): quoted `bak="$(mktemp …)"`
RHS recognition, full-args-tail scan (`rm -rf "$S" "$EVIL"` now denies), `..`-residue check,
`IFS=`-withdraws-provenance, `+=` treated as assignment in canon.

**The DX friction itself remains open**: 86% of §8-rm-rf-var denies are the agent cleaning
its own scratch dirs (14d: 177/205, all scratch var names, zero real project paths), and
§8.V4 mandates that cleanup. Supported answers today are `S=$(mktemp -d)` provenance,
`${VAR:?}`, or `[allow-rm-rf-var]`. If revisited, the only safe direction is making the
harness emit mktemp-shaped scratch paths, NOT loosening the gate.

## Operator decisions (data in hand)

- **banned-vocab-check hook 去留** — worst cost/benefit component (79ms git-commit path =
  48% of chain; 14d: 7 deny / 10 bypass = 59% bypassed; extended long table earned 0
  incremental hits). Evaluation record: `tasks/banned-vocab-demote-evaluation-2026-07-25.md`.
  Scheduled for next §13.2 batch review — decide there, not in a patch.
- **MEMORY.md index cap** — 12.3KB always-injected (~3.5k tok/session, 31% of injected
  budget) duplicating routing `memory-prompt-hint.sh` already does at 459B-on-match.
  OPERATOR.md §13.1 has the 12KB SHOULD; enforcement/prune is §5-scoped operator edit.
- **doctor demote-criterion cleanup** (loop-F3/F4) — doctor's `ratio 52% → §0.1 demotion
  candidate` line uses a rule the spec doesn't have (bypass-rate is a §13.3 PROMOTION
  gate); hard-rules-audit `§8-curl-sh` demote candidate is the safety-class-sparse FP the
  07-25 evaluation said to exempt. Both re-fire every review until a safety-class
  annotation lands in the two scripts. Small code change, but it encodes a governance
  rule — pair it with the §13.2 batch review that decides the rule's wording.

## Deferred code items (no decision blocker, just not this batch)

- **mid-spine-yield-scan.sh precondition sync** (delta-MEDIUM): shipped bash hook (default
  OFF, not enabled here) lacks the v6.21.1/v6.22.0 asked-precondition and quotes pre-v6.21.1
  rule text at :138; no JS↔bash parity test. If ever default-ON, sync + parity test first
  (model: banned-vocab-engine-parity).
- **sampling-audit.js tasks/ overwrite guard** (loop-F7 / O-1): a plain run replaces the
  committed `tasks/sampling-audit-<date>.md`; UTC date names a day ahead in the evening.
  Guard: refuse overwrite when the target differs from own output shape, or --force flag.
- **version-sync.sh $PPID debounce** (dx-F7): once-per-session sentinel fails when
  CLAUDE_SESSION_ID unset (240/245 stale-root rows session_id=null, ~13% of all telemetry
  events). Impact bounded (0-byte stdout); fix = sentinel keyed on $PPID fallback actually
  writing/reading the same key.
- **M4 vocab-reference join**: `reference_banned_vocab_examples.md` (new prose home of the
  §10-V enumeration) lives outside the repo — no CI join possible. Either declare it
  ungated free text (status quo, now explicit) or mirror a copy under spec/ for the drift
  test to join against.
- **slash-command usage telemetry** (dx-F8): 16 commands, zero instrumentation — the
  "measure before demoting" thesis can't evaluate its own operator surface. One
  hook_record in the command wrapper would close it; batch with the next telemetry change.
- **L8 command descriptions** scenario-driven rewrite (14/16 capability-style) — polish,
  operator taste; **L9 §13.2/§13.3 relocation** to OPERATOR.md (~3KB extended, agent-facing
  "log to tasks/" clause must stay) — do together with a future extended net-delete need.

## Known residuals accepted (documented in code, do not re-open without new evidence)

- §8: `"bash" -c '…'` quoted-runner+indirect combo; `xargs bash`; `env -i bash` flag-wrapper
  in curl-sh sink; `sudo -u svc curl` option-with-arg wrappers; mid-segment `&` wrapper;
  quoted literal RHS with spaces (sanitize-blanked → deny direction); trap-DEBUG /
  indirect-name rebinds vs provenance (same bar as mktemp class); non-BMP cwd encoding.
- §10-V 中文 path FP class (ASCII-only strip): `docs/显著提升-report.md` fires both
  engines — engines AGREE (not a seam); fix only with a 中文-aware path strip on BOTH.
- perf-baseline hermetic test reads the live log line-count (L5) — flaky only under a
  concurrent writing session; accept until it actually flakes in CI (it runs sandboxed HOME
  there).
