# Claude Code hook I/O protocol reference

## PreToolUse event envelope (stdin)

```json
{
  "session_id": "<uuid>",
  "transcript_path": "/home/u/.claude/projects/<encoded-cwd>/<session>.jsonl",
  "tool_name": "Bash",
  "tool_input": { "command": "git commit -m ..." },
  "tool_use_id": "toolu_01ABC…",
  "cwd": "/path/to/project"
}
```

`transcript_path` and `tool_use_id` were absent from this envelope until
audit-2026-08-22 条目 22, while six hooks read them and
`docs/RULE-HITS-SCHEMA.md` requires `tool_use_id` in every logged row — a
reference that omits a field its own consumers depend on sends the next hook
author to re-derive it from another hook's source:

- `tool_use_id` — PreToolUse / PostToolUse only. Stop / SessionStart /
  SessionEnd / UserPromptSubmit carry no per-tool context, and rule-hits rows
  from those events log `null`. Read by `pre-bash-safety-check.sh`,
  `banned-vocab-check.sh`, `memory-read-check.sh`, `session-extended-read.sh`,
  `transcript-vocab-scan.sh`.
- `transcript_path` — the session's JSONL, present on Stop / SessionEnd /
  PostToolUse. Read by `session-end-check.sh`,
  `transcript-structure-scan.sh`, `transcript-vocab-scan.sh`. Treat it as
  best-effort: it can be absent or point at a file that does not exist yet.

Other tools have different `tool_input` shapes:
- `Edit`: `{"file_path": "...", "old_string": "...", "new_string": "..."}`
- `Write`: `{"file_path": "...", "content": "..."}`
- `Stop`: no `tool_input` / `tool_name`; carries `session_id`,
  `transcript_path` and `hook_event_name`

## Deny output (stdout)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "<multi-line human-readable>"
  }
}
```

## Exit codes

- `0` with no stdout → pass silent
- `0` with stdout JSON → decision honored
- `2` with stderr → legacy deny path (avoid)
- Anything else → undefined (treated as bug); always prefer exit 0.

## Stop hooks cannot block

The Stop event does not respect `permissionDecision: "deny"`. Hooks on Stop are advisory — write to `stderr` (shown to user) + record via `hook_record`.
