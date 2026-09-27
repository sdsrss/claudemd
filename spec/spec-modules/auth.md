---
module: auth
loads-on: before deleting files, and for AUTONOMY_LEVEL or public-API questions
triggers: 
trigger-window: head
---

# AI-CODING-SPEC v6.36.0 — module: auth

<!-- generated from spec/CLAUDE-extended.md by scripts/build-spec-modules.js; edit the source, then rebuild -->

## §5-EXT Safe-paths whitelist (detail)

Strict prefix match (NOT glob):

- `tmp/**`
- `node_modules/**`
- `dist/**`
- `build/**`
- `.cache/**`
- `coverage/**`
- `.next/**`
- `.nuxt/**`
- `target/debug/**`
- `target/release/**`
- `__pycache__/**`
- `.pytest_cache/**`

**NEVER-covers** (hard AUTH even when the path matches a prefix above):

- a path reached through a `..` component — the prefix certifies where it points, not where a walk from it lands
- anything under `.git/`
- a path whose resolution leaves the project root (symlink included — delete the link, not through it)
- a bare prefix with no subpath (`dist/`, not `dist/bundle.js`)
- a path that is itself a §5 Hard subject OTHER than the delete — `.env`/secret/config schema, migration/DB schema, CI/deploy/infra config, `~/.claude/settings.json` / user-global hooks / MCP config. Closed set, and the exclusion is load-bearing: `delete file/dir` is §5 Hard's first item, so a clause reading "anything §5 Hard names" would swallow the safe-path carve-out whole

**`SAFE_DELETE_PATHS:` extension rule**: a project `CLAUDE.md` MAY add prefixes. Bounds, all of them:

- project-root-relative directory prefixes only — no absolute path, no `~`, no `..`, no glob
- an entry covering a NEVER-covers item is ignored, not honoured — the project file extends the list, it cannot raise its ceiling
- effective only for the project declaring it

§3 names this one of three channels that move a §5 AUTH gate; these bounds are what keeps it a channel rather than an opening.

## Appendix B — Canonical examples


### B.1 `[AUTH REQUIRED]`

```
[AUTH REQUIRED op:refactor-event-bus scope:src/events/*,src/orders/*,src/billing/*,src/notifications/* risk:4-module-contract-change-event-type-rename-downstream-consumers-affected]

[AUTH REQUIRED op:migration-add-users-2fa-column scope:migrations/0042_users_2fa.sql,src/models/user.py risk:additive-column-default-null-but-concurrent-index-on-5M-rows]
```

## §5.1-EXT AUTONOMY_LEVEL effects (full table)

| Level | Effect on §5 table |
|---|---|
| `aggressive` | `delete in safe-paths` → no surface-required; `deps dev-only` → none. `cross-module refactor (≥3 Modules)` and `Δ-contract on public API` both stay HARD — core §5.1's skip-list says §5 Hard-AUTH still binds, and two passages cannot both be followed (§3 stricter-reading). |
| `default` | §5 table as written, unchanged |
| `careful` | `deps dev-only` → hard; `cross-module ≥2 Modules` → hard; `L2 local single module` → soft (surface diff inline first) |

The `aggressive` skip-list lives in core §5.1 (read at every level); its reductions are ceremony-only and never touch the §5.1 Never-downgrade set.

**Published client** (defines "public API" for the §5 Hard row `Δ-contract on public API`, at every autonomy level): any consumer outside this repo — external SDK user, npm-install consumer, MCP client (incl. Claude Code reading a server's tool schema), CLI end-user via `npx` / `cargo install` / release binary. **Internal** = same-repo module-to-module only. Uncertainty → treat as published (hard).
