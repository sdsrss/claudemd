# Memory layer routing — design spec

**Date**: 2026-05-20
**Status**: design (awaiting user review → writing-plans)
**Spec version impact**: v6.11.16 → v6.11.17 (patch)
**Plugin version impact**: claudemd v0.17.5 → v0.17.6 (patch, atomic-ship)
**Classification**: L3 (LLM-visible metadata — `~/.claude/CLAUDE-extended.md`)

## Problem

`§11-EXT Memory operations` already defines two layers (durable MEMORY.md vs
`claude-mem-lite` plugin recall) and a 6-month routing test. In practice we
observed "lesson" content drifting between layers session to session. Three
gaps:

1. **No plugin-absent fallback** — spec assumes the plugin exists (`e.g.
   claude-mem-lite`). No documented behavior when tool list lacks `mem_*`.
2. **"Lesson" is overloaded** — both bugfix postmortems (transient) and trap
   rules (durable) end up labeled "lesson", so the 6-month test alone is
   insufficient to decide layer.
3. **Concrete category → file pattern map missing** — `user_*` / `feedback_*`
   / `project_*` / `reference_*` prefixes are mentioned in CC's built-in memory
   prompt but never restated alongside the layer table, so the decision
   "which prefix" requires loading CC core memory prompt detail every time.

## Non-goals (YAGNI)

- No new hooks. Plugin detection uses the LLM's own tool list.
- No mirroring. "One home per fact" still binds.
- No automated migration tool for `recall_*` fallback files when plugin returns
  (left as future work; manual `claude-mem-lite import-recall-fallback` if it
  ever ships).
- No PostToolUse validator for `mem_save` calls (Approach C, rejected — heuristic
  mis-warns too high).

## Mental model (no change, made explicit)

```
┌─ Durable layer ───────────────────────────────┐
│ ~/.claude/projects/<encoded-cwd>/memory/      │  SessionStart auto-injects
│   MEMORY.md (index) + *.md (4 types)          │  → always in LLM context
│   user_* / feedback_* / project_* / reference_*│
└───────────────────────────────────────────────┘

┌─ Recall layer ────────────────────────────────┐
│ claude-mem-lite plugin (FTS5 + timeline)      │  LLM must call mem_search /
│   mem_save / mem_search / mem_recall / ...    │  mem_recall to retrieve
└───────────────────────────────────────────────┘
```

**Decision criterion (unchanged)**: "Will this be true 6 months from now?"
Yes → durable. No → recall.

**Read order (clarification, not change)**: MEMORY.md is *always* read first
because SessionStart injects it. Plugin only enters context when the LLM
explicitly queries. The user's framing "plugin first, MEMORY.md fallback" was
inverted — durable IS the default-read layer; plugin is the on-demand
supplement.

## Routing matrix

Lives in a new memory file `feedback_memory_layer_routing.md`, NOT in the
spec, per the v6.11.14 pattern of moving operational discipline out of the
byte-capped spec into memory anchors.

| Memory kind | Example | Layer | Filename pattern |
|---|---|---|---|
| User profile | "solo OSS maintainer, runs bypassPermissions" | durable | `user_*.md` |
| Behavioral rule | "atomic-ship from main; no /ship skill" | durable | `feedback_*.md` |
| Project fact (compliance / deadline / why) | "merge freeze 2026-03-05 for mobile cut" | durable | `project_*.md` |
| External pointer | "Linear INGEST = pipeline bugs" | durable | `reference_*.md` |
| Bugfix postmortem (recent fix detail) | "v0.9.16 — args.find(startsWith) silent drop" | recall | plugin `mem_save type=bugfix` |
| Activity / state log | "released v0.17.5 today" | recall | plugin (auto via hooks) |

## Lesson disambiguation

"Lesson" overloads two distinct things. The new memory file separates them:

- **Bugfix postmortem** — what broke last week, the specific symptom + cite.
  Ages out as code changes. → plugin `mem_save`.
  Skill: `claude-mem-lite:lesson`.
- **Trap rule** — "always/never do X because Y". Survives codebase changes.
  → MEMORY.md `feedback_*.md`. No plugin write.

**Promotion path**: a recurring bugfix postmortem (cited ≥2 sessions OR caused
a regression) → write a `feedback_*.md` trap rule referencing it. The plugin
entry can stay; durable layer wins on conflict.

## Plugin-absent detection & fallback

**Detection**: at task entry, scan the tool list for `mem_save` /
`mem_search`. Absent → plugin is unloaded for this session. No new hook — the
LLM already sees its tool list.

**Fallback (when plugin absent)**:

- Recall-bound content → write to `recall_<topic>_<YYYYMMDD>.md` in the
  durable layer with header `# Recall fallback — plugin absent`. Add MEMORY.md
  index line with `[fallback]` tag for later sweep / migration.
- Durable content → unchanged (already goes to MEMORY.md).
- On re-detect plugin available: optional migration via
  `claude-mem-lite import-recall-fallback` (out of scope for this design).

## What does NOT change

