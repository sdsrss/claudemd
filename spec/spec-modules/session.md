---
module: session
loads-on: in long sessions: context pressure, re-reads, temp retention, macOS shells
triggers: 
trigger-window: head
---

# AI-CODING-SPEC v7.0.0 — module: session

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §1.5-EXT GLOSSARY

Core §1.5 inlines `LOC / Local-Δ / Module / Evidence / Task / Contract / Δ-contract` (used at L1/L2). Terms core does not define, and clarifications:

- **Assumption** — claim not verified this turn via Read/Grep/tool. Memory recall = assumption.

## §7-EXT-TMP TMP_RETENTION policy

**`~/.claude/tmp/` retention**: tool-exhaust, not WIP. Nothing purges it automatically: `/claudemd-clean-residue` reaps entries older than `TMP_RETENTION_DAYS` (default 7; dry-run unless `--apply`), and the residue-audit Stop hook warns when one session grows it by ≥20 entries. No auto-clean without AUTH. Override: project `CLAUDE.md` `TMP_RETENTION_DAYS: 30`.

## §11-EXT Session heuristics (advisory)

SHOULD-level guardrails — apply when condition fires, not Iron Law gates.

- **Redundant Re-Read**: files Read or Written this session don't need re-Read absent external-change signal (user says "pull latest" / commit appears / mtime newer / structural test failure). Unsure → re-read; a third Read on unchanged content is wasted context.
- **Correction pressure**: user rejects ≥2 auto-decisions in one task → switch to ASK-first for remaining sub-decisions. Rejection signals inferred defaults are drifting.
- **Context pressure** (>75% window OR compaction-imminent): (a) prefer fresh-subagent for exploration not requiring main-thread state; (b) compact prose, drop evidential blocks already inline-cited; (c) defer non-critical Re-Read; (d) consider `tasks/<slug>-paused.md` checkpoint before next long tool call.
- **Read-before-propose**: don't propose changes to code you haven't Read or Grep'd this session. §1 Search-before-write covers writes; this covers AUTH-eligible proposals — a `[AUTH REQUIRED]` citing unread code is a false-claim incident.
- **Diagnose-before-pivot**: approach failed once → diagnose (read error, check assumption, focused fix); §6 Three-strike is the upper bound, not the trigger — pivoting too early on a viable approach burns context.
- **Existing-comment protection**: don't remove old comments unless removing the code they describe OR verified them wrong this session. The harness's own default-to-no-new-comments guidance addresses *new* comments, not pruning old.

## §11-EXT-MAC macOS shell portability (cross-ref)

Implementation discipline (BSD-vs-GNU `stat`, `wc -l` padding, missing `timeout`, `mktemp` symlink, exec-bit) is not a spec rule: hook scripts `source` the plugin's `hooks/lib/platform.sh` and call its wrappers — a `command -v` guard alone falls silently false.
