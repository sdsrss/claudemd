# Sampling audit — 2026-07-25

Window: 30d · Transcripts scanned: 152 · Total assistant turns: 14136
Source: `/home/sds/.claude/projects`

> Metric contract (pre-registered): compliance = 1 − violations/opportunities.
> A rate without its denominator is not evidence. Detector rates stay
> `collecting` until hand-labeled precision ≥ 0.8 (~50 flagged + ~50 unflagged
> samples per rule) — plan A2/A4, docs/spec-optimization-plan-2026-07-10.md.

## Aggregate by rule

| Rule | Violations | Opportunities | Rate | Transcripts affected | Precision | Status |
|---|---:|---:|---:|---:|---:|---|
| §10-V | 45 | 14136 | 0.003 | 20 | uncalibrated | collecting |
| §iron-law-2 | 18 | 57 | 0.316 | 7 | uncalibrated | closed |
| §10-four-section-order | 0 | 58 | 0 | 0 | uncalibrated | closed |
| §10-honesty | 1 | 4 | 0.25 | 1 | uncalibrated | closed |
| §11-turn-yield | 2 | 1837 | 0.001 | 2 | uncalibrated | collecting |
| §7-bugfix-anchor | 8 | 8 | 1 | 4 | uncalibrated | closed |
| §11-post-compaction | 39 | 49 | 0.796 | 23 | uncalibrated | closed |
| §5-hard-auth | 85 | 88 | 0.966 | 18 | uncalibrated | closed |

## By project class (self-repo vs external)

| Rule | Self viol/opps | External viol/opps |
|---|---:|---:|
| §10-V | 1/946 | 44/13190 |
| §iron-law-2 | 2/9 | 16/48 |
| §10-four-section-order | 0/10 | 0/48 |
| §10-honesty | 1/1 | 0/3 |
| §11-turn-yield | 0/145 | 2/1692 |
| §7-bugfix-anchor | 0/0 | 8/8 |
| §11-post-compaction | 0/2 | 39/47 |
| §5-hard-auth | 2/2 | 83/86 |

## Over-ceremony (C1)

Task segments: 3496 · L0/L1-shaped (≤2 files, <80 est. LOC): 255 · with ceremony skill: 1 · rate: 0.004
Ceremony invocations (all segments): brainstorming×18, writing-plans×24, test-driven-development×3

> C2 pre-registered disposition (plan P3): after 30d collection, rate < 5% → keep
> superpowers, close P3; ≥ 5% → evaluate uninstall (EXT §12 fallback table) / fork /
> hook-level disable. Threshold fixed before data collection.

## Per-transcript hits

- `-home-sds--claude-tmp-claude-1000--mnt-data-ssd-dev-projects-loop-testing-905f6b5a-d296-44df-a672-fa3e70c0bcfb-scratchpad-calc-target/117348d3-f80e-4b6b-a4a5-c74022175682.jsonl` (2 hits)
  - turn 13: §10-V — matches: comprehensive
  - turn 20: §10-V — matches: comprehensive
- `-mnt-data-ssd-dev-projects-agentsmd/78d160d2-1c9b-46e0-9359-29108f3eddcf.jsonl` (2 hits)
  - §11-post-compaction ×5
  - §5-hard-auth ×19
- `-mnt-data-ssd-dev-projects-claudemd/20d1ce9b-3fc0-438b-b702-b48f5412f943.jsonl` (1 hit)
  - turn 28: §10-V — matches: significantly
- `-mnt-data-ssd-dev-projects-claudemd/4d50d65b-0a1f-44aa-8cb2-cf5ef0f605fa.jsonl` (2 hits)
  - turn 24: §iron-law-2 ×1
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-claudemd/c614c301-f28b-4056-aeff-6d2f29a6e721.jsonl` (1 hit)
  - turn 10: §10-honesty ×1
- `-mnt-data-ssd-dev-projects-claudemd/f0bf4e0a-e33a-4799-b33a-405da3f25eaf.jsonl` (2 hits)
  - turn 104: §iron-law-2 ×1
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-code-graph-mcp/106d6ddb-2df0-458f-9fd8-a984572cfc79.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-code-graph-mcp/1d6165b2-23ab-4624-ac24-3aa28a278861.jsonl` (2 hits)
  - turn 52: §10-V — matches: robust
  - §11-post-compaction ×4
- `-mnt-data-ssd-dev-projects-code-graph-mcp/888e88c9-2fdc-4727-b956-55121ae1009c.jsonl` (1 hit)
  - turn 0: §10-V — matches: comprehensive
- `-mnt-data-ssd-dev-projects-code-graph-mcp/a536ff27-6187-40dd-b5ef-75c65955cbd7.jsonl` (3 hits)
  - turn 23: §iron-law-2 ×1
  - turn 45: §iron-law-2 ×1
  - turn 75: §iron-law-2 ×1
