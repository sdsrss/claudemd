---
name: claudemd-sampling-audit
description: Retrospective batch scan of historical transcripts for 4 self-enforced HARD rules (§10-V banned vocab / §iron-law-2 / §10-four-section-order / §10-honesty). Mirrors hooks/transcript-{vocab,structure}-scan.sh but iterates all assistant turns across the last N days of transcripts, surfacing aggregate violation rates that feed §13.2 staleReviews demote-review.
---

Default window is 30 days, current project only. If the user passes a number (e.g. `/claudemd-sampling-audit 60`), set `CLAUDEMD_SAMPLING_DAYS=$ARGS` before invocation.

Run: `CLAUDEMD_SAMPLING_DAYS=${ARGS:-30} node ${CLAUDE_PLUGIN_ROOT}/scripts/sampling-audit.js`

Flags (append after the number when needed):

| Flag | Effect |
|---|---|
| `--days=N` | Window in days (positive integer, default 30; overrides env). |
| `--sample=N` | Random subset of N transcripts within the window. |
| `--global` | Scan all CC project dirs (`~/.claude/projects/*`) — not just cwd. |
| `--json` | Emit machine-readable JSON to stdout instead of a markdown report. |

The JSON / markdown contains:

| Field | Meaning |
|---|---|
| `windowDays` | Window in days actually used. |
| `scannedTranscripts` | Transcripts within the window that contained ≥1 assistant text turn. |
| `totalTurns` | Total assistant text turns scanned (sum across transcripts). |
| `byRule[<§rule>].hits` | Total per-rule violations aggregated across all turns. |
| `byRule[<§rule>].transcriptsAffected` | Distinct transcripts with ≥1 hit for that rule. |
| `perTranscript` | Array of `{file, hits: [{rule, turn, ...}]}` — limited to transcripts with ≥1 hit. |

Default output (no `--json`): writes `tasks/sampling-audit-<YYYY-MM-DD>.md` in the current project and prints a one-line-per-rule summary to stdout.

Companion to `/claudemd-rules` — that command reads the rule-hits log (write-time, current session); this command scans the raw transcripts (retrospective, historical window). Together they cover both observation surfaces for the 4 self-enforced rules.
