# rule-hits JSONL schema

File: `~/.claude/logs/claudemd.jsonl`
Format: one JSON object per line. Append-only. Size-capped rotation at 5 MB
(see `hooks/lib/rule-hits.sh`).

## Fields

| Field | Type | Description |
|---|---|---|
| `ts` | string (ISO-8601 UTC, Z-suffix) | timestamp of row creation |
| `hook` | string | hook name — see "Events" table for valid emitters |
| `event` | string | event class — see "Events" table |
| `project` | string | project identifier: `$CLAUDE_PROJECT_DIR` (or `$PWD` fallback) with `/` and `.` replaced by `-`. Empty string when neither var is set. Added v0.6.2. |
| `session_id` | string \| null | Claude Code session identifier extracted from stdin EVENT JSON `.session_id`. `null` for rows written before v0.9.33 (added then). All 12 emitter hooks populate it as of v0.9.34. |
| `tool_use_id` | string \| null | Per-invocation tool use ID (format `toolu_[alnum]`) from stdin EVENT JSON `.tool_use_id`. Only PreToolUse / PostToolUse events carry this — Stop / SessionStart / SessionEnd / UserPromptSubmit emit `null` (no per-tool context). Drives audit `unique_invocations` dedup. Key (extended v0.23.21) is `(ts, hook, session_id, tool_use_id, event, extra)`: BYTE-IDENTICAL rows twice ⇒ true single-invocation double-fire (registration / lib bug); different `tool_use_id` at same ts + same session_id ⇒ Claude fast-retry after deny, NOT a duplicate. Multi-emit hooks (`pre-bash-safety` logs one row per matched pattern in a compound command) legitimately repeat the quadruple with differing `extra` — the `event`+`extra` key keeps those distinct; a byte-identical residual can still arise from one command repeating the same pattern, so confirm against the source command before treating a `pre-bash-safety` `_real` as a bug. Added v0.9.34. |
| `spec_section` | string \| null | spec section being enforced — drives §0.1/§13.1/§13.2 promotion/demotion accounting. `null` for plugin-internal events (bootstrap, version-sync, upstream-banner) and for rows written before v0.7.0. See "Spec section taxonomy" below. Added v0.7.0. Audit `bySection` (v0.9.37+) splits null-section rows by cutoverTs: pre-cutover ⇒ `(unset-historical)`, post-cutover ⇒ `(unset-current)`. |
| `extra` | any | hook-specific payload (object / null / string). For `memory-read-check`: `deny` rows carry `{missing: string[], match_count: number}` (`match_count` = total MATCHES in MEMORY.md scan = MISSING.length + already-Read subset; added v0.9.36); `bypass-escape-hatch` rows carry `{token: string}` plus optional `bypass_reason: string` when `[skip-memory-check: <reason>]` form is used (added v0.9.36). |

## Events

The `event` field is one of the following. The contract is locked by
`tests/hooks/contract.test.sh` — every documented (event, emitter) pair
must have a matching `hook_record` call in source, and every emission in
source must appear in this table.

