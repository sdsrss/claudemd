# manifest.pluginRoot stale versioned-cache path → SessionStart spec downgrade loop

Status: live defect, reproduced 2026-07-11 (twice in one day). Fix targeted for next release; internal-freeze exemption = reproduced defect, not speculative hardening.

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

## Fix sketch (next release)

Bootstrap/update resolution order should distrust dead or version-mismatched cache paths:
1. If `manifest.pluginRoot` doesn't exist → already handled (doctor D8 orphan check) — but ALSO handle "exists yet stale": compare its `plugin.json` version against `marketplacePluginRoot()`'s; marketplace newer → prefer marketplace + rewrite manifest.
2. Never let a bootstrap sync DOWNGRADE the home spec version (compare semver in the H1 line before copying; downgrade requires explicit user choice).
3. Test: fixture with two cache dirs (0.33.0 stale + marketplace newer) → bootstrap must pick marketplace and rewrite manifest.

## Verify command (when fixed)

Stage a stale versioned cache dir + newer marketplace dir in a sandbox HOME, run the SessionStart bootstrap path, assert `head -1 $HOME/.claude/CLAUDE.md` stays at the newer version and manifest.pluginRoot no longer points at the stale dir.
