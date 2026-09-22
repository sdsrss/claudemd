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
  `transcript-vocab-scan.sh`, `rework-breaker.sh`.
  One reader of the NAME is not a reader of this field: `evidence-gate.sh` is a
  Stop hook, so its envelope carries no `tool_use_id` at all — it reads the
  `tool_use_id` that each `tool_result` in the TRANSCRIPT carries, to join a
  result back to the command that produced it. Same spelling, different object;
  the derivation gate here matches on the spelling, which is why the
  distinction is written down rather than left to look like an omission.
- `transcript_path` — the session's JSONL, present on Stop / SessionEnd /
  PostToolUse. Read by `session-end-check.sh`,
  `transcript-structure-scan.sh`, `transcript-vocab-scan.sh`,
  `evidence-gate.sh`, `ledger-staleness.sh`. Treat it as
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

- `hookEventName` must match the event the hook is registered for. This
  envelope is how a hook speaks to the model; `stderr` is how it speaks to the
  human. The events this repo has CONFIRMED deliver it are `PreToolUse`,
  `UserPromptSubmit`, `SessionStart` and `PostToolUse`. That list used to read
  as a closed set of the first three, which was this file asserting a limit it
  had never tested: on 2026-09-21 a probe registered a PostToolUse hook emitting
  a unique token and the model quoted the token back, on Claude Code 2.1.278
  (`rework-breaker.sh` ships on that path). `Stop` genuinely does not — see
  below, where the absence is a schema fact rather than an untested assumption.
- `suppressOutput: true` keeps the text out of the transcript UI while the
  model still receives it. Every emitter here sets it.
- **A hook must emit exactly one JSON object per run.** Two objects on stdout
  are not valid JSON and the whole payload is dropped silently — no error, no
  context. `session-start-check.sh` emits from TWO places, and which one runs
  depends on whether a manifest exists. The version-MATCH branch can have five
  banners ready in one run (stale-cache, upstream, session summary, spec drift,
  user-content) and the fresh/mismatch tail can have three (bootstrap-failed,
  session summary, user-content). Both call `merge_banners`, one `jq -s` that
  drops the empties, passes a single survivor through and joins the rest — one
  implementation since 2026-09-05, because a sixth banner added to one copy of
  two identical programs is a banner that appears on one branch only. A banner
  added with its own `jq -cn` alongside either call would disarm every banner in
  that run, not just itself. v0.75.0 added the fifth (user-content)
  through the merge, and moved the tail's emit into `emit_tail_banners` so every
  `exit` after the banner set is computed prints it exactly once — the guards on
  the `command -v node` and `mkdir -p "$LOG_DIR"` bailouts exist for that reason,
  and `tests/hooks/session-start.test.sh` Case 37 pins the node-absent one.

Emitters, derived from source and gated by
`tests/scripts/architecture-drift.test.js` (R11-21(c)):

- `memory-prompt-hint.sh` — UserPromptSubmit; lists MEMORY.md files matching
  the prompt that have not been Read this session.
- `session-start-check.sh` — SessionStart; the merged banner described above.
- `rework-breaker.sh` — PostToolUse (`Edit|Write`); one line naming a LOWER
  BOUND on how many times this session has edited the file — the multiple of
  the G2 threshold this process won, not the tally it read, because concurrent
  Edit hooks interleave and only the claim is exact. Code files only.
  It reads `.tool_input.file_path` and `.session_id`, and quotes the path from
  the EVENT rather than from its own state file, because that state is keyed by
  checksum and a collision there must not be able to name the wrong file.

**Stop hooks emit no `hookSpecificOutput` at all.** The Stop event has no
context schema, so the ones with something to say write advisory text to
`stderr` — `mem-audit.sh`, `residue-audit.sh`, `sandbox-disposal-check.sh`,
`transcript-structure-scan.sh` and `evidence-gate.sh` — and
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
