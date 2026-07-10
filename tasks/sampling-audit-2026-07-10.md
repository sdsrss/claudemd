# Sampling audit — 2026-07-10

Window: 30d · Transcripts scanned: 12 · Total assistant turns: 669
Source: `/home/sds/.claude/projects/-mnt-data-ssd-dev-projects-claudemd`

## Aggregate by rule

| Rule | Hits | Transcripts affected |
|---|---:|---:|
| §10-V | 30 | 7 |
| §iron-law-2 | 0 | 0 |
| §10-four-section-order | 0 | 0 |
| §10-honesty | 0 | 0 |

## Per-transcript hits

- `07639dc2-bc07-48af-be90-5a9cf1ecd5e5.jsonl` (2 hits)
  - turn 40: §10-V — matches: robust
  - turn 70: §10-V — matches: robust
- `28b77653-4679-4cf8-848c-3975751e498b.jsonl` (1 hit)
  - turn 1: §10-V — matches: should work
- `5dd6b4e0-75f0-4652-8d4c-68de96c5f455.jsonl` (4 hits)
  - turn 3: §10-V — matches: robust
  - turn 4: §10-V — matches: robust
  - turn 8: §10-V — matches: robust
  - turn 12: §10-V — matches: robust
- `c9e7277c-391e-4178-a647-0cbbb58112ed.jsonl` (1 hit)
  - turn 8: §10-V — matches: comprehensive
- `effac075-42af-423c-81c2-d98c7a6208a3.jsonl` (10 hits)
  - turn 13: §10-V — matches: robust
  - turn 17: §10-V — matches: robust
  - turn 66: §10-V — matches: robust
  - turn 86: §10-V — matches: significantly, comprehensive
  - turn 114: §10-V — matches: comprehensive
  - turn 115: §10-V — matches: comprehensive
  - turn 120: §10-V — matches: robust
  - turn 122: §10-V — matches: robust
  - turn 131: §10-V — matches: significantly, robust, comprehensive
  - turn 150: §10-V — matches: robust
- `f1e1f950-8455-4055-9e81-54565f075f27.jsonl` (3 hits)
  - turn 31: §10-V — matches: robust
  - turn 33: §10-V — matches: robust
  - turn 90: §10-V — matches: robust
- `f411e92b-09c5-4bd8-b0ce-c3880bf81d9a.jsonl` (2 hits)
  - turn 1: §10-V — matches: robust, Comprehensive, should work
  - turn 10: §10-V — matches: robust, Comprehensive, should work

## Baseline analysis (A1, spec-optimization-plan-2026-07-10 §P1)

First REAL-data run (the 2026-07-06 report scanned 0 transcripts from a sandbox
HOME — annotated in that file; script default path resolution verified correct,
no code fix needed).

**Global run** (same day, `--global --json`, raw JSON in session scratchpad
`sampling-global.json`): 1110 transcripts / 20827 turns across all CC projects.

| Rule | claudemd (self-repo) | Global | Rate self (hits/1k turns) | Rate global |
|---|---:|---:|---:|---:|
| §10-V | 30 | 140 | 44.8 | 6.7 |
| §iron-law-2 | 0 | 13 | 0 | 0.62 |
| §10-four-section-order | 0 | 0 | 0 | 0 |
| §10-honesty | 0 | 6 | 0 | 0.29 |

Per-project §10-V+ hit totals (top): mem 52 · code-graph-mcp 44 · claudemd 23 ·
daagu 14 · tmp 6 · agentsmd 5 · bz 4. Top matched tokens: `robust` 84/140 (60%) ·
`comprehensive/Comprehensive` 26 · `significantly` 8 · `should work` 7 · 中文 12.

**Interpretation caveats (do NOT read raw hits as violation counts)**:
1. **Quote contamination**: claudemd's 6.7× higher §10-V density vs global is the
   expected self-dogfood pattern — sessions here *discuss* banned vocab (this
   session's own turns quote `significantly` verbatim). Same lesson as the
   2026-06-03 deny-count finding (187/198 = one word, self-repo).
2. **Context-blind detector**: §10-V scope is value claims about *own work*;
   `robust` at 60% of matches likely includes technical-discussion usage outside
   that scope. Precision is unmeasured until A4 hand-labeling (~50 flagged +
   ~50 unflagged; gate: precision ≥ 0.8 before any rate enters /claudemd-audit).
3. **No denominators yet**: script reports hits without opportunities (e.g.
   iron-law-2 lacks "count of complete four-section blocks scanned";
   scanStructure only evaluates when all 4 labels present, so the denominator is
   computable — A2 implementation item).
4. §iron-law-2 13 hits are all in non-claudemd projects (12 transcripts) —
   candidate first target for A4 labeling since volume is small enough to label
   exhaustively.

**Next steps**: A2 (denominators + self/external split in script output) → A3
(4 new detectors) → A4 (labeling) per docs/spec-optimization-plan-2026-07-10.md.
