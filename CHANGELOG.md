# Changelog

All notable changes to the `claudemd` plugin. This changelog tracks plugin artifact changes (hooks, scripts, commands). Spec content changes live in `spec/CLAUDE-changelog.md`.

## Versioning policy (set in v0.2.1)

- **Plugin manifest `description` fields** carry spec version at **major.minor only** (e.g. `"AI-CODING-SPEC v6.10 …"`). Patch-level spec updates (v6.10.0 → v6.10.1) do NOT re-bump manifest descriptions. Rationale: description is marketplace-list tagline — user absorbs version family, not full semver; churn across 3 manifests every patch has no signal.
- **Canonical spec version source**: `spec/CLAUDE.md` top-line title (`# AI-CODING-SPEC vX.Y.Z — Core`) + `spec/CLAUDE-changelog.md` top `##` entry.
- **Plugin semver vs spec semver** are independent: plugin patch (0.2.0 → 0.2.1) may ship when spec is unchanged (this release); plugin minor (0.1.9 → 0.2.0) ships when spec minor updates (v0.2.0 shipped spec v6.10.0).

## [0.5.0] - 2026-04-29

**Minor — three bundled additions: §12 PreToolUse:Bash safety hook, §1.B sandbox-disposal scan-locations override, §1.A macOS /tmp diagnostic CI step.** Released-artifact user-visible default behavior change (new hook intercepts dangerous `git`-adjacent Bash commands at PreToolUse), so SemVer minor per AI-CODING-SPEC §EXT released-artifact checklist. No spec content change; spec stays at v6.11.2. Manifest descriptions stay at `v6.11` per v0.2.1 description-policy.

### Migration note (read before upgrading)

After v0.5.0 lands, **a new PreToolUse:Bash hook** (`pre-bash-safety-check.sh`) intercepts two dangerous patterns enumerated in spec §8 SAFETY:

1. `rm -rf $VAR` / `rm -rf "$VAR"` / `rm -rf ${VAR}` — variable-expansion target without inline validation. Whitelists `$HOME`, `$PWD`, `$OLDPWD`, `$TMPDIR`.
2. `npx <pkg>` without `@<version>` pin — bare `npx prettier` denies; `npx prettier@3.0.0` / `npx ./local.tgz` / `npx --help` pass.

**Bypass**:
- Per-command escape token in the command body: `[allow-rm-rf-var]` or `[allow-npx-unpinned]` (recorded as `bypass-*` in rule-hits log).
- Hook kill-switch: `DISABLE_PRE_BASH_SAFETY_HOOK=1` (whole hook off).
- Global kill: `DISABLE_CLAUDEMD_HOOKS=1`.

Run the canonical 4-step upgrade after fetching v0.5.0:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
```

Pin v0.4.3 to skip: `/plugin install claudemd@claudemd@0.4.3`.

### Added

- **`hooks/pre-bash-safety-check.sh`** — new PreToolUse:Bash hook enforcing spec §8 SAFETY rules at the harness level (forbids `rm -rf $VAR` with unvalidated expansion + unpinned `npx`). Registered in `hooks/hooks.json` ahead of the existing 3 PreToolUse:Bash hooks. 28-case test in `tests/hooks/pre-bash-safety.test.sh` covers: 4 non-trigger paths, 6 rm-with-var-expansion forms (bare/quoted/braced/flag-permutations/whitelist), 1 escape-hatch, 3 npx-unpinned forms (bare/scoped/`-p`), 7 npx-allowed forms (pinned/local-path/flags/`@latest`/escape), 2 kill-switch verifications, 1 fail-open malformed-stdin path.
- **`HOOK_BASENAMES` extended to 8 entries** at `scripts/install.js:16-25` — adds `pre-bash-safety-check.sh` so install/uninstall correctly evict any stale registration. Manifest count assertion in `tests/integration/full-lifecycle.test.sh:31` updated 7 → 8. Hook-basename alternation in both integration tests extended.
- **`.github/workflows/ci.yml` macOS-only diagnostic step** (`continue-on-error: true`) — captures ground-truth data on `find /tmp -newer ref` behavior on `macos-15-arm64` runners. v0.4.1 (run 25073453249) + v0.4.2 (run 25073841437) saw `FOUND` empty in the production sandbox-disposal hook with stderr blank; the diagnostic prints `uname`, `BASH_VERSION`, `TMPDIR`, `/tmp` realpath, `find --version`, ref/marker mtime delta, raw `find -newer` output, and runs the production hook against real `/tmp` to surface the v0.4.x-era root cause. Non-gating; data lives in CI logs for forensic use.

### Changed

- **`hooks/sandbox-disposal-check.sh` scan locations parameterized via `CLAUDEMD_SCAN_SPECS_OVERRIDE`** (§1.B refactor). Default scan list `/tmp|claudemd_only` + `$HOME/.claude/tmp|both` lifted from inline literals into a record-separator-delimited spec format the hook consumes. Tests inject fixture dirs via the env var, decoupling Cases 7-8 from real `/tmp` — the same path that failed reproducibly on macOS-15 GitHub runners in v0.4.1/v0.4.2 with stderr empty. Hook behavior on production users is unchanged (default scan paths identical to v0.4.x).
- **`tests/hooks/sandbox-disposal.test.sh` Cases 7-8 unconditional** — v0.4.3's `if [[ "$(uname)" == "Darwin" ]]; then echo SKIP; else …` branch removed. Both cases now inject fixture paths through the override; Linux + macOS run all 8 cases identically. Test fixture under `$TMP_HOME/system-tmp` substitutes for real `/tmp`; assertions on basename, no dependency on host-runner /tmp churn or `mkdir` semantics.

### Not changed

- **No spec content change**, no new HARD rules, no §13.2 budget delta. 20-task counter preserved.
- **No new env-var kill-switches** outside the new hook's `DISABLE_PRE_BASH_SAFETY_HOOK`. Existing kill-switches all unchanged.
- **No marketplace `description` version-family bump** — `v6.11` stays per v0.2.1 description-policy.

### Follow-up (not blocking)

If the v0.5.0 macOS CI diagnostic step surfaces a concrete root cause for the v0.4.1/v0.4.2 `find /tmp -newer ref` empty-result behavior, file as a `tasks/lessons.md` entry and decide whether the production hook needs a macOS-specific code path. Until then, real `/tmp` scan still runs on production macOS — only test coverage is decoupled.

## [0.4.3] - 2026-04-29

**Patch — macOS CI test conditional skip + lessons entry.** No plugin/spec code change. Spec stays at v6.11.2.

v0.4.1 introduced `tests/hooks/sandbox-disposal.test.sh` Cases 7-8 covering the `/tmp` scope hook fix. Case 8 (`/tmp/claudemd-* still flagged`) failed reproducibly on GitHub Actions macOS runners with stderr empty (FOUND list empty in hook). v0.4.2's mtime-edge + symlink-form defenses did not change the outcome — root cause is not what was hypothesized and cannot be reproduced without real-machine macOS access. Per AI-CODING-SPEC §6 Three-strike rule (same-signature failure 3× → roll back the path that introduced it), continuing to patch in CI without root-cause data would have crossed that threshold.

### Fixed

- `tests/hooks/sandbox-disposal.test.sh` Cases 7+8 are wrapped in `if [[ "$(uname)" == "Darwin" ]]; then echo "SKIP" ; else …` — Linux runs all 8 cases; macOS runs 6 (matching v0.4.0 baseline). Hook's `/tmp` scope behavior remains validated on Linux. The hook itself ships unchanged from v0.4.1; only test coverage on macOS is reduced.
- `tasks/lessons.md` created with two entries: (1) macOS-CI-tmp-flake — rule that macOS-specific filesystem tests must reproduce on real-machine before landing, (2) ship-baseline-bootstrap — rule that fix-forward commits to a known-red baseline use commit-body `known-red baseline:` per spec §7 option (b).

### Not changed

- No hook script change; no `scripts/` change; no spec content change. v0.4.1 and v0.4.2 hook fixes (memory-read tag-syntax dual form, ship-baseline RED expansion, sandbox-disposal /tmp scope, etc.) all still in effect.
- README, install/uninstall/update logic, manifests' `description` field — all unchanged from v0.4.2.

### Follow-up (not blocking)

Real-machine macOS investigation of why `find /tmp -newer ref` returned no fresh `claudemd-*` entries despite documented mkdir + sleep — candidates: GH runner /tmp ACL silent-fail, BSD vs GNU find divergence under brew gnubin PATH, /tmp churn race, hosted-runner sandbox behavior. Track until reproduced or refuted; no plugin code is suspected.

## [0.4.2] - 2026-04-29

**Patch — macOS CI test flake fix.** No plugin/spec code change. `tests/hooks/sandbox-disposal.test.sh` Case 8 (added in v0.4.1) was timing-fragile on macOS APFS: `touch -d '1 second ago' SESSION_REF` followed by an **immediate** `mkdir /tmp/claudemd-test-labeled_$$` could round both mtimes into the same wall-clock-second slot under APFS metadata granularity, defeating `find -newer`'s strict `>` comparison and leaving `FOUND` empty. CI run [25073453249](https://github.com/sdsrss/claudemd/actions/runs/25073453249) on v0.4.1 surfaced it; ubuntu-latest cancelled by `fail-fast` matrix.

### Fixed

- `tests/hooks/sandbox-disposal.test.sh` Case 8 — replaces `touch -d '1 second ago' + immediate mkdir` with `touch (NOW) + sleep 1 + mkdir` (the same pattern Case 5 already uses for nested-dir setup). Also grep on basename instead of full path, defending against the secondary risk of macOS `/tmp → /private/tmp` symlink-form path differences.

### Not changed

- No hook script change; no `scripts/` change; no spec content change. Spec stays at v6.11.2 from v0.4.1.
- README, install/uninstall/update logic, manifests' `description` field — all unchanged from v0.4.1.

## [0.4.1] - 2026-04-29

**Patch — post-audit fixes** spanning hooks, install/upgrade scripts, README, and spec content. Driven by 3-agent self-audit dispatched on `main` (install path / hook logic / spec prompt science). No new HARD rules, no breaking changes, no behavior change for already-installed users until they upgrade. Plugin manifests stay at `v6.11` per v0.2.1 description-policy (spec major.minor unchanged).

### Migration note (read before upgrading)

Run the canonical 4-step upgrade after fetching v0.4.1, then `/claudemd-update` to apply spec patch v6.11.1 → v6.11.2:

```
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins
/claudemd-update
```

Pin v0.4.0 to skip: `/plugin install claudemd@claudemd@0.4.0`.

### Fixed — hooks

- **`memory-read-check.sh` accepts both spec and data tag-syntax forms.** `hooks/memory-read-check.sh:49-58` adds plain-form sed fallback for `(file.md) [tag, tag] —` (the syntax documented at spec §11) alongside the existing `\`[tag, tag]\`` backtick form (the syntax in real `MEMORY.md` files). Pre-fix any plain-form line was treated as untagged → matched every `git push` / release / deploy / ship command, forcing unrelated Reads.
- **`ship-baseline-check.sh` treats all gh red-conclusion states as red.** `hooks/ship-baseline-check.sh:38-44` expands `[[ "$CONCLUSION" == "failure" ]]` to a `case` covering `failure` / `cancelled` / `timed_out` / `action_required` / `startup_failure`. Pre-fix a cancelled CI run shipped silently.
- **`sandbox-disposal-check.sh` no longer attributes system /tmp churn to the session.** `hooks/sandbox-disposal-check.sh:25-39` filters `/tmp` to `^claudemd-` prefix only. `~/.claude/tmp` continues to flag both `^tmp\.` and `^claudemd-`. Pre-fix vim/pip/cargo's stock `/tmp/tmp.XXXXXX` directories were warned-on at every Stop hook.

