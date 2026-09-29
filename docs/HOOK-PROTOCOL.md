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
  `transcript-vocab-scan.sh`, `rework-breaker.sh`, `branch-prune.sh`,
  `cross-repo-write-check.sh`.
  Two readers of the NAME are not readers of this field: `evidence-gate.sh`
  (Stop) and `session-end-check.sh` (SessionEnd) get no `tool_use_id` in their
  envelope at all — they read the `tool_use_id` that each `tool_result` in the
  TRANSCRIPT carries, to join a result (and the files its `bashEditDiff`
  lists) back to the command that produced it. Same spelling, different object;
  the derivation gate here matches on the spelling, which is why the
  distinction is written down rather than left to look like an omission.
- `transcript_path` — the session's JSONL, present on Stop / SessionEnd /
  PostToolUse, and on PreToolUse too (a 2026-09-26 `claude -p` probe on
  2.1.283 received it there; with `--no-session-persistence` the path is given
  but the file never exists). Read by `session-end-check.sh`,
  `transcript-structure-scan.sh`, `transcript-vocab-scan.sh`,
  `evidence-gate.sh`, `ledger-staleness.sh`, `reply-language-check.sh`,
  `spec-module-gate.sh` (whether ship.md was read),
  `sandbox-disposal-check.sh` (only its dirname, to exclude the session's own
  project dir from the residue scan). Treat it as
  best-effort: it can be absent or point at a file that does not exist yet.
  It also does not contain everything the session did. As of Claude Code
  2.1.278 — observed there, still true at 2.1.280, no earlier bound established —
  a subagent's rows go to `<encoded-cwd>/<session>/subagents/agent-<name>-<hash>.jsonl`
  — one directory down, carrying `isSidechain: true` and the PARENT's
  `sessionId` — while the events that subagent's own tool calls raise still
  carry the parent `session_id`. A hook that reconstructs `<session>.jsonl` and
  reads only that sees the parent's turns and none of its subagents'. That is
  round-17 HK-H1: `hook_memfile_was_read` denied files a reviewer subagent had
  open. Read both, at fixed depth — §8 forbids descending `~/.claude`
  recursively.

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
  `UserPromptSubmit`, `SessionStart`, `PostToolUse` and `PostToolUseFailure`
  (2026-09-29, Claude Code 2.1.284: a Bash call exiting non-zero fired
  `PostToolUseFailure` and not `PostToolUse`, and the model quoted back a token
  from its `additionalContext`). That list used to read
  as a closed set of the first three, which was this file asserting a limit it
  had never tested: on 2026-09-21 a probe registered a PostToolUse hook emitting
  a unique token and the model quoted the token back, on Claude Code 2.1.278
  (`rework-breaker.sh` ships on that path). `Stop` and `SubagentStop` accept it
  too, since Claude Code 2.1.163, but on those two events it is not a passive
  channel: the turn keeps going so the model can respond — see below. This
  file said the opposite until 2026-09-29, which was the same mistake again.
- `suppressOutput: true` keeps the text out of the transcript UI while the
  model still receives it. Every emitter here sets it.
- `systemMessage` (top level, beside `suppressOutput`) is the opposite channel:
  the human sees it and the model does not. Measured 2026-09-27 on Claude Code
  2.1.283: an interactive session printed `SessionStart:startup says: <text>`
  even with `suppressOutput: true`, and a `claude -p` probe asking the model for
  the token found only the `additionalContext` one. `session-start-check.sh`
  uses it for notices that ask the USER to act: a newer release and a stale
  plugin registration go to the human only; a failed background install and
  the two user-content notices (your own `~/.claude/CLAUDE.md` was moved aside)
  go to both, because the model also needs to know. Sent as
  `additionalContext` alone they had reached only the model.
- **A hook must emit exactly one JSON object per run.** Two objects on stdout
  are not valid JSON and the whole payload is dropped silently — no error, no
  context. `session-start-check.sh` emits from several places depending on the
  manifest state and the session source; the version-MATCH branch alone can
  have six candidates ready in one run (stale-cache, upstream, session summary,
  spec drift, user-content, ledger) and the fresh/mismatch tail four. Both call `merge_banners`, one `jq -s` that
  drops the empties and joins the rest into one object, `additionalContext` and
  `systemMessage` each joined separately — one
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
- `spec-module-inject.sh` — UserPromptSubmit; the body of each spec module whose
  `triggers:` regex the prompt matches, once per session, at most two per prompt.
  Claude Code replaces a context string over 10,000 characters with a file path
  and a preview, so the hook strips each body's build comment and holds a second
  module that would cross 9,800 characters for the next prompt.
