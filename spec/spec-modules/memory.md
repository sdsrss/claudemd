---
module: memory
loads-on: when saving, recalling or tagging memory
triggers: 记住|记下来|(?<![A-Za-z0-9_])remember (this|that)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])mem_save(?![A-Za-z0-9_])
trigger-window: head
---

# AI-CODING-SPEC v7.2.0 — module: memory

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

**User-override filter** (extends CC built-in `## What NOT to save`): WHAT-NOT-TO-SAVE list (`git log`-recoverable / code invariant / session-local / clean-root-cause bug) applies even when user says "save / 记一下 / remember this". Activity logs, PR rundowns, step lists, deploy walkthroughs lower signal density. Compliance = ASK what was *surprising* or *non-obvious*, save only that.

### Auto-memory decision tree (top-down, first match wins)

**Step 1 — Global-state hard** (MUST any level, skip judgment): `~/.claude/` writes across ≥2 files in one task (plugin install/uninstall / settings migration / marketplace edits / statusline / hook / MCP config) → save `project`/`feedback` memory naming what + why. **Self-describing artifact exemption**: edit produces durable in-artifact "what + why" a future session can grep without loading memory (versioned spec with `## Recent changes` / `CHANGELOG.md` / migration comment) → skip `mem_save`. Test: opaque state (plugin / marketplace JSON / hook / MCP) fails the test, still save.

**Step 2 — L2+ retrospective** (MUST L2+, overrides Step 3): (a) preventable-error pattern (>2 wasted tool iterations OR hypothesis falsified in a reusable way), OR (b) non-default decision / non-obvious sequencing (spec-skill conflict resolved with non-default tradeoff, OR ship/release/env step not derivable from docs). Body: `[context]` + `[what to do differently]` + `[trigger words]`, ≤8 lines.

**Step 3 — Judgment** (L0/L1, and L2+ when Steps 1-2 miss): durable project artifact (overview / phase / plan / retrospective / completion) whose insight would have changed a decision this session AND has ≥1 future-reuse probability → save; else skip.

**Always skip regardless of step**: `git log`-recoverable, code invariant (→ inline comment), session-local (→ `tasks/`), clean-root-cause bug (→ `mem_save` bugfix type, not this tree).


### MEMORY.md tag syntax

- Optional `- [Title](file.md) [tag1, tag2] — description`. Agent matches task keywords against tags before Read.
- **Untagged lines** = agent-driven full content scan from title/description; hook does NOT auto-block.
- **Tag specificity (SHOULD)**: tags ≥4 chars AND specific to the topic. Avoid generic single-word EN tags (`hook` / `plugin` / `test` / `cli` / `audit` / `done` / `spec` / `ship` when memory not actually about ship-flow) that substring-match incidental occurrences. Prefer multi-word phrases (`hook-fail-open` / `cli-flag-shape` / `audit-pipeline-filter`). The hook applies word-boundary matching with 0-2 char declension tolerance (`hook` → `hooks` / `hooked`; `cli` ≠ inside `clippy`); generic exact-word tags still fire — fix at authoring time.
- Rule of thumb: if removing the tag wouldn't change agent's decision quality on a typical command match, the tag is too generic.
- **Ship-runbook consolidation (SHOULD)**: per project, ship-trigger tags (`ship / release / deploy / 发布 / 发版 / 打tag`) belong to exactly ONE memory file — the project's ship runbook, holding the full release flow (pre-ship checks → atomic steps → post-ship). Flow changes edit that file; other ship-adjacent lessons keep their topical tags and get `[[links]]` from the runbook instead of own ship tags. Effect: §11 read-the-file at ship costs one predictable Read instead of tag fan-out.