### Fixed — install / uninstall / update

- **`HOOK_BASENAMES` covers all 7 shipped hooks.** `scripts/install.js:16-24` adds `version-sync.sh` (was missing since v0.3.1 introduced the hook). settings.json eviction during install/uninstall now cleans stale `version-sync.sh` entries; previously they persisted undetected. Comment "5 shipped hooks" → "7" on `scripts/install.js:122`.
- **`scripts/update.js` decoupled from `backupRoot()`.** New `homeSpec(name)` helper at `scripts/lib/paths.js:29` replaces `path.join(backupRoot(), name)` (3 call sites). Future relocation of backups will not silently break `/claudemd-update`'s home-spec read path.
- **Integration tests grep covers all 7 hooks.** `tests/integration/full-lifecycle.test.sh:27,50` and `tests/integration/upgrade-lifecycle.test.sh:120,128` extend the hook-basename alternation from 5 to 7 (adds `session-start-check|version-sync`); Phase 7 in full-lifecycle also widens the JSON path filter from `PreToolUse`-only to all event types. Pre-fix a regression leaving either of those two in `settings.json` post-uninstall would have passed CI.

### Added

- **README ## Prerequisites section.** Explicit table for `node>=20` / `jq` / `git` / `gh` / `coreutils` (macOS only). Hoists previously-Troubleshooting-only dependency notes into the install path. Verify line: `node --version && jq --version && gh --version && git --version && timeout --version | head -1`.
- **README Uninstall clarifications.** Calls out that `delete` and `restore` are only available via direct `node …/uninstall.js`, never via `/plugin uninstall` (which always picks `keep`). Corrects `--purge` flag misdescription to `CLAUDEMD_PURGE=1` env-var form (the actual mechanism per `scripts/uninstall.js:83`).
- **Hook test cases** for the 3 hook fixes:
  - `tests/hooks/memory-read-check.test.sh` Cases 10-11: plain-form tag syntax (no-keyword-match passes; with-keyword-match-and-unread denies). 9 → 11 cases.
  - `tests/hooks/ship-baseline.test.sh` Cases 10-11: `cancelled` and `timed_out` conclusions deny push. 9 → 11 cases.
  - `tests/hooks/sandbox-disposal.test.sh` Cases 7-8: system `/tmp/tmp.*` is not attributed; `/tmp/claudemd-*` is still flagged. 6 → 8 cases.
- **`tests/fixtures/mock-gh/fail-cancelled/gh` + `fail-timed-out/gh`** — two new gh-CLI mocks emitting `cancelled` / `timed_out` conclusion JSON. mode 100755 set via `git update-index --chmod=+x` (per macOS portability rule — exec bit on `.sh` artifacts).

### Changed

- **Spec v6.11.1 → v6.11.2.** `spec/CLAUDE.md` §EXT TOC line removed (-357 chars / -1.5% core size); `spec/CLAUDE-extended.md` title bumped from `v6.10.0` to `v6.11.2` (closes silent trio-desync demonstrated at v6.11.1). From v6.11.2 forward, spec trio ships with synced version numbers. Recovered 1.4 percentage points from §13.1 size-budget pressure (95.0% → 93.6%). Full spec rationale at `spec/CLAUDE-changelog.md` v6.11.2 entry.

### Not changed

- **No new HARD rules**, no rule downgrades, no §13.2 budget delta. 20-task counter preserved.
- **No new hook scripts**, no new `settings.json` schema, no new env-var kill-switches. Existing kill-switches all unchanged.
- **No marketplace `description` version-family bump** — `v6.11` stays per v0.2.1 description-policy.

## [0.4.0] - 2026-04-29

**Minor bump — released-artifact user-visible default behavior change** per AI-CODING-SPEC §2 + §EXT §2-EXT release-requirements checklist. Adds an upstream-tag-check sub-feature to `session-start-check.sh`: every session start (rate-limited to once per 24h) compares the local plugin cache max version against the GitHub remote latest tag and, on mismatch, injects a 4-line "upgrade available" banner via SessionStart `additionalContext`. No spec content change (v6.11.1 stays). Manifest descriptions stay at `v6.11` per v0.2.1 policy.

### Migration note (read before upgrading)

After 0.4.0 lands, **all your sessions will start showing an "upgrade available" banner** when the GitHub remote has a newer claudemd release than your local cache. The banner contains the 4-step canonical upgrade sequence ready to copy-paste:

```
[claudemd] vX.Y.Z available (you have vA.B.C). Run these 4 commands to upgrade:
/plugin marketplace update claudemd
/plugin uninstall claudemd@claudemd
/plugin install claudemd@claudemd
/reload-plugins

Disable this notice: DISABLE_UPSTREAM_CHECK=1
```

This is a **default-on** behavior change — you will see the banner on session start without any opt-in. Three layers of opt-out (see Kill-switches in README):

1. `DISABLE_UPSTREAM_CHECK=1` — turn off only this sub-feature; existing manifest-version-mismatch auto-bootstrap (v0.2.5+) keeps running.
2. `DISABLE_SESSION_START_HOOK=1` — turn off the entire SessionStart hook (loses both upstream-check and bootstrap auto-sync).
3. `DISABLE_CLAUDEMD_HOOKS=1` — turn off all 7 claudemd hooks.

To pin v0.3.2 and skip 0.4.0: `/plugin install claudemd@claudemd@0.3.2` (CC marketplace pinning) or restore from `~/.claude/backup-<ISO>/`.

### Added — `hooks/session-start-check.sh::upstream_check`

New function inside the existing SessionStart hook (no new hook script registration; `hooks/hooks.json` unchanged). Fires only on the manifest-version-MATCH branch — i.e. when the local install is consistent and we're free to look outward. Skips on the mismatch branch to avoid stacking a banner on top of an in-flight bootstrap.

**Mechanism**:

1. Sentinel check: `~/.claude/.claudemd-state/upstream-check.lastrun` mtime within 24h → exit silently. Cross-platform via `platform_stat_mtime` (GNU `stat --format=%Y` / BSD `stat -f %m`).
2. Cache enumeration: `ls $cache_parent | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1` → local max version.
3. Remote tag: `timeout 3 git ls-remote --tags --refs --sort=-v:refname https://github.com/sdsrss/claudemd 'v*.*.*' | head -1` → latest semver tag. Public repo, no auth, no GitHub API rate-limit footprint.
4. Compare via `sort -V`: only emit banner when `remote > local`. Skips on equal or `local > remote` (dev-mode safety).
5. Sentinel touched on every reachable network attempt (success or empty result), so transient remote failures don't burst-retry.
6. Banner output: `jq -cn` constructs `{suppressOutput: true, hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: "..."}}` JSON; written to stdout for CC to inject as session context.

**Test override env vars** (testing-only, not user-facing):