- "One home per fact — double-writing creates drift" still binds. **No
  mirroring** between layers.
- MEMORY.md auto-index discipline unchanged: write `*.md`, append one
  `- [Title](file.md) [tags] — desc` line to MEMORY.md.
- WHAT-NOT-TO-SAVE filter (§11-EXT Layer routing — `git log`-recoverable /
  code invariant / session-local / clean-root-cause bug) still binds even
  when the user says "save / 记一下 / remember this".
- Auto-memory decision tree (3 steps in §11-EXT) unchanged.

## Spec patch surface (the actual diff)

**Only one edit to `spec/CLAUDE-extended.md` §11-EXT Layer routing**:

```diff
 **Picking the home**: "will this be true 6 months from now?" Yes → durable. No → recall plugin. Conflict: durable wins; recall layer ages out.

+**Plugin-absent fallback**: recall content writes to `recall_<topic>_<YYYYMMDD>.md` in durable layer with `[fallback]` tag. Routing matrix + lesson disambiguation (bugfix postmortem vs trap rule): see `feedback_memory_layer_routing.md`.
+
 **User-override filter** ...
```

Byte impact: core unchanged; extended +~250 char (well within 50KB ceiling,
current 44.9 KB / 5.1 KB headroom).

## Write targets

| # | File | Action | Estimated bytes |
|---|------|--------|---|
| 1 | `spec/CLAUDE-extended.md` (project plugin source-of-truth) | +1 paragraph in §11-EXT | ~250 char |
| 2 | `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_memory_layer_routing.md` | new file | ~1.6 KB |
| 3 | `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/MEMORY.md` | +1 index line | ~120 char |
| 4 | `spec/CLAUDE-changelog.md` | +v6.11.17 entry | ~400 char |
| 5 | `package.json` / `plugin.json` / `marketplace.json` (claudemd plugin) | bump v0.17.5 → v0.17.6 | ~30 char |

Per project memory `feedback_claudemd_spec_single_source_of_truth.md`: spec
edits go through the plugin source-of-truth (`spec/CLAUDE-extended.md`),
NOT directly `~/.claude/CLAUDE-extended.md`. The `/claudemd-update` command
syncs after install.

## Dataflow

```
[session start]
  ├─ SessionStart hook → MEMORY.md auto-inject → LLM context
  │    (includes `[layer-routing]` tag pointing at feedback_memory_layer_routing.md)
  └─ LLM scans tool list for mem_*
      ├─ present → plugin available (default)
      └─ absent  → plugin missing → fallback active

[LLM decides to save memory]
  Run 6-month test
    ├─ durable → MEMORY.md *.md (pick prefix per routing matrix)
    └─ recall  → if plugin present: mem_save
                 if plugin absent:  recall_<topic>_<DATE>.md [fallback]

[LLM reads memory]
  - durable content already in context (auto-inject)
  - task keywords match a tagged MEMORY.md line → Read the file
  - want recent activity / past bugfix → mem_search / mem_recall
```

## Verification

- `scripts/lib` already runs spec byte-budget checks at ship time — will
  surface the +250 char change in Sizing line.
- New memory file: after writing, `claude-mem-lite recent` should NOT include
  it (durable layer; plugin only sees its own observations).
- MEMORY.md +1 line: `claudemd-doctor` MEMORY.md tag-specificity check passes
  if `[layer-routing]` is ≥4 chars + topic-specific (it is).
- No hook tests required (no hook added).

## Testing

Manual smoke tests:

1. Save a `feedback_*` memory in a follow-up session — confirm it lands in
   `~/.claude/projects/<encoded-cwd>/memory/` (durable), not in plugin.
2. Save a bugfix postmortem (e.g., today's hook fix) — confirm it lands in
   plugin (`claude-mem-lite recent` shows it).
3. Disable plugin in `~/.claude/settings.json`, restart session — confirm LLM
   notices tool absence (via tool list scan) and writes recall fallback to
   `recall_*.md` in durable layer.

(3) is the only one that exercises new behavior; (1) and (2) confirm
no-regression.

## Open questions / known limits

- The "promotion criterion" for postmortem → trap-rule (`≥2 sessions OR
  caused a regression`) is judgment-based, not enforced. If drift recurs,
  consider a quarterly `/claudemd-audit` sweep that flags plugin entries
  recalled ≥2× as promotion candidates.
- `recall_<topic>_<DATE>.md` fallback files have no automatic cleanup. If
  plugin returns, files accumulate. Mitigation: `[fallback]` tag makes them
  greppable; manual cleanup or future `import-recall-fallback` command.

## Cross-references

- Pattern source: `feedback_macos_shell_portability.md` (v6.11.14 — moved
  out of spec into memory anchor).
- Single-source-of-truth: `feedback_claudemd_spec_single_source_of_truth.md`.
- Atomic-ship convention: `feedback_claudemd_ship_from_main_atomic.md`.
- Existing related memory: `feedback_brainstorm_for_design_tasks.md` (this
  doc's authorship process).
