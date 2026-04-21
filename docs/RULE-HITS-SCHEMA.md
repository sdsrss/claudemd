# rule-hits JSONL schema

File: `~/.claude/logs/claudemd.jsonl`
Format: one JSON object per line. Append-only.

## Fields

| Field | Type | Description |
|---|---|---|
| `ts` | string (ISO-8601 UTC, Z-suffix) | timestamp of row creation |
| `hook` | string | hook name (`banned-vocab`, `ship-baseline`, `residue-audit`, `memory-read-check`, `sandbox-disposal`) |
| `event` | string | one of: `pass`, `deny`, `bypass-env`, `bypass-escape-hatch`, `warn`, `error`, `pass-known-red` |
| `extra` | any | hook-specific payload (object / null / string) |

## Example rows

```json
{"ts":"2026-04-21T03:10:45Z","hook":"banned-vocab","event":"deny","extra":{"matched":["significantly"]}}
{"ts":"2026-04-21T03:14:00Z","hook":"ship-baseline","event":"pass-known-red","extra":{"run_url":"https://..."}}
{"ts":"2026-04-21T04:22:30Z","hook":"residue-audit","event":"warn","extra":{"delta":34,"current":187,"baseline":153}}
{"ts":"2026-04-21T04:23:00Z","hook":"sandbox-disposal","event":"warn","extra":{"count":7}}
```

## Retention

`/claudemd-audit` does not auto-prune (v0.1.0). Future enhancement: prune rows older than 180 days on each audit invocation.