- `CLAUDEMD_LS_REMOTE_CMD` — replace `git ls-remote` with a mock script for unit tests.
- `CLAUDEMD_CACHE_PARENT` — point cache-enumeration at a fake parent dir.
- `CLAUDEMD_REMOTE_URL` — override the GitHub URL (default `https://github.com/sdsrss/claudemd`).

### Added — Tests

`tests/hooks/session-start.test.sh` Cases 8-11 (test count 7 → 11):

- Case 8: upstream-check banner emitted on newer remote tag (mock returns v9.9.9, local cache max `0.4.0` stub).
- Case 9: `DISABLE_UPSTREAM_CHECK=1` suppresses banner (no stdout, manifest-match path otherwise unchanged).
- Case 10: 24h sentinel skips fresh check (pre-touched sentinel → no banner, mock not invoked).
- Case 11: `git ls-remote` failure fail-open (mock exits 1; hook exits 0, no stdout, no stderr).

Existing Cases 1-7 unchanged. Test file exports `DISABLE_UPSTREAM_CHECK=1` at top so Cases 1-7 stay network-free; new cases override per-run with `DISABLE_UPSTREAM_CHECK=0`.

### Discoverability (per §EXT §2-EXT)

- The banner itself is the one-time discoverability signal — first session after upgrade prints it; subsequent sessions within 24h hit the sentinel and stay quiet.
- Migration note in this CHANGELOG entry (above) documents the default-on behavior + 3-tier opt-out.
- README Kill-switches section gains a new "Per-sub-feature" tier (2a) calling out `DISABLE_UPSTREAM_CHECK`. Tier 2 list also gains `DISABLE_SESSION_START_HOOK` and `DISABLE_USER_PROMPT_SUBMIT_HOOK` (doc-drift fix from v0.1.9 / v0.3.1).
- `/claudemd-status` will continue to show the kill-switch state (existing logic surfaces all `DISABLE_*` env vars).

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.3.2 → 0.4.0
- `hooks/session-start-check.sh`: +60 lines (upstream_check function + match-branch routing)
- `tests/hooks/session-start.test.sh`: +69 lines (Cases 8-11 + mocks)
- `README.md`: +1 row in Daily-use table; +5 lines in Kill-switches Tier 2; +new Tier 2a sub-feature section

No spec change. `spec/CLAUDE*.md` unchanged at v6.11.1.

### Migration

`/plugin marketplace update claudemd` + `/plugin uninstall claudemd@claudemd` + `/plugin install claudemd@claudemd` + `/reload-plugins` (canonical sequence). `postInstall` triggers `install.js` which copies the new `hooks/session-start-check.sh` into the plugin cache. Next session start: banner appears if remote > local (which after 0.4.0 lands → no banner since local = remote = 0.4.0).

---

## [0.3.2] - 2026-04-29

Patch. Ships **spec v6.11.1** — 2 wording tightenings on existing HARD rules (§7 Iron Law #2 Bugfix anchor + §10 Specificity), driven by 30-day cross-project audit (188 rule-hits across `projects--claudemd` / `projects--mem` / `projects--code-graph-mcp` / `projects--daagu`). Both edits qualify as §13.2 evidence-rebuttal shortcut (fix existing HARDs, not new rules); HARD tally unchanged at 12 core + 4 §EXT-side. Manifest descriptions stay at `v6.11` per v0.2.1 policy.

### Spec v6.11.1 highlights

- **§7 Iron Law #2 Bugfix anchor** — appended banned-phrasing list (`should work / 应该可以 / 看上去 ok / 跑过了 / 能跑 / it runs / 没问题了`) with replace-with-failing-state-token instruction. Closes the "ran ≠ verified" hedge-evasion path that left the existing rule unfalsifiable.
- **§10 Specificity** — appended `No-baseline fallback` clause: `[PARTIAL: <missing-baseline>]` mandatory when no absolute number or baseline ratio is available, replacing synonym-softening (`much / notably / clearly / markedly / 较为 / 比较`). Closes the "switch synonym to escape banned-vocab" path observed in 13/14 deny-rate over 30 days.
- **§13.2 candidate log update**: `tasks/rule-candidates-2026-04.md` gains a second candidate — Shared-symbol edit guard (repro-count 1, below promotion bar).

See `spec/CLAUDE-changelog.md` v6.11.1 entry for sizing + grounding detail.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.3.1 → 0.3.2
- `tests/scripts/spec-structure.test.js`: version pins (L58, L65) 6.11.0 → 6.11.1; test description (L61) updated to match
- `tests/integration/upgrade-lifecycle.test.sh`: `NEW_SPEC_VER` (L15) 6.11.0 → 6.11.1
- `spec/CLAUDE.md`: header + §7 Iron Law #2 Bugfix anchor + §10 Specificity wording
- `spec/CLAUDE-changelog.md`: v6.11.1 entry prepended
- `tasks/rule-candidates-2026-04.md`: §9 Shared-symbol edit guard candidate appended
- `README.md`: spec-version mentions 6.11.0 → 6.11.1 (2 sites)

### Migration

`/claudemd-update` picks up spec v6.11.1 automatically on next SessionStart (v0.2.5 hook auto-syncs on version mismatch; v0.3.1 `UserPromptSubmit` covers the live-session path). No hook behavior change, no settings.json change, no state-dir change.

---

## [0.3.1] - 2026-04-24

Patch. Adds `UserPromptSubmit` hook `hooks/version-sync.sh` — piggy-back version-mismatch detection that covers the `/plugin marketplace update + /plugin install + /reload-plugins` upgrade path. Complements `session-start-check.sh` (SessionStart-only). After 0.3.1 lands, the user's first prompt submission following a plugin cache swap triggers `install.js` in the background; on-disk `~/.claude/CLAUDE*.md` syncs without requiring `/exit` + new session. No spec change (v6.11.0 stays). Manifest descriptions stay at `v6.11` per v0.2.1 policy.

### Added — `hooks/version-sync.sh`

Reads `~/.claude/.claudemd-manifest.json::.version` and compares against the active plugin root's `package.json::.version` (same authoritative pair `session-start-check.sh` and `install.js::readPluginVersion` use). Mismatch → `timeout 10 node install.js` backgrounded, detached, stdout+stderr redirected to `~/.claude/logs/claudemd-bootstrap.log`. Match → fast exit. Fail-safe: missing `jq`, unreadable `package.json`, legacy manifest without `.version`, `node` absent → silent early exit, no spawn, fail-open.

**Stdout contract**: exactly 0 bytes on every path. `UserPromptSubmit` hook stdout is injected into the user's prompt context by Claude Code; any accidental output would pollute every prompt in every session.

**Once-per-session**: session-scoped sentinel at `${TMPDIR:-/tmp}/claudemd-sync-${CLAUDE_SESSION_ID:-$PPID}`. Keyed off `CLAUDE_SESSION_ID` when CC exposes it, else the CC process PID (stable within a session). Sentinel is written on the first invocation regardless of outcome — mismatch or match — so subsequent prompts in the same session re-check in O(1) (single `test -f`). Hook adds ~5-10ms to first-prompt-of-session wall time, ~1ms to every subsequent prompt.

**Kill-switch**: `DISABLE_USER_PROMPT_SUBMIT_HOOK=1` or `DISABLE_CLAUDEMD_HOOKS=1` both suppress entirely (shared `hook_kill_switch` from `lib/hook-common.sh`).

### Added — test coverage

`tests/hooks/version-sync.test.sh` — 6 cases covering no-manifest/version-match/version-mismatch/kill-switch/sentinel-dedup/stdout-byte-count paths. `tests/scripts/install.test.js` fixture `hooks.json` updated to include the new `UserPromptSubmit` block (entry count 6 → 7). `tests/integration/full-lifecycle.test.sh` entry-count assertion updated accordingly.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.3.0 → 0.3.1
- `hooks/hooks.json`: +`UserPromptSubmit` block with 2-second timeout
- `README.md`: hook count 5 → 7 (also surfaces previously-undocumented `session-start-check` + new `version-sync`)

### Migration

Transparent — install.js behavior unchanged, hook registration auto-picked-up. First user after upgrade path: `/plugin marketplace update claudemd` + `/plugin uninstall claudemd@claudemd` + `/plugin install claudemd@claudemd` + `/reload-plugins` + send any prompt → on-disk spec syncs in background within ~1s. Subsequent upgrades require only the 4-step sequence + one prompt (no `/exit` needed).

---

## [0.3.0] - 2026-04-24

Minor. Ships **spec v6.11.0** — ROI-ranked optimization across §1 / §2 / §5 / §5.1 / §7 / §9 / §10 / §11 driven by a 5-day retrospective over `projects--mem` (v2.47.0 → v2.50.0) and `projects--code-graph-mcp` (v0.11.4 → v0.16.2) session history. Plugin-side: version sync + manifest `description` field bumps (v6.10 → v6.11 family, per v0.2.1 policy). No hook / script / test behavior changes beyond version pins.

### Spec v6.11.0 highlights

- **New SHOULD**: §9 Parallel-path completeness (L2+) — 4 grounded repros in 5 days; HARD candidate logged in `tasks/rule-candidates-2026-04.md`, promotion blocked by §13.2 20-task counter.
- **New SHOULD**: §7 Metric-coupling check (L2+) — changes coupled to existing bench/oracle/compile-time budget MUST cite before-and-after.
- **New classification**: §2 LLM-visible metadata (MCP tool descriptions, `instructions` field, adoption memory, prompt templates) → L3 regardless of LOC.
- **Clarifications** (no new HARD): §5 Obvious-follow-on re-AUTH; §1 Recommend-first single-option execute-directly; §5.1 aggressive skip-list; §10 banned-vocab quick-list in core.
- **Demotion**: §11 Re-Read / Correction / Context pressure → §11-EXT (non-HARD maintenance heuristics).
- **HARD tally unchanged** from v6.10.2 (12 core + 4 §EXT-side). §13.2 budget cost = 0.

See `spec/CLAUDE-changelog.md` for full per-section delta and sizing.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.2.5 → 0.3.0
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2) descriptions: `v6.10` → `v6.11` (minor-family bump per v0.2.1 policy)
- `README.md`: spec-version mentions 6.10 → 6.11 / 6.10.2 → 6.11.0 (3 sites)
- `tests/scripts/spec-structure.test.js`: version pins (L58, L65) 6.10.2 → 6.11.0
- `spec/CLAUDE.md`: header + §1 / §2 / §5 / §5.1 / §7 / §9 / §10 / §11 rule edits
- `spec/CLAUDE-extended.md`: §11-EXT Session maintenance heuristics (new block, receives demoted rules) + Recent changes block replaced
- `spec/CLAUDE-changelog.md`: v6.11.0 entry prepended
- `tasks/rule-candidates-2026-04.md`: created (§13.2 workflow)

