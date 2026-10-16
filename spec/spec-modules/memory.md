---
module: memory
loads-on: when saving, recalling or tagging memory
triggers: 记住|记下来|(?<![A-Za-z0-9_])remember (this|that)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])mem_save(?![A-Za-z0-9_])
trigger-window: head
---

# AI-CODING-SPEC v8.1.0 — module: memory

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §11-EXT-MEM Memory operations

One home per fact — double-writing creates drift.

**Terminology**: `claude-mem-lite` = the recall-layer plugin only (FTS5 / timeline / `[mem]` prefix); `MEMORY.md` / **durable layer** = CC built-in 4-type memory only. Avoid bare `mem` in new spec text or hook output — ambiguous between the two layers. Existing identifiers carrying `mem` are scoped: plugin tool/CLI names `mem_save / mem_search / mem_recall / mem_recent` refer to the plugin; `mem-audit.sh` / `mem-audit` in hook telemetry refer to the claudemd Stop hook over the durable layer.

### Layer routing

| Layer | Path | Time horizon | Use for |
|---|---|---|---|
| **Durable (CC built-in 4 types)** | `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md` + `*.md` | session-spanning | user role / preference / cross-session lessons / project-permanent decisions |
| **Time-sensitive recall plugin** (e.g. `claude-mem-lite` FTS5 + timeline) | plugin-managed | days–weeks, rolls off | bugfix lessons / current-project state / recent activity |

**Picking the home**: "will this be true 6 months from now?" Yes → durable. No → recall plugin. Conflict: durable wins; recall layer ages out.

**Plugin-absent fallback**: detect via tool list (no `mem_save`/`mem_search` → plugin unloaded). Recall content then writes to `recall_<topic>_<YYYYMMDD>.md` in durable layer with `[fallback]` tag.

**Body-structure scope**: `mem-audit` Stop hook scans `feedback_*.md` only for `**Why:**` / `**How to apply:**` body markers. `project_*.md` exempt — the incident-log pattern (`project_<topic>_<date>.md`) is fact-only by nature; the hook does not warn when authors omit Why/How there.

### Save triggers (core §11 Memory)

- **Global state** (MUST, any level): a task writes ≥2 files under `~/.claude/` (plugin install / settings / marketplace / statusline / hook / MCP config) → save what + why. Exempt only when the edit leaves a greppable what + why in the artifact itself (a versioned spec's `## Recent changes`, `CHANGELOG.md`, a migration comment); opaque state (plugin / marketplace JSON / hook / MCP config) is never exempt.
- **Lesson body** (a `feedback_*` save): the harness's **Why:** and **How to apply:** lines plus the trigger words a later task would search for, ≤8 lines.
- **Never**: what `git log` recovers, a code invariant (→ a comment), task-local state (→ the spec file), a clean-root-cause bug (→ the recall plugin's bugfix type).

### MEMORY.md tag syntax

- Optional `- [Title](file.md) [tag1, tag2] — description`. Agent matches task keywords against tags before Read.
- **Index line ≤150 characters**: title, tags, one-line hook. `MEMORY.md` loads every session; the detail belongs in the file, and `/claudemd-doctor` flags longer lines.
- **Untagged lines** = agent-driven full content scan from title/description; hook does NOT auto-block.
- **Tag specificity (SHOULD)**: tags ≥4 chars AND specific to the topic. Avoid generic single-word EN tags (`hook` / `plugin` / `test` / `cli` / `audit` / `done` / `spec` / `ship` when memory not actually about ship-flow) that substring-match incidental occurrences. Prefer multi-word phrases (`hook-fail-open` / `cli-flag-shape` / `audit-pipeline-filter`). The hook applies word-boundary matching with 0-2 char declension tolerance (`hook` → `hooks` / `hooked`; `cli` ≠ inside `clippy`); generic exact-word tags still fire — fix at authoring time.
- Rule of thumb: if removing the tag wouldn't change agent's decision quality on a typical command match, the tag is too generic.
- **Ship-runbook consolidation (SHOULD)**: per project, ship-trigger tags (`ship / release / deploy / 发布 / 发版 / 打tag`) belong to exactly ONE memory file — the project's ship runbook, holding the full release flow (pre-ship checks → atomic steps → post-ship). Flow changes edit that file; other ship-adjacent lessons keep their topical tags and get `[[links]]` from the runbook instead of own ship tags. Effect: §11 read-the-file at ship costs one predictable Read instead of tag fan-out.
