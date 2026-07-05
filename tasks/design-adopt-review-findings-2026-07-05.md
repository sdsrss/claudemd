# design-adopt (v0.24.0) — max-review findings

- **Date**: 2026-07-05
- **FINAL STATUS**: **PIVOTED TO COMMAND-ONLY after 2 adversarial max reviews (15 findings each).** The SessionStart auto-hint was the bug magnet (cache/pending collisions, races, FP nagging, residue) — it was **cut**. The detector is now stateless + command-only; the human's diff+consent gate is the safety net. Detector-core findings all fixed with regression tests. Full suite 542 pass; detector verified stateless. See the ROUND-2 OUTCOME section below for the per-finding disposition. Ship: pending user go.
- **Round-1 review**: `/code-review` max (39 agents, 2.95M tok). 40 verified, 0 refuted, 15 root causes.

## ROUND-2 RE-REVIEW OUTCOME (2026-07-05)

Round-1 fixes were re-reviewed adversarially (max, 40 findings, 0 refuted, 15 kept). **No round-1 finding regressed** — the hot-path redesign held. But the fix pass exposed 15 more, concentrated in the SessionStart auto-hint (cwd-encoding collision serving wrong verdicts #335; `--emit-file` rmSync data loss #412; two-tab emit race #200; stale post-adoption hint #198; unstable show-once signature #340; unbounded state residue; background re-pay #312) plus detector-core bugs (nested interpolation #196; unterminated comment #191; digit/underscore props #199; monorepo cross-package misattribution #247; `site/` fixed-name FP #143; wiring-basename FP #291; deep-CSS read-cap #266).

**Resolution — PIVOT TO COMMAND-ONLY (user decision).** Rather than keep hardening a silently-firing heuristic (2 rounds × 15), the SessionStart auto-hint + cache + pending statefile + `--emit-file` were all **deleted**. The detector is now stateless and runs only from `/claudemd-design-adopt`. This designs out the ENTIRE hint-path class — #335, #412, #200, #198, #340, residue, #312 all gone by deletion. Detector-CORE findings fixed with regression tests: #196 (fixed-point interpolation strip + brace-depth scan), #191 (unterminated-comment strip), #199 (`--[\w-]+` prop regex), #247 (walk anchored at the UI subproject, never siblings), #143 (fixed-name list narrowed to frontend|web|client), #291 (wiring requires DESIGN.md ref or sentinel), #266 (token-named CSS read first). Round-1 #8/#297 stdin concerns: gone — hook reverted to HEAD. New fixtures: nested-interp, digit-props, unterminated-comment, backend-site, monorepo-siblingtokens.

---

## Round-1 resolution notes (historical — superseded by the command-only pivot above)

## Resolution summary (2026-07-05)

Hot-path class (#1/#2/#7/#8) — **redesigned**: SessionStart no longer spawns node synchronously. Two-phase in `session-start-check.sh`: `design_hint_emit` (sync, ms-class jq on a pending statefile, joins the single-object merge) + `design_hint_refresh` (detached, all fds → /dev/null, spawns `design-detect.js --emit-file` for next session). Measured hook synchronous path on a UI cwd: **0.03s** (was: up-to-3s macOS stall). Stdin read guarded with `[ -t 0 ]` (#8). Feature-dead kills: `pathToFileURL` main guard (#3), meta-frameworks added (#11). Detector correctness: monorepo+subproject wiring read full CLAUDE.md (#4/#14), cache watches subproject pkg + token files + 7d TTL (#5), multi-root walk from subproject (#9), filter-dirs-before-cap (#10), `:root`+`@theme` block parse comment-stripped + SCSS-interpolation-safe (#12/#13 + interpolation regression caught via daagu), FIFO isFile-guard (#6). Deferred + documented: Tailwind v4 now COVERED (#12 fixed, not deferred); cwd-encoding show-once collision (#15) documented in CHANGELOG known-limitations. Tests: design-detect.test.js 10→21, session-start.test.sh 14→19 cases.

- Two firing memory lessons corroborate: [[feedback_macos_shell_portability]] (#1 macOS timeout), [[feedback_cc_cwd_encoding_dots]] (#15 cwd-encoding collision).

## Blockers — must fix before any ship

### SessionStart hot-path safety class (violates core "never block/delay a session" invariant)
1. **session-start-check.sh:176** — `out=$(platform_timeout 3 node design-detect.js …)`: on stock macOS w/o coreutils the bash-watchdog fallback's orphaned `sleep 3` holds the `$()` pipe open after node exits → **every** session start in **every** package.json project stalls the full 3s (measured 3002ms). Not 24h-gated like upstream_check.
2. **session-start-check.sh:229-230** — third serialized `$(platform_timeout 3 …)` before the single merged emit can push the manifest-match branch past the 5s `hooks.json` timeout (upstream 3s + design 3s). CC kills the hook before `printf|jq -s` runs → upgrade banner + summary banner + design hint **all silently dropped**, AND their one-shot state is already consumed (upstream sentinel touched, summary mv'd to `.last-shown`, hintedSig burned).
7. **design-detect.js:236** — cache written only at the very end (after walk + ≤60×64KB reads); if the walk exceeds the 3s timeout the process is killed pre-memoization → every future session re-pays the full 3s (any OS). MAX_DIRS caps dirs, not entries/dir.
8. **session-start-check.sh:24** — the EVENT hoist made `EVENT=$(cat)` unconditional (HEAD gated it behind `[[ -z SESSION_ID ]] && command -v jq`); now the hook blocks on stdin EOF even when `CLAUDE_SESSION_ID` is set or `jq` absent → hangs on manual probe / any runner with an open tty stdin.

### Whole-feature-dead silent kills
3. **design-detect.js:300** — main guard `import.meta.url === \`file://${process.argv[1]}\`` compares percent-encoded vs raw; any plugin-root path with a space / `%` / non-ASCII → script prints nothing, exit 0, no JSON → hint + `/claudemd-design-adopt` Step 0 dead with no telemetry. Fix: `pathToFileURL(process.argv[1]).href`.
11. **design-detect.js:30** — `FRAMEWORK_PRIORITY` only matches direct deps; Nuxt 3 / Astro (vue/react transitive) verdict `no-ui` → feature no-ops for the exact Vue ecosystem it targets. (Note `.nuxt`/`.output` are already in SKIP_DIRS — walk intends to cover Nuxt.)

## Correctness — should fix
4. **design-detect.js:222** — `claudeMdRef` reads only root CLAUDE.md, but `commands/claudemd-design-adopt.md:61` tells the agent to wire the sentinel into the monorepo package's CLAUDE.md → doc-compliant monorepo adoption can never reach `configured`; Step 5's required evidence unattainable; next session re-arms an "never references" hint that is false. (`designMd` at :217-218 IS monorepo-aware; asymmetric.)
5. **design-detect.js:167** — cache key = only root package.json/CLAUDE.md/DESIGN.md; subproject package.json + token-file changes never invalidate; spec'd 7d TTL dropped → stale `no-ui`/`ui-no-tokens` persists indefinitely (incl. the fullstack-split motivating shape).
9. **design-detect.js:130** — walk anchors MAX_DEPTH=4 at repo root even when `monorepoPkg` is known → tokens at `packages/<pkg>/src/assets/styles/` (depth 5) never found. verdict `ui-no-tokens` for the primary monorepo audience.
6. **design-detect.js:62** — `readHead` uses blocking `openSync` (no O_NONBLOCK, no stat guard); a FIFO matching a scanned name (or a FIFO CLAUDE.md, read unconditionally) hangs forever — command path has NO timeout wrapper.
13. **design-detect.js:207** — css-custom-props gates on bare `/:root/` substring anywhere in the 64KB head, then counts `--prop:` across the WHOLE file → component-scoped props + `:root` in a comment falsely qualify (reproduced: `.btn`-scoped props + `/* …:root… */` → adoptable). Violates never-false-positive posture; feeds wrong DESIGN.md.
14. **design-detect.js:222** — wiring check via `readHead` (64KB) → a sentinel block appended to a >64KB CLAUDE.md (exactly where adopt inserts it) is invisible → `unwired` despite being wired.
10. **design-detect.js:107** — `entries.slice(0,50)` caps raw dirents BEFORE the `isDirectory()` filter → files consume the 50-package budget; UI package past index 50 missed. Filter-then-cap.

## Reasonable v1 gaps — document, don't necessarily fix now
12. **design-detect.js:206** — Tailwind v4 CSS-first (`@theme`, no `tailwind.config.*`, no `:root`) entirely undetected → `ui-no-tokens`. Tailwind v4 is current major (Jan 2025).
15. **design-detect.js:247** — `cacheFile()` encodes non-`[a-zA-Z0-9-]`→`-`; sibling checkouts differing only by `.`/`_`/`/` share one cache file; (mtime,size) keys keep verdicts correct but `hintedSig` show-once marker is inherited → 2nd project never sees the hint. Narrow.

## 10 lower-severity findings cut at cap (per review summary)
two-tab cache race; README/CHANGELOG "no node spawn" cost-model mismatch (the hint DOES spawn node); this spec-file's drift-log omission; `--no-cache` still writes hintedSig; PLAUSIBLE platform.sh-absent guard; per-session spawn overhead; test/emit-shape cleanups.

## Recommended path (pending user decision)
Redesign the SessionStart integration to **background the detection + emit the hint next session** (the existing `session-summary` → `last-session-summary.json` pattern) — this kills the entire hot-path class (#1/#2/#7/#8) because the sync part becomes a ms-class statefile read. Then fix the isolated detector bugs (#3/#4/#6/#9/#10/#11/#13/#14) with tests, add cache subproject-key + TTL (#5), document #12/#15. Re-review before ship. Full findings JSON: `~/.claude/tmp/.../tasks/wzwlqh4sr.output` (session-scoped).