- `spec-module-gate.sh` — PreToolUse(Bash), only with `SPEC_MODULE_GATE=advisory`;
  names the ship module to read before a release command.
- `session-start-check.sh` — SessionStart; the merged banner described above.
- `test-failure-debug.sh` — PostToolUseFailure (`Bash`), only with
  `DEBUG_ON_TEST_FAILURE=1`; the `debug` spec module, wrapped the way
  `spec-module-inject.sh` wraps one (`hooks/lib/spec-module.sh`), when a test
  runner exits non-zero and the module is not yet in this session.
- `rework-breaker.sh` — PostToolUse (`Edit|Write|Bash`); one line naming a LOWER
  BOUND on how many times this session has edited the file — the multiple of
  the G2 threshold this process won, not the tally it read, because concurrent
  Edit hooks interleave and only the claim is exact. Code files only.
  It reads `.tool_input.file_path` (Edit/Write) or
  `.tool_response.bashEditDiff` (Bash; Claude Code >=2.1.278): `changedFiles`
  (the complete list, at most 200) and `files[].filePath` (at most 5 rendered
  diffs, possibly none), once per path. Claude Code records it by default in
  auto/bypassPermissions mode behind its own feature gate, and in any mode when
  the `bashEditDiffEnabled` setting or `CLAUDE_CODE_BASH_EDIT_DIFF=1` turns it
  on. A command changing more than 20 code files is skipped as a bulk
  operation. It also reads `.session_id`, and quotes the path from
  the EVENT rather than from its own state file, because that state is keyed by
  checksum and a collision there must not be able to name the wrong file.
- `cross-repo-write-check.sh` — PreToolUse (`Edit|Write|NotebookEdit|Bash`);
  one line per git repo, other than the one owning `cwd`, that the call writes
  into — the target path of a file tool, or a git write after a literal `cd` or
  `git -C` in Bash. Told once per repo per session (an `O_EXCL` claim), recorded
  on every hit. Opt-in `CROSS_REPO_WRITE=1`. It never sets
  `permissionDecision`, so the envelope carries context only.
- `tmp-sweep.sh` — PostToolUse (`Bash`); one line when the temp root is at or
  past `CLAUDEMD_TMP_PRESSURE_PCT` (default 80) full, naming the percentage
  and, on a tmpfs, that the bytes are RAM. Rate-limited with the sweep itself
  to one run per `CLAUDEMD_TMP_SWEEP_INTERVAL_MIN` (default 10).
- `branch-prune.sh` — PostToolUse (`Bash`); one line listing the local
  branches that are safe to delete, with the `git branch -d` command that
  deletes them. It deletes nothing. Silent when there is nothing to list.

**No Stop hook here emits `hookSpecificOutput`, and that is a choice, not the
schema.** Claude Code 2.1.163 added `hookSpecificOutput.additionalContext` to
Stop and SubagentStop, documented as "non-error feedback that continues the
conversation": the model reads it at the end of the turn and responds, under the
same `stop_hook_active` loop guard as `decision: "block"`, and under `claude -p`
that extra reply becomes the final result. So on Stop it costs one more model
turn per firing, exactly as a block does, just without the error label. An
advisory whose precision is low — `evidence-gate.sh` fired 21 times over 1,747
historical turn ends and at most 3 were right — would buy one extra turn per
false alarm, which is why the advisories below stay on `stderr`.
Two Stop hooks print stdout JSON of a different shape, each
only under its opt-in: `reply-language-check.sh` and
`sandbox-disposal-check.sh` (`SANDBOX_DISPOSAL_BLOCK=1`) return top-level
`{"decision":"block","reason":…}`, which Claude Code documents for Stop as
"keep going" — the model receives `reason` and writes one more message. Both
let the next Stop through when the event carries `stop_hook_active: true`, so
each blocks at most once per turn. The others with something to say write
advisory text to `stderr` — `mem-audit.sh`, `residue-audit.sh`,
`sandbox-disposal-check.sh` (by default),
`transcript-structure-scan.sh`, `evidence-gate.sh` and
`ledger-staleness.sh` — and `session-summary.sh` writes
`~/.claude/.claudemd-state/last-session-summary.json` for
`session-start-check.sh` to turn into a banner at the START of the next
session. Before 2.1.163 that indirection was forced by the schema; it is now
the cheaper of two channels, kept because the other one costs a turn.

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

The Stop event does not respect `permissionDecision: "deny"`; its only control
is `decision: "block"`, which does not undo anything — it only asks for more
output (see `reply-language-check.sh` and `sandbox-disposal-check.sh` above). Hooks on Stop are otherwise advisory — write to `stderr` (shown to user) + record via `hook_record`.