| Event | Emitted by hook | Meaning |
|---|---|---|
| `pass` | `ship-baseline` | rule checked, no action needed |
| `deny` | `banned-vocab`, `ship-baseline`, `memory-read-check`, `pre-bash-safety` | rule denied the tool call |
| `deny-prose` | `banned-vocab` | v0.21.0 Path 2 — ship-flow command (commit/push/pr-create/release-create/publish) blocked because the preceding assistant turn's chat prose contains a high-fire §10-V banned vocab pattern. `extra.matched` lists the prose hits. Sub-feature opt-out: `BANNED_VOCAB_PROSE_SCAN=0`. Section: `§10-V`. Added v0.21.0. |
| `deny-prose-dry-run` | `banned-vocab` | v0.21.1 — Path 2 observability mode. Same trigger as `deny-prose` (ship verb + high-fire prose match), but emitted instead of denying when `CLAUDEMD_PATH2_DRY_RUN=1`. `extra.matched` carries the would-deny hits; the tool call passes through. Grep this row to measure TP vs FP rate before committing to live enforcement. Section: `§10-V`. Added v0.21.1. |
| `bypass-escape-hatch` | `banned-vocab`, `pre-bash-safety`, `memory-read-check` | per-invocation escape token used (records token name in `extra`) |
| `npx-allow-local` | `pre-bash-safety` | fetch-execute runner (`npx` / `bunx` / `npm exec` / `pnpm dlx` / `yarn dlx`) `<pkg>` allowed because pkg resolves from cwd's lockfile or `node_modules/<pkg>/` (spec §8 lockfile/local link). Records `extra.pkg`. Added v0.9.30; runner family v0.23.23. |
| `npx-allow-no-install` | `pre-bash-safety` | `npx --no-install <pkg>` / `npx --no <pkg>` allowed regardless of lockfile state — these flags forbid registry fetch, so npx runs an already-installed binary or exits non-zero; no unknown-origin code can land (the §8 NPX chain's target). Flags after the package name do NOT lift the gate. Records `extra.pkg`. Section: `§8-npx`. Added v0.23.19. |
| `rm-rf-allow-validated` | `pre-bash-safety` | `rm -rf $VAR` allowed because the same `VAR` is guarded by bash's `${VAR:?…}` set-or-exit operator (spec §8 SAFETY "Validate the var inline" recommended form). Records `extra.var`. Other guard forms (`[[ -n ]]`, `set -u`, control flow) are NOT recognized — use `[allow-rm-rf-var]`. Section: `§8-rm-rf-var`. Added v0.21.3. |
| `pass-known-red` | `ship-baseline` | red CI baseline bypassed via commit-body `known-red baseline:` marker (HEAD message) |
| `pass-known-red-incmd` | `ship-baseline` | v0.23.2 — same bypass but marker found in the CMD itself (typical chained `git commit -m "...known-red baseline: x" && git push origin main`). Closes the PreToolUse chicken-and-egg where amend hasn't run yet so HEAD lacks the marker. Section: `§7-ship-baseline`. Added v0.23.2. |
| `deny-repeat` | `ship-baseline` | 2nd `deny` on the same (`session_id`, `run_url`) pair within 5 minutes — agent retried without resolving CI. REASON wording escalated; same `permissionDecision=deny` to the model. Sentinel state in `~/.claude/.claudemd-state/ship-baseline-recent/<session_id>_<run_id>.sentinel` (1-day self-prune). Added v0.18.1. |
| `warn` | `sandbox-disposal`, `residue-audit` | non-blocking advisory |
| `advisory` | `transcript-vocab-scan` | PostToolUse advisory — agent-text §10-V hit (cannot block; v0.8.3 R-N8) |
| `structure-advisory` | `transcript-structure-scan` | Stop advisory — agent self-rule observation for §iron-law-2 / §10-four-section-order / §10-honesty (cannot block; v0.9.10 P1.2) |
| `bootstrap` | `session-start` | one-shot install on session start |
| `upstream-banner` | `session-start` | upstream version available banner |
| `compact-reminder` | `session-start` | SessionStart `source=="compact"` — emitted the §11 post-compaction re-read banner (advisory; opt-out `DISABLE_COMPACT_REREAD_REMINDER=1`). Section: `§11-post-compaction`. Added v0.27.0. |
| `version-sync` | `user-prompt-submit` | mid-session manifest sync triggered |
| `fail-open` | any hook calling `hook_record_failopen` (currently `banned-vocab`) | hook silently skipped enforcement due to a missing prerequisite. `extra.reason` ∈ {`jq-missing`, `bad-event`, `patterns-missing`, `prereq-missing`}. Rate-limited to 1 row per (hook, reason) per 60s via `~/.claude/.claudemd-state/failopen-*.ts`. Section: `§hooks-fail-open`. Round-6. |
| `read` | `session-extended-read` | session loaded the canonical user-global extended spec `~/.claude/CLAUDE-extended.md` (per spec §2.2 EXT LOADING). Per-session dedup via `~/.claude/.claudemd-state/ext-read-<sid>.ts` sentinel — at most one row per `session_id`. Provides the session-denominator signal for §13.1 demote analysis on extended-scope rules: a "0 hits" count is only meaningful against the count of sessions that actually loaded extended. Note (spec v6.17.0): §2.2 now sanctions targeted single-section Reads at any level; those also log `read` (no offset/limit discrimination), so treat this denominator as an upper bound on full-file loads. Section: `§13.1-extended-read`. Added v0.10.1. |
| `suggest` | `memory-prompt-hint` | UserPromptSubmit proactive hint — user's prompt matched MEMORY.md tags and at least one matched file is un-Read this session. `extra.suggested` lists the un-Read file basenames (capped at 5 in output, full list logged); `extra.match_count` carries the total un-Read match count for cite-recall analysis. v0.35.0 adds per-session per-file dedupe: a file already in the EMITTED prefix (first 5, priority-ordered) of a prior `suggest` row for the same `session_id` is not re-suggested (rule-hits lookup beats transcript flush lag; capped-out entries were never shown, so they stay eligible). Section: `§11-memory-hint`. Added v0.11.0. |
| `suppress-source` | `memory-prompt-hint` | Same match pipeline as `suggest`, but the prompt came from a non-human source (`<agent-message>` / `<task-notification>` / local-command relay / system-reminder) — additionalContext emission suppressed, would-have-been list logged for avalanche measurement. These rows are excluded from cite-recall (lesson-bypass-audit joins `event=suggest` only) and do NOT feed the dedupe. Same `extra` shape as `suggest`. Section: `§11-memory-hint`. Added v0.35.0 (R1, 2026-07-11 spec-audit). |
| `mid-spine-advisory` | `mid-spine-yield-scan` | Stop advisory — agent self-rule observation for §11 Mid-SPINE turn-yield. Walks the session transcript for (user-message matching continuation tell `继续 / next / why stop / proceed / keep going / 怎么停了 / 还有吗`, body ≤ 30 chars) preceded immediately by an assistant turn that (a) executed ≥1 tool_use AND (b) lacked four-section report anchor / `[AUTH REQUIRED` / `[PARTIAL:`. `extra` carries `{count}` (total suspected yields per session). Per-session dedup via `~/.claude/.claudemd-state/mid-spine-yield-<sid>.ts` sentinel. Opt-in `MID_SPINE_YIELD_SCAN=1` (default OFF). Section: `§11-mid-spine-yield`. Added v0.15.0. |
| `batch-cadence-advisory` | `session-end-check` | SessionEnd advisory — fires when the §13.2 batch-review L2+ session counter reaches `CLAUDEMD_BATCH_THRESHOLD` (default 20). L2+ heuristic: session emitted ≥1 rule-hits row with event ∈ {`deny`, `structure-advisory`, `mid-spine-advisory`, `warn`, `deny-repeat`} for this `session_id`. On trip: stderr banner recommending `/claudemd-sampling-audit` + `/claudemd-rules`, counter file at `~/.claude/.claudemd-state/l2-task-counter` reset to 0. `extra` carries `{l2_sessions}` (the threshold count, not the underlying event count). Sub-feature kill-switch `DISABLE_BATCH_CADENCE_ADVISORY=1`. Section: `§13.2-batch-review`. Added v0.19.2 B1. |

## Spec section taxonomy

`spec_section` carries the spec section identifier each event maps to. The
mapping is compile-time per (hook, callsite); `extra.matched` keeps the
per-pattern detail. Hooks that don't enforce a spec rule (session-start
bootstrap / upstream-banner / user-prompt-submit version-sync) emit `null`.