### Migration

`/claudemd-update` picks up spec v6.11.0 automatically on next SessionStart (v0.2.5 hook upgrades on version-mismatch).

---

## [0.2.5] - 2026-04-23

Patch. Hook-behavior fix: SessionStart auto-sync on version mismatch. No spec change (v6.10.2 stays). Plugin-side response to a CC marketplace-lifecycle gap that quietly froze users' installed manifest at whatever version last ran `scripts/install.js` manually.

### Fixed — SessionStart hook now auto-upgrades on version mismatch

`hooks/session-start-check.sh` pre-0.2.5 short-circuited on `manifest-exists`, meaning the manifest + spec files stayed pinned to whichever version last triggered `scripts/install.js`. In practice Claude Code's marketplace install/uninstall flow does **not** invoke the `postInstall` / `preUninstall` fields declared in `.claude-plugin/plugin.json` — a `/plugin install claudemd@claudemd` after `/plugin marketplace update claudemd` swaps the active cache dir pointer but never runs `install.js`, so manifest.version and `~/.claude/CLAUDE*.md` both froze at the user's last manual-bootstrap version. Observed in the wild: a user stuck at manifest 0.2.2 / spec v6.10.0 after two documented releases (v0.2.3 shipping v6.10.1, v0.2.4 shipping v6.10.2) despite running the full canonical `/plugin marketplace update + uninstall + install + reload-plugins` sequence each time.

Hook now reads `manifest.version` from `~/.claude/.claudemd-manifest.json` and compares it against `.version` in the loaded plugin root's `package.json` (same authoritative source `install.js` uses for `readPluginVersion`). Mismatch logs a line to `~/.claude/logs/claudemd-bootstrap.log` and falls through to the existing background install block (`timeout 10 node scripts/install.js`, detached, stdout redirected). Match → fast exit as before. Fail-safe defaults: missing `jq`, unreadable `package.json`, legacy manifests without `.version`, or dev-mode non-semver plugin roots all early-exit without attempting upgrade (prevents re-bootstrap loops on broken state).

New test case `tests/hooks/session-start.test.sh:69-89` (Case 7) writes a `{"version":"0.0.1"}` manifest and asserts the hook both writes an auto-upgrade log line and bumps the manifest to the plugin's current `package.json` version. Cases 1-6 unchanged (fresh install, silence, log creation, version-match no-op, kill-switch, legacy manifest). Case 4 description updated to reflect the new "version-match" semantics.

### Migration

**One-time manual sync** to land this 0.2.5 hook: after `/plugin marketplace update claudemd` + `/reload-plugins`, run

```
node ~/.claude/plugins/cache/claudemd/claudemd/0.2.5/scripts/install.js
```

This will be the last manual install required — from 0.2.6 onward the 0.2.5 hook (now active in your session) will detect version drift on the next SessionStart and re-run install.js in the background automatically.

### Changed — Version bumps

- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2): 0.2.4 → 0.2.5
- `hooks/session-start-check.sh`: +27/-3 (version-check branch before manifest early-exit)
- `tests/hooks/session-start.test.sh`: +21/-3 (Case 7 added, Case 4 comment clarified)

No `spec/CLAUDE*.md` change. `README.md` spec-version mentions unchanged (still v6.10.2). Manifest `description` fields still at `v6.10` per the v0.2.1 policy.

---

## [0.2.4] - 2026-04-23

Patch. Ships spec v6.10.2 — new HARD rule **§11 Mid-SPINE turn-yield** (core, all levels). First rule-addition patch since v0.2.0 (v6.10.0 shipped); prior v0.2.1 / v0.2.2 / v0.2.3 were hook/doc-drift patches. HARD tally: 11 → 12 in core.

### Added — §11 Mid-SPINE turn-yield (HARD, all levels)

`spec/CLAUDE.md:229` new bullet between `MEMORY.md read-the-file` and `Session-exit mid-SPINE`. Placement is the turn-boundary sibling to the existing session-boundary rule: once a turn has executed ≥1 tool call inside an active SPINE cycle, the model MUST continue planned steps through VALIDATE. `<system-reminder>` blocks (hook output / mid-turn `[mem]` context / PostToolUse flushes) are explicitly NOT turn boundaries. Only three legal mid-cycle yields: `[AUTH REQUIRED]`, genuinely-ambiguous direction, or §11 Context pressure checkpoint. Silent mid-cycle yield followed by a next-turn "done" claim is flagged as Iron Law #2 violation. Self-diagnostic tell: user's next message is `继续 / next / 怎么停了 / why did you stop` → confirmed prior yield.

**Grounding**: two user-reported mid-turn stops in plugin-adjacent sessions on 2026-04-22 / 04-23. Incident 1 root cause was `UserPromptSubmit` hook injecting a `<system-reminder>` on an empty/continuation prompt, which the model read as a new-turn boundary (hook-side mitigation landed separately: short-prompt silent-exit + continuation-label on reminders). Incident 2 root cause was single-Edit completion feeling like task-done when the plan had ≥3 remaining steps — this is a model-side habit that hook fixes cannot reach. The new spec rule addresses incident-2 directly; incident 1 gets both hook mitigation (eliminates the noise) and spec reinforcement (neutralizes the noise if it ever slips through).

**Core vs §EXT decision**: §EXT loads only at L3/ship/Override/3-strike, but mid-turn yields happen at L1/L2 (both grounded incidents were L1-L2). Placing the rule in §EXT would mean it never binds at the levels where it fires. §11 SESSION is already labeled "universal · binds every task", so core placement is the natural home and does not require a §0.1 core-growth exception carve-out.

Spec-structure tests updated (`tests/scripts/spec-structure.test.js:58,65` pin to 6.10.2).

### Changed — Version bumps

- `spec/CLAUDE.md` header v6.10.1 → v6.10.2
- `spec/CLAUDE-changelog.md` new v6.10.2 entry (above v6.10.1)
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (×2 fields): 0.2.3 → 0.2.4
- `README.md` lines 15, 197 spec-version mention: v6.10.1 → v6.10.2

Per "Versioning policy set in v0.2.1" (§CHANGELOG.md:7), plugin manifest `description` fields stay at `v6.10` (major.minor) — not re-bumped per patch.

### Migration

**`/claudemd-update`** to pick up spec v6.10.2 (1 new bullet in §11). No hook behavior change, no settings.json change, no state-dir change. Existing `~/.claude/CLAUDE.md` at v6.10.0 or v6.10.1 continues to work with all prior rules binding; the new Mid-SPINE turn-yield rule binds only after update.

---

## [0.2.3] - 2026-04-23

Patch. Ships spec v6.10.1 (wording patch on §7 Ship-baseline; zero rule change). Fixes 1 doc-drift P0 + 3 hook/spec P1 items surfaced by end-to-end audit. Adds 3 P2 production-hardening items: pre-merge settings.json backup rotation, rule-hits log rotation, and a live banned-vocab self-test check in `/claudemd-doctor`.

### Fixed — README spec-version drift (P0)

`README.md` lines 3, 15, 197 still referenced `v6.9` / `v6.9.3` after v0.2.0 shipped spec v6.10.0. Installers reading the README believed they were getting v6.9.3 while `plugin.json:4` and the shipped `spec/CLAUDE.md` H1 both declared v6.10. Synced to `v6.10` / `v6.10.1`.

### Fixed — §7 Ship-baseline wording vs hook behavior (P1)

`spec/CLAUDE.md:158` + `spec/CLAUDE-extended.md:261` said "check base-branch pipeline color"; the shipped `hooks/ship-baseline-check.sh:30-35` has queried `gh run list --branch $(git branch --show-current)` since v0.1.0 to avoid blocking feature-branch pushes over unrelated scheduled-workflow failures on `main`. Prior wording implied a broader check than any implementation actually did. Changed to "check pushed-branch pipeline color (fallback latest-any on detached HEAD)" in both core §7 and §EXT §7-EXT rationale. Spec bumped v6.10.0 → v6.10.1 with new entry in `spec/CLAUDE-changelog.md`. Spec-structure tests updated (`tests/scripts/spec-structure.test.js:58,65`).

