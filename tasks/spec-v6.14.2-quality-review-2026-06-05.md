# spec v6.14.2 quality-review (reconstruction) — 2026-06-05

**Trigger**: prior session (v0.23.11 ship) deferred "8 spec-body quality items (wording / cross-references)" to a future v6.14.2 spec patch with no fixed date/trigger. Those 8 items were never written to a task file — only in conversation prose, wiped by `/clear`. User asked to re-run the review and patch.

## Method
Fresh round-5-style review of `spec/CLAUDE.md` (24553 B), `spec/CLAUDE-extended.md` (45618 B), `spec/OPERATOR.md`, `spec/hard-rules.json`.

## Mechanically-verified — all ACCURATE
- **§-reference integrity**: all 13 `§EXT` targets resolve in extended; `§13.1` → OPERATOR.md resolves; no dangling `§` refs (core or extended).
- **HARD-rule count** (§13 META line 405): "22 / 6 hook / 14 self / 1 both / 1 external" matches `hard-rules.json` exactly (`{self:14, external:1, hook:6, both:1}`, total 22).
- **Sizing line**: core 24553 (Sizing claims 24553, exact); extended 45618 (Sizing claims 45620, Δ2 within stated ±20B envelope).
- **Typos / doubled words**: none (perl `\b(\w+)\s+\1\b` scan clean).

## Candidate findings — none rise to a release
1. **§7-EXT / §11-EXT "duplicate" anchors**: NOT a defect. The `§X-EXT` convention intentionally allows multiple extended sections per core §; `§11-EXT` already labels 3 sections. Distinguished by heading text. (Telemetry note: `§7-EXT` in hard-rules.json is rule *id* `§7-EXT-evidence-validity` → VALIDATE subsection; not a `bySection` key — anchors are hook/json constants, not heading-scraped.)
2. **core line 3 vs extended line 3 load-trigger summaries**: read as scope-statement (extended "Applies to … orchestration") vs load-trigger list (core "load on …"); not contradictory. §2.2 remains authoritative.
3. **§13 META (L2 spec-patch-wording) vs core §2 (LLM-visible-metadata → L3)**: genuine latent ambiguity — a reader following only core §2 over-classifies spec wording fixes as L3. The L2 carve-out lives in §13 META (extended, not loaded at L2). Fix would land in core §2 = scarce headroom (447B) under net-zero/net-delete posture. Cost > benefit; defer to a paired net-delete patch if ever.

## Decision
**No v6.14.2 ship.** Fresh review finds the spec substantially clean; no wording/cross-ref defect warrants an L3 released-artifact patch under the current net-zero headroom posture. Finding #3 is the only real latent item — park it for the next net-delete-paired core edit.