- `-mnt-data-ssd-dev-projects-daagu/0a352371-c418-439d-b5ae-c81a85b63ff2.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-daagu/e77d41d1-b808-4b30-b4f3-e1c9711b0043.jsonl` (3 hits)
  - §11-turn-yield ×1
  - §11-post-compaction ×4
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-gsd/5859dc1d-de48-4c55-b5f3-17a6a5531bc7.jsonl` (5 hits)
  - turn 18: §10-V — matches: robust
  - turn 28: §10-V — matches: robust
  - turn 33: §10-V — matches: robust
  - turn 34: §10-V — matches: robust
  - turn 50: §10-V — matches: comprehensive
- `-mnt-data-ssd-dev-projects-gsd/a7734be6-a182-4e0d-b8fd-8ffa1e2d537b.jsonl` (2 hits)
  - turn 106: §10-V — matches: robust
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-llm-wiki/0c679d79-e03e-4a53-a6b4-5c030593223d.jsonl` (5 hits)
  - turn 0: §10-V — matches: comprehensive
  - turn 59: §10-V — matches: comprehensive
  - turn 87: §10-V — matches: robust
  - turn 89: §10-V — matches: robust
  - turn 90: §10-V — matches: robust
- `-mnt-data-ssd-dev-projects-llm-wiki/2577191c-1dfb-46e6-98d1-0b7115bc335f.jsonl` (2 hits)
  - turn 70: §10-V — matches: robust
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-llm-wiki/3f6f965a-1984-48fa-90b9-2b1db53a0ee8.jsonl` (3 hits)
  - turn 23: §10-V — matches: robust
  - turn 42: §10-V — matches: robust
  - turn 77: §iron-law-2 ×1
- `-mnt-data-ssd-dev-projects-llm-wiki/615b3f1a-f39b-4831-baa9-55b74a58a5cb.jsonl` (1 hit)
  - §5-hard-auth ×3
- `-mnt-data-ssd-dev-projects-llm-wiki/616562bf-74b8-4895-9a64-ba3f5e667181.jsonl` (10 hits)
  - turn 261: §10-V — matches: robust
  - turn 264: §10-V — matches: Robust
  - turn 376: §10-V — matches: robust
  - turn 377: §10-V — matches: robust
  - turn 379: §10-V — matches: robust
  - turn 400: §10-V — matches: robust
  - turn 401: §10-V — matches: robust
  - turn 435: §10-V — matches: robust
  - §11-post-compaction ×2
  - §5-hard-auth ×18
- `-mnt-data-ssd-dev-projects-llm-wiki/864d92da-6501-42a3-96e9-649c010c4904.jsonl` (2 hits)
  - §11-post-compaction ×2
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-llm-wiki/a6751762-c889-4897-bdbe-e1f2a84ccdde.jsonl` (2 hits)
  - turn 11: §7-bugfix-anchor ×1
  - turn 24: §7-bugfix-anchor ×1
- `-mnt-data-ssd-dev-projects-llm-wiki/ba1d22fa-fc67-482f-a2bf-e4ec471b84cd.jsonl` (2 hits)
  - turn 8: §10-V — matches: Comprehensive
  - turn 50: §10-V — matches: significantly
- `-mnt-data-ssd-dev-projects-loop-eng/41affee3-3fc4-4bef-8b12-93fd3df9585e.jsonl` (2 hits)
  - turn 38: §10-V — matches: comprehensive
  - turn 39: §10-V — matches: comprehensive
- `-mnt-data-ssd-dev-projects-loop-eng/a68ad269-5030-4a65-98cb-05ecbed7abc4.jsonl` (2 hits)
  - §11-post-compaction ×1
  - §5-hard-auth ×3
- `-mnt-data-ssd-dev-projects-loop-testing/51dc9f94-4e43-445e-aec3-4848dbbd4a96.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-loop-testing/81ceb9b4-1f9e-4653-bba0-9b3a17a15c77.jsonl` (4 hits)
  - turn 21: §10-V — matches: robust
  - turn 27: §10-V — matches: robust
  - turn 37: §10-V — matches: robust
  - turn 40: §10-V — matches: comprehensive
- `-mnt-data-ssd-dev-projects-loop-testing/905f6b5a-d296-44df-a672-fa3e70c0bcfb.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-loop-testing/acd9a2e7-817b-4346-9b3d-7b4b3d12834b.jsonl` (1 hit)
  - turn 19: §10-V — matches: robust
