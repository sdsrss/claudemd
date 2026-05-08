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
| `bootstrap` | `session-start` | one-shot install on session start |
| `upstream-banner` | `session-start` | upstream version available banner |
| `version-sync` | `user-prompt-submit` | mid-session manifest sync triggered |

## Example rows

```json
{"ts":"2026-04-21T03:10:45Z","hook":"banned-vocab","event":"deny","project":"-mnt-data-ssd-dev-projects-claudemd","extra":{"matched":["significantly"]}}
{"ts":"2026-04-21T03:14:00Z","hook":"ship-baseline","event":"pass-known-red","project":"-mnt-data-ssd-dev-projects-claudemd","extra":{"run_url":"https://..."}}
{"ts":"2026-04-21T04:22:30Z","hook":"residue-audit","event":"warn","project":"-mnt-data-ssd-dev-projects-claudemd","extra":{"delta":34,"current":187,"baseline":153}}
{"ts":"2026-04-21T04:23:00Z","hook":"pre-bash-safety","event":"bypass-escape-hatch","project":"-mnt-data-ssd-dev-projects-claudemd","extra":{"token":"allow-rm-rf-var"}}
```

## Retention

`/claudemd-audit` does not auto-prune (v0.1.0). Future enhancement: prune rows older than 180 days on each audit invocation.
