# Update-notify design — SessionStart release check + /claudemd-refresh

status: approved
revision: 1
date: 2026-07-15
level: L3 (released-artifact user-visible behavior change, core spec §2)

## Goal

Close the "knowing an update exists" gap in the plugin refresh flow. Today the
refresh mechanics are already automated (`update.sh` collapses marketplace-update
→ uninstall → install into one command; `hooks/version-sync.sh` +
`hooks/session-start-check.sh` sync spec/manifest automatically after reload),
but nothing tells the user a new release shipped. Target UX:

```
SessionStart notice: [claudemd] v0.48.0 available (installed 0.47.4) — run /claudemd-refresh, then restart
user: /claudemd-refresh        # wraps bash "${CLAUDE_PLUGIN_ROOT}/update.sh"
user: restart Claude Code      # CC platform requirement to load new hook code
(spec/manifest sync then happens automatically via existing hooks)
```

## Non-goals

- **No auto-install from hooks.** No background `claude plugin uninstall/install`,
  no tarball self-update into CC's plugin cache. claudemd is marketplace-installed;
  the cache is CC infrastructure. Mutating CC-global plugin state from a hook is
  §5 hard-AUTH-class action performed silently, plus a concurrent-session race.
  (The `plugin-auto-update` skill's downloadAndInstall pattern targets
  install.mjs-distributed plugins, not marketplace ones — per its own notes.)
- No change to the release pipeline / marketplace layout.
- No removal of `update.sh` (the `/claudemd-refresh` command wraps it).

## Design

### 1. New hook `hooks/update-check.sh` (SessionStart, own registration entry)

- **Throttle**: state file records `lastCheck`; skip if < 24h ago. A GitHub 403
  (rate limit) sets `rateLimited: true`; while set, interval is treated as
  satisfied for 6h minimum regardless of `lastCheck`.
- **Check**: `curl --max-time 3 -s https://api.github.com/repos/sdsrss/claudemd/releases/latest`
  → `tag_name` (strip leading `v`) → semver-compare against installed plugin
  version (`"$CLAUDE_PLUGIN_ROOT"/package.json`, same source version-sync.sh uses).
- **Fail-open everywhere**: no network / timeout / no jq / malformed API response /
  unreadable package.json → exit 0 with zero output. Never blocks a session.
- **Conventions**: sources `hooks/lib/hook-common.sh`, respects
  `hook_kill_switch SESSION_START`-style toggle (own `DISABLE_UPDATE_CHECK_HOOK`
  key so `/claudemd-toggle` can disable it independently), logs a `suggest`-class
  rule-hit to the telemetry sink like sibling hooks.

### 2. Notification shape

- Newer release found → single `additionalContext` line via the standard hook
  JSON envelope:
  `[claudemd] v<latest> available (installed v<current>) — run /claudemd-refresh, then restart Claude Code`
- Installed == latest (or check skipped/failed) → **zero output**. No "you are
  up to date" noise.

### 3. New command `commands/claudemd-refresh.md`

- Thin wrapper: instruct Claude to run `bash "${CLAUDE_PLUGIN_ROOT}/update.sh"`
  and then tell the user to restart (or `/reload-plugins`), after which
  version-sync.sh / session-start-check.sh finish the spec+manifest sync — no
  manual `/claudemd-install` needed.
- Works for third-party adopters with no repo checkout (update.sh ships in the
  plugin; `${CLAUDE_PLUGIN_ROOT}` expands in commands/hooks).

### 4. State file

- `~/.claude/.claudemd-update-state.json` — sibling + same style as
  `.claudemd-manifest.json`. Fields: `lastCheck`, `latestSeen`, `rateLimited`.
- Lifecycle: created by the hook on first check; `scripts/uninstall.js` must
  remove it (user-global write → owned residue).

## Constraints

- SessionStart budget: hook must finish well inside its registered timeout even
  on no-network machines (curl `--max-time 3`, registration timeout 5, matching
  the existing session-start-check.sh entry).
- §7 user-global-write rule: implementation task must show residue evidence for
  `~/.claude/` writes (exactly one new file, counted).
- §8.V3: no destructive paths here (notify-only), but tests must not hit the real
  network or real `~/.claude/` — curl mocked via PATH shim, HOME pointed at a
  sandbox.
- Released-artifact checklist (§EXT §2-EXT): minor version bump; CHANGELOG note
  at top; opt-out documented (`DISABLE_UPDATE_CHECK_HOOK=1` via /claudemd-toggle);
  the notify line itself is the discoverability signal.

## Success criteria

1. With a mocked newer release, a fresh SessionStart emits exactly one
   additionalContext line naming both versions and `/claudemd-refresh`.
2. With mocked equal/older release, network failure, 403, or missing jq: zero
   stdout, exit 0.
3. Second SessionStart within 24h performs no network call (throttle hit,
   verified via curl-shim call counter).
4. `/claudemd-refresh` on this machine refreshes the plugin cache to the latest
   released version (`node scripts/status.js` shows installed == latest after
   restart).
5. `scripts/uninstall.js` removes the state file (sandbox-tested per §8.V3).
6. Controls-first test harness: the mock suite starts with two fixtures that
   MUST produce different results (newer-version vs up-to-date) before any
   other assertion is trusted (feedback_probe_harness_controls_first).

## Open questions

- None blocking. Deferred consideration: `skipVersion` field (user wants to
  ignore a specific release) — YAGNI until requested.

## Change log

- r1 (2026-07-15): initial approved design. Option chosen: notify-only, over
  (a) background pre-pull (hook mutating CC plugin state — race + silent
  hard-AUTH) and (b) status-quo docs-only (no version awareness for adopters).
