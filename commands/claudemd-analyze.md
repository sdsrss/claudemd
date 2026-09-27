---
name: claudemd-analyze
description: Read-only audit of spec ↔ implementation coherence — cross-references, the Sizing line, size caps, MEMORY.md ↔ memory files, and banned-vocab coverage. Findings graded CRITICAL to LOW.
---

Usage: `/claudemd-analyze` (advisory) or `/claudemd-analyze --strict` (CI gate)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-coherence-audit.js $ARGUMENTS`

Surface the per-check [✓]/[△]/[✗] block first, then the severity-grouped findings, then the one-line summary. Counter format: `C=<critical> H=<high> M=<medium> L=<low>`.

Severity meaning:
- CRITICAL — breaks the spec's structural contract (unresolved §EXT ref)
- HIGH — drift outside accepted tolerance (Sizing line off by >20B — the ±20B self-rewrite envelope)
- MEDIUM — runtime-binding drift (MEMORY.md references missing file; a §10 quick-check term no `banned-vocab.patterns` row can match)
- LOW — non-binding drift (orphan memory file not in index)

`banned-vocab-spec-drift` reports two things that are NOT findings and must not be read as coverage: `acknowledgedCount` (terms §10 names that are deliberately unmechanized — the `note` gives each one's measured false-positive reason) and `ironLaw2Unenforced` (§7's own phrasing list, which does not declare `banned-vocab.patterns` as its enumeration). Report both verbatim from the `note` rather than folding them into the severity counters.

Out of scope (covered by sibling commands):
- HARD-rule → hook enforcement coverage → `/claudemd-doctor` + `scripts/safety-coverage-audit.js`
- MEMORY.md tag-specificity → `/claudemd-doctor` (`memory-tag-specificity` check)
- rule-hits.jsonl telemetry → `/claudemd-audit`

This command is read-only and exits 0 by default. `--strict` exits 1 on CRITICAL or HIGH findings — suitable for pre-tag ship gate.
