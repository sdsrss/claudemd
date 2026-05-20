# Memory layer routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship spec v6.11.17 (claudemd v0.17.6) — add explicit plugin-absent fallback to §11-EXT Layer routing and externalize the routing matrix + lesson disambiguation to a new memory anchor `feedback_memory_layer_routing.md`.

**Architecture:** Spec adds one paragraph cross-referencing a new memory file; the matrix lives in memory per v6.11.14's "operational discipline → memory anchors" pattern. Zero new hooks, zero mirroring. Plugin-absent detection uses the LLM's own tool-list visibility (no new automation).

**Tech Stack:** Markdown spec, JSON manifests (package.json, plugin.json, marketplace.json), bash hooks for verification, git + gh CLI for release.

**Spec reference:** `docs/superpowers/specs/2026-05-20-memory-layer-routing-design.md` (commit `87f0d3f`).

**Pre-flight reads (engineer should skim):**
- `spec/CLAUDE-extended.md` lines 510-535 — current §11-EXT Memory operations
- `spec/CLAUDE-changelog.md` lines 1-37 — v6.11.16 entry format (template for v6.11.17)
- Memory `feedback_claudemd_spec_single_source_of_truth.md` — edit `spec/`, not `~/.claude/`
- Memory `feedback_claudemd_ship_from_main_atomic.md` — commit + push + tag + release in one turn
- Memory id #8225 (claude-mem-lite recall) — plugin.json + marketplace.json bump together

---

## File Structure

**Files modified (6, all in repo)**:
- `spec/CLAUDE-extended.md` — +1 paragraph in §11-EXT Layer routing (~250 char)
- `spec/CLAUDE.md` — version header line `v6.11.16` → `v6.11.17`
- `spec/CLAUDE-changelog.md` — prepend v6.11.17 entry (~700 char)
- `package.json` — `"version": "0.17.5"` → `"0.17.6"`
- `.claude-plugin/plugin.json` — `"version": "0.17.5"` → `"0.17.6"`
- `.claude-plugin/marketplace.json` — both `metadata.version` AND `plugins[0].version` `"0.17.5"` → `"0.17.6"` (two occurrences in same file)

**Files created (1, outside repo — durable memory layer)**:
- `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_memory_layer_routing.md` — new memory anchor

**Files modified outside repo (1)**:
- `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/MEMORY.md` — +1 index line

---

### Task 1: Create the memory anchor file

**Files:**
- Create: `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_memory_layer_routing.md`

- [ ] **Step 1: Verify target directory exists**

Run: `ls ~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/ | head -3`
Expected: existing memory `.md` files listed (directory already exists; do NOT mkdir).

- [ ] **Step 2: Write the memory file**

Use the Write tool. Exact contents:

```markdown
---
name: memory-layer-routing
description: which memory content goes to MEMORY.md vs claude-mem-lite plugin; how to detect plugin absence and fall back
metadata:
  type: feedback
---

Memory layer routing (companion to spec §11-EXT Memory operations).

**Why**: spec §11-EXT keeps the 2-line layer table only; this file carries the operational matrix so spec stays under its byte ceiling. Pattern: v6.11.14 "operational discipline → memory anchors" (see [[feedback_macos_shell_portability]]).

## Routing matrix

| Memory kind | Example | Layer | Filename pattern |
|---|---|---|---|
| User profile | "solo OSS maintainer, runs bypassPermissions" | durable | `user_*.md` |
| Behavioral rule | "atomic-ship from main; no /ship skill" | durable | `feedback_*.md` |
| Project fact (compliance / deadline / why) | "merge freeze 2026-03-05 for mobile cut" | durable | `project_*.md` |
| External pointer | "Linear INGEST = pipeline bugs" | durable | `reference_*.md` |
| Bugfix postmortem (recent fix detail) | "v0.9.16 — args.find(startsWith) silent drop" | recall | plugin `mem_save type=bugfix` |
| Activity / state log | "released v0.17.5 today" | recall | plugin (auto via hooks) |

## Lesson disambiguation

"Lesson" overloads two distinct things:

- **Bugfix postmortem** — what broke last week, the specific symptom + cite. Ages out as code changes. → plugin `mem_save`. Skill: `claude-mem-lite:lesson`.
- **Trap rule** — "always/never do X because Y". Survives codebase changes. → MEMORY.md `feedback_*.md`. No plugin write.

**Promotion path**: a recurring bugfix postmortem (cited ≥2 sessions OR caused a regression) → write a `feedback_*.md` trap rule referencing it. The plugin entry can stay; durable layer wins on conflict.

## Plugin-absent detection & fallback

**Detection**: at task entry, scan the tool list for `mem_save` / `mem_search`. Absent → plugin is unloaded for this session. No new hook — the LLM already sees its tool list.

**Fallback (when plugin absent)**:
- Recall-bound content → write to `recall_<topic>_<YYYYMMDD>.md` in durable layer with header `# Recall fallback — plugin absent`. Add MEMORY.md index line with `[fallback]` tag for later sweep / migration.
- Durable content → unchanged (already goes to MEMORY.md).
- On re-detect plugin available: optional migration via `claude-mem-lite import-recall-fallback` (out of scope; not yet shipped).

