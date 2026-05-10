# Rule-detector design decisions — P2 #1 (b) outcome

Date: 2026-05-11
Context: P2 phase plan #1 (b) — extend transcript-scan detector coverage to 4 self-enforced rules. After v0.15.0 shipped `mid-spine-yield-scan` (1 of 5) as the highest-confidence pilot, the 4 remaining candidates were triaged into 2 ship-later + 2 drop-permanent.

## Decisions

| Rule ID | Decision | Detector signal | Reasoning |
|---|---|---|---|
| `§iron-law-1` | **Ship deferred** — v0.17.0 (≥14 days post v0.15.0, after FP data lands) | `fixed/修复` token + Edit + same/prior turn lacks `failed/pre-fix/error/expected.*got` anchor | FP medium-controllable; reuses `transcript-structure-scan` fingerprint pattern; ~100 LOC. Estimated ship date: ≥2026-05-25. |
| `§11-session-exit` | **Ship deferred** — v0.18.0 (after iron-law-1 FP baseline) | last assistant turn Done segment lacks evidence fingerprint at SessionEnd | Extends existing `hooks/session-end-check.sh`, NOT a new hook. ~30 LOC + 6-8 test cases. |
| `§9-parallel-path` | **DROP permanent** — no hook | (proposed) Edit content with ≥2 of `fallback / else / default / match / early return` keywords | FP would approach 90%. Most non-trivial functions contain `else` branches. Text-based scan cannot distinguish "well-verified sibling path" from "silently missed sibling path" — requires AST + dataflow. Rule stays self-enforced; relies on `/claudemd-rules` 30d-0-hits natural demotion under §13.1 if it's truly unenforceable. |
| `§12-author-not-reviewer` | **DROP permanent** — no hook | (proposed) agent claims "reviewed / verified / checked" without Task subagent dispatch in same turn | FP "I checked / 看了一下 / verified / appears correct" is daily-prose vocabulary, structurally indistinguishable from formal `sp:requesting-code-review` invocation. AI self-attribution of review is textually flat — no syntactic anchor a regex can grab. Rule stays self-enforced. |

## Why this is §13.2 budget reverse-validation

§13.2 (HARD-rule budget) gates rule **additions**, but doesn't say every HARD rule must have a hook. The instinct is "every HARD rule deserves observability — write the detector." Both dropped rules fail that instinct at the design stage:

- `§9-parallel-path` and `§12-author-not-reviewer` are HARD rules that hooks **cannot reliably detect via transcript text-scanning**. Shipping a 90%-FP detector would actively erode trust in the other detectors' signal — operators stop reading rule-hits when the boy-cried-wolf rate exceeds ~20%.
- The correct fallback is **rule preservation without hook observation**: rule stays in spec, agent self-enforces, `/claudemd-rules` 30-day-0-hits surfaces "this rule may be unenforceable" → manual review → demote-or-keep decision. The 0-hits state for an unmonitored rule is a flat null, not a false signal.

This is the reverse-validation of §13.2: not all HARD rules deserve hooks. The hooks budget (call it §13.3 implicitly) should ratchet similarly to the rule budget — refuse low-quality-signal detectors at design time.

## Outcome

- Hook detectors landed or queued: 1 (mid-spine-yield-scan, v0.15.0) + 2 (iron-law-1 v0.17.0 / session-exit v0.18.0, deferred ≥14 days).
- Hook detectors dropped: 2 (parallel-path / author-not-reviewer).
- Original P2 #1 (b) plan: ship 5. Actual outcome: ship 3 + drop 2 with documented reason.

## Follow-up triggers (future review)

- If `/claudemd-rules` reports either §9-parallel-path or §12-author-not-reviewer at 0 hits for 90 consecutive days, the §13.1 demote-review SHOULD fire — but the demote is independent of detector existence. Demote because the rule isn't fired by humans, not because the hook didn't detect it.
- If an AST-based static-analysis tool gets integrated (`code-graph-mcp` already provides AST; could feed a `§9-parallel-path` detector), revisit §9 detector feasibility. Outside this P2 phase plan's scope.
- `§12-author-not-reviewer` has no path to text-only detection that I can see. If detection becomes desirable, the route is structural (require explicit `Task` tool call for `review` claims) rather than vocabulary-based — a CLAUDE.md `feedback_*.md` user-guidance update, not a hook.
