---
name: claudemd-design-adopt
description: Generate a thin, fact-based DESIGN.md from a UI project's real design-token sources and wire it into project CLAUDE.md. Use when (1) the user asks to configure design specs / 配置设计规范 / 设计规范 for agents, (2) UI sessions keep inventing colors or spacing instead of using the project's existing tokens, (3) a UI project (Vue/React/Svelte/Nuxt/Astro + a component lib or Tailwind/UnoCSS/SCSS) has design tokens but no DESIGN.md guiding agents. Modes - check (verify pointers), remove (unwire). Never invents design values - every generated line must trace to a detected file.
---

Usage: `/claudemd-design-adopt` | `/claudemd-design-adopt check` | `/claudemd-design-adopt remove`

## Step 0 — detect (deterministic)

Run: `node ${CLAUDE_PLUGIN_ROOT}/scripts/design-detect.js --json` (add `--cwd=PATH` to target another dir). The detector is stateless — it reads the filesystem and prints a verdict, writing nothing.

- `no-ui` / `ui-no-tokens` → report one line (`nothing to adopt: <verdict>`) and STOP. Never create DESIGN.md for a token-less project — generation would require inventing values, which this command forbids.
- `configured` → report "already wired" + the DESIGN.md path. Offer `check` instead; regenerate only if the user explicitly asks.
- `adoptable` / `unwired` → continue.
- `error` → report the failure; do not write anything.

## `check` mode (no writes)

Read the existing DESIGN.md; for every repo-file reference in it, verify the file exists. Report resolvable vs broken pointers, then STOP.

## `remove` mode

Delete the `<!-- claudemd-design:begin` … `<!-- claudemd-design:end -->` block from project CLAUDE.md (everything else untouched; show the diff first). Do NOT delete DESIGN.md — report that it stays for the user to remove.

## Step 1 — read the real sources

Read every `tokenSources[].path` from step 0 (first ~200 lines each), plus — when present — whatever injects them (vite `css.preprocessorOptions.additionalData`, tailwind `content`, the `main.*` style import chain). You are extracting FACTS: token names, semantic-color variables, spacing scale, radii, fonts, dark-mode mechanism, reusable mixins / utility classes, contrast annotations.

## Step 2 — draft DESIGN.md (thin pointer, facts only)

Contract — every line must trace to something Read in step 1:

1. **Header**: values live in the source files ("以 `<file>` 为准"); DESIGN.md never duplicates full value tables (single source of truth, no drift).
2. **事实源与加载机制**: each token-source path + its load mechanism *only if verified* (e.g. vite `additionalData` global injection ⇒ "`$vars`/mixins are available in every SFC — do not `@use` the file again").
3. **硬规则 — evidence-gated menu.** Include ONLY rules whose evidence appeared in step 1:
   - semantic color variables exist → "use semantic vars, never hardcode hex"
   - dark-mode signals → name the mechanism (`html.dark` / `prefers-color-scheme` / `darkMode: 'class'`) + "develop and verify in that theme"
   - spacing tokens (≥4) → grid rule stating the actual base (e.g. 8px multiples)
   - mixin / utility inventory → reuse-first rule listing the real names
   - mono font token → "numeric columns use the mono token"
   - WCAG / contrast comments → "contrast annotations are commitments; keep them true"

   No rule without its evidence. No generic boilerplate — naming conventions, import order, commit rules do NOT belong in DESIGN.md.
4. **Identity table** (≤8 rows) of parsed brand values, with the "values live in `<file>`" disclaimer.
5. **Domain color semantics are not derivable** (e.g. finance 红涨绿跌): append `<!-- TODO: 领域色彩语义（如涨跌色）请人工确认 -->` — unless a source comment states the rule, in which case cite it.

Write the doc in the language of the project's existing CLAUDE.md (fall back to the user's language).

## Step 3 — wire CLAUDE.md (sentinel block, idempotent)

Insert — or replace, if a prior block exists — next to the project's CLAUDE.md content:

```
<!-- claudemd-design:begin v1 -->
## Design context
- Token source of truth: <paths> — read before any UI change; entry point: `DESIGN.md`.
- <top 1–2 hard rules from step 2>
<!-- claudemd-design:end -->
```

No CLAUDE.md → create one containing only this block. Placement: repo root; when step 0 reported `monorepoPkg`, put DESIGN.md in that package root and the block in the CLAUDE.md nearest to it.

## Step 4 — consent gate (always)

Show the full DESIGN.md draft + the CLAUDE.md diff BEFORE writing, ask once, then write both files in the same turn. This gate applies even under `AUTONOMY_LEVEL: aggressive` — these files steer every future session (LLM-visible context).

## Step 5 — verify + report

Re-run `node ${CLAUDE_PLUGIN_ROOT}/scripts/design-detect.js --json` and cite `verdict: configured` as the completion evidence. Report: files written, token sources cited, rules included vs skipped (with the missing-evidence reason), and whether the domain-semantics TODO was left for the user.
