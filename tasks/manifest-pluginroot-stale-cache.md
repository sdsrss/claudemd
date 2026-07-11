# manifest.pluginRoot stale versioned-cache path → SessionStart spec downgrade loop

Status: **FIXED in v0.36.0 (2026-07-11)** — never-downgrade guard in `install.js` + direction gates in `session-start-check.sh` / `version-sync.sh` + `plugin cache:staleness` doctor check. Reproduced twice on 2026-07-11 before the fix; internal-freeze exemption = reproduced defect, not speculative hardening. See "Implemented shape" below for deviations from the original sketch and the residual risk.

## Symptom

`~/.claude/CLAUDE.md` (+ extended/changelog/OPERATOR) silently regresses to an OLD spec version at session start; `~/.claude/.claudemd-manifest.json` `version` regresses with it. The UserPromptSubmit version-sync hook then re-heals to `${CLAUDE_PLUGIN_ROOT}`'s version mid-session — so the user sees v6.15.1 → v6.16.0 flapping while repo is at v6.17.0.

## Evidence (2026-07-11)

- 09:38Z audit session: installed extended observed at 46288B (= v6.15.1) at session start, healed to 46440B (v6.16.0) by version-sync mid-session (status.js then 4/4 match).
- 11:1xZ ship session (post-compact SessionStart): `head -1 ~/.claude/CLAUDE.md` = `v6.15.1`, manifest `{"version":"0.33.0","pluginRoot":"/home/sds/.claude/plugins/cache/claudemd/claudemd/0.33.0"}` — while marketplace dir (`~/.claude/plugins/marketplaces/claudemd`) held spec v6.16.0 / plugin.json 0.34.0.
- The 0.33.0 versioned cache dir still exists and holds v6.15.1 spec → whatever syncs from `manifest.pluginRoot` (SessionStart bootstrap path) copies stale content and stamps the stale version back into the manifest.

## Root cause shape

CC creates VERSIONED plugin cache dirs (`plugins/cache/claudemd/claudemd/<ver>/`). The manifest captured one at install time; later marketplace refreshes moved the live plugin forward but nothing rewrites the manifest → same failure family as `feedback_plugin_settings_json_path_stability.md` (version-dir goes stale on /plugin update), new surface: manifest.pluginRoot + session-start bootstrap.

## Interim fix applied (2026-07-11, this session)

`node scripts/install.js` from the repo: home spec re-synced to v6.17.0 (24648/48488/8314 bytes verified == repo), manifest rewritten to `{"version":"0.35.0","pluginRoot":"/mnt/data_ssd/dev/projects/claudemd"}`. Repo as pluginRoot is stable for the solo-dev setup (repo == source of truth) but will be overwritten by the next `/plugin install` lifecycle.

## Fix sketch (original, pre-v0.36.0)

Bootstrap/update resolution order should distrust dead or version-mismatched cache paths:
1. If `manifest.pluginRoot` doesn't exist → already handled (doctor D8 orphan check) — but ALSO handle "exists yet stale": compare its `plugin.json` version against `marketplacePluginRoot()`'s; marketplace newer → prefer marketplace + rewrite manifest.
2. Never let a bootstrap sync DOWNGRADE the home spec version (compare semver in the H1 line before copying; downgrade requires explicit user choice).
3. Test: fixture with two cache dirs (0.33.0 stale + marketplace newer) → bootstrap must pick marketplace and rewrite manifest.

## Implemented shape (v0.36.0, 2026-07-11)

Root-cause refinement over the sketch: the sync source was never `manifest.pluginRoot` — both bootstrap hooks sync from their OWN directory. The real hole was the **direction-blind version comparison** (`session-start-check.sh` / `version-sync.sh`: any `INSTALLED_VER != PLUGIN_VER` triggered install), so a hook firing from a stale cache dir treated "manifest is newer than me" as an upgrade and ran the OLD `install.js`.

1. **`install.js` never-downgrade guard** (choke point for every AUTOMATIC sync path; sketch item 2, keyed on manifest.version rather than the spec H1 — the manifest is the recorded install state and both are stamped by the same run): incoming semver < manifest semver → throw with the refresh sequence; `CLAUDEMD_ALLOW_DOWNGRADE=1` = the "explicit user choice"; non-semver skips (fail-open). Runs before any other mutation (`readManifest()` may relocate a pre-0.1.9 legacy manifest file — lossless, documented side effect).
2. **Hook direction gates**: stale direction skips the spawn, logs `stale plugin root` to bootstrap.log, writes a `stale-root` rule-hits row, and (SessionStart only) banners the 4-command refresh. version-sync keeps its 0-byte-stdout contract.
3. **Doctor `plugin cache:staleness`** (sketch item 1's detection half): manifest.pluginRoot version < marketplace version → flagged with the refresh fix. The "prefer marketplace + auto-rewrite" half was deliberately NOT built: auto-healing from a second source adds a cross-dir spawn with `CLAUDE_PLUGIN_ROOT` env-override subtleties, and the banner-guided refresh reaches the same end state through the documented, user-visible path.

Tests: `install.test.js` +3 (refusal with no-mutation asserts / forced rollback / non-semver fail-open), `session-start.test.sh` case 18, `version-sync.test.sh` case 8, `doctor.test.js` +3. RED anchors reproduced pre-fix in sandbox: home spec v6.16.0 → v6.15.1 + manifest 0.34.0 → 0.33.0 via stale-root `install()`; bootstrap.log `auto-upgrade: manifest 9.9.9 → plugin 0.35.0` via the hook.

**Residual risk (accepted, documented)**: pre-0.36.0 versioned cache dirs still contain ungated hooks + unguarded install.js. A session whose registration points at one of those can still downgrade until they age out of cache-prune (keep:3 — i.e. two more releases) or the user refreshes. Protection is forward-looking; if a downgrade recurs, check `head -1 ~/.claude/CLAUDE.md` + `~/.claude/logs/claudemd-bootstrap.log` and re-run `node <repo>/scripts/install.js`. Also outside the guard by design (2026-07-11 pre-tag review NOTE): `update.js` apply-all — a user-gated spec writer (shows the diff first, requires explicit `CLAUDEMD_UPDATE_CHOICE=apply-all`); running it from a stale root can still write the older spec, which the design treats as the sanctioned explicit-user-choice path.

## Verify command

Covered by `tests/hooks/session-start.test.sh` case 18 + `tests/scripts/install.test.js` downgrade-guard tests (sandbox HOME, manifest newer than root, assert no spawn / refusal + spec and manifest untouched).
