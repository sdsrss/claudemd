---
name: claudemd-sampling-audit
description: Retrospective batch scan of historical transcripts for 8 self-enforced HARD rules — text detectors (§10-V banned vocab / §iron-law-2 / §10-four-section-order / §10-honesty) + sequence/claim detectors (§11-turn-yield / §7-bugfix-anchor / §11-post-compaction / §5-hard-auth). Every rule reports violations with its opportunity denominator; rates feed §13.2 staleReviews and the /claudemd-audit selfCompliance section once calibrated.
---

Default window is 30 days, current project only. If the user passes a number (e.g. `/claudemd-sampling-audit 60`), set `CLAUDEMD_SAMPLING_DAYS=$ARGS` before invocation.

Run: `CLAUDEMD_SAMPLING_DAYS=${ARGS:-30} node ${CLAUDE_PLUGIN_ROOT}/scripts/sampling-audit.js`

Flags (append after the number when needed):

| Flag | Effect |
|---|---|
| `--days=N` | Window in days (positive integer, default 30; overrides env). |
| `--sample=N` | Random subset of N transcripts within the window (per project dir). |
| `--global` | Scan all CC project dirs (`~/.claude/projects/*`) — not just cwd; adds `byClass` self-repo vs external stratification. |
| `--json` | Emit machine-readable JSON to stdout instead of a markdown report. |

The JSON / markdown contains:

| Field | Meaning |
|---|---|
| `windowDays` | Window in days actually used. |
| `metricContract` | The A2 pre-registered constraint: compliance = 1 − violations/opportunities; a rate without its denominator is not evidence. |
| `scannedTranscripts` | Transcripts within the window that contained ≥1 assistant text turn. |
| `totalTurns` | Total assistant text turns scanned (sum across transcripts). |
| `byRule[<§rule>].violations` | Per-rule violation count (for §10-V: turns with ≥1 match; `hits` keeps the raw per-pattern match count). |
| `byRule[<§rule>].opportunities` | Denominator: detected trigger contexts for that rule (Done lines examined / substantive Uncertain lines / typed-after-tool-turn messages / compaction events / hard-class ops / …). |
| `byRule[<§rule>].precision` / `.status` | A4 calibration state. `precision` stays null until ~50 flagged + ~50 unflagged samples are hand-labeled; `status` is `collecting` until precision ≥ 0.8, then `calibrated`. Uncalibrated ratios are collection data, NOT compliance evidence. |
| `byRule[<§rule>].transcriptsAffected` | Distinct transcripts with ≥1 violation for that rule. |
| `byClass` | `--global` only: `{self, external, unknown}` split of violations/opportunities per rule (self = project dir ends in `-claudemd`). Self-repo dogfood and external signal must never be pooled. |
| `perTranscript` | Array of `{file, hits: [{rule, turn?, ...}]}` — limited to transcripts with ≥1 violation. |

Default output (no `--json`): writes `tasks/sampling-audit-<YYYY-MM-DD>.md` in the current project and prints a one-line-per-rule `violations/opportunities` summary to stdout. **Warning**: re-running on the same day overwrites that file — if today's report carries hand-written analysis, use `--json` instead.

Sequence-detector notes (mechanical heuristics, calibrate before trusting):
- `§11-turn-yield`: violation = typed user message that is a bare continuation nudge (`继续` / `next` / `怎么停了` / `why did you stop`) following a tool-active turn — the spec's own confirmed-yield tell. Whole-message match; partial-recall by design.
- `§7-bugfix-anchor`: violation = `Done: fixed …` line without a prior-failing token (error name / FAILED / crash / pre-fix / repro) in the same line.
- `§11-post-compaction`: violation = compaction event with no plan/spec re-read (CLAUDE*.md / OPERATOR.md / tasks/*.md / *plan*.md in any tool input) within the next 10 main-line assistant events.
- `§5-hard-auth`: violation = hard-class op (settings.json/.env/migrations write, prod `npm install <pkg>`, `git push --force`, `DROP TABLE`) with no `[AUTH REQUIRED` marker in the previous 10 assistant texts. Known FP-heavy under bypassPermissions — advisory collection only.
- Subagent sidechains (`isSidechain:true`) are excluded from sequence detectors.

Companion to `/claudemd-rules` — that command reads the rule-hits log (write-time, current session); this command scans the raw transcripts (retrospective, historical window). Together they cover both observation surfaces for the 8 self-enforced rules. `/claudemd-audit` embeds the same scan as its `selfCompliance` section.
