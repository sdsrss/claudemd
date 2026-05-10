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
| `spec_section` | string \| null | spec section being enforced — drives §0.1/§13.1/§13.2 promotion/demotion accounting. `null` for plugin-internal events (bootstrap, version-sync, upstream-banner) and for rows written before v0.7.0. See "Spec section taxonomy" below. Added v0.7.0. |
| `extra` | any | hook-specific payload (object / null / string) |

## Events

The `event` field is one of the following. The contract is locked by
`tests/hooks/contract.test.sh` — every documented (event, emitter) pair
must have a matching `hook_record` call in source, and every emission in
source must appear in this table.

| Event | Emitted by hook | Meaning |
|---|---|---|
| `pass` | `ship-baseline` | rule checked, no action needed |
| `deny` | `banned-vocab`, `ship-baseline`, `memory-read-check`, `pre-bash-safety` | rule denied the tool call |
| `bypass-escape-hatch` | `banned-vocab`, `pre-bash-safety`, `memory-read-check` | per-invocation escape token used (records token name in `extra`) |
| `pass-known-red` | `ship-baseline` | red CI baseline bypassed via commit-body `known-red baseline:` marker |
| `warn` | `sandbox-disposal`, `residue-audit` | non-blocking advisory |
| `advisory` | `transcript-vocab-scan` | PostToolUse advisory — agent-text §10-V hit (cannot block; v0.8.3 R-N8) |
| `structure-advisory` | `transcript-structure-scan` | Stop advisory — agent self-rule observation for §iron-law-2 / §10-four-section-order / §10-honesty (cannot block; v0.9.10 P1.2) |
| `bootstrap` | `session-start` | one-shot install on session start |
| `upstream-banner` | `session-start` | upstream version available banner |
| `version-sync` | `user-prompt-submit` | mid-session manifest sync triggered |
| `fail-open` | any hook calling `hook_record_failopen` (currently `banned-vocab`) | hook silently skipped enforcement due to a missing prerequisite. `extra.reason` ∈ {`jq-missing`, `bad-event`, `patterns-missing`, `prereq-missing`}. Rate-limited to 1 row per (hook, reason) per 60s via `~/.claude/.claudemd-state/failopen-*.ts`. Section: `§hooks-fail-open`. Round-6. |

## Spec section taxonomy

`spec_section` carries the spec section identifier each event maps to. The
mapping is compile-time per (hook, callsite); `extra.matched` keeps the
per-pattern detail. Hooks that don't enforce a spec rule (session-start
bootstrap / upstream-banner / user-prompt-submit version-sync) emit `null`.

| Hook | Event | spec_section |
|---|---|---|
| `banned-vocab` | `deny` / `bypass-escape-hatch` | `§10-V` |
| `ship-baseline` | `pass` / `pass-known-red` / `deny` | `§7-ship-baseline` |
| `pre-bash-safety` | `deny` (combined patterns) | `§8` |
| `pre-bash-safety` | `bypass-escape-hatch` (`allow-rm-rf-var`) | `§8-rm-rf-var` |
| `pre-bash-safety` | `bypass-escape-hatch` (`allow-npx-unpinned`) | `§8-npx` |
| `memory-read-check` | `deny` / `bypass-escape-hatch` | `§11-memory-read` |
| `residue-audit` | `warn` | `§7-user-global-state` |
| `sandbox-disposal` | `warn` | `§8.V4` |
| `transcript-vocab-scan` | `advisory` | `§10-V` |
| `transcript-structure-scan` | `structure-advisory` | `§iron-law-2` / `§10-four-section-order` / `§10-honesty` (one row per §-section detected) |
| `session-start` | `bootstrap` / `upstream-banner` | `null` |
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
