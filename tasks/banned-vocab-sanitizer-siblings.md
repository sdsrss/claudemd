# Deferred: identifier/path sanitizer for sibling §10-V scanners

Queued from v0.23.19 (2026-06-13). Non-blocking — both siblings are advisory-only or scope-different, so the FP class costs telemetry noise, not denied commands.

## Background

v0.23.19 fixed the §10-V Path 2 (ship-verb prose scan) FP where `\b`-anchored
high-fire patterns match inside slashed/hyphenated identifiers — e.g. branch
name `docs/comprehensive-audit-2026-06-12` quoted in prose fires
`\bcomprehensive\b` because `-` and `/` are word boundaries. The fix sanitizes
the scanned text in `hooks/banned-vocab-check.sh` (strip fenced code blocks,
inline backtick spans, path-like ASCII runs containing `/`) before matching.

## Remaining siblings sharing the FP class (unsanitized)

1. `hooks/transcript-vocab-scan.sh` — PostToolUse advisory (`advisory` event,
   §10-V). Same `\b` patterns over agent text; identifier mentions inflate the
   advisory count in rule-hits telemetry and `/claudemd-audit` heatmaps.
2. `bin/claudemd-lint.js` (standalone CLI) — commit-msg / text lint. A commit
   message quoting a branch/file name containing a high-fire word FPs in git
   pre-commit usage. Different conventions than chat prose (commit subjects
   legitimately name branches), so the same strip rules likely apply.

## Suggested approach

Extract the v0.23.19 sanitizer (awk fence-toggle + sed backtick/path strip in
`hooks/banned-vocab-check.sh`, search "identifier/path mentions are not value
claims") into `hooks/lib/` so all three consumers share one implementation,
then add per-consumer shape tests (slashed / backtick-wrapped / fenced / bare
regression guard — see banned-vocab.test.sh cases 36–41 for the template).

## Verify command

`npm test` after wiring; specifically `bash tests/hooks/transcript-vocab-scan.test.sh`
and `node --test tests/scripts/*.test.js` for the CLI.
