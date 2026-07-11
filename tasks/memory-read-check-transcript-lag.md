# memory-read-check: suspected transcript-flush lag false-deny

Status: observed once, not reproduced. Logged during the v0.34.0 ship session (2026-07-11); internal freeze applies — investigate only if it recurs.

## Observation

`~/.claude/logs/claudemd.jsonl` 2026-07-10:

- `15:53:55Z` deny — missing `feedback_claudemd_ship_from_main_atomic.md`, match_count=1
- `15:54:43Z` bypass — reason: "feedback_claudemd_ship_from_main_atomic.md was Read this session immediately before this retry"

If the bypass reason is accurate, the hook's transcript grep (`memory-read-check.sh` — `grep -qF "$MEMFILE" "$TRANSCRIPT"`) missed a Read that had already happened. Candidate causes:

1. CC transcript flush lag — the Read event not yet persisted to `<session>.jsonl` when the next PreToolUse:Bash fired.
2. Path mismatch — Read used a different path spelling (relative / symlink) than `$MEM_DIR/$file`.

## Verify command (when it recurs)

Reproduce: Read the memory file, then IMMEDIATELY (same turn) run a trigger command; on deny, `grep -c "feedback_claudemd_ship_from_main_atomic" ~/.claude/projects/<encoded>/<session>.jsonl` to check whether the Read row exists at deny time.

## Fix sketch (if confirmed as flush lag)

Retry the transcript grep once after a short sleep, or accept a same-turn `[mem] PreToolUse recall` marker as Read evidence. Do NOT widen fail-open — deny→bypass already self-corrects at cost of one round-trip.
