---
name: claudemd-bypass-audit
description: Measure how often a memory that the prompt hint suggested was then applied or bypassed in recent sessions (cite-recall).
disable-model-invocation: true
---

Default window is 30 days. The script answers one question: when claudemd's `memory-prompt-hint` hook surfaced a relevant memory to the agent, did the agent actually read or cite it?

**Argument parsing** (the arguments are `$ARGUMENTS`): same shape as `/claudemd-rules` — split `$ARGUMENTS` into a numeric day-count and an optional `--verbose` agent-presentation flag (NOT a script flag — the script ignores it):

| Argument value | `CLAUDEMD_BYPASS_DAYS` env | Agent output |
|---|---|---|
| (empty) | unset (script uses default 30) | summary only |
| `7` | `7` | summary only |
| `--verbose` | unset | summary + full `perMemory` + `perSession` |
| `90 --verbose` | `90` | summary + full per-memory and per-session breakdown |

Run: `CLAUDEMD_BYPASS_DAYS=<numeric-from-the-arguments-or-30> node ${CLAUDE_PLUGIN_ROOT}/scripts/lesson-bypass-audit.js --json`

The audit covers every project's suggest rows in the rule-hits log, not only this one: each row is scored against the transcript in the project the row names. `--cwd` (default: the current working directory) is only where a transcript is looked for when that fails or the row names no project, so it does not narrow the numbers to one project.

The JSON contains:

| Field | Meaning |
|---|---|
| `totalSuggestEvents` | distinct UserPromptSubmit events where the hook surfaced ≥1 memory |
| `totalSuggestions` | sum of suggested filenames across all events (one event can surface up to 5) |
| `totalApplied` | suggestions where the filename appeared in the session transcript after the suggest timestamp |
| `totalBypassed` | suggestions where the filename never appeared post-suggest |
| `totalMissingTranscript` | suggestions whose session transcript was absent (deleted / synthetic / cwd mismatch) — separated from applied/bypassed so the operator can size the unmeasurable fraction |
| `citeRecall` | applied / (applied + bypassed); null when no measurable data |
| `bypassRate` | bypassed / (applied + bypassed); the inverse of cite-recall |
| `perMemory` | per-filename `{applied, bypassed, missingTranscript}` |
| `perSession` | per-session-id same shape, plus `transcriptMissing: bool` |

Format: lead with `citeRecall`, `bypassRate`, and the top-5 bypassed memories. Suppress full `perMemory` / `perSession` arrays unless the arguments contained `--verbose`.

**Reading the signal**:
- `citeRecall ≥ 60%` over 30d with ≥20 measurable events = R3 Step 2 working as designed; cite-#NN contract loop is observable.
- `citeRecall < 30%` consistently = either (a) suggestions are too noisy (FP rate high — investigate top suggested files for over-trigger patterns) or (b) agent is genuinely bypassing relevant memories (real cite-recall problem).
- `totalMissingTranscript` ≈ `totalSuggestions` = the transcripts are gone from `~/.claude/projects/<encoded>/` (deleted, or the sessions were synthetic), or the rows name no project and `--cwd` is not the project where they fired. Only that last case is fixed by re-running with `--cwd=<that project>`.
- Newly added memories may show 100% bypass for their first few suggest events while the agent hasn't yet learned to look at them — that's a Bayesian prior issue, not a measurement bug. Per §13.3 promotion criteria, fold into the existing 30d-default-OFF FP-collection window before treating as load-bearing.
