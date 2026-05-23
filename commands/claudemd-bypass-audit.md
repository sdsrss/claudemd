---
name: claudemd-bypass-audit
description: R3 Step 2 — lesson-bypass detector. Joins memory-prompt-hint `suggest` events with subsequent transcript activity to compute cite-recall (applied / (applied + bypassed)) across recent sessions. Makes the §11 MEMORY.md read-the-file effectiveness observable.
---

Default window is 30 days. The script answers one question: when claudemd's `memory-prompt-hint` hook surfaced a relevant memory to the agent, did the agent actually read or cite it?

**$ARGS parsing**: same shape as `/claudemd-rules` — split `$ARGS` into a numeric day-count and an optional `--verbose` agent-presentation flag (NOT a script flag — the script ignores it):

| `$ARGS` value | `CLAUDEMD_BYPASS_DAYS` env | Agent output |
|---|---|---|
| (empty) | unset (script uses default 30) | summary only |
| `7` | `7` | summary only |
| `--verbose` | unset | summary + full `perMemory` + `perSession` |
| `90 --verbose` | `90` | summary + full per-memory and per-session breakdown |

Run: `CLAUDEMD_BYPASS_DAYS=<numeric-from-$ARGS-or-30> node ${CLAUDE_PLUGIN_ROOT}/scripts/lesson-bypass-audit.js --json`

(`--cwd` defaults to the current working directory, which is what you want when auditing the project the agent is running in.)

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

Format: lead with `citeRecall`, `bypassRate`, and the top-5 bypassed memories. Suppress full `perMemory` / `perSession` arrays unless `$ARGS` contained `--verbose`.

**Reading the signal**:
- `citeRecall ≥ 60%` over 30d with ≥20 measurable events = R3 Step 2 working as designed; cite-#NN contract loop is observable.
- `citeRecall < 30%` consistently = either (a) suggestions are too noisy (FP rate high — investigate top suggested files for over-trigger patterns) or (b) agent is genuinely bypassing relevant memories (real cite-recall problem).
- `totalMissingTranscript` ≈ `totalSuggestions` = the `--cwd` doesn't match any sessions in `~/.claude/projects/<encoded>/`. Re-run with explicit `--cwd=` to the project where suggestions fired.
- Newly added memories may show 100% bypass for their first few suggest events while the agent hasn't yet learned to look at them — that's a Bayesian prior issue, not a measurement bug. Per §13.3 promotion criteria, fold into the existing 30d-default-OFF FP-collection window before treating as load-bearing.