## What does NOT change

- "One home per fact — double-writing creates drift" still binds. No mirroring between layers.
- MEMORY.md auto-index discipline unchanged: write `*.md`, append one `- [Title](file.md) [tags] — desc` line to MEMORY.md.
- WHAT-NOT-TO-SAVE filter (§11-EXT Layer routing — `git log`-recoverable / code invariant / session-local / clean-root-cause bug) still binds even when user says "save / 记一下 / remember this".
- Auto-memory decision tree (3 steps in §11-EXT) unchanged.

## How to apply

When you reach the "save memory?" decision:
1. Run the 6-month test. Durable → MEMORY.md (pick the row's filename pattern).
2. Recall → plugin if present; else fallback path above.
3. If "lesson" — pick: postmortem (recall) or trap-rule (durable). Never both unless promotion criterion met.

## Trigger words (中英 both)

memory routing, 记忆路由, 哪里存, lesson 存哪, plugin 不在, mem_save, claude-mem-lite, fallback, recall_, 搂底, 分层, layer routing
```

- [ ] **Step 3: Verify file written**

Run: `wc -c ~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_memory_layer_routing.md`
Expected: roughly 2000-2500 bytes (≈ design estimate 1.6 KB + frontmatter + triggers section).

- [ ] **Step 4: No commit yet**

Memory files live outside the repo. No `git add`. Move to Task 2.

---

### Task 2: Add MEMORY.md index line

**Files:**
- Modify: `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/MEMORY.md` (append one line)

- [ ] **Step 1: Read current MEMORY.md tail**

Use Read tool on the file. Confirm the file uses single-line index entries with optional tag syntax `- [Title](file.md) [tags] — desc`.

- [ ] **Step 2: Append new index line**

Use Edit tool. Insert the new line at the end of the index block (after the existing memory entries; preserve any trailing CC built-in entries below). Exact line:

```
- [Memory layer routing — MEMORY.md vs claude-mem-lite](feedback_memory_layer_routing.md) `[layer-routing, mem-routing, plugin-absent, fallback, lesson-disambig, 搂底]` — durable vs plugin recall: routing matrix + lesson disambiguation + plugin-absent fallback to `recall_*.md`
```

(Tags chosen ≥4 chars + topic-specific per v6.11.11 SHOULD; `搂底` preserved for 中文 trigger recall.)

- [ ] **Step 3: Verify tag-specificity**

Manually check: each tag matches v6.11.11 rule (≥4 chars, topic-specific, no generic single-word collisions). `layer-routing` / `mem-routing` / `plugin-absent` / `fallback` / `lesson-disambig` / `搂底` — all topic-specific. (Note: `fallback` is borderline-generic; OK here because the file is literally about fallback behavior.)

- [ ] **Step 4: No commit yet**

Still outside-repo files. Move to Task 3.

---

### Task 3: Patch §11-EXT Layer routing (spec)

**Files:**
- Modify: `spec/CLAUDE-extended.md` (around line 521, "Picking the home" paragraph)

- [ ] **Step 1: Read the target region**

Use Read tool on `spec/CLAUDE-extended.md` lines 510-530 to anchor the edit.

- [ ] **Step 2: Insert fallback paragraph**

Use Edit tool. Match this exact `old_string`:

```
**Picking the home**: "will this be true 6 months from now?" Yes → durable. No → recall plugin. Conflict: durable wins; recall layer ages out.

**User-override filter**
```

Replace with this `new_string` (note: keep two newlines between paragraphs):

```
**Picking the home**: "will this be true 6 months from now?" Yes → durable. No → recall plugin. Conflict: durable wins; recall layer ages out.

**Plugin-absent fallback**: detect via tool list (no `mem_save`/`mem_search` → plugin unloaded). Recall content then writes to `recall_<topic>_<YYYYMMDD>.md` in durable layer with `[fallback]` tag. Routing matrix + lesson disambiguation (bugfix postmortem vs trap rule) → `feedback_memory_layer_routing.md`.

**User-override filter**
```

- [ ] **Step 3: Verify byte delta**

Run: `wc -c spec/CLAUDE-extended.md`
Expected: previous ~44901 → new ~45200 (+~300 bytes). Confirm still under 50000 ceiling.

---

### Task 4: Bump core spec version header

**Files:**
- Modify: `spec/CLAUDE.md` (line 1)

- [ ] **Step 1: Edit the version line**

Use Edit tool. `old_string`:

```
# AI-CODING-SPEC v6.11.16 — Core
```

`new_string`:

```
# AI-CODING-SPEC v6.11.17 — Core
```

- [ ] **Step 2: Confirm only the header line changed**

Run: `git diff spec/CLAUDE.md`
Expected: a single-line diff at line 1, `v6.11.16` → `v6.11.17`. No other changes.

---

### Task 5: Prepend v6.11.17 changelog entry

**Files:**
- Modify: `spec/CLAUDE-changelog.md` (prepend at line 9, before existing `## v6.11.16 — 2026-05-11`)

- [ ] **Step 1: Edit changelog**

Use Edit tool. `old_string`:

```
---

## v6.11.16 — 2026-05-11
```

`new_string`:

```
---

## v6.11.17 — 2026-05-20

Patch: §11-EXT Layer routing — explicit plugin-absent fallback paragraph added; routing matrix + lesson disambiguation externalized to `feedback_memory_layer_routing.md` per v6.11.14 "operational discipline → memory anchors" pattern. No HARD add/remove/downgrade, no behavior change for plugin-present sessions. **§13.2 budget cost: 0 (core), +~300B (extended)**.

### Background

User-observed drift: "lesson" content routing inconsistently between `claude-mem-lite` plugin and durable MEMORY.md. Two root causes — (1) spec assumed plugin present (`e.g. claude-mem-lite`) with no documented fallback; (2) "lesson" overloaded bugfix postmortems (recall) and trap rules (durable). Design rationale: `docs/superpowers/specs/2026-05-20-memory-layer-routing-design.md`.

### Changes

- `[refactor]` **§11-EXT Layer routing +1 paragraph** — "Plugin-absent fallback" paragraph added between "Picking the home" and "User-override filter". Documents tool-list detection (no `mem_save`/`mem_search` → plugin unloaded) and `recall_<topic>_<YYYYMMDD>.md` fallback target with `[fallback]` tag. Cross-refs new memory anchor for the routing matrix.
- `[memory-anchor]` **`feedback_memory_layer_routing.md`** — new memory file carries 6-row routing matrix, lesson disambiguation (bugfix postmortem vs trap rule), promotion path, and `What does NOT change` invariants. Pattern: v6.11.14 macOS-portability externalization.

### Cross-ref preservation

- "One home per fact" rule (§11-EXT) unchanged — no mirroring introduced.
- Auto-memory decision tree (3 steps in §11-EXT) unchanged.
- WHAT-NOT-TO-SAVE filter unchanged.
- §11 core "MEMORY.md read-the-file" HARD rule unchanged — new memory file gains a tagged index line so the rule resolves it correctly.

### Sizing impact

Core unchanged at 24134 bytes (headroom 866B). Extended 44901 → ~45200 bytes (Δ +~300B, headroom 5099B → ~4800B). Both files inside v6.11.14 envelope.

### Migration / agent impact

- Plugin-present sessions: zero behavior change. Agent continues routing per existing rules.
- Plugin-absent sessions: agent now has a documented fallback path instead of silent ambiguity.
- "Lesson" decision: agent has explicit postmortem-vs-trap-rule criterion before save.

---

## v6.11.16 — 2026-05-11
```

- [ ] **Step 2: Confirm changelog parses**

Run: `head -50 spec/CLAUDE-changelog.md | grep -c "^## v6.11"`
Expected: `3` (v6.11.17 + v6.11.16 + v6.11.15 visible in first 50 lines).

---

### Task 6: Bump plugin version (3 files)

**Files:**
- Modify: `package.json` (line 3)
- Modify: `.claude-plugin/plugin.json` (line 4)
- Modify: `.claude-plugin/marketplace.json` (lines 9 + 16 — two occurrences)

- [ ] **Step 1: Bump package.json**

Use Edit tool. `old_string`:

```json
  "version": "0.17.5",
  "description": "Standalone CLI for §10-V banned-vocab + transcript scanning.
```

`new_string`:

```json
  "version": "0.17.6",
  "description": "Standalone CLI for §10-V banned-vocab + transcript scanning.
```

- [ ] **Step 2: Bump plugin.json**

Use Edit tool. `old_string`:

```json
  "name": "claudemd",
  "version": "0.17.5",
  "description": "AI-CODING-SPEC v6.11 HARD-rule enforcement via Claude Code hooks + spec distribution",
```

`new_string`:

```json
  "name": "claudemd",
  "version": "0.17.6",
  "description": "AI-CODING-SPEC v6.11 HARD-rule enforcement via Claude Code hooks + spec distribution",
```

- [ ] **Step 3: Bump marketplace.json (BOTH version fields)**

Use Edit tool with `replace_all: true`. `old_string`: `"version": "0.17.5"`. `new_string`: `"version": "0.17.6"`.

Verify both occurrences updated.

- [ ] **Step 4: Sanity-check the three manifests agree**

Run: `grep -h '"version"' package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json | sort -u`
Expected: exactly one unique line, `"version": "0.17.6",` (with or without trailing comma — all three files agree on 0.17.6).

---

### Task 7: Pre-ship verification

**Files:** (read-only checks)

- [ ] **Step 1: Run repo test suite**

Run: `npm test`
Expected: PASS — tests pass on main (current baseline). If any test fails, STOP and surface the failure; do not ship a red baseline without explicit user "known-red baseline: <reason>" authorization.

- [ ] **Step 2: Spec sizing audit**

Run: `wc -c spec/CLAUDE.md spec/CLAUDE-extended.md`
Expected: core ≤25000 (currently 24134, unchanged this version); extended ≤50000 (was 44901, now ~45200). Both inside ceiling.

- [ ] **Step 3: Git status review**

Run: `git status --short`
Expected: 6 modified files, all in repo, all expected:
```
 M .claude-plugin/marketplace.json
 M .claude-plugin/plugin.json
 M package.json
 M spec/CLAUDE-changelog.md
 M spec/CLAUDE-extended.md
 M spec/CLAUDE.md
```
No untracked files, no unexpected edits.

- [ ] **Step 4: Memory file sanity check (outside repo)**

Run: `ls -la ~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_memory_layer_routing.md`
Expected: file exists with non-zero size (~2KB).

Run: `grep -c "memory-layer-routing\|feedback_memory_layer_routing" ~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/MEMORY.md`
Expected: `1` (the new index line is in MEMORY.md).

- [ ] **Step 5: gh CI baseline (main)**

Run: `gh run list --branch main --limit 1`
Expected: latest run on main is `completed success`. If failed, STOP — investigate before shipping on a red baseline.

---

### Task 8: Atomic ship — commit + push + tag + release

**Files:** (release ceremony — NO new file edits)

> **Atomic-ship rule (per memory `feedback_claudemd_ship_from_main_atomic.md`)**: execute commit + push + tag + push tag + gh release create in one turn. Do NOT stop after commit. Skip the `/ship` skill (its branch-PR flow doesn't apply here).

- [ ] **Step 1: Stage all 6 modified files**

Run:
```bash
git add spec/CLAUDE.md spec/CLAUDE-extended.md spec/CLAUDE-changelog.md \
        package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git status --short
```

Expected: all 6 files shown as `M` (staged), none unstaged.

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
release(v0.17.6): refactor — spec v6.11.17 §11-EXT plugin-absent fallback + memory-layer-routing anchor

§11-EXT Layer routing gets one paragraph documenting plugin-absent
fallback (tool-list detection → recall_<topic>_<DATE>.md with [fallback]
tag). 6-row routing matrix + lesson disambiguation (bugfix postmortem
vs trap rule) externalized to feedback_memory_layer_routing.md per
v6.11.14 "operational discipline → memory anchors" pattern. Zero new
hooks, zero mirroring. Plugin-present sessions: no behavior change.

Design: docs/superpowers/specs/2026-05-20-memory-layer-routing-design.md
Plan:   docs/superpowers/plans/2026-05-20-memory-layer-routing.md
EOF
)"
```

Expected: commit lands; `[main <SHA>] release(v0.17.6)…`. Memory hooks fire (PostToolUse) — that's normal.

- [ ] **Step 3: Push to origin/main**

Run: `git push origin main`
Expected: `main -> main` push completes, no rejection.

- [ ] **Step 4: Tag the release**

Run: `git tag v0.17.6`
Expected: silent success.

- [ ] **Step 5: Push the tag**

Run: `git push --tags`
Expected: `* [new tag] v0.17.6 -> v0.17.6`.

- [ ] **Step 6: Create GitHub release**

Run:
```bash
gh release create v0.17.6 --title "v0.17.6 — spec v6.11.17 plugin-absent fallback" --notes "$(cat <<'EOF'
**Spec v6.11.17 (patch)** — `§11-EXT Layer routing` adds explicit plugin-absent fallback paragraph. Routing matrix + lesson disambiguation (bugfix postmortem vs trap rule) externalized to `feedback_memory_layer_routing.md` per v6.11.14 "operational discipline → memory anchors" pattern.

### What changed

- `spec/CLAUDE-extended.md` — +1 paragraph in `§11-EXT Layer routing` documenting tool-list-based plugin detection and `recall_<topic>_<YYYYMMDD>.md` fallback target.
- `spec/CLAUDE-changelog.md` — v6.11.17 entry with background, change list, sizing impact, and migration notes.
- Plugin version → `0.17.6` (atomic-bump across `package.json`, `plugin.json`, `marketplace.json`).
- New memory anchor `feedback_memory_layer_routing.md` (installs on first session after spec sync).

### Behavior changes

- Plugin-present sessions: none.
- Plugin-absent sessions: documented fallback to `recall_*.md` in durable layer (previously undefined).
- "Lesson" classification: agent now has explicit postmortem-vs-trap-rule criterion.

### Invariants preserved

- "One home per fact — double-writing creates drift" — no mirroring.
- WHAT-NOT-TO-SAVE filter — unchanged.
- Auto-memory decision tree (3 steps) — unchanged.
- Core spec size 24134 bytes (unchanged); extended 45200 bytes (+~300B, headroom ~4800B).

### Upgrade

Existing users: `/plugin update claudemd` then `/claudemd-update` to sync spec to `~/.claude/`.
EOF
)"
```

Expected: `https://github.com/sdsrss/claudemd/releases/tag/v0.17.6` URL printed.