| Hook | Event | spec_section |
|---|---|---|
| `banned-vocab` | `deny` / `bypass-escape-hatch` | `§10-V` |
| `ship-baseline` | `pass` / `pass-known-red` / `pass-known-red-incmd` / `deny` / `deny-repeat` | `§7-ship-baseline` |
| `pre-bash-safety` | `deny` | granular per triggering pattern: `§8-rm-rf-var` / `§8-npx` / `§8-curl-sh` (one deny row per section present; untagged hits fall back to `§8`) |
| `pre-bash-safety` | `bypass-escape-hatch` (`allow-rm-rf-var`) | `§8-rm-rf-var` |
| `pre-bash-safety` | `bypass-escape-hatch` (`allow-npx-unpinned`) | `§8-npx` |
| `pre-bash-safety` | `bypass-escape-hatch` (`allow-curl-sh`) | `§8-curl-sh` |
| `pre-bash-safety` | `npx-allow-local` | `§8-npx` |
| `pre-bash-safety` | `npx-allow-no-install` | `§8-npx` |
| `pre-bash-safety` | `rm-rf-allow-validated` | `§8-rm-rf-var` |
| `memory-read-check` | `deny` / `bypass-escape-hatch` | `§11-memory-read` |
| `memory-prompt-hint` | `suggest` / `suppress-source` | `§11-memory-hint` |
| `mid-spine-yield-scan` | `mid-spine-advisory` | `§11-mid-spine-yield` |
| `residue-audit` | `warn` | `§7-user-global-state` |
| `sandbox-disposal` | `warn` | `§8.V4` |
| `transcript-vocab-scan` | `advisory` | `§10-V` |
| `transcript-structure-scan` | `structure-advisory` | `§iron-law-2` / `§10-four-section-order` / `§10-honesty` (one row per §-section detected) |
| `session-extended-read` | `read` | `§13.1-extended-read` |
| `session-start` | `bootstrap` / `upstream-banner` | `null` |
| `session-start` | `compact-reminder` | `§11-post-compaction` |
| `user-prompt-submit` | `version-sync` | `null` |
| any hook calling `hook_record_failopen` | `fail-open` | `§hooks-fail-open` (plugin-internal observability — not a spec rule) |

