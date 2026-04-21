# Claude Code hook I/O protocol reference

## PreToolUse event envelope (stdin)

```json
{
  "session_id": "<uuid>",
  "tool_name": "Bash",
  "tool_input": { "command": "git commit -m ..." },
  "cwd": "/path/to/project"
}
```

Other tools have different `tool_input` shapes:
- `Edit`: `{"file_path": "...", "old_string": "...", "new_string": "..."}`
- `Write`: `{"file_path": "...", "content": "..."}`
- `Stop`: minimal, mostly `{"session_id": "..."}`

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
