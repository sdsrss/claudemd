# Sampling audit — 2026-07-25

Window: 30d · Transcripts scanned: 20 · Total assistant turns: 901
Source: `/home/sds/.claude/projects/-mnt-data-ssd-dev-projects-claudemd`

> Metric contract (pre-registered): compliance = 1 − violations/opportunities.
> A rate without its denominator is not evidence. Detector rates stay
> `collecting` until hand-labeled precision ≥ 0.8 (~50 flagged + ~50 unflagged
> samples per rule) — plan A2/A4, docs/spec-optimization-plan-2026-07-10.md.

## Aggregate by rule

| Rule | Violations | Opportunities | Rate | Transcripts affected | Precision | Status |
|---|---:|---:|---:|---:|---:|---|
| §10-V | 8 | 901 | 0.009 | 3 | uncalibrated | collecting |
| §iron-law-2 | 1 | 6 | 0.167 | 1 | uncalibrated | collecting |
| §10-four-section-order | 0 | 7 | 0 | 0 | uncalibrated | collecting |
| §10-honesty | 1 | 1 | 1 | 1 | uncalibrated | collecting |
| §11-turn-yield | 0 | 140 | 0 | 0 | uncalibrated | collecting |
| §7-bugfix-anchor | 0 | 0 | n/a | 0 | uncalibrated | collecting |
| §11-post-compaction | 0 | 2 | 0 | 0 | uncalibrated | collecting |
| §5-hard-auth | 1 | 1 | 1 | 1 | uncalibrated | collecting |

## Over-ceremony (C1)

Task segments: 380 · L0/L1-shaped (≤2 files, <80 est. LOC): 23 · with ceremony skill: 0 · rate: 0
Ceremony invocations (all segments): brainstorming×3, writing-plans×2

> C2 pre-registered disposition (plan P3): after 30d collection, rate < 5% → keep
> superpowers, close P3; ≥ 5% → evaluate uninstall (EXT §12 fallback table) / fork /
> hook-level disable. Threshold fixed before data collection.

## Per-transcript hits

- `20d1ce9b-3fc0-438b-b702-b48f5412f943.jsonl` (1 hit)
  - turn 28: §10-V — matches: significantly
- `64d2c888-cbab-40c9-97bb-a93253f4ecc6.jsonl` (4 hits)
  - turn 19: §10-V — matches: comprehensive
  - turn 21: §10-V — matches: comprehensive
  - turn 22: §10-V — matches: comprehensive
  - turn 28: §10-V — matches: comprehensive
- `c614c301-f28b-4056-aeff-6d2f29a6e721.jsonl` (1 hit)
  - turn 10: §10-honesty ×1
- `f0bf4e0a-e33a-4799-b33a-405da3f25eaf.jsonl` (5 hits)
  - turn 8: §10-V — matches: comprehensive
  - turn 80: §10-V — matches: comprehensive
  - turn 87: §10-V — matches: comprehensive
  - turn 104: §iron-law-2 ×1
  - §5-hard-auth ×1