- [ ] **Step 7: CI gate — confirm release workflow green**

Run: `gh run list --branch main --limit 3`
Wait for the v0.17.6 release-tagged run to complete `success`. If `in_progress`, monitor with: `gh run watch <RUN_ID>`.

Expected: latest run `completed success` on the v0.17.6 tag commit.

- [ ] **Step 8: Verify shipped artifact**

Run: `gh release view v0.17.6 --json tagName,name,publishedAt`
Expected: JSON with `tagName: "v0.17.6"`, `name` matching the title, `publishedAt` timestamp present.

---

## Verification recap (Iron Law #2 evidence for the closing REPORT)

When all 8 tasks complete, the closing Done line should cite:
- `spec/CLAUDE-extended.md` byte delta (e.g., `44901 → ~45200B`)
- 6 files modified in the release commit (`git show --stat <SHA>` count)
- `claudemd v0.17.5 → v0.17.6` version coherence across 3 manifests
- New memory file present + indexed (`MEMORY.md` grep count = 1)
- CI workflow `success` on the tag commit (`gh run list` output)
- Release URL (from Step 8)

---

## Self-Review checklist (run after all tasks pass, before closing)

- [ ] **Spec coverage**: every section of `2026-05-20-memory-layer-routing-design.md` mapped to a task?
  - Problem (3 gaps) → Tasks 3 + 1 (spec paragraph + memory file disambiguation)
  - Routing matrix → Task 1 (memory file body)
  - Lesson disambiguation → Task 1
  - Plugin-absent detection & fallback → Task 1 + Task 3 (memory + spec paragraph)
  - Spec patch surface → Tasks 3 + 4 + 5 (extended + core header + changelog)
  - Write targets table → Tasks 1, 2, 3, 4, 5, 6 (all 5 file groups)
- [ ] **Placeholder scan**: no TBD/TODO/placeholder strings in committed files
- [ ] **Type/version consistency**: `0.17.6` appears in exactly 4 places after Task 6 (1× package.json, 1× plugin.json, 2× marketplace.json); `v6.11.17` appears in 2 places (1× CLAUDE.md header, 1× CLAUDE-changelog.md heading)
- [ ] **No mirroring crept in**: grep the memory file for any "also write to" / "mirror" / "duplicate" — should be 0 hits (spec invariant preserved)

If issues, fix and re-verify before claiming Done.
