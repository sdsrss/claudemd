# ~/.claude/tmp retention automation (deferred, 2026-07-10)

## Context (measured)

- 2026-07-10 manual purge with user AUTH: `~/.claude/tmp` 550M → 197M; deleted 4706 top-level entries + 451 `claude-1000/` children, all `mtime > 7d` (`find -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} +`, the exact command `residue-audit.sh:50` already recommends).
- Root cause of accumulation is a GC gap, NOT the §8 hook: telemetry shows 715 `rm-rf-allow-validated` vs 206 `deny` vs 15 `bypass-escape-hatch` for `§8-rm-rf-var` — the guard path works and is used. Nothing implements spec §EXT §7-EXT:511 ("harness SHOULD purge mtime > 7d"; `TMP_RETENTION_DAYS` override), so harness session scratchpads / worktree fixtures / old plugin exhaust (`gsd-errcode-*`, `hook-ctx-test-*`) pile up.

## Candidate (next minor)

Extend `/claudemd-clean-residue` (command + consent, dry-run default — same shape it already has for `$TMPDIR`) to also purge `~/.claude/tmp` entries with `mtime > TMP_RETENTION_DAYS` (default 7, project-CLAUDE.md override per §7-EXT).

## Explicit non-goals

- NO SessionStart auto-clean: §7-EXT says "no auto-clean without AUTH"; design-adopt v0.24.0 lesson — silent heuristics are bug magnets, prefer command+consent.
- NO safe-path carve-out for `~/.claude/tmp` in `pre-bash-safety-check.sh`: literal-path rm already passes; guarded/`[allow-rm-rf-var]` var rm already passes; a prefix allow-rule would open a traversal FN (`rm -rf ~/.claude/tmp/$X` with `X=../..`) and §8 is never-downgrade. Run the FN matrix before any §8 edit (feedback_s8_false_negative_audit).