- `-mnt-data-ssd-dev-projects-mem/3785cf8c-c04b-4101-bd0a-f076c7d1941b.jsonl` (1 hit)
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-mem/e18345fe-2277-4a44-95c9-b8de5fb542e1.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-moa-skill/417b85c6-1b1d-4a31-8b2c-2692cac0dd44.jsonl` (1 hit)
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-moa-skill/b2a7a7a9-23fa-4720-8bc5-98de82eb25b6.jsonl` (10 hits)
  - turn 6: §iron-law-2 ×1
  - turn 26: §iron-law-2 ×1
  - turn 33: §iron-law-2 ×1
  - turn 85: §iron-law-2 ×1
  - turn 158: §iron-law-2 ×1
  - turn 170: §iron-law-2 ×1
  - turn 174: §iron-law-2 ×1
  - turn 186: §iron-law-2 ×1
  - turn 194: §iron-law-2 ×1
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-moa-skill/bacc4735-cfe9-41b2-a8d6-401ccc402ed7.jsonl` (1 hit)
  - turn 116: §10-V — matches: robust
- `-mnt-data-ssd-dev-projects-sgc/182a0c36-13f0-4891-8196-a82099dc4a51.jsonl` (1 hit)
  - §5-hard-auth ×1
- `-mnt-data-ssd-dev-projects-sgc/31d72ae7-46b8-4787-a809-f2fdb7df9c3e.jsonl` (1 hit)
  - turn 184: §iron-law-2 ×1
- `-mnt-data-ssd-dev-projects-sgc/4d2ebad4-6c4c-4575-a0cd-754d61fbf573.jsonl` (1 hit)
  - §5-hard-auth ×8
- `-mnt-data-ssd-dev-projects-sgc/a554be71-719a-475f-8d24-da399dfbcd1e.jsonl` (4 hits)
  - turn 37: §10-V — matches: presumably
  - turn 164: §iron-law-2 ×1
  - turn 228: §iron-law-2 ×1
  - §5-hard-auth ×3
- `-mnt-data-ssd-dev-projects-sgc/c3f64afe-ccea-4a29-9251-94b61af0f095.jsonl` (2 hits)
  - §11-post-compaction ×1
  - §5-hard-auth ×16
- `-mnt-data-ssd-dev-projects-super-skill/39c9f0bb-79a6-4d06-9e35-32dfc178522e.jsonl` (1 hit)
  - §5-hard-auth ×4
- `-mnt-data-ssd-dev-projects-super-skill/3e2ac56d-d5da-481e-a637-66be8780d99c.jsonl` (2 hits)
  - turn 46: §7-bugfix-anchor ×1
  - turn 55: §7-bugfix-anchor ×1
- `-mnt-data-ssd-dev-projects-super-skill/50a5ddd1-73d8-479e-afc2-2debacd74386.jsonl` (1 hit)
  - §5-hard-auth ×2
- `-mnt-data-ssd-dev-projects-super-skill/6fb87dd9-fd16-4aed-aedd-bef74368bef2.jsonl` (2 hits)
  - turn 45: §7-bugfix-anchor ×1
  - turn 57: §7-bugfix-anchor ×1
- `-mnt-data-ssd-dev-projects-super-skill/bce8e23f-5f5e-43fe-949a-a91beb0f11e8.jsonl` (2 hits)
  - turn 131: §10-V — matches: robust
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-super-skill/e8bdd2fa-1acc-4c09-83cf-8bb2d5334136.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-ubuntu-sec/073f0567-df9f-44cd-a0ae-038b924c3ea8.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-ubuntu-sec/16b44d83-b0e2-4032-b04e-7f874d917342.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-ubuntu-sec/37b6d104-e00d-4dd3-9269-52772045fe17.jsonl` (2 hits)
  - turn 17: §7-bugfix-anchor ×1
  - turn 29: §7-bugfix-anchor ×1
- `-mnt-data-ssd-dev-projects-ubuntu-sec/438c6874-c134-459a-8830-9c0ba0fa6da1.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-ubuntu-sec/54c92879-40e0-4611-93f8-50a1c91d3e75.jsonl` (2 hits)
  - §11-turn-yield ×1
  - §11-post-compaction ×3
- `-mnt-data-ssd-dev-projects-ubuntu-sec/55368095-2ea3-47cc-bec7-69f7ae07f79b.jsonl` (1 hit)
  - §11-post-compaction ×1
- `-mnt-data-ssd-dev-projects-ubuntu-sec/ba38ace5-79d6-4fdb-b8cf-281d65f9e2c5.jsonl` (5 hits)
  - turn 166: §10-V — matches: robust
  - turn 201: §10-V — matches: robust
  - turn 242: §10-V — matches: Robust
  - turn 264: §10-V — matches: robust
  - §11-post-compaction ×3
- `-mnt-data-ssd-dev-projects-ubuntu-sec/c1acaaf5-1408-407b-bd63-e5e71f3ed44c.jsonl` (1 hit)
  - turn 117: §10-V — matches: comprehensive
- `-mnt-data-ssd-dev-projects-ubuntu-sec/e5d5a1c5-118d-4904-a0e9-79d184e3002b.jsonl` (2 hits)
  - turn 116: §10-V — matches: robust
  - §11-post-compaction ×1
- `-tmp-loop-accept-api-QLoYhe/acc87bc6-7277-49d0-9e33-da23e2eefde9.jsonl` (1 hit)
  - §5-hard-auth ×1
