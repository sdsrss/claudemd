---
name: claudemd-analyze
description: Read-only spec ↔ implementation coherence audit. Cross-references core ↔ extended §EXT refs, Sizing line accuracy (±20B), and MEMORY.md ↔ files bidirectional integrity. Findings graded CRITICAL/HIGH/MEDIUM/LOW. Borrowed from github/spec-kit's /analyze pattern.
---

Usage: `/claudemd-analyze` (advisory) or `/claudemd-analyze --strict` (CI gate)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-coherence-audit.js $ARGS`

Surface the per-check [✓]/[△]/[✗] block first, then the severity-grouped findings, then the one-line summary. Counter format: `C=<critical> H=<high> M=<medium> L=<low>`.

Severity meaning:
- CRITICAL — breaks the spec's structural contract (unresolved §EXT ref)
- HIGH — drift outside accepted tolerance (Sizing line off by >20B; per `feedback_spec_sizing_recursive_rewrite.md`)
- MEDIUM — runtime-binding drift (MEMORY.md references missing file)
- LOW — non-binding drift (orphan memory file not in index)

Out of scope (covered by sibling commands):
- HARD-rule → hook enforcement coverage → `/claudemd-doctor` + `scripts/safety-coverage-audit.js`
- MEMORY.md tag-specificity → `/claudemd-doctor` (`memory-tag-specificity` check)
- rule-hits.jsonl telemetry → `/claudemd-audit`

This command is read-only and exits 0 by default. `--strict` exits 1 on CRITICAL or HIGH findings — suitable for pre-tag ship gate.
