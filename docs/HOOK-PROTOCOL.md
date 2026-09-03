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
  from those events log `null`. Read by `banned-vocab-check.sh`,
  `memory-read-check.sh`, `pre-bash-safety-check.sh`,
  `session-extended-read.sh`, `ship-baseline-check.sh`,
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

## Context output (stdout)

A hook can also return text for the model to read instead of a decision. Same
`hookSpecificOutput` wrapper, different fields:

```json
{
  "suppressOutput": true,
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<text the model sees>"
  }
}
```

- `hookEventName` must match the event the hook is registered for —
  `PreToolUse`, `UserPromptSubmit` or `SessionStart`. This envelope is how a
  hook speaks to the model; `stderr` is how it speaks to the human.
- `suppressOutput: true` keeps the text out of the transcript UI while the
  model still receives it. Every emitter here sets it.
- **A hook must emit exactly one JSON object per run.** Two objects on stdout
  are not valid JSON and the whole payload is dropped silently — no error, no
  context. `session-start-check.sh` can have up to four banners ready in one
  run (stale-root, upstream, session summary, spec drift) and merges them
  through `jq -s` for this reason (`session-start-check.sh:381,439`); a fifth
  banner added with its own `jq -cn` would disarm all of them.

Emitters, derived from source and gated by
`tests/scripts/architecture-drift.test.js` (R11-21(c)):

- `memory-prompt-hint.sh` — UserPromptSubmit; lists MEMORY.md files matching
  the prompt that have not been Read this session.
- `session-start-check.sh` — SessionStart; the merged banner described above.

**Stop hooks emit no `hookSpecificOutput` at all.** The Stop event has no
context schema, so `mem-audit.sh`, `residue-audit.sh` and
`sandbox-disposal-check.sh` write advisory text to `stderr`, and
`session-summary.sh` writes
`~/.claude/.claudemd-state/last-session-summary.json` for
`session-start-check.sh` to turn into a banner at the START of the next
session. That indirection is the schema's doing, not a design preference.

Injected text lands next to user messages, so it has to carry its own origin
framing (`[claudemd] …`, plus an explicit "system-injected" marker on anything
that reads like an instruction) — an XML wrapper alone does not stop a model
from treating injected prose as something the user said.

## Exit codes

- `0` with no stdout → pass silent
- `0` with stdout JSON → decision honored
- `2` with stderr → legacy deny path (avoid)
- Anything else → undefined (treated as bug); always prefer exit 0.

## Stop hooks cannot block

The Stop event does not respect `permissionDecision: "deny"`. Hooks on Stop are advisory — write to `stderr` (shown to user) + record via `hook_record`.