Pre-v0.7.0 rows have no `spec_section` field; `audit.js`'s `bySection`
aggregation surfaces them under the `(unset)` bucket so the operator can
see how much pre-upgrade data is in the audit window.

**Hooks that do NOT write to this log** (v0.8.0+): `session-summary.sh`
is a Stop hook that aggregates rows from this log and writes a derived
summary to `~/.claude/.claudemd-state/last-session-summary.json` (consumed
once by `session-start-check.sh` on the next session). It does not call
`hook_record` and produces no JSONL row. Grepping `claudemd.jsonl` for
`hook == "session-summary"` will return zero — that's expected.

## Example rows

```json
{"ts":"2026-04-21T03:10:45Z","hook":"banned-vocab","event":"deny","project":"-mnt-data-ssd-dev-projects-claudemd","spec_section":"§10-V","extra":{"matched":["significantly"]}}
{"ts":"2026-04-21T03:14:00Z","hook":"ship-baseline","event":"pass-known-red","project":"-mnt-data-ssd-dev-projects-claudemd","spec_section":"§7-ship-baseline","extra":{"run_url":"https://..."}}
{"ts":"2026-04-21T04:22:30Z","hook":"residue-audit","event":"warn","project":"-mnt-data-ssd-dev-projects-claudemd","spec_section":"§7-user-global-state","extra":{"delta":34,"current":187,"baseline":153}}
{"ts":"2026-04-21T04:23:00Z","hook":"pre-bash-safety","event":"bypass-escape-hatch","project":"-mnt-data-ssd-dev-projects-claudemd","spec_section":"§8-rm-rf-var","extra":{"token":"allow-rm-rf-var"}}
```

## Retention

`/claudemd-audit` does not auto-prune (v0.1.0). Future enhancement: prune rows older than 180 days on each audit invocation.
