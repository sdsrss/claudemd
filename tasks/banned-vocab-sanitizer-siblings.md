# Deferred: identifier/path sanitizer for sibling §10-V scanners

Queued from v0.23.19 (2026-06-13). Non-blocking — both siblings are advisory-only or scope-different, so the FP class costs telemetry noise, not denied commands.

## Background

v0.23.19 fixed the §10-V Path 2 (ship-verb prose scan) FP where `\b`-anchored
high-fire patterns match inside slashed/hyphenated identifiers — e.g. branch
name `docs/comprehensive-audit-2026-06-12` quoted in prose fires
`\bcomprehensive\b` because `-` and `/` are word boundaries. The fix sanitizes
the scanned text in `hooks/banned-vocab-check.sh` (strip fenced code blocks,
inline backtick spans, path-like ASCII runs containing `/`) before matching.

## Remaining siblings sharing the FP class (unsanitized) — BOTH FIXED (working tree)

1. **[FIXED]** `hooks/transcript-vocab-scan.sh` — PostToolUse advisory (`advisory`
   event, §10-V). Same `\b` patterns over agent text; identifier mentions
   inflated the advisory count in rule-hits telemetry. Fixed: added the awk
   fence-toggle + sed backtick/slashed-path/bare-file strip after LAST_TEXT
   extraction (mirrors banned-vocab-check.sh Path 2). Tests 13–14 in
   transcript-vocab-scan.test.sh (identifier-only → clean; bare-prose-beside-id
   → still fires).
2. **[FIXED — the load-bearing one]** `bin/claudemd-lint.js` (standalone CLI) —
   commit-msg / text lint, used in git pre-commit hooks + CI, so the FP BLOCKS
   commits (not merely telemetry noise — the deferral note undersold this).
   Reproduced: `claudemd-cli lint "refactor comprehensive-parser.js"` exited 1.
   Fixed: `lib/lint.js` gained `stripIdentifiers()` + a `scan({sanitize})` opt-in;
   the CLI `lint` + `audit` paths pass `sanitize:true`. 6 unit tests in lint.test.js.

## Resolution note (differs from the suggested approach)

The suggested single shared `hooks/lib/` implementation is not literally
achievable — one consumer is bash (`transcript-vocab-scan.sh`, shares the inline
awk+sed with `banned-vocab-check.sh` Path 2) and one is Node
(`bin/claudemd-lint.js` via `lib/lint.js#stripIdentifiers`). Both now implement
the SAME rule set (fenced → backtick → slashed-path → bare `name.ext` with a
lowercase extension). The bare-file rule is a CLI-domain extension beyond Path 2
(commit messages name bare files); the lowercase-extension guard keeps decimals
/ versions ("3.5x", "v6.14") intact so a baseline-less ratio claim is not
swallowed (would be a false negative). Bare hyphenated identifiers with no
extension/slash/backtick (`robust-retry`) remain a residual FP — the same
boundary limitation Path 2 has; left as-is (escape hatch: `[allow-banned-vocab]`).

## Verify command

`npm test` (all green: transcript-vocab-scan 14/14, lint.test.js 58/58, full suite pass).
