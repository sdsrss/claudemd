---
status: implemented
revision: 2
---

# evidence-gate observations delivered with the next prompt (R5 plan B)

Source: docs/oss-benchmark-2026-09-28.md §3.1 and §4 R5 (local-only benchmark doc). Authorized as L3 by the user on 2026-09-29 (plan B only; plan C waits for a verdict that passes the 0.8 precision gate).

## goal

When evidence-gate fires (a completion claim after code edits with no verification output behind it), the MODEL learns it — without interrupting the turn that just ended and without a model turn per false alarm.

## non-goals

- Plan C (Stop `hookSpecificOutput.additionalContext`, which continues the turn: one extra model reply per firing, under the same `stop_hook_active` guard as a block). Not until the verdict's precision reaches 0.8 (R3/R4(a)); today at most 3 of 21 firings were right.
- No change to evidence-gate's verdict, its claim detector, or its opt-in (`EVIDENCE_GATE=1`, default OFF).
- ledger-staleness (G7) is not wired to the new channel yet; its notice text is written for the human.

## constraints

1. Stop writes `~/.claude/.claudemd-state/notice-<sid>.evidence-gate`; a new UserPromptSubmit hook, `deferred-notice.sh`, delivers it as `additionalContext` with the session's next prompt, once (rename-then-read, so concurrent prompts cannot both deliver), capped at 2,000 characters.
2. No delivery for headless runs: the transcript's last `entrypoint` starting `sdk-` means nothing is queued.
3. The text is an observation with an origin marker, not an instruction (`docs/HOOK-PROTOCOL.md`: injected text carries its own framing), and names the user's kill switch.
4. Cost for every user when nothing is queued: one glob, before any library is sourced.
5. A notice nobody collects is reaped by `/claudemd-clean-residue` (`notice` class, plus a `.delivering.<pid>` claim left by a killed deliverer); `/claudemd-uninstall --purge` covers the stem.
6. Telemetry: `evidence-advisory` rows gain `extra.queued`; delivery writes `notice-delivered` with `extra.sources`.
7. Its own opt-in, `EVIDENCE_GATE_DELIVER=1`, on top of `EVIDENCE_GATE=1`. The G1b pre-registration's 2026-09-26 revision (`tasks/g1b-g2-eval/PREREG.md`) holds ANY channel into the model — a UserPromptSubmit injection included — until the verdict reaches 0.8 precision on the same replay; the benchmark doc's "B before the gate" does not override a pre-registered rule for users who opted into the human-only advisory. The switch is what the pre-registered A/B (`tasks/r5-deferred/PREREG.md`) runs.

## success-criteria

1. `tests/hooks/deferred-notice.test.sh` (9 cases): nothing queued → silent; delivered once, to its own session only; kill switch; cap and source-name filter; telemetry; end to end with evidence-gate for an interactive session (queued, delivered on the next prompt), a headless one and one without `EVIDENCE_GATE_DELIVER=1` (nothing queued in either).
2. `tests/hooks/evidence-gate.test.sh` unchanged and green; `npm run check` green.
3. Behaviour (pre-registered in `tasks/r5-deferred/PREREG.md`, local): in a two-turn paired replay, the share of second turns that contain a verification call is higher with the notice than without it, and turns whose work was already verified gain no tool calls. Not run yet.

## open-questions

1. A notice delivered after the user changed the subject reads as noise. The notice carries its timestamp and says to disregard it if the reply was not a completion claim; whether that is enough is what criterion 3 measures.
2. G1b: its first window was voided on 2026-09-26 because the model never received the advisory. A new G1b window with this channel needs the 0.8 gate first (constraint 7); until then the channel exists only for the pre-registered A/B.

# Change log

- r2 (2026-09-29): queueing moved behind `EVIDENCE_GATE_DELIVER=1` (constraint 7). r1 queued whenever `EVIDENCE_GATE=1` was set, which would have opened a model channel for existing opt-in users — this machine included — against the G1b pre-registration. Found re-reading that pre-registration after r1 was committed.
- r1 (2026-09-29): implemented as above. The human-facing stderr line that said "a Stop hook has no channel into the model" is corrected in the same change.