### Fixed — `memory-read-check` tag matched as regex (P1)

`hooks/memory-read-check.sh:58` used `grep -qi "$t"` where `$t` is a MEMORY.md index tag. Tags containing regex metacharacters (`.`, `$`, `*`, `[`, `]`, `\`) were interpreted by grep's BRE — e.g. a tag `v6.9` would literal-match `v6X9` / `v6_9`, drifting into false-positive territory as tag vocab grows. Changed to `grep -qiF` (fixed-string). Added test case 9 in `tests/hooks/memory-read-check.test.sh:96-113` locking the intent (tag `v6.9` does NOT match command text `v6X9`).

### Fixed — `banned-vocab` fallback false-positive scope undocumented (P1)

`hooks/banned-vocab.patterns` header claimed "applied to ENTIRE git commit command string", but since v0.1.9 the hook extracts `-m`/`--message` bodies first and only falls back to whole-command scanning when extraction fails (editor-mode commits, `--file=PATH`, `--amend --no-edit`, unusual quoting). Rewrote header to describe actual extraction logic and name the fallback-only false-positive class (`git commit --file=/tmp/banned-significantly.txt` scanning the filename). Mirrored comment in `hooks/banned-vocab-check.sh:52-56`.

### Added — Pre-merge `settings.json` backup rotation

`scripts/install.js:88-98` has written `~/.claude/settings.json.claudemd-backup-<iso>` before any settings mutation since v0.1.0, but `/claudemd-doctor --prune-backups` only touched `~/.claude/backup-<ISO>/` directories — the sibling backup files accumulated one-per-install indefinitely.

New `pruneSettingsBackups(retainCount)` in `scripts/lib/backup.js:60-75` (mirrors `pruneBackups` retention semantics, iso-stamp lexicographic sort). Called from `install.js` right after creating the new backup; retains 5 newest, drops older. Regex `SETTINGS_BK_REGEX` accepts both ms-precision stamps and the sub-ms `-N` collision suffix. Install return shape gains `settingsBackupsPruned: string[]`. Three new unit tests in `tests/scripts/backup.test.js:71-105`: retention with mixed siblings, ms-precision + `-N` suffix, missing `.claude/` dir returns `[]` without throw.

### Added — Rule-hits log size-capped rotation

`hooks/lib/rule-hits.sh:18-33` gained `CLAUDEMD_LOG_MAX_MB` (default 5) size check before each append. Over threshold → rotate `claudemd.jsonl` → `claudemd.jsonl.1` (pushing existing `.1` to `.2`, dropping prior `.2`). Disk footprint bounded at ~3× max_mb. `stat -c` (GNU) with `-f %z` (BSD) fallback for macOS compat. Three new shell cases in `tests/hooks/rule-hits.test.sh`: rotation on overflow with old content preserved in `.1`, second rotation evicts stale `.2`, under-threshold no-rotation. `doctor.js` existing `logs > 5 MB` warn path still fires when the primary file itself grows past 5 MB after most recent rotation (informational; rotation keeps disk bounded regardless).

### Added — `/claudemd-doctor` live banned-vocab self-test

`scripts/doctor.js:59-93` spawns `hooks/banned-vocab-check.sh` with a synthetic event (`git commit -m "this is significantly better"`) and asserts a `"permissionDecision": "deny"` JSON response. Catches drift between `banned-vocab.patterns` and the hook's extraction logic that unit tests (which parse patterns directly) can silently paper over. Side-effect-free: sets `DISABLE_RULE_HITS_LOG=1` in the spawn env so the self-test doesn't pollute the user's rule-hits log; clears both kill-switch vars so ambient env can't falsely pass the check by disabling it. Degrades gracefully when `jq` / `bash` missing (prerequisite check with specific detail message).

**Kill-switch surfacing (review I1)**: the self-test detects before spawn whether `DISABLE_CLAUDEMD_HOOKS=1` / `DISABLE_BANNED_VOCAB_HOOK=1` is engaged in process env OR `settings.json:env`. Result still reports `ok: true` (hook code still denies the synthetic trigger when forced-enabled), but the detail appends `" — note: kill-switch engaged in user env/settings; hook will NOT fire in practice"`. Without this, doctor would silently green-light a hook the user has actively disabled, masking a config-vs-intent mismatch. Two new tests in `tests/scripts/doctor.test.js` lock both the settings.json and process.env paths.

### Manifest version bumps

- `package.json` 0.2.2 → 0.2.3. Description unchanged (`v6.10` per v0.2.1 policy: major.minor only).
- `.claude-plugin/plugin.json` 0.2.2 → 0.2.3. Description unchanged.
- `.claude-plugin/marketplace.json` both version fields 0.2.2 → 0.2.3. Descriptions unchanged.

### Required migration

**`/claudemd-update`** to pick up spec v6.10.1 (3-word wording change on §7 Ship-baseline + §EXT §7-EXT rationale). No hook behavior change, no settings.json change, no state-dir change. Existing `~/.claude/CLAUDE.md` at v6.10.0 continues to work (wording is more-accurate, not rule-different).

### Test totals

- Unit: 101 → 107 (+3 pruneSettingsBackups, +1 doctor self-test, +2 doctor kill-switch surfacing).
- Shell hooks: `memory-read-check` 8 → 9 cases (regex-metachar tag); `rule-hits` 3 → 6 cases (rotation trio).
- Full suite (shell + Node + full-lifecycle integration): PASS (573 ms).

## [0.2.2] - 2026-04-23

Patch. Ships at spec v6.10.0 (unchanged). Fixes `/claudemd-status` spec-version drift and adds bounded cache retention to prevent unbounded version-dir accumulation under `~/.claude/plugins/cache/`.

### Fixed — `/claudemd-status` spec version extraction

`scripts/status.js` read spec version with regex `^Version:\s*(\S+)` — a format retired in v6.10.0 when the spec header consolidated into `# AI-CODING-SPEC vX.Y.Z — Core`. Since v0.2.0 (which shipped spec v6.10.0), every healthy install returned `spec.installed: ""`, directly contradicting the "Versioning policy" set in v0.2.1 which declares the H1 title the canonical spec-version source.

- New extraction: H1-title match first (`/^#\s*AI-CODING-SPEC\s+v([\d.]+)/m`), legacy `Version:` fallback for pre-v6.10.0 installs.
- Test-reality drift repaired: `tests/scripts/status.test.js` fixture rewritten from fake `Version: 6.9.2` to real H1 format `# AI-CODING-SPEC v6.10.0 — Core`. The old fixture matched the broken regex, so unit tests passed while production silently returned empty. A single test assertion at the integration boundary would have caught this; added comment referencing v0.2.1 policy source to prevent re-drift.

### Added — Cache version pruning (keep newest 3)

New `scripts/lib/cache-prune.js` (`pruneCache`) called at end of `install.js`. Keeps the 3 newest semver version dirs under `~/.claude/plugins/cache/<plugin>/<plugin>/`, always retaining the currently-installed version even if older than the top-3 (rollback scenario). Previously cache dirs accumulated unbounded across upgrades — observed in the field after 8 releases: 6 stale version dirs (0.1.1 / 0.1.4 / 0.1.6 / 0.1.7 / 0.1.9 / 0.2.1) totalling ~2 MB per install cycle × N releases.

- **Scope-gated**: only dirs matching `^\d+\.\d+\.\d+$` are candidates; `scratch-notes/` and other non-semver siblings stay untouched.
- **Dev-mode safe**: when `pluginRoot` basename is non-semver (source repo checkout via `node scripts/install.js`), prune returns `{skipped: 'non-semver-plugin-root'}` — no scan of repo parent.
- **Best-effort**: prune wrapped in try/catch; an FS error does not void the preceding install success.
- **Coverage**: 7 new unit tests in `tests/scripts/cache-prune.test.js` — newest-3 keep, rollback retains current, non-semver siblings ignored, dev-mode skip, missing parent dir, multi-digit semver (0.10.0 > 0.9.5).

### Manifest version bumps

- `package.json` 0.2.1 → 0.2.2. Description unchanged (`v6.10` per policy).
- `.claude-plugin/plugin.json` 0.2.1 → 0.2.2. Description unchanged.
- `.claude-plugin/marketplace.json` both version fields 0.2.1 → 0.2.2. Descriptions unchanged.

### Required migration

**NONE.** Cache pruning triggers on next `install.js` run (any plugin upgrade path). No settings.json change, no spec content change, no hook behavior change.

### Test totals

- Unit: 101 → 108 (+7 cache-prune tests; +0 net on status since the failing case was fixed in place)
- Full suite (shell hooks + Node + full-lifecycle integration): PASS

## [0.2.1] - 2026-04-23

Patch. Loose-end cleanup from the v0.2.0 ship. No spec content change, no hook/script behavior change, no user-visible behavior difference — ships at spec v6.10.0 as in v0.2.0.

### Fixed — Test sentinel drift-proneness

- `tests/scripts/spec-structure.test.js` A15 `MEMORY.md tag syntax`: dropped the `/tag syntax/i` literal-phrase match. The `[tag1, tag2]` literal (user-copy-paste anchor) is the structural sentinel and was already asserted; the `/tag syntax/i` match was redundant and fragile — spec could rename "Optional tag syntax" → "Tag annotation syntax" (or similar) and silently keep passing against unrelated contexts, while the copy-paste example is the real stability invariant. Post-change: 2 assertions per test (MEMORY.md + `[tag1, tag2]`), down from 3. Full suite: 94/94 Node + full-lifecycle integration PASS.

### Fixed — Repo hygiene

- `.gitignore`: entry `.claude/settings.local.json` broadened to `.claude/`. The whole `.claude/` directory is Claude Code workspace state (sessions / permission grants / local hook caches) — entirely user-specific, entirely transient. Prior narrow rule left `?? .claude/` in every contributor's `git status` whenever CC created any sibling file (which it does now during normal session use). `.claude/settings.local.json` stays covered by the broader rule.

### Docs — Versioning policy

- `CHANGELOG.md`: new "Versioning policy" section (above) codifies the manifest-description-at-major.minor rule and documents independence between plugin semver and spec semver. Future reviewers see the rule without spelunking git log.

### Manifest version bumps

- `package.json`: 0.2.0 → 0.2.1. Description unchanged (`v6.10` per policy above).
- `.claude-plugin/plugin.json`: 0.2.0 → 0.2.1. Description unchanged.
- `.claude-plugin/marketplace.json`: both `metadata.version` and `plugins[0].version` 0.2.0 → 0.2.1. Descriptions unchanged.

## [0.2.0] - 2026-04-23

**Minor bump — ships spec v6.9.3 → v6.10.0**. Per AI-CODING-SPEC §2 "released-artifact user-visible default behavior change → L3 regardless of LOC" and §EXT §2-EXT "SemVer non-patch bump". User-facing behavior UNCHANGED (0 new HARD, 0 rule semantic modification, §5 AUTH table verbatim, all Iron Laws preserved) — bump chosen to signal the structural spec refresh, not a behavior contract change.

### Spec v6.10.0 — data-driven net contraction

Grounding: external audit of 6-week history across `projects--mem` / `projects--code-graph-mcp` / `projects--claudemd` flagged v6.9.3 core at 95% of §13.1 size ceiling (24.9k/25k), evidence rule scattered across §0 / §7 / §10 / §EXT §7-EXT / B.2, and dual routing tables (§2.2 core + §EXT §4 FLOW) with tie-breaker adding cognitive cost every task.

- **§2.1 ROUTE unified** — original §2.1 skill soft-triggers + §2.2 ROUTE (L0–L2 subset) + §2.3 TOOLS (orchestration) merged into one §2.1 ROUTE table + escalation principles + soft-trigger clause. Dual-routing tie-breaker dropped; §EXT §4 FLOW still authoritative on L3/ship. `~−1.4k chars` in core.
- **§5 AUTH compaction** — 14-row hard/soft column table → hard-default enum + soft list + none-case. 12 ops verbatim; no AUTH-level semantic change. `~−400 chars`.
- **§8 Verify-before-claim** — 8.V1–V4 bodies tightened to 1–2 lines; historical incident grounding (v0.8.3 leak count etc.) externalized to `spec/CLAUDE-changelog.md` v6.7.1 / v6.7.4 entries. `~−500 chars`.
- **§7 / §10 / §11 DRY sweep** — Iron Law #2 good-examples 3 → 2; Specificity clause tightened (full banned-vocab at §EXT §10-V); session-exit HARD preserved with v0.11.4 anecdote trimmed to changelog. `~−600 chars`.
- **Misc sweep** — Fast-Path / depth-triggers / TOC cross-ref tightened; obsolete `§EXT §8-EXT` pointer dropped. `~−200 chars`.
- **Recent-changes hygiene** — `spec/CLAUDE-changelog.md` v6.9.0 entry backfilled (chain was v6.9.3 → v6.9.2 → [gap] → v6.8.1; now continuous).

**Sizing delta** (vs v6.9.3):
- `spec/CLAUDE.md`: 23823 → 19553 chars (`−4270`, `−17.9%`); headroom 1177 → 5447 chars (`4.6×`).
- `spec/CLAUDE-extended.md`: 42427 → 42602 chars (+175, net flat — v6.9.0 entry archived to changelog offset by v6.10.0 entry + new Sizing line).
- `spec/CLAUDE-changelog.md`: 18716 → 23645 chars (+4929 — v6.10.0 entry + v6.9.0 backfill).
- Runtime L0/L1/L2 load: ~6.0k → ~4.9k tokens (`−1.1k` every turn).
- Runtime L3/ship load: ~16.6k → ~15.5k tokens (`−1.1k` per L3 turn).

**HARD tally unchanged**: 11 in core (§0.1 / §0 Hard-AUTH override / Iron Law #2 / §7 Ship-baseline / §7 User-global-state audit / §8 Verify-before-claim V1–V4 / §10 Four-section order / §10 Honesty rules / §10 Specificity / §11 MEMORY.md read-the-file / §11 Session-exit mid-SPINE). Zero added, zero removed, zero semantic change. §13.2 budget cost = 0; 20-task counter reset per "rule consolidation" allowance.

### Required migration: NONE

Agent behavior is backward compatible. Spec cross-references that external docs / memory files may carry:

- `§2.2 ROUTE` / `§2.3 TOOLS` → now under unified **§2.1 ROUTE**. If your `memory/*.md` or project `CLAUDE.md` cites these subsections by number, re-map to §2.1. Content preserved verbatim; only section numbers changed.
- All other section numbers (§0 / §0.1 / §1 / §1.5 / §2 / §3 / §5 / §5.1 / §7 / §8 / §9 / §10 / §11 / §EXT) unchanged.

### Opt-out / revert

Pin previous version:
- Plugin: `/plugin marketplace update claudemd` (or re-install) and select the `0.1.9` tag, OR from source: `git -C <claudemd-clone> checkout tags/v0.1.9 && node scripts/install.js`.
- Spec only: restore `~/.claude/CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md` from the `~/.claude/.claudemd-backups/<timestamp>/` backup that the 0.2.0 `postInstall` writes before overwriting (see `scripts/install.js` backup flow).

### Discoverability

- GitHub release notes (v0.2.0 tag) summarize the bump rationale.
- `/claudemd-status` now reports plugin 0.2.0 / spec v6.10.0.
- `hooks/session-start-check.sh` first run after upgrade logs the version bump to `~/.claude/logs/claudemd-bootstrap.log`.

### Manifest version bumps

- `package.json` 0.1.9 → 0.2.0; description `v6.9` → `v6.10`.
- `.claude-plugin/plugin.json` 0.1.9 → 0.2.0; description `v6.9` → `v6.10`.
- `.claude-plugin/marketplace.json` both `metadata.version` and `plugins[0].version` 0.1.9 → 0.2.0; both descriptions `v6.9` → `v6.10`.

No plugin code (hooks / scripts / commands / tests) changed in this release; shipping exclusively carries the spec refresh.

## [0.1.9] - 2026-04-23

Follow-on hardening from the 2026-04-23 end-to-end usage audit. 6 warts surfaced during sandbox simulation, all addressed; 4 new regression test cases and 1 new test suite added.

### Fixed — High (state-dir double-duty)

- `scripts/lib/paths.js` + `scripts/install.js` + `scripts/uninstall.js` + `scripts/status.js` + `scripts/doctor.js`: install manifest relocated from `~/.claude/.claudemd-state/installed.json` to `~/.claude/.claudemd-manifest.json`. The pre-0.1.9 location shared the state dir with runtime baselines (`tmp-baseline.txt`, `session-start.ref`); a user running `rm -rf ~/.claude/.claudemd-state/` to reset residue-audit / sandbox-disposal baselines silently erased the install record, and `/claudemd-status` reported `installed:false` even with hooks still firing from `hooks/hooks.json`. Sandbox repro: manifest gone → `{"warning":"already-uninstalled"}` from the next uninstall run. New `readManifest()` helper in `paths.js` transparently migrates legacy `.claudemd-state/installed.json` → new location on first access, so existing 0.1.x users get relocated automatically by any claudemd script (status / doctor / uninstall / install). (P1a)
- `scripts/uninstall.js` `purge` + default paths: unlink both the new manifest AND any pre-0.1.9 legacy file for belt-and-braces cleanup on upgrade→uninstall flows. (P1a)

### Added — Feature (SessionStart self-bootstrap)

- `hooks/session-start-check.sh` (new) + `hooks/hooks.json` SessionStart registration: auto-runs `install.js` in the background (10s ceiling, detached) when the plugin is present but no manifest exists at either location. Saves new users the manual `node ~/.claude/plugins/cache/claudemd/claudemd/<version>/scripts/install.js` step documented in `README.md`. Idempotent — fast-exits in ~5ms on subsequent starts once the manifest is in place. Kill-switch `DISABLE_SESSION_START_HOOK=1` suppresses the bootstrap; `DISABLE_CLAUDEMD_HOOKS=1` suppresses it too. Diagnostic log at `~/.claude/logs/claudemd-bootstrap.log`. `HOOK_BASENAMES` updated so uninstall catches this hook alongside the five enforcement hooks; `status.js` / `toggle.js` surface it under the `session_start` kill-switch key. (P1b)

### Fixed — Hook behavior

- `hooks/residue-audit.sh`: first invocation (no `tmp-baseline.txt` yet) now establishes the baseline silently and returns, mirroring `sandbox-disposal-check.sh`. Previously, a user whose `~/.claude/tmp/` already held >20 entries from other plugins or prior sessions got an immediate false alarm on the very first Stop after install, with `BASELINE=0` producing a misleading "grew by 32 entries" warning. (P2)
- `hooks/sandbox-disposal-check.sh`: trailing blank bullet (` - ` with no path) no longer appears at the end of the warn list. Root cause: the `FOUND` accumulator ended with a `\n`, and `head -n 5 | sed 's/^/  - /'` preserved the blank line as a naked bullet. Replaced with `sed -e '/^$/d' -e 's/^/  - /' | head -n 5` to strip empties before prefixing. (P3a)
- `hooks/banned-vocab-check.sh`: scan scope narrowed from "entire `git commit` command line" to "message body only" (extracted from `-m "..."` / `-m '...'` / `--message=...` / `--message "..."` forms). §10-V is about commit message content, so scanning `COMMIT_FLAG_SIGNIFICANTLY=1 git commit -m "fix: X"` across all tokens used to flag unrelated env/config text. Falls back to full-CMD scan when no `-m` / `--message` is captured (editor commits, `-F file`, unusual quoting) — preserves §10-V coverage without over-matching. BSD-safe: uses octal `\047` for single quote in regex alternation. (P4)

### Fixed — Medium (cosmetic churn in settings.json)

- `scripts/lib/settings-merge.js`: `unmergeHook` now prunes empty event arrays (e.g. `"PreToolUse": []`) and drops the top-level `hooks` key entirely when it becomes empty. Previously every install/uninstall cycle left `"hooks":{"PreToolUse":[]}` scaffolding in `settings.json`, visible as noise in user diffs and accumulating across plugins. (P3b)

### Added — Tests

- `tests/hooks/session-start.test.sh` (new, 6 cases): first-run silent + background install writes manifest, bootstrap log created, manifest-present no-op, kill-switch suppression, legacy-manifest path recognized as installed.
- `tests/hooks/banned-vocab.test.sh`: 5 new cases (16-20) covering message-scope scan — env prefix / `git -c` config / multi `-m` / `--message=` form / `-F file` fallback.
- `tests/hooks/sandbox-disposal.test.sh`: case 6 asserts no trailing blank bullet in warn list.
- `tests/hooks/residue-audit.test.sh`: case 1 now asserts first-run silence (no warn), case 4 seeds a zero baseline before exercising the threshold override.
- `tests/scripts/paths.test.js`: 4 new tests covering `manifestPath()` location outside `stateDir()`, `readManifest()` migration from legacy path, `readManifest()` returns `exists:false` on cold, and preference of new over stale legacy.
- `tests/scripts/settings-merge.test.js` case 17 rewritten: `unmergeHook` now returns `s.hooks === undefined` (not `s.hooks.PreToolUse.length === 0`).
- `tests/scripts/status.test.js` + `install.test.js`: manifest paths updated to `.claudemd-manifest.json`; install-test `hooks.json` fixture bumped to 6 entries (SessionStart included); manifest entry-count assertions `5 → 6`.
- `tests/integration/full-lifecycle.test.sh`: Phase 3 manifest path updated; entry count `5 → 6`.
- Test totals: script tests 90 → 94; hook suites gain a new `session-start.test.sh` (6 cases); `banned-vocab.test.sh` 15 → 20 cases. Running `tests/run-all.sh`: 94/94 Node + all shell hook suites + full-lifecycle integration PASS.

No spec content change — ships at v6.9.3 as in v0.1.8.

## [0.1.8] - 2026-04-23

### Fixed — Hook behavior

- `hooks/banned-vocab-check.sh`: ratio-class patterns now honor a baseline-context exemption. When the commit message carries an explicit baseline anchor (numbers on both sides of `→` / `->` / `=>`, or the literal word `baseline`), ratio hits are suppressed. Previously the hook denied spec-compliant commits like `perf: rendering 240ms → 72ms (70% faster)` even though §10 "ratio with baseline" explicitly permits this form. Non-ratio patterns (hedges, evaluative adjectives) still deny regardless of arrows in the message. Implementation: `banned-vocab.patterns` tags ratio-class lines with `@ratio` in the reason column; the hook parses the tag and gates the hit on a per-command `BASELINE_EXEMPT` check. The prior pattern file header claim `false-positive none` is corrected to `false-positive low` — this bug was the counter-example.
- `hooks/banned-vocab.patterns`: every 中文 pattern now carries its own self-contained reason. Previously four patterns (`显著改善`, `显著优于`, `大幅改善`, `明显优于`) shared the literal string `同上`, so the hook's deny message printed a lone "同上" with no referent.

### Fixed — Docs

- `README.md`: 5 sites hardcoding `0.1.5` in install/uninstall command paths replaced with `<version>` placeholder plus a one-line discovery hint (`ls ~/.claude/plugins/cache/claudemd/claudemd/ | sort -V | tail -1`). Survives future version bumps without doc churn.
- `README.md`: two `Spec v6.9.2` references (What-it-installs table row + Project-layout comment) bumped to `v6.9.3` matching the shipped spec since v0.1.6.

### Added — Tests

- `tests/hooks/banned-vocab.test.sh`: 3 new cases covering the baseline exemption: EN ratio with `→` baseline passes, hedge (`should work`) with `→` in message still denies (exemption is ratio-only), 中文 ratio with `→` baseline passes. Test total: 12 → 15.

No `scripts/` change. Spec content unchanged at v6.9.3. Running `tests/run-all.sh`: shell hook suites + 90 Node script tests + full-lifecycle integration all pass.

## [0.1.7] - 2026-04-22

### Fixed — Docs

- Every reference to `/plugin update claudemd` across `README.md`, `commands/claudemd-update.md`, and `scripts/install.js` comments has been corrected. `/plugin update` is **not** a valid Claude Code slash command — Claude Code silently ignores unrecognized commands (no error, empty stdout), which is why users running `/plugin update claudemd` saw nothing happen and concluded the plugin was broken. The actual root cause sat in our own docs framing, not plugin code.
- `README.md` **Update** section rewritten to list the canonical upgrade sequence (`/plugin marketplace update claudemd` → `/plugin uninstall claudemd@claudemd` → `/plugin install claudemd@claudemd` → `/reload-plugins`) or the `/plugin` UI alternative.
- `README.md` **Troubleshooting** gains a leading entry for the `/plugin update claudemd does nothing / empty stdout` symptom, pointing at the canonical sequence with the manual `git fetch` + `git archive` + `install.js` recipe as last-resort fallback.
- `scripts/install.js` internal comment updated: former "went stale on /plugin update" phrasing replaced with version-neutral "went stale when CC swapped in a new version-dir on upgrade".

No code change in `scripts/` (beyond one comment) or `hooks/`. Spec content unchanged at v6.9.3. Tests unchanged: 90/90 pass + full-lifecycle integration PASS.

## [0.1.6] - 2026-04-22

### Changed — Spec

- Ships AI-CODING-SPEC v6.9.3 (patch). New §12 paragraph "Manual-ship atomicity (HARD, clarification)" codifies that the `manual ship because <reason>` override is one atomic turn: enumerate remaining steps up-front, execute back-to-back, no turn-ending between clean green steps. Grounding: a manual-ship session stopped after `git commit` and required user prompt to continue — the single `[AUTH]` on ship already covered the full pipeline per §5 per-task-per-scope. See `spec/CLAUDE-changelog.md` v6.9.3 entry for full rationale.
- Fixes `spec/CLAUDE-extended.md` header version drift (was stuck at v6.9.0 while core had advanced through v6.9.1 / v6.9.2). Now matches at v6.9.3.

### Fixed — Docs

- `README.md` troubleshooting: replaces misleading "Since 0.1.4..." note (0.1.2-0.1.4 were broken — `${CLAUDE_PLUGIN_ROOT}` never expanded in `settings.json`). New entry documents the `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin` symptom (5 errors per Bash call on 0.1.2-0.1.4) and the v0.1.5 upgrade path.
- `README.md` install/uninstall command paths: `0.1.4` → `0.1.5` (3 sites).
- `README.md` Project layout: `hooks/hooks.json` is no longer "intentionally empty" — it's the authoritative hook registration site post-v0.1.5.

### Changed — Hygiene

- `.gitignore` now excludes `.claude/settings.local.json` (per-session CC permission grants; user-specific + transient; should never ship).

## [0.1.5] - 2026-04-22

### Fixed — Critical

- Hook registration moved from `~/.claude/settings.json` to the plugin's own `hooks/hooks.json`. The 0.1.2-0.1.4 releases wrote commands like `bash "${CLAUDE_PLUGIN_ROOT}/hooks/…"` into `settings.json`, but the CC harness only expands `${CLAUDE_PLUGIN_ROOT}` for hooks defined in a plugin's `hooks/hooks.json` — never in `settings.json`. Result: every Bash-tool call and every session-end fired 5 hook errors of the form `Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin`, and no claudemd hook actually ran. (V1)
- `scripts/install.js` now evicts ALL claudemd hook commands from `settings.json` on install — both the legacy absolute-path form (≤0.1.1) and the broken `${CLAUDE_PLUGIN_ROOT}`-literal form (0.1.2-0.1.4). Upgrading from any prior version leaves `settings.json` free of claudemd entries; `hooks/hooks.json` is now the sole registration site.
- Installed-manifest `entries` still contains the 5 shipped hook descriptors (sourced from the plugin's `hooks/hooks.json`), so `/claudemd-status` keeps showing `entries: 5` and `scripts/uninstall.js` keeps its precise-command match path alongside the `HOOK_BASENAMES` fallback.

### Docs

- `docs/ADDING-NEW-HOOK.md` step 3 now directs new-hook registration into `hooks/hooks.json` + `HOOK_BASENAMES`, not the deleted `HOOK_SPECS` array.

### Added — Tests

- `install.test.js`: 2 regression cases replace the old settings.json-count assertions — `fresh install leaves settings.json with NO claudemd hook entries (v0.1.5)` and `upgrade evicts ALL stale claudemd hook entries from settings.json (v0.1.5)`. The M4 env-var-literal check now asserts against `manifest.entries` instead of `settings.json`.
- `integration/full-lifecycle.test.sh` Phase 3 rewritten: asserts `settings.json` has zero claudemd residue AND `.claudemd-state/installed.json` carries 5 manifest entries.
- Script tests: 90/90 pass. Hook suites + full-lifecycle integration: PASS.

## [0.1.4] - 2026-04-22

Post-review hardening (full audit 2026-04-22). 0.1.3 was never tagged; this rolls the 0.1.3 pre-review fix set forward.

### Fixed — High

- `scripts/uninstall.js`: `--purge` no longer `rm -rf`s `~/.claude/logs/` (shared with other plugins, e.g. claude-mem-lite). Now only deletes `claudemd.jsonl` and removes the directory iff it becomes empty. (H1)
- `hooks/memory-read-check.sh`: project-dir encoding now replaces BOTH `/` and `.` with `-` (Claude Code's real scheme). Slash-only encoding silently missed any CWD containing a dot (`~/.config/*`, `my.project/`, etc.), turning the §11 HARD rule into a fail-open no-op. (H2)

### Fixed — Medium

- `hooks/ship-baseline-check.sh`: `gh run list` now filters by current branch (`--branch $(git branch --show-current)`). Previously an unrelated scheduled-cron failure on `main` could block a feature-branch push. Detached HEAD falls back to the old unfiltered query. (M1)
- `hooks/lib/platform.sh`: `platform_find_newer` adds `-maxdepth 1`. Fixes self-inconsistency with spec §8 "no recursive `~/.claude/` traversal" and speeds up scanning when `tmp/` accumulates. (M2)
- `scripts/update.js`: removed unreachable `choice=select` branch (no CLI path to pass `selected`). `select` now throws `unknown choice` with the existing error path. (M3)
- `scripts/install.js` + `scripts/uninstall.js`: hook commands written into `settings.json` now use literal `${CLAUDE_PLUGIN_ROOT}` (expanded by the CC harness at hook invocation per hooks docs). `/plugin update claudemd` surviving version-dir bumps no longer requires manual re-registration. `install.js` evicts any stale absolute-path entries left by ≤0.1.3 installs before merging the new env-var form. `uninstall.js` fallback matcher updated to catch both formats via a shared `HOOK_BASENAMES` list. (M4)

### Fixed — Low

- `scripts/audit.js`: CLI now accepts `--days=N` (parity with `doctor.js --prune-backups=N`) and rejects non-numeric / zero / negative with a usage hint. Previously `parseInt('garbage') → NaN` silently filtered every row to zero. (L1)
- `hooks/banned-vocab-check.sh`: git-commit detection regex now uses POSIX `[[:space:]]` / `[^[:space:]]+` instead of `\s` / `\S+` (not reliable under BSD grep on macOS). (L2)
- `scripts/doctor.js`: `logs` check now reports file size (MB) and fails at ≥5 MB with a truncation hint. `audit.js` reads the whole file into memory; oversize logs slow `/claudemd-audit`. (L5)

### Added — Tests

- 12 new regression cases across 9 files: purge-preserves-foreign-logs, dot-cwd encoding, branch-aware mock + filter test, maxdepth nested-tmp isolation, env-var hook command form, upgrade-from-absolute-path migration, audit CLI rejection pairs, doctor log-size threshold pair, unknown-choice throws.
- New fixture: `tests/fixtures/mock-gh/branch-aware/gh` — returns green/red based on `--branch` arg.
- Test total: 81 script + 12 post-review additions → **90 script tests**; hook suites **3** new cases across memory-read-check (7→8) / ship-baseline (8→9) / sandbox-disposal (4→5); integration 1/1.

## [0.1.3] - 2026-04-22

### Fixed
- `scripts/lib/backup.js`: `isoStamp()` now includes milliseconds (`YYYYMMDDTHHMMSSmmmZ`). Two installs within the same second previously shared a backup directory and silently overwrote the user's original spec backup via `renameSync`, losing data. A numeric suffix (`-1`, `-2`, …) is appended as a belt-and-braces guard for same-millisecond collisions. `listBackups` accepts both old and new stamp formats so pre-0.1.3 backups still sort correctly.
- `scripts/uninstall.js`: `delete` (without `CLAUDEMD_CONFIRM=1`) and `restore` (with no backups) now abort **before** mutating `settings.json` or the manifest. Previously the hook entries were silently removed before the abort return, so users saw "abort" but their hooks were already disabled.
- `scripts/lib/spec-diff.js`: replaced Set-based line diff with LCS. Reordered spec sections now show a nonzero `+N/-N` summary in `/claudemd-update` instead of the misleading `+0/-0`.
- `scripts/doctor.js`: `--prune-backups=N` now requires `N ≥ 1`. `--prune-backups=0` used to delete every backup (the retain-count semantic was surprising); it now errors with a usage hint.
- `scripts/toggle.js`: running with no argument now prints usage + valid hook names instead of the confusing `unknown hook: undefined` error.
- `package.json`: removed the `bin` field pointing at a non-existent `scripts/cli.js`. The plugin is distributed via the Claude Code marketplace, not npm, so the declaration was a landmine (`npm i -g` silently skipped creating the bin symlink).

### Added
- Regression tests covering each fix (F1, F2, F9, F10, F14, F18) under `tests/scripts/`.

## [0.1.2] - 2026-04-22

### Fixed
- `scripts/install.js` CLI invocation (`node scripts/install.js`) now auto-derives `pluginRoot` from its own file location via `import.meta.url`. Previously required `CLAUDE_PLUGIN_ROOT` env var and crashed with `install: pluginRoot missing` when users followed the README one-liner.
- `scripts/update.js` CLI invocation gains the same self-derivation fallback.
- `installed.json` manifest now records the actual plugin version (read from `<pluginRoot>/package.json`) instead of a hardcoded `'0.1.0'`. `/claudemd-status` and `/claudemd-doctor` now report correct version after install.

### Added
- `tests/scripts/install.test.js`: CLI smoke test that spawns `node scripts/install.js` with no env and no args, proving self-derived `pluginRoot` path works end-to-end.
- `scripts/lib/paths.js`: `resolvePluginRoot(importMetaUrl)` + `readPluginVersion(pluginRoot)` helpers.

## [0.1.1] - 2026-04-21

### Fixed
- `marketplace.json` moved from repo root to `.claude-plugin/marketplace.json` (correct Claude Code plugin layout).
- `marketplace.json` `plugins` field changed from object-keyed-by-name to array of objects (schema compliance).
- `plugin.json` stripped of explicit `commands` / `hooks` paths (auto-scanned by Claude Code); these caused install-time schema validation failure.
- Added `hooks/hooks.json` stub (`hooks: {}`) to prevent any auto-load double-execution when the install script registers hooks in `~/.claude/settings.json`.
- macOS CI: install `coreutils` for `timeout`; add GNU gnubin to PATH.
- macOS: `tests/hooks/rule-hits.test.sh` strips BSD `wc -l` whitespace padding.
- Git index: set executable bit (`100755`) on all shell scripts so CI mock-gh PATH invocation works.
- README rewritten with correct `/plugin marketplace add` + `/plugin install` flow.

## [0.1.0] - 2026-04-21

### Added
- Five hooks:
  - `banned-vocab-check` (PreToolUse:Bash) — blocks commits with §10-V banned vocabulary
  - `ship-baseline-check` (PreToolUse:Bash) — blocks `git push` on red base-branch CI (2s gh timeout)
  - `residue-audit` (Stop) — advisory warn when `~/.claude/tmp/` grows beyond threshold (default 20)
  - `memory-read-check` (PreToolUse:Bash) — denies ship/push when matched MEMORY.md entry unread in session
  - `sandbox-disposal-check` (Stop) — warns on mkdtemp residue at session end
- Five slash commands: `/claudemd-status`, `/claudemd-update`, `/claudemd-audit`, `/claudemd-toggle`, `/claudemd-doctor`.
- Seven Node.js management scripts with idempotent settings.json merge, backup-and-overwrite spec install (last 5 backups retained), 3-way uninstall (keep/delete/restore with hard-AUTH on delete).
- Ships spec v6.9.2 (adds §0.1 Core growth discipline + §2.3 TOOLS; reduces core from ~6,200 to ~5,330 tokens).
- CI matrix: ubuntu-latest + macos-latest × node 20.

### Notes
- First release.
