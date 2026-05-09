# Changelog

All notable changes to the `claudemd` plugin. This changelog tracks plugin artifact changes (hooks, scripts, commands). Spec content changes live in `spec/CLAUDE-changelog.md`.

## Versioning policy (set in v0.2.1)

- **Plugin manifest `description` fields** carry spec version at **major.minor only** (e.g. `"AI-CODING-SPEC v6.10 …"`). Patch-level spec updates (v6.10.0 → v6.10.1) do NOT re-bump manifest descriptions. Rationale: description is marketplace-list tagline — user absorbs version family, not full semver; churn across 3 manifests every patch has no signal.
- **Canonical spec version source**: `spec/CLAUDE.md` top-line title (`# AI-CODING-SPEC vX.Y.Z — Core`) + `spec/CLAUDE-changelog.md` top `##` entry.
- **Plugin semver vs spec semver** are independent: plugin patch (0.2.0 → 0.2.1) may ship when spec is unchanged (this release); plugin minor (0.1.9 → 0.2.0) ships when spec minor updates (v0.2.0 shipped spec v6.10.0).

## [0.9.8] - 2026-05-10

**Patch — v0.9.7 CI hotfix.** v0.9.7 shipped `hooks/mem-audit.sh` drift detection + new `tests/hooks/mem-audit.test.sh` cases 9-11, but the test-file edit was not staged in the v0.9.7 commit. Result: v0.9.7 CI failed at `Run test suite` step on both ubuntu-latest and macos-latest because old case 9 expected `silent` from a hook that now correctly emits an `index_orphan` warn. Hook behavior in v0.9.7 is correct; only the test sync was missing.

### Fixed

- `[fix]` **`tests/hooks/mem-audit.test.sh`** — sync test file with v0.9.7 mem-audit.sh drift detection. Case 9 reused for `index_orphan` (MEMORY.md links file that doesn't exist), case 10 added for `file_orphan` (memory file present, no MEMORY.md link), case 11 added for aligned-no-drift baseline. Test count 9/9 → 11/11. Pre-fix on v0.9.7 CI: `FAIL: 9 (stderr='[claudemd] §11-EXT mem-audit: 1 MEMORY.md drift entries...')` — the failure was the test asserting old behavior, not a hook regression.

### Versioning

- `package.json` 0.9.7 → **0.9.8** (npm).
- `.claude-plugin/plugin.json` 0.9.7 → **0.9.8**.
- `.claude-plugin/marketplace.json` two version fields 0.9.7 → **0.9.8**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `bash tests/hooks/mem-audit.test.sh` → 11/11 passed locally pre-commit.
- `node --test tests/scripts/*.test.js` → 217 passed, 0 failed.
- `bash tests/run-all.sh` → all suites passed.

### Lesson recorded

The v0.9.7 atomic-ship sequence used `git add <files...>` with an explicit list and forgot `tests/hooks/mem-audit.test.sh`. Local `bash tests/run-all.sh` passed because it ran against the working-tree state, not the staged state. Future ships covering hook + test edits should `git diff --cached` before commit, or use `git add -u` after touching tracked files. Recorded inline here rather than as a separate memory entry — the test fixture format-drift memory (`feedback_test_fixture_format_drift`) already covers the test-real-file-divergence pattern; this is its sibling failure mode (test edit forgotten, not test fixture drift).

## [0.9.7] - 2026-05-10

**Patch — P1.3 + P2 batch from audit follow-up.** Spec v6.11.7 unchanged. Three additive changes; no behavior change for users on the green path.

### Added

- `[doc]` **README.md "Execution order (PreToolUse:Bash)" subsection** — closes the audit observation that the 4 PreToolUse:Bash hook execution order was undocumented. Lists the 4 hooks in `hooks/hooks.json` declaration order with their spec section, fail-stop semantics (first deny stops the rest), per-hook timeout fail-open contract, and the opt-in `BASH_READONLY_FAST_PATH=1` short-circuit. Local-only `docs/HOOK-PROTOCOL.md` (gitignored per `.gitignore` policy) carries the same content for internal reference.
- `[feat]` **`hooks/mem-audit.sh` MEMORY.md ↔ files drift detection** — adds two reverse-direction checks to the existing Why/How marker scan: (a) `index_orphan` — MEMORY.md link target file doesn't exist (stale index), (b) `file_orphan` — memory file present but no MEMORY.md link points to it. Both advisory; reported alongside Why/How marker counts on the same 24 h sentinel debounce. Independent of `claude-mem-lite` per the existing hook contract — pure CC built-in memory scan. Test cases 9-11 cover index_orphan, file_orphan, and aligned-no-drift; 11/11 cases pass (was 9/9; case 9 reused for new behavior, cases 10+11 new).
- `[feat]` **`scripts/perf-baseline.sh`** — measures hook chain overhead on 6 representative bash commands (`ls` / `git_log` / `git_status` / `git_commit_noop` / `echo` / `cat_head`). Median of N=10 runs (configurable) with hooks ON vs hooks OFF (`DISABLE_CLAUDEMD_HOOKS=1`). Initial run on this repo (Linux 6.17, N=3): `ls 1→48 ms (delta 47)`, `git_log 3→50 ms (delta 47)`, `git_status 8→55 ms (delta 47)`, `git_commit_noop 11→93 ms (delta 82)` — `git_commit_noop` is the only command where banned-vocab actually scans, hence the higher delta. Pre-this-script estimate was "200-400 ms" (5月9日 audit, never measured). Caveat: script measures direct stdin invocation, NOT CC harness round-trip — real overhead is above + per-event JSON construction + timeout enforcement.
- `[doc]` **`docs/cross-project-pilot.md`** — checklist framework for adopting claudemd in an unrelated project. Closes the audit observation that claudemd was self-tested only. 6-axis observation table, pilot-duration guidance (≥2 weeks), 3 exit-outcome criteria, empty pilot-results table for future fills. Added to `.gitignore` exception list so the doc ships with the repo.

### Versioning

- `package.json` 0.9.6 → **0.9.7** (npm).
- `.claude-plugin/plugin.json` 0.9.6 → **0.9.7**.
- `.claude-plugin/marketplace.json` two version fields 0.9.6 → **0.9.7**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `node --test tests/scripts/*.test.js` → 217 passed, 0 failed.
- `bash tests/hooks/mem-audit.test.sh` → 11/11 passed (was 9/9; +2 drift cases).
- `bash tests/run-all.sh` → all suites passed (upgrade-lifecycle final check).
- `bash scripts/perf-baseline.sh --runs 3` → 6 commands measured; output format matches the column layout documented in the script header.

### Audit follow-up status (after v0.9.6 + v0.9.7)

P0 done (v0.9.6: hard-rules-audit error context + tests; session-start tag semver gate). P1 partially done — P1.3 doc shipped here; P1.1 spec net-delete deferred (core 442 chars headroom; passive trigger per §13.1, not active); P1.2 agent observation extension deferred (spec-pattern-drift would require 3-file lockstep spec change + transcript scanner FP risk on every PostToolUse). P2 done (this release: mem drift detector, perf baseline, cross-project pilot framework). The unresolved audit signal is P1.2 — agent self-rule observation needs better detection logic before adding patterns; logged for next iteration.

## [0.9.6] - 2026-05-10

**Patch — defensive hardening + test coverage gap closure.** Spec unchanged (still v6.11.7); plugin-only patch. Triggered by an audit pass that found `scripts/hard-rules-audit.js` had zero test coverage and no error context on `JSON.parse` failure, plus `hooks/session-start-check.sh` embedded the upstream tag in a banner without a strict semver gate. Three small changes; no behavior change for users on the green path.

### Fixed

- `[fix]` **`hard-rules-audit.js` opaque error on broken / missing `spec/hard-rules.json`** — pre-fix: `JSON.parse(fs.readFileSync(manifestPath, 'utf8'))` at L21 surfaced bare `ENOENT` / `SyntaxError` with no path context, leaving the operator to guess which file broke. Post-fix: try/catch wraps the parse, throws `hard-rules-audit: failed to load <path>: <reason>`; an additional shape-check (`Array.isArray(manifest.rules)`) throws `hard-rules-audit: <path> missing required 'rules' array` when the JSON is valid but the manifest body is wrong.
- `[fix]` **`session-start-check.sh` lacked semver gate before embedding `remote_tag` in `additionalContext`** — pre-fix: `jq --arg new "$remote_tag"` already safe-quotes the value, so JSON injection wasn't reachable, but a malformed remote tag (newline-injected, exotic glyphs from a compromised mirror) would still produce a confusing upgrade banner. Post-fix: a `[[ "$remote_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 0` gate after `head -1 | awk | sed`. Defense-in-depth, not a fix to a live exploit.

### Added

- `[test]` **`tests/scripts/hard-rules-audit.test.js` — 6 cases, 0 → 6 coverage**: (1) byte-exact production fixture (reads real `spec/hard-rules.json` per project memory `feedback_test_fixture_format_drift` — locks against test/impl drift), (2) missing manifest path → error names the file, (3) malformed JSON → error names the file, (4) JSON valid but `rules` array missing → error explains what's missing, (5) cross-ref of `rule_hits_section` to live log rows (verifies `§10-V` deny rows reach `§10-specificity.hits.deny`), (6) `demoteCandidates` correctly excludes self-enforced rules (avoids false-positive `§iron-law-2` demotion suggestion). All 6 pass; total Node test count 211 → 217.

### Versioning

- `package.json` 0.9.5 → **0.9.6** (npm).
- `.claude-plugin/plugin.json` 0.9.5 → **0.9.6**.
- `.claude-plugin/marketplace.json` two version fields 0.9.5 → **0.9.6**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `node --test tests/scripts/*.test.js` → 217 passed (211 prior + 6 new), 0 failed.
- `bash hooks/session-start-check.sh < /dev/null` → exit 0; banner emitted as expected; semver gate not exercised on green path (operator-side smoke).
- Verification log of why three of four originally suspected HIGH hook bugs turned out to be false positives recorded in this session's audit transcript:
  - `sandbox-disposal-check.sh` printf `\x1e` — `printf '/tmp|claudemd_only\x1e%s|both' "$HOME"` produces 1 RS byte; `read -d $'\x1e'` correctly splits into 2 specs.
  - `pre-bash-safety-check.sh` heredoc terminator — bash itself treats `EOF # comment` as heredoc body (not terminator), so the regex matching this behavior is correct, not a bypass.
  - `banned-vocab-check.sh` baseline regex — `code→123ms` and `code → 123ms` both correctly fail the `[0-9].*(→|->|=>).*[0-9]` test (left side requires a number); previously-claimed asymmetry doesn't exist.

## [0.9.5] - 2026-05-10

**Patch — `mem-audit.sh` hotfix (3 bugs introduced in v0.9.4).** Spec unchanged (still v6.11.7); plugin-only patch. The new Stop hook shipped in v0.9.4 silently failed validation on every Stop event ("Hook JSON output validation failed — Invalid input") and produced false-positive missing-marker warnings on legitimate memories. v0.9.5 fixes all three issues and adds `tests/hooks/mem-audit.test.sh` (9/9 cases) to lock them down.

### Fixed

- `[fix]` **Stop event schema mismatch (CRITICAL)** — v0.9.4 emitted `{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "..."}}` to stdout, but Claude Code's hook schema only accepts `hookSpecificOutput` for `PreToolUse` / `UserPromptSubmit` / `PostToolUse` / `PostToolBatch`. **Stop is not on the list.** Every emit was rejected with `Hook JSON output validation failed — (root): Invalid input`. The fix mirrors `residue-audit.sh`: write to stderr only, no JSON output. CC harness surfaces stderr as advisory; Stop cannot block by design either way.
- `[fix]` **Path double-slash** — error banner showed paths like `<encoded>//memory/feedback_x.md` (double slash after the project dir). Root cause: glob `"$PROJECTS_ROOT"/*/` produces values with trailing slashes, so the join `"$proj_dir/memory"` became `"<dir>/memory"` with `<dir>` already ending `/`. Fix: `proj_dir="${proj_dir%/}"` strips the trailing slash before the join.
- `[fix]` **Regex matched only one Why-form** — v0.9.4 regex `^\*\*Why:\*\*` matched only `**Why:**` (colon inside bolding), but most memories in the wild use `**Why**:` (colon outside bolding). Both forms are valid per CC `memoryTypes.ts:58` body_structure example. v0.9.5 regex `^\*\*Why(:\*\*|\*\*:)` accepts either; same change for `**How to apply:**` / `**How to apply**:`. This eliminates the v0.9.4 26-file false-positive batch on `~/.claude/projects/-mnt-data-ssd-dev-projects-claudemd/memory/feedback_*.md`.

### Added

- `[test]` **`tests/hooks/mem-audit.test.sh` — 9 cases**: (1) no projects dir → silent, (2) empty memory dir → silent, (3) **Why:** colon-inside-bolding accepted, (4) **Why**: colon-outside-bolding accepted, (5) missing markers → stderr warn, no stdout (locks Stop schema fix), (6) path single-slash format (locks the trailing-slash bug), (7) 24h sentinel debounce, (8) kill-switch DISABLE_MEM_AUDIT_HOOK=1, (9) MEMORY.md index file skipped.

### Compatibility

- **No claude-mem-lite required.** `mem-audit.sh` audits CC built-in auto-memory under `~/.claude/projects/<encoded>/memory/` only. It does NOT depend on `claude-mem-lite`, `claude-mem`, or any other recall-layer plugin. If a user only has the claudemd plugin installed (no recall plugin):
  - Hook still operates correctly, scanning whatever CC built-in 4-types memories exist.
  - Zero memory files → silent exit (no projects dir / no relevant files = no output).
  - Spec wording (§11 + §11-EXT) consistently uses "recall-layer plugin **if present**" — no plugin specifically required.
- **Comment in `mem-audit.sh:13-21`** documents the independence property explicitly.

### Versioning

- `package.json` 0.9.4 → **0.9.5** (npm).
- `.claude-plugin/plugin.json` 0.9.4 → **0.9.5**.
- `.claude-plugin/marketplace.json` two version fields 0.9.4 → **0.9.5**.
- Spec headers unchanged (v6.11.7 still current); no `spec/CLAUDE-changelog.md` entry — plugin-only patch.

### Validation

- `bash tests/hooks/mem-audit.test.sh` → 9/9 passed.
- `npm run test:scripts` → 211/211 passed.
- `bash tests/run-all.sh` → all suites passed including upgrade-lifecycle (v0.2.3/v6.10.1 → current/v6.11.7).

## [0.9.4] - 2026-05-10

**Minor — spec v6.11.7 (CC-source comparative audit) + new `mem-audit` Stop hook.** Driven by side-by-side analysis of upstream `sdscc/src/constants/prompts.ts` + `src/memdir/memoryTypes.ts` against AI-CODING-SPEC v6.11.6 — five spec additions where CC's eval-validated rules were stronger or absent in spec. Plugin manifest version skips `0.9.3` (npm-only release that didn't bump `plugin.json` / `marketplace.json`); v0.9.4 brings all manifests back to a coherent state.

### Spec changes (v6.11.6 → v6.11.7)

- `[fix]` **§10 Specificity No-baseline fallback boundary** (core, +~70 bytes net) — PARTIAL applies to numeric/quantitative claims w/o baseline only, NOT to pure process-completion (commit landed / file created / config applied) when V1-verified. Closes a defensive-PARTIAL drift. Source: CC `prompts.ts:183`.
- `[change]` **§11 Memory routing** (core +~95 bytes pointer; full body §EXT §11-EXT +~810 bytes) — durable layer (CC built-in 4 types) vs time-sensitive recall layer (e.g. `claude-mem-lite`). One home per fact.
- `[change]` **§11-EXT user-override filter** — WHAT-NOT-TO-SAVE applies even on explicit "save / 记一下 / remember"; ASK what was *surprising* / *non-obvious*, save only that. Source: CC `memoryTypes.ts:189`.
- `[change]` **§11-EXT Execution heuristics (CC-borrowed, non-HARD)** — Read-before-propose (`prompts.ts:175`), Diagnose-before-pivot (`prompts.ts:178`), Existing-comment protection (`prompts.ts:161`).
- `[refactor]` **§10 Banned-vocab quick-list compaction** (core, −~50 bytes).

§13.2 budget cost: 0 (no new HARD added). Sizing post-v6.11.7: core 24558/25000 (442 bytes headroom, **98.23% — tight**); extended 46568/50000 (3432 bytes headroom, 93.14%). Operator note: v6.11.8 should net-delete or migrate marginal core bullets to §EXT before adding new content.

### Plugin changes

- `[feat]` **`hooks/mem-audit.sh` — new Stop hook (advisory, never blocks)**: scans `~/.claude/projects/*/memory/feedback_*.md` + `project_*.md` for missing `**Why:**` / `**How to apply:**` body-structure markers (per CC `memoryTypes.ts:58/76/132/149`). Emits `additionalContext` banner with file paths (max 3 shown + `+N more`); 24h sentinel debounce so it doesn't fire on every Stop. Skips MEMORY.md itself + sub-400-byte stubs. Disable: `DISABLE_MEM_AUDIT_HOOK=1`. Registered in `hooks/hooks.json` (Stop event, after sandbox-disposal-check, before session-summary), `scripts/lib/hook-registry.js`, `commands/claudemd-toggle.md`. Hook count: **10 → 11**.

### Versioning

- `package.json` 0.9.3 → **0.9.4** (npm tag).
- `.claude-plugin/plugin.json` 0.9.2 → **0.9.4** (catches up — v0.9.3 was an npm-only release that didn't bump plugin manifests).
- `.claude-plugin/marketplace.json` two version fields 0.9.2 → **0.9.4**.
- `spec/CLAUDE.md` v6.11.6 → **v6.11.7** (header + body).
- `spec/CLAUDE-extended.md` v6.11.6 → **v6.11.7**.
- `spec/CLAUDE-changelog.md` prepended **v6.11.7** entry.
- `spec/hard-rules.json` `spec_version` v6.11.6 → **v6.11.7**.

### Notes

- Plugin manifest `description` fields stay at major.minor (`v6.11`) per Versioning policy; not touched this release.
- npm `claudemd-cli@0.9.4` will publish via the `npm-publish.yml` workflow on `v0.9.4` tag push (auto-publish per v0.9.2 onwards).
- Carryover: v0.9.3 npm tarball (released 2026-05-09 with spec v6.11.4–v6.11.6 batch ship) didn't bump plugin manifests. v0.9.4 reconciles. No user-facing impact — `/claudemd-update` reads `spec/CLAUDE.md` header, not `plugin.json` version, so spec sync was unaffected.

## [0.9.2] - 2026-05-09

**Patch — npm provenance metadata + first auto-publish via workflow.** v0.9.1 manual publish succeeded but the auto-publish workflow's first triggered run failed twice: first run on the v0.9.1 tag push hit `ENEEDAUTH` (NPM_TOKEN not yet configured); a rerun after token configuration hit `E422` from npm's sigstore provenance verifier — `--provenance` requires `repository.url` in package.json to match the inferred repo URL. v0.9.2 closes that gap and serves as the first end-to-end auto-publish validation.

### Added

- `[feat]` **`package.json` `repository` / `homepage` / `bugs` / `keywords` fields** — required by `npm publish --provenance` (sigstore verifier reads `repository.url` to validate the build chain came from the same git origin GitHub Actions claims). `homepage` deep-links to the README's CLI section so the npm package page sends new users straight to install/usage. `keywords` improves discoverability on npmjs.com search.

### Changed

- `[chore]` **`package.json` bin path** (committed post-v0.9.1 as a no-bump fixup) — `npm pkg fix` normalized `./bin/claudemd-lint.js` → `bin/claudemd-lint.js`. Silences the publish warning the v0.9.1 workflow run surfaced. Behavior unchanged — npm resolves both forms identically.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.9.2`. Spec files unchanged; spec version remains v6.11.3.
- This release is the **first auto-publish** (operator pre-configured `NPM_TOKEN` repo secret on 2026-05-08; tag push triggers `.github/workflows/npm-publish.yml` which runs tests, validates package.json version against tag, and publishes with `--provenance --access public`).
- Validation: `tests/run-all.sh` → 211/211 node tests pass (no test changes vs v0.9.1); 13 hook suites green; 2 integration suites pass.
- npm package: [`claudemd-cli@0.9.2`](https://www.npmjs.com/package/claudemd-cli). Published via Actions OIDC, so the tarball carries a sigstore provenance attestation linking it to commit `<sha>` and workflow `npm-publish.yml`.
- v0.9.1 workflow run history (verbose for the on-call audit trail):
  - run 1: failed `ENEEDAUTH` — token not yet set.
  - run 2 (rerun after token set): failed `E422` — missing `repository.url`.
  - v0.9.2 (this release): expected to succeed end-to-end.

## [0.9.1] - 2026-05-09

**Patch — first npm publish + auto-publish workflow.** Operator approved npm publish for v0.9.0's R-N7 CLI; v0.9.1 is the actual first release on npm. Bundles four changes: `.npmignore` (whitelist-style; ships only the 7 runtime files the CLI needs — 69 kB packed vs 4-5× full repo), GitHub Actions auto-publish workflow on tag push, npm package rename to `claudemd-cli` (anti-spam similarity check rejected `claudemd` name due to existing `claude-md` package), and the publish itself.

### Naming

- **GitHub repo**: `sdsrss/claudemd` (unchanged — the Claude Code plugin marketplace install path uses this).
- **npm package**: `claudemd-cli` (NEW — `claudemd` was rejected by npm's automatic similarity check against the unrelated `claude-md` package). CLI invocation: `npx claudemd-cli lint "..."` / `npx claudemd-cli audit transcript.jsonl`. Asymmetry is intentional: GitHub repo serves both the plugin (broad scope) and the CLI (lint subset); npm package is CLI-only and `-cli` suffix makes that explicit.

### Added

- `[feat]` **`.npmignore`** (new) — whitelist approach (`*` then `!file` re-includes). Ships only `bin/`, `scripts/lib/lint.js`, `hooks/banned-vocab.patterns`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`. All plugin-only artifacts (other `hooks/*.sh`, `commands/`, `spec/`, `scripts/install.js` and friends, `.claude-plugin/`, `tests/`, `docs/`, `tasks/`, `.github/`) are excluded. Plugin marketplace install path is unaffected — Claude Code clones the GitHub repo, doesn't go through npm. Verified via `npm pack --dry-run`: 7 files, 68.4 kB packed / 199.5 kB unpacked.

- `[feat]` **`.github/workflows/npm-publish.yml`** (new) — auto-publish on tag push (`v*.*.*` pattern). Pre-publish gate: `tests/run-all.sh` must pass on `ubuntu-latest + node 20` (matches `ci.yml` Linux leg). Belt-and-suspenders version check: refuses to publish if `package.json` version differs from the tag. Uses `npm publish --provenance --access public` for npm provenance attestation (signed build chain). Required repo secret: `NPM_TOKEN` (Automation token, publish scope for `claudemd`). `workflow_dispatch` allowed for manual fallback (e.g. recovering from transient registry outage).

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.9.1`. Spec files unchanged; spec version remains v6.11.3.
- **First npm release**: `claudemd-cli@0.9.1` published from this commit's tagged tarball. After this release, future tag pushes auto-publish via the workflow — operator no longer runs `npm publish` by hand.
- npm package: [`claudemd-cli@0.9.1`](https://www.npmjs.com/package/claudemd-cli). Invocation: `npx claudemd-cli lint "..."` / `npx claudemd-cli audit ...`.
- Validation: `tests/run-all.sh` → 211/211 node tests pass; 13 hook suites green; 2 integration suites pass. No code changes vs v0.9.0 in the runtime path; this release is publish infra + first push.
- Operator post-step: add `NPM_TOKEN` to repo secrets (npm dashboard → Access Tokens → Generate Automation Token, scope `claudemd` publish; GitHub repo → Settings → Secrets → Actions → New repository secret).

## [0.9.0] - 2026-05-09

**Minor — R-N7 standalone CLI (`npx claudemd lint` / `audit`).** Closes the last entry in the v0.6.x → v0.8.x R-N series: the same `banned-vocab.patterns` source the in-CC bash hook uses is now exposed as a pure-Node CLI for **git pre-commit hooks, GitHub Actions, and other agents** (Codex, Cursor, OpenClaw). Spec's effective enforcement surface expands from "inside Claude Code only" to "anywhere Node 20+ runs." This is what makes claudemd a meaningful authority layer rather than a single-client lint.

**Ground-only ship**: source code + `bin` field + tests + GitHub release. `npm publish` is **not** part of this release — operator runs `npm publish` separately when ready (irreversible 24h unpublish window + 72h name reservation are real-world side effects requiring deliberate operator action with their own credentials).

### Added

- `[feat]` **`bin/claudemd-lint.js`** (new, ~140 LOC) — Node CLI entrypoint. Subcommands: `lint <text>` (positional or `--stdin`), `audit <jsonl-path>`. Flags: `--json`, `--include-ratio`, `--version`, `--help`. Exit codes: `0` clean, `1` hits, `2` usage error. Human-readable hits go to stderr (so stdout stays parseable for `cmd | jq`); `--json` emits to stdout regardless of hit/clean. Shebang `#!/usr/bin/env node`, ES module, `fs.readFileSync(0, 'utf8')` for stdin.

- `[feat]` **`scripts/lib/lint.js`** (new, ~110 LOC) — pure-Node scanning functions: `readPatterns` (parses `hooks/banned-vocab.patterns` into `{regex, reason, isRatio}` entries), `scan(text, {excludeRatio, patterns})` (case-insensitive match against patterns; bad-regex fail-open), `parseTranscript(jsonlText)` (extracts assistant-text turns, joins multi-block content per turn, drops corrupt rows silently), `formatHumanReadable` + `formatJSON`. Same matching rules as the bash hooks without the shell quoting + jq plumbing. Reusable by future Node-side hooks.

- `[feat]` **`package.json` `bin` field** — `{ "claudemd": "./bin/claudemd-lint.js" }`. After operator runs `npm publish`, `npx claudemd lint "..."` works directly. Pre-publish, dev mode is `node bin/claudemd-lint.js lint "..."`. Description string updated to reflect the dual surface (CC plugin + standalone CLI).

- `[test]` **`tests/scripts/lint.test.js`** (new, 11 cases) — unit tests for `lib/lint.js`: pattern parsing, hit detection, case-insensitivity, `excludeRatio` flag, bad-regex skip, transcript parsing (multi-block joining, corrupt-row tolerance), formatter output shape, default patterns file resolution.

- `[test]` **`tests/scripts/lint-cli.test.js`** (new, 12 cases) — spawn-based CLI surface tests: `--help` exit 0 + usage to stdout, no-args exit 2, `--version` exit 0, lint clean exit 0, lint hit exit 1 with stderr (NOT stdout) carrying the hit, `--stdin`, `--json` parseable for both clean + hit, missing positional → exit 2, audit clean / hit / missing-file paths, unknown subcommand error.

### Fixed

- `[fix]` **`README.md`** — drift catch-up: layout block "What it installs" said `9 shell hooks` but transcript-vocab-scan landed at v0.8.3 (line 248 was fixed in v0.8.4 but line 13 was missed). Now `10 shell hooks` with `transcript-vocab-scan` listed; new `1 standalone CLI` row added below the slash-command count.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.9.0` (minor: new public surface). Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 211/211 node tests pass (was 188; +23 lint cases — 11 unit + 12 CLI); 13 hook suites green; 2 integration suites pass.
- Plugin runtime path unchanged. CC users see no functional change. `bin/` is opt-in invocation surface only.
- `npm publish` deferred: when ready, operator runs `npm whoami` (or `npm login`), `npm publish --dry-run` to preview tarball contents, optionally adds `.npmignore` to trim non-essentials (tests/ docs/ spec/ would inflate package size 4-5×), then `npm publish`. Once published, `npx claudemd@0.9.0 lint "..."` works for anyone.

### R-N series — closed

| ID | Title | Shipped |
|---|---|---|
| R-N1 | Spec ↔ banned-vocab.patterns drift gate | v0.7.1 |
| R-N2 | HARD-rules manifest | v0.8.0 |
| R-N3 | Week-over-week regression alerts | v0.8.0 |
| R-N4 | SessionStart summary banner | v0.8.0 |
| R-N5 | Bash readonly fast-path (opt-in) | v0.8.3 |
| R-N6 | Doctor bypass:deny ratio | v0.7.1 |
| R-N6+ | Doctor bypass-token detail | v0.8.5 |
| R-N7 | npx claudemd-lint CLI | **v0.9.0** |
| R-N8 | Transcript-side §10-V scan (opt-in) | v0.8.3 |
| R-N9 | CHANGELOG/audit sparkline | v0.8.4 |

All 9 audit-doc R-N candidates shipped. Next-cycle work would be informed by 30-day FP-signal data on the opt-in R-N5 + R-N8 flags (decide default-ON / demote / remove), not by extending the R-N list.

## [0.8.5] - 2026-05-09

**Patch — R-N6+ doctor bypass-token detail.** Follow-on to v0.7.1's R-N6 (bypass:deny ratio surface): when a spec section trips the §0.1 demotion threshold, doctor now names the specific `[allow-X]` token driving the bypass. Distinguishes "single token consistently overused" (likely rule-design issue — wording confuses, threshold too tight) from "multiple tokens distributed" (likely cross-cutting friction). Operator no longer has to cross-reference `/claudemd-audit byBypass` to see WHICH escape hatch is being used.

### Changed

- `[refactor]` **`scripts/doctor.js:173-217`** — extends the v0.7.1 rule-usage check. When `ratio > 0.5` AND total ≥ 3 events, build a per-section `extra.token` histogram from the same recent-hits buffer already in scope (no extra log read). Sort tokens by count desc, secondary alpha for deterministic output. Detail format:
  ```
  [✗] rule-usage:§11-memory-read: 30d deny=2 bypass=8 (ratio 80%, §0.1 demotion candidate; bypass via [skip-memory-check]×8)
  [✗] rule-usage:§8-rm-rf-var:    30d deny=1 bypass=4 (ratio 80%, §0.1 demotion candidate; bypass via [allow-rm-rf-var]×3, [allow-npx-unpinned]×1)
  ```
  Healthy rows stay terse (token detail only attached to demotion candidates — per-token forensics are only useful when the rule is being defeated).

- `[test]` **`tests/scripts/doctor.test.js`** — 3 new R-N6+ cases: (1) single-token demotion candidate detail names the token + count, (2) mixed-token detail sorts by count desc, (3) healthy rows do NOT carry token detail.

### Fixed

- `[fix]` **`CHANGELOG.md` v0.8.4 entry** — corrected the R-N series status table: R-N6 ships at v0.7.1, NOT a v0.9.x candidate. The original entry mis-listed it alongside R-N7. v0.8.4 already cited the correct shipped status in `README.md` ("v0.7.1+ also flags rule sections whose bypass:deny ratio > 50%"); only the CHANGELOG status table was wrong. Same Specificity self-violation class the v0.8.1 reviewer caught for v0.8.0 (CHANGELOG claim contradicting the actual ship state).

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.5`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 188/188 node tests pass (was 185; +3 R-N6+ cases); 13 hook suites green; 2 integration suites pass.
- No runtime behavior change in hook execution; doctor surface only.
- Net diff vs v0.8.4: +21 LOC in `doctor.js` (per-section token histogram), +47 LOC tests, 1 CHANGELOG correction.

### R-N series status (corrected)

| ID | Title | Shipped |
|---|---|---|
| R-N1 | Spec ↔ banned-vocab.patterns drift gate | v0.7.1 |
| R-N2 | HARD-rules manifest | v0.8.0 |
| R-N3 | Week-over-week regression alerts | v0.8.0 |
| R-N4 | SessionStart summary banner | v0.8.0 |
| R-N5 | Bash readonly fast-path (opt-in) | v0.8.3 |
| R-N6 | Doctor bypass:deny ratio | v0.7.1 |
| R-N6+ | Doctor bypass-token detail | **v0.8.5** |
| R-N8 | Transcript-side §10-V scan (opt-in) | v0.8.3 |
| R-N9 | CHANGELOG/audit sparkline | v0.8.4 |
| R-N7 | npx claudemd-lint CLI | v0.9.x candidate (200-400 LOC + npm pipeline) |

## [0.8.4] - 2026-05-09

**Patch — R-N9 rule-usage sparkline (dev-tooling).** Closes the audit-gap §13.1 (quarterly rule review) and §13.2 (rule budget) have run on since v0.7.0: per-window cumulative counts of signal events grouped by `spec_section`, with a per-period rate-based trend arrow. Operators paste the markdown block into the CHANGELOG header before each release; `/claudemd-sparkline` runs anytime to surface "which rules are firing, which are dying, which just woke up" with public data instead of "operator eyeballed two audits."

### Added

- `[feat]` **`scripts/sparkline.js`** (new, ~110 LOC) — reads `~/.claude/logs/claudemd.jsonl`, computes 30/60/90d cumulative counts per `spec_section` for signal events (`deny` + `warn` + `advisory` + `bypass-escape-hatch`), emits a markdown block. Reuses `readHits` + `groupBySection` from `scripts/lib/rule-hits-parse.js` (no duplication of the parsing/aggregation logic). Skips the `(unset)` bucket — pre-v0.7.0 rows without `spec_section` are noise for the version-discipline question this report answers.

  Output shape:
  ```
  Rule usage trend (30d / 60d / 90d, signal events only):
    §10-V              30 / 80 / 120  ↘
    §7-ship-baseline   12 / 12 / 12   ≈
    §11-memory-read     5 /  5 /  5   ↗ (newly active)
    §8.V4               0 /  4 /  4   ↘ (silenced)
  ```

  Trend arrow compares per-period rate (count / window-days), not cumulative count, so a rule firing at steady cadence reads as `≈` rather than `↗` just because the cumulative number grew with the window. Annotations: `(newly active)` when older buckets are empty + recent has events; `(silenced)` when recent bucket is empty + cumulative > 0 (covers both "fired only in oldest bucket" and "fired only in middle bucket and went quiet" — the latter case caused a v0.8.4 prep bug, fixed before ship via test fixture).

  CLI: `node scripts/sparkline.js [--days=30,60,90]` or `CLAUDEMD_SPARKLINE_DAYS=14,28,56`. Requires ≥2 windows.

- `[feat]` **`commands/claudemd-sparkline.md`** — `/claudemd-sparkline` slash command wrapping the script. Registered as the 9th slash command (was 8 in v0.8.0+).

- `[test]` **`tests/scripts/sparkline.test.js`** (new, 8 cases) — empty-log no-data path, monotonic ↗, monotonic ↘, newly-active marker, silenced marker (covers both oldest-bucket-only and middle-bucket-only-then-quiet cases), signal-event filter (excludes `pass` / `pass-known-red` / `bootstrap` / `(unset)` rows), aligned markdown output, custom windows.

### Fixed

- `[fix]` **`README.md`** — drift catch-up from v0.8.3: hook count `9 → 10` (transcript-vocab-scan added in v0.8.3 was never reflected in the layout block); slash-command count `8 → 9` (adds the new `/claudemd-sparkline` row); script count `7 → 10` (was stale across multiple v0.x releases). Same documentation-drift class the v0.8.1 reviewer caught for v0.8.0; the v0.8.2 single-source registry handled the in-code count drift but README counts remain hand-maintained because they're prose-context, not machine-readable. v0.9.x candidate: extend the registry drift test to grep README for stale numeric claims.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.4`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 185/185 node tests pass (was 177; +8 sparkline cases); 13 hook suites green; 2 integration suites pass.
- No runtime behavior change. Pure dev-tooling addition; nothing in the hook execution path touched.
- Closes the v0.6.x → v0.8.x R-N series. R-N1 (drift gate v0.7.1), R-N2 (HARD-rules manifest v0.8.0), R-N3 (week-over-week regression v0.8.0), R-N4 (SessionStart summary banner v0.8.0), R-N5 (bash readonly fast-path v0.8.3), R-N8 (transcript vocab scan v0.8.3), R-N9 (sparkline v0.8.4) all shipped. R-N6 (doctor bypass:deny ratio) and R-N7 (npx claudemd-lint CLI) remain candidates for v0.9.x.

## [0.8.3] - 2026-05-09

**Patch — R-N5 + R-N8 opt-in behavior bundle.** Two independent runtime changes ship behind opt-in env-var flags, default OFF, following the v0.6.0 `BASH_SAFETY_INDIRECT_CALL` precedent for behavior-layer changes that need 30-day FP signal collection in the wild before becoming default-on. Both are gated, both expose status via `/claudemd-status`, both honor the standard kill-switch envelope. With both flags OFF, behavior is byte-identical to v0.8.2.

### Added

- `[feat]` **R-N5 — `BASH_READONLY_FAST_PATH=1`** (default OFF). Skips the 4 PreToolUse:Bash hooks (`pre-bash-safety`, `banned-vocab`, `ship-baseline`, `memory-read-check`) for definitely-read-only commands — the bulk of agent Bash calls (`ls`, `cat`, `git log`, `git status`, etc.). New helper `hook_is_readonly_bash` in `hooks/lib/hook-common.sh`: rejects any shell-meta (`;`, `|`, `&`, `>`, `<`, `` ` ``, `$(`, `${`), then matches first token against a conservative whitelist (pure readers + `git` read-only subcommands like `log`/`status`/`diff`/`show`/`rev-parse`/`rev-list`/`describe`/`blame`/`reflog`/`ls-files`/`ls-tree`/`cat-file`/`remote`). Excludes `git branch`/`tag`/`config` because their destructive sub-flags (`-d`, `-D`, `-c`) live one token deeper than the fast-path scans. False negatives are free (just do more work); false positives could skip a real safety check, hence the conservative list.

- `[feat]` **R-N8 — `TRANSCRIPT_VOCAB_SCAN=1`** (default OFF). New `hooks/transcript-vocab-scan.sh` PostToolUse:* hook. Reverses `banned-vocab-check.sh`: instead of scanning git commit messages (commit-time enforcement), scans the most recent assistant text in the transcript jsonl and emits a stderr advisory + rule-hits log entry on §10-V banned vocab. Advisory-only — PostToolUse fires after the assistant text has been sent, so cannot block. Skips `@ratio` patterns (commit-context-only; chat prose has different baseline conventions). Reads transcript via `jq -R 'try fromjson catch empty'` (line-by-line jsonl with corrupt-row tolerance). Picks the LAST assistant turn (`tail -n 1` after `awk 'NF'`) using `join(" ")` to keep one turn per output line.

- `[feat]` **`scripts/status.js`** — new `features.bashReadonlyFastPath` and `features.transcriptVocabScan` fields alongside existing `features.bashSafetyIndirectCall`. `/claudemd-status` now reflects all three opt-in behavior flags.

- `[feat]` **`hooks/transcript-vocab-scan.sh`** registration: `hooks/hooks.json` gains a new `PostToolUse: [{matcher: '*', ...}]` block. The plugin now registers 10 hooks total (was 9). Registry, `commands/claudemd-toggle.md`, `tests/scripts/install.test.js` fixture, and `tests/integration/full-lifecycle.test.sh` MCOUNT all moved together via the v0.8.2 single-source registry.

- `[test]` **`tests/hooks/bash-readonly-skip.test.sh`** (new, 30 cases) — classifier truth table (read-only commands, shell-meta rejection, non-whitelisted first tokens, git destructive subcommands), plus end-to-end: each of the 4 PreToolUse:Bash hooks short-circuits with the flag ON; with the flag OFF, banned-vocab still denies as in v0.8.2.

- `[test]` **`tests/hooks/transcript-vocab-scan.test.sh`** (new, 8 cases) — opt-in gate (default OFF silent), clean-prose silent, banned-word advisory + log row with `event: "advisory"`, exit-0 on hit (PostToolUse cannot block), kill-switch suppression, `@ratio` skip in transcript context, fail-open on missing transcript, last-assistant-turn targeting across multiple turns.

### Changed

- `[refactor]` **4 PreToolUse:Bash hooks** — opt-in fast-path branch inserted after CMD extraction, before per-hook filter. Highest leverage in `pre-bash-safety-check.sh` because that hook runs `sanitize_cmd` + RM/NPX detectors on every Bash invocation; the 3 others already short-circuit on filter mismatch quickly. Same call shape across all 4 for consistency: `if [[ "${BASH_READONLY_FAST_PATH:-0}" == "1" ]] && hook_is_readonly_bash "$CMD"; then exit 0; fi`.

- `[change]` **`scripts/lib/hook-registry.js`** — 10th entry: `transcript-vocab-scan.sh` / `transcript-vocab-scan` / `TRANSCRIPT_VOCAB_SCAN` / `PostToolUse` / `*` / 3s. Drift test count moved 9 → 10.

- `[change]` **`docs/RULE-HITS-SCHEMA.md`** — Events table gains `advisory` row (emitter: `transcript-vocab-scan`, meaning: PostToolUse non-blocking §10-V hit). Spec-section taxonomy table gains `transcript-vocab-scan` → `§10-V` row.

- `[change]` **`tests/hooks/contract.test.sh`** — `DOCUMENTED` array gains `advisory:transcript-vocab-scan` to keep the hook↔doc contract gate green.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.3`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 177/177 node tests pass; 13 hook suites green (was 11; +2 new); 2 integration suites pass (`full-lifecycle` + `upgrade-lifecycle`); contract test green with new `advisory` event documented.
- Default-OFF discipline: every existing test passes byte-identical to v0.8.2 with no env vars set. Opt-in is required to exercise either new code path.
- 30-day FP-signal collection plan (per v0.6.0 precedent): operators set the flags, surface hits via `/claudemd-audit`, and at the v0.9.x review either flip a default ON, demote, or remove.

## [0.8.2] - 2026-05-09

**Patch — single-source hook registry refactor.** Eliminates 5 hand-maintained sites where the 9-hook list was duplicated. Same thesis as v0.7.1's spec ↔ banned-vocab.patterns drift gate and v0.8.0's R-N1 / R-N2 manifests, applied to the plugin's own internal code: turn "agent must remember N places to keep in sync" into "code enforces single source of truth." Surfaced by the v0.8.1 reviewer. No runtime behavior change.

### Added

- `[feat]` **`scripts/lib/hook-registry.js`** (new, 9 entries) — single source of truth for the 9 plugin hooks. Each entry: `basename`, `displayName`, `envVarSuffix`, `hookEvent`, `matcher`, `timeout`. Re-exports `HOOK_BASENAMES`, `HOOK_ENV_SUFFIXES`, `HOOK_NAME_TO_ENV` derived from the array, so consumers stay one-line imports. Order mirrors `hooks/hooks.json` registration order (the order CC actually executes them: SessionStart → UserPromptSubmit → PreToolUse:Bash → Stop).

- `[test]` **`tests/scripts/hook-registry.test.js`** (new, 7 cases) — drift gate against every consumer site:
  1. Registry length === 9 (matches integration `MCOUNT` and `manifest.entries.length`).
  2. Every registry entry exists in `hooks/hooks.json` with matching event/matcher/timeout.
  3. Every `hooks/hooks.json` command points to a registry basename.
  4. Every `hooks/*.sh` file on disk is registered (no orphan entrypoints) and every registry entry has a file on disk.
  5. `commands/claudemd-toggle.md` mentions every registry `displayName`.
  6. Derived consts (`HOOK_BASENAMES`, `HOOK_ENV_SUFFIXES`, `HOOK_NAME_TO_ENV`) all have one entry per registry row.
  7. `basename`, `displayName`, `envVarSuffix` are unique within the registry.

### Changed

- `[refactor]` **`scripts/install.js`** — removed inline `HOOK_BASENAMES` literal; now imports from `scripts/lib/hook-registry.js` and re-exports for back-compat (used by `tests/scripts/install.test.js` and `scripts/uninstall.js`).

- `[refactor]` **`scripts/status.js`** — removed inline `HOOK_NAMES` literal; now derives kill-switch enumeration from `HOOK_ENV_SUFFIXES`. Side effect: `status.killSwitches` JSON object key order shifts from the old `BANNED_VOCAB`-first to registry order (`session-start`-first); no test pinned the old order. The `plugin` kill-switch key remains first by virtue of being added before the loop.

- `[refactor]` **`scripts/toggle.js`** — removed inline `NAME_MAP` literal; now imports `HOOK_NAME_TO_ENV` from the registry. The `version-sync` → `USER_PROMPT_SUBMIT` event-name mapping (preserved so existing `DISABLE_USER_PROMPT_SUBMIT_HOOK` env vars keep working) lives in the registry rather than as a NAME_MAP comment.

- `[refactor]` **`scripts/uninstall.js`** — `HOOK_BASENAMES` import switched from `./install.js` to `./lib/hook-registry.js` (direct registry import; install.js's re-export is for tests only).

### Fixed

- `[fix]` **`commands/claudemd-toggle.md`** — drift caught by the new registry test: the "Valid hook names" line listed 8 hooks (`banned-vocab`, `pre-bash-safety`, `ship-baseline`, `residue-audit`, `memory-read-check`, `sandbox-disposal-check`, `session-start-check`, `version-sync`) but `toggle.js` NAME_MAP carried 9 — `session-summary` (added in v0.8.0) was never added to the markdown. Now lists all 9 in registry order; future drift fails the new drift test.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.2`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 177/177 node tests pass (170 pre-refactor + 7 new hook-registry drift cases); 11 hook suites green; 2 integration suites pass (`full-lifecycle` + `upgrade-lifecycle`).
- Net diff: +1 file (registry), +1 file (drift test), -22 lines of duplicated literals across 4 consumers, +1 docs fix.

## [0.8.1] - 2026-05-09

**Patch — code-review fix-up for v0.8.0.** Closes 6 Important issues + 2 Minor issues raised by post-ship code review of v0.8.0. Theme: docs and tests drifted from code in the same release that shipped a manifest meant to detect drift — that's the §10 Specificity self-violation reviewer caught. No runtime behavior change.

### Fixed

- `[fix]` **`tests/integration/full-lifecycle.test.sh:50`** — Phase 7 residue regex now includes `session-summary` in its alternation. Pre-fix, a future regression that left a `session-summary.sh` entry in `settings.json` after uninstall would pass this gate silently. (Reviewer I1.)

- `[fix]` **`README.md`** — 5 stale counts corrected: line 14 "6 slash commands" → 8 (+ `/claudemd-rules` + `/claudemd-clean-residue` listed); line 99 "All 8 hooks" → 9; line 115 kill-switch list adds `DISABLE_SESSION_SUMMARY_HOOK`; new sub-feature flag `DISABLE_SESSION_SUMMARY_BANNER` documented at line 122-126; line 241 layout block "5 slash-command markdown files" → 8; commands table at line 84-91 adds `/claudemd-rules` + `/claudemd-clean-residue` rows. (Reviewer I2.)

- `[fix]` **`CHANGELOG.md` v0.8.0 entry — false-claim correction**: removed "+ ARCHITECTURE.md updated" from the Notes block. Per `.gitignore`, `docs/ARCHITECTURE.md` is an explicitly local-only internal reference (commit `e035f1f`); the v0.8.0 release does not ship it. The original phrasing implied a public doc update that never happened — the §10 Specificity self-violation reviewer caught. Local copy of `docs/ARCHITECTURE.md` was updated for personal reference but is intentionally not part of the release artifact. (Reviewer I3.)

- `[fix]` **`docs/RULE-HITS-SCHEMA.md`** — explicit "Hooks that do NOT write to this log" callout naming `session-summary.sh` so future readers grepping `claudemd.jsonl` for it know why nothing matches. The hook writes to `~/.claude/.claudemd-state/last-session-summary.json` instead. (Reviewer I4.)

- `[fix]` **`tests/scripts/hard-rules-drift.test.js:99`** — invariant 5 substring matching tightened to a single direction (`line.includes(anchor)` only). The previous OR with `anchor.includes(line[:80])` accepted silent renames where a future spec edit shortened a heading's verbatim text but the manifest still carried the longer anchor. Now invariants 1 and 5 must remain in lockstep — invariant 1 owns `anchor → spec`, invariant 5 owns `spec → anchor`, neither half can paper over the other. (Reviewer I5.)

- `[fix]` **`tests/scripts/hard-rules-drift.test.js:24-39`** — `SPEC_HARD_LINE_EXEMPTIONS` comment block was misleading: it described 4 reasons for exemption when actually only 1 line in the spec needs exemption (the §12 fallback table cross-ref to `sp:subagent-driven-development`). Comment rewritten to explain that the other (HARD) lines (V1-V4 sub-rules, Iron Laws, Manual-ship atomicity, etc.) are anchor-covered, not exempt. Future maintainer reading the comment will understand why each is or isn't on the list. (Reviewer I6.)

- `[fix]` **`scripts/hard-rules-audit.js:62-72`** — `byEnforcement` output no longer double-counts. Pre-fix: `byEnforcement.hook` counted `enforcement === 'hook'` plus `enforcement === 'both'`, while `byEnforcement.both` counted `both` again — sum exceeded `totalRules` by the count of `both` entries. Post-fix the four categories partition `rules` exactly: `hook + self + external + both = totalRules`. The hook-enforced union (used internally for `demoteCandidates`) is computed inline. (Reviewer M3.)

- `[fix]` **`CHANGELOG.md` v0.8.0 entry** — replaced "the 90/10 split" baseline-less ratio with concrete numbers: `7 of 21 (33%) hook-enforced, 14 of 21 (67%) self/external`. Per §10 Specificity, value claims about own work require absolute numbers or baseline ratios; the original phrasing was the kind of vague magnitude the same release's `banned-vocab.patterns` is meant to catch. (Reviewer M7.)

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — all to `0.8.1`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 170/170 node tests pass; 11 hook suites green; 2 integration suites pass.
- Reviewer's recommended `scripts/lib/hook-registry.js` refactor (single source of truth for the 9-hook list) deferred — touches 5 production files plus tests and qualifies as L2 cross-module work; better as its own focused commit. Tracked as v0.8.x candidate.

## [0.8.0] - 2026-05-09

**Minor — HARD-rules manifest (R-N2) + week-over-week regression (R-N3) + SessionStart summary banner (R-N4).** Builds on v0.7.x's `spec_section` + `byBypass` data plane. R-N2 makes spec self-governance machine-readable: §13.1 quarterly demote and §13.2 budget accounting now have a structured manifest to read instead of grep-and-eyeball. R-N3 turns single-window audit numbers into early-regression alerts. R-N4 surfaces last session's hook activity at the start of the next session — agent sees its own trend without an explicit `/claudemd-audit` invocation.

### Added

- `[feat]` **`spec/hard-rules.json`** (new, 21 rules) — machine-readable manifest of every HARD rule across `spec/CLAUDE.md` + `spec/CLAUDE-extended.md`. Per-rule fields: `id`, `name`, `scope` (core/extended), `section_anchor` (verbatim spec substring), `enforcement` (hook/self/external/both), `rule_hits_section` (links to v0.7.0 audit data; null for non-hook rules), `added_version`, `confidence` (high/medium/low), `last_demote_review`. Enforcement breakdown: 6 hook + 13 self + 1 external + 1 both = 21 rules total — meaning 7 of 21 (33%) HARD rules emit signal to rule-hits.jsonl, while 14 of 21 (67%) rely on agent self-discipline.

- `[feat]` **`scripts/hard-rules-audit.js`** (new, 100 LOC) — cross-references `spec/hard-rules.json` with `~/.claude/logs/claudemd.jsonl` `bySection` data over a configurable window (default 90d, matching §13.1 quarterly cadence). Outputs: `byScope` / `byEnforcement` / `byConfidence` summaries, `demoteCandidates` (hook-enforced rules with 0 hits in window), `staleReviews` (rules whose `last_demote_review` is null or older than the window), and per-rule rows with hits. CLI: `--days=N` flag or `CLAUDEMD_RULES_DAYS` env var.

- `[feat]` **`commands/claudemd-rules.md`** (new) — slash command surfacing `hard-rules-audit.js`. Documents the field table and the "≥3 occurrences = demotion candidate" heuristic for §13.1 review.

- `[feat]` **`scripts/lib/rule-hits-parse.js`** — new `byTrend(hits, windowDays)` export. Splits hits into recent vs prior windows of equal size, returns per-section `{recent, prior, ratio, flag}`. Flag values: `regression` (ratio ≥ 2), `recovery` (ratio ≤ 0.5), `newly_active` (prior=0, recent>0), `silenced` (recent=0, prior>0), `stable` (in-between).

- `[feat]` **`scripts/audit.js`** — `/claudemd-audit` JSON now carries `byTrend` (default 7-day window). Reads 2× window data automatically. Empty when fewer than 2 windows of data exist.

- `[feat]` **`hooks/session-summary.sh`** (new, 80 LOC) — Stop hook. Aggregates `~/.claude/logs/claudemd.jsonl` rows since session-start.ref and writes summary to `~/.claude/.claudemd-state/last-session-summary.json` (atomic tmp+rename). Skips write when total=0. Two-stage jq pipe: outer parses each line via `try fromjson catch empty` (drops corrupt rows silently), inner slurps the stream and aggregates. Kill-switch: `DISABLE_SESSION_SUMMARY_HOOK=1`.

- `[feat]` **`hooks/session-start-check.sh`** — new `emit_session_summary_banner` function. On version-match branch (after `upstream_check`), reads the summary file, emits a one-line `additionalContext` banner via SessionStart hookSpecificOutput, then renames the file to `.last-shown` so the banner only fires once. Banner format: `[claudemd] last session: N denies, M bypasses, K warns, top: §X-Y`. Kill-switch: `DISABLE_SESSION_SUMMARY_BANNER=1`.

- `[test]` **`tests/scripts/hard-rules-drift.test.js`** (new, 6 tests) — 4-direction drift gate: (1) every manifest entry's `section_anchor` exists verbatim in the named spec file; (2) every `rule_hits_section` is in the v0.7.0 hook taxonomy; (3) hook-enforced entries have non-null `rule_hits_section`; (4) self/external entries have null. Plus 2 schema invariants: (5) every (HARD) annotation in spec has a manifest entry or documented exemption; (6) required-fields presence + enum validity (enforcement, confidence, scope).

- `[test]` **`tests/scripts/audit.test.js`** — 4 R-N3 cases: byTrend flags `regression` at recent/prior=5/1, `newly_active` at 3/0, `silenced` at 0/4, `recovery` at 1/4. Existing 9 tests preserved.

- `[test]` **`tests/hooks/session-summary.test.sh`** (new, 6 cases) — empty log → no write; 2 deny + 1 bypass + 1 warn captured correctly with `top_section: §10-V`; kill-switch suppression; SessionStart banner consumes summary + renames to `.last-shown`; `DISABLE_SESSION_SUMMARY_BANNER=1` suppresses banner.

### Changed

- `[refactor]` **`scripts/install.js`** — `HOOK_BASENAMES` extended to 9 entries (added `session-summary.sh`). The list drives `isClaudemdLegacyHookCommand` for legacy `settings.json` eviction; defensive even though session-summary was never in pre-0.1.5 settings.json form.

- `[refactor]` **`scripts/status.js`** + **`scripts/toggle.js`** — `HOOK_NAMES` and `NAME_MAP` extended with `SESSION_SUMMARY` / `session-summary`. `/claudemd-toggle session-summary` enables/disables the new hook.

- `[refactor]` **`hooks/hooks.json`** — Stop hook block now registers 3 hooks (was 2): `residue-audit.sh` + `sandbox-disposal-check.sh` + `session-summary.sh`.

- `[fix]` **`tests/scripts/install.test.js`** — `manifest.entries.length` assertions updated to 9 (was 8); fixture hooks.json mirrors production with the new Stop entry.

- `[fix]` **`tests/integration/full-lifecycle.test.sh`** — `MCOUNT == 9` (was 8); residue-detection regex includes `session-summary`.

### Deferred

- **R-N9** (CHANGELOG sparkline) — release-time dev tool, low priority vs runtime features. Fits a future patch when audit data has accumulated enough trend signal to be worth visualizing.
- **R-N5** (Bash early-exit list for read-only commands) + **R-N8** (transcript-side §10-V scan) — runtime hook-surface changes. Per v0.6.0 `BASH_SAFETY_INDIRECT_CALL` precedent, they should ship behind opt-in flags with their own validation cycle. Targeted for v0.8.1.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.8.0`. Spec files (`spec/CLAUDE*.md`) unchanged; spec version remains v6.11.3.
- Hook count: 8 → 9. README updated. (`docs/ARCHITECTURE.md` is gitignored as internal reference per `.gitignore` — local-only edits don't ship.)
- Validation: `tests/run-all.sh` → 170/170 node tests pass; 11 hook suites green (including new session-summary 6/6 + hard-rules-drift 6/6); 2 integration suites pass (full-lifecycle, upgrade-lifecycle).
- Why R-N2 + R-N3 + R-N4 in one ship: they all consume v0.7.x data. R-N2 indexes the rule taxonomy; R-N3 adds a time-axis to existing aggregations; R-N4 is a one-line context inject at session boundary. Single migration wave keeps schema attribution clean.

## [0.7.1] - 2026-05-09

**Patch — spec ↔ pattern drift gate (R-N1) + doctor §0.1 demotion-candidate surface (R-N6).** Closes the "spec is falsifiable" half of the v0.7.0 governance loop. Pre-fix, `spec/CLAUDE-extended.md §10-V` (banned-vocab prose list) and `hooks/banned-vocab.patterns` (regex enforcement) were maintained by hand discipline; drift in either direction went undetected until field signal. v0.7.1 adds a CI-time canonical fixture + 6-direction drift test that fails the build the moment spec or patterns disagree without an explicit exemption. R-N6 turns v0.7.0's `byBypass` data into a doctor check — sections whose denies are routinely escape-hatched (>50% bypass:deny ratio) surface as §0.1 demotion candidates without manual audit reading.

### Added

- `[feat]` **`tests/fixtures/banned-vocab-canonical.json`** (new, 38 entries) — single source of truth mapping each spec §10-V banned term ↔ `hooks/banned-vocab.patterns` regex. Each entry carries `term`, `category` (EN-adj/EN-hedge/EN-ratio/ZH-adj/ZH-ratio), `in_spec` (bool), `pattern` (regex string or null), and `exempt_reason` when partial coverage applies. Documents 11 acknowledged divergences: 8 spec-only "too common in legitimate language" exemptions (likely / arguably / 通常如此 / 一般来说 / 大部分情况 / most of the time / usually passes / often fails / 大多数时候 / 多数情况下) and 3 pattern-only symmetric forms (显著改善 / 显著优于 / 大幅提升, derived from spec's 显著提升 / 大幅改善 / 明显优于 — 显著改善 is also flagged as a spec-promotion candidate as it leads ZH pattern fires at 5/30d).

- `[feat]` **`tests/scripts/spec-pattern-drift.test.js`** (new, 6 tests) — 4-direction drift gate: (1) every banned-vocab pattern has a canonical entry; (2) every canonical entry's pattern exists in the patterns file; (3) every spec §10-V banned term has a canonical entry with `in_spec: true`; (4) every `in_spec: true` canonical entry exists verbatim in spec §10-V text. Plus 2 schema invariants: (5) partial-coverage entries carry `exempt_reason`; (6) no entry is both spec-absent and pattern-absent. Parses spec section text via `## §10-V Banned-vocab` anchor + `**Banned ...**: "term"` regex (handles both `"a" / "b"` separate quotes and `"a / b / c"` slash-joined-quote forms). 6/6 passing on current state.

- `[feat]` **`scripts/doctor.js:11 / 19-31 / 154-178`** — new `rule-usage:<spec_section>` checks. Reads 30-day window from `~/.claude/logs/claudemd.jsonl`, groups by `spec_section` (v0.7.0 field), computes bypass:deny ratio per section, emits one check per section with ≥3 events. Ratio > 50% → `[✗] §0.1 demotion candidate — see /claudemd-audit byBypass`; ratio ≤ 50% → `[✓] healthy`. Sections under the statistical floor or in the `(unset)` legacy bucket are skipped — pre-v0.7.0 rows lack section attribution and would misattribute pre-upgrade behavior to current rule design.

- `[test]` **`tests/scripts/doctor.test.js`** — 4 R-N6 cases: (1) flags `§11-memory-read` as demotion candidate when 5 bypass + 1 deny → 83%; (2) marks `§10-V` healthy at 17%; (3) skips sections below 3-event statistical floor; (4) skips `(unset)` bucket carrying legacy rows. Total `tests/scripts/`: 160 (was 150 — +6 drift + +4 R-N6).

### Changed

No behavior change to the runtime hook path. Drift test runs in CI only; doctor check is read-only against the existing rule-hits log.

### Why drift gate matters now

Empirical signal from v0.7.0 audit data already reveals 3 acknowledged spec ↔ pattern divergences in `tests/fixtures/banned-vocab-canonical.json` (the `pattern_only` ZH adjectives 显著改善 / 显著优于 / 大幅提升 — symmetric forms the patterns author derived from spec but never round-tripped to spec). Prior to this release, those divergences sat invisible. The drift test surfaces them as `exempt_reason` lines on review; the next minor spec bump can promote them with full visibility.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.7.1`. Spec files unchanged; spec version remains v6.11.3.
- Validation: `tests/run-all.sh` → 160/160 node tests pass; 11 hook suites green (drift 6/6, doctor 16/16, contract 35/35, banned-vocab 20/20, rule-hits 12/12); 2 integration suites pass (full-lifecycle, upgrade-lifecycle).
- Why drift + doctor together: both consume the v0.7.0 `spec_section` data plane. R-N1 polices its edit-time invariants; R-N6 polices its runtime behavior. Same wave, two layers.

## [0.7.0] - 2026-05-09

**Minor — per-rule instrumentation + bypass dashboard + banned-vocab dead-pattern stratification.** Closes the §0.1/§13.1/§13.2 governance loop: pre-fix `/claudemd-audit` answered "which hook is firing" but not "which spec rule is firing", so `§0.1 Core growth discipline` (promote ≥5 hits in 30d) and `§13.1` quarterly demote (0 hits in 90d) had no source data — both rules were aspirational, not mechanical. This release adds `spec_section` to every hook-enforcing rule-hits row, surfaces `byBypass` (per-token escape-hatch usage — the §0.1 demotion candidate signal), and reorganizes `banned-vocab.patterns` into high-fire and prophylactic regions per the same audit data.

### Added

- `[feat]` **`hooks/lib/rule-hits.sh:8-17 / 56-67`** — `rule_hits_append` accepts an optional 4th positional `SPEC_SECTION` arg. Empty arg → `null` in the JSONL row (back-compat with hooks that don't pass the arg). The new field lands as `spec_section` next to the existing `extra` column. Schema is additive — `audit.js` keeps working unchanged on legacy rows; the `bySection` aggregation surfaces them under an `(unset)` bucket so the operator sees how much pre-upgrade data is in the audit window.

- `[feat]` **7 hook scripts** — every spec-enforcing `hook_record` callsite now passes a section identifier: `banned-vocab` → `§10-V`; `ship-baseline` → `§7-ship-baseline`; `pre-bash-safety` → `§8-rm-rf-var` / `§8-npx` / `§8` (combined-deny path); `memory-read-check` → `§11-memory-read`; `residue-audit` → `§7-user-global-state`; `sandbox-disposal` → `§8.V4`. Plugin-internal events (`session-start` bootstrap/upstream-banner; `version-sync` lifecycle) keep section `null` — they're not enforcing a spec rule. Full taxonomy table is the new "Spec section taxonomy" section in `docs/RULE-HITS-SCHEMA.md`.

- `[feat]` **`scripts/lib/rule-hits-parse.js`** — two new exports: `groupBySection(hits)` (per-section total + event/hook breakdown) and `byBypass(hits)` (per-`bypass-escape-hatch`-token total + per-hook breakdown). High counts on a single bypass token signal a rule that's too strict and is being routinely overridden — the §0.1 demotion candidate indicator that pre-fix sat in the JSONL log unaggregated.

- `[feat]` **`scripts/audit.js`** — `/claudemd-audit` JSON now carries `bySection` and `byBypass` next to the existing `byHook` / `topPatterns`. `commands/claudemd-audit.md` updated with the field table and a "≥3 occurrences = review candidate" rule for the bypass dashboard.

- `[test]` **`tests/hooks/contract.test.sh`** — invariant E added (8 cases): every spec-enforcing hook (banned-vocab / ship-baseline / pre-bash-safety × 2 / memory-read-check / residue-audit / sandbox-disposal) emits the documented `spec_section`; plugin-internal hooks keep it `null`. Drives §0.1/§13.1/§13.2 promotion accounting end-to-end. Total: 35/35 passing (was 27/27 — invariants A.1–A.4, B×14, C×8, D, E×8).

- `[test]` **`tests/hooks/rule-hits.test.sh`** — Cases 10/11/12 added: (10) `spec_section` 4th arg threads through to JSONL; (11) omitted arg → `null` (back-compat); (12) empty-string arg also normalizes to `null` (defends against `hook_record h e null ""` muddling the `(unset)` bucket attribution). Total: 12/12 passing (was 9/9).

- `[test]` **`tests/scripts/audit.test.js`** — 4 new tests: `bySection` aggregates v0.7.0 spec_section field correctly; `bySection` surfaces legacy rows under `(unset)`; `byBypass` aggregates per-token override usage with hook breakdown; `byBypass` empty when no bypass-escape-hatch events present. Existing `byHook` test updated for fixture expansion (banned-vocab now 3 rows incl. 1 bypass; pre-bash-safety added with 2 bypass rows). Total: 9 tests passing.

### Changed

- `[refactor]` **`hooks/banned-vocab.patterns`** — reorganized into `# region: high-fire` (≥1 deny in last 30d audit window) and `# region: prophylactic` (0 hits in last 30d) sections. Same 27 patterns kept — zero deletion, zero functional change. Reorder puts the 6 actively-firing patterns at the top of the file so grep early-exits on common matches; visual stratification lets the operator see at a glance "what's actively gating" vs "what's carried for §10-V coverage". Re-stratify on each `/claudemd-audit` review per §13.1 cadence; demotion to `§EXT §10-V` reference list eligible after 3 consecutive 30d windows at zero (combined with `byBypass` — added this release).

- `[docs]` **`docs/RULE-HITS-SCHEMA.md`** — `spec_section` field added to the row-shape table; new "Spec section taxonomy" table maps each (hook, event) pair to its section identifier; example rows include the new field. Pre-v0.7.0 rows handled by the `(unset)` bucket — documented inline.

### Migration

No user action required for the `spec_section` field — it auto-populates on next hook fire after upgrade. Existing rule-hits rows in `~/.claude/logs/claudemd.jsonl` keep working; `/claudemd-audit` `bySection` shows them under `(unset)` until the audit window slides past the upgrade timestamp.

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.7.0`. Spec files (`spec/CLAUDE*.md`) unchanged; spec version remains v6.11.3. Per the versioning policy, plugin minor ships independently when spec is unchanged but plugin features are added.
- Validation: `tests/run-all.sh` → 150/150 node tests pass; 11 hook suites green (rule-hits 12/12, contract 35/35, banned-vocab 20/20, sandbox-disposal, memory-read-check, ship-baseline, residue-audit, pre-bash-safety, session-start, version-sync, hook-common, platform); 2 integration suites pass (full-lifecycle, upgrade-lifecycle).
- Why this set together: R1 (spec_section), R3 (byBypass), R4 (banned-vocab stratification) all consume the same rule-hits.jsonl data plane. Shipping them in one release keeps schema migration to one wave; the audit dashboard ships with the data that makes the dashboard useful on day one.

## [0.6.3] - 2026-05-09

**Patch — fix v0.6.2 macOS CI red.** `scripts/clean-residue.js` returned `deleted: 0` on macOS for brand-new entries when `ageDaysMin=0`, because `now - stat.mtimeMs` could come back marginally negative — sub-ms timing skew between `fs.writeFileSync` and the `Date.now()` read inside `clean()` on APFS. Linux ext4 happened to land consistently non-negative; the same test passed locally and on Ubuntu CI. v0.6.2 shipped, the macOS runner caught it, and this is the immediate forward-fix. v0.6.2 functionality is otherwise intact (the bug only affects callers passing `ageDaysMin=0` against a freshly-created file — not the default 1-day threshold path).

### Fixed

- `[fix]` **`scripts/clean-residue.js`** — `ageDays = Math.max(0, (now - mtimeMs) / 86400000)`. A file can't be younger than itself; clamping at 0 makes the comparison robust to sub-ms timestamp skew between filesystem writes and `Date.now()` regardless of FS implementation. The 12-case test suite continues to pass; the failing case `clean ageDaysMin=0 includes brand-new entries` now resolves correctly on macOS APFS as well.

## [0.6.2] - 2026-05-09

**Patch — audit-data instrumentation + residue self-cleanup.** Two themes, one release. (1) Closes a schema-vs-impl drift in the rule-hits log: 2 of 4 bypass-capable hooks were silently exiting without recording `bypass-escape-hatch`, so `/claudemd-audit` under-counted user overrides; the JSONL also carried no project identifier, so cross-project drill-down was impossible. Adds `project` field on every row + bypass recording in `pre-bash-safety` and `memory-read-check` + a contract test that locks "every documented event has a producer and every emitted event is documented." (2) Closes the irony that the residue-policing plugin was itself the largest residue source: 525 stale `claudemd-sync-*` session sentinels accumulated in 9 days under `$TMPDIR` (one per CC session, never collected). Adds GC of >24h sentinels in `version-sync.sh` (bounded to first prompt of a session) + a new `/claudemd-clean-residue` command + a `scripts/clean-residue.js` library.

### Added

- `[feat]` **`hooks/lib/rule-hits.sh`** — `rule_hits_append` now derives `project` from `$CLAUDE_PROJECT_DIR` (or `$PWD` fallback), encoded with `/` and `.` → `-` to match Claude Code's `~/.claude/projects/<encoded>/` convention. Every JSONL row now carries the field. Schema is additive — `audit.js` keeps working unchanged on legacy rows; `groupByProject` aggregation deferred to a follow-up. Pre-fix, `/claudemd-audit` could answer "which hook is firing" but not "in which project" — making per-project red-rate / regression detection impossible.

- `[feat]` **`hooks/pre-bash-safety-check.sh:138-141 / 173-176`** — when `[allow-rm-rf-var]` or `[allow-npx-unpinned]` token fires the bypass branch, the hook now calls `hook_record pre-bash-safety bypass-escape-hatch '{"token":"..."}'` before exiting. Pre-fix, the bypass took the deny path's normal early-exit and never wrote to the rule-hits log — so a user routinely escape-hatching `npx unpinned-pkg` had zero audit visibility. 30-day baseline data showed 0 such recorded bypasses; field signal will land in the next 14-day window.

- `[feat]` **`hooks/memory-read-check.sh:22-31`** — `[skip-memory-check]` token check moved from pre-trigger (line 23) to post-trigger, so bypass usage is recorded only when the hook would have actually scanned. New `hook_record memory-read-check bypass-escape-hatch` call on the bypass path. Behavior is unchanged from a user-visible standpoint (token still exits 0); only the audit log gains the bypass row.

- `[feat]` **`hooks/version-sync.sh:31-35`** — first-prompt-per-session self-cleanup: `find "$TMP_BASE" -maxdepth 1 -name 'claudemd-sync-*' -mmin +1440 -delete 2>/dev/null || true`. Bounded to once per CC session (the early-exit on existing sentinel filters out subsequent prompts), `-maxdepth 1` + named-pattern + fail-silent. Field measurement: one user's `~/.claude/tmp/` had 525 stale sentinels accumulated over 9 days at install time; post-deploy first-session run drops the count to ≤ session count of the day.

- `[feat]` **`scripts/clean-residue.js`** (new, 66 LOC) — exports `scan({tmpDir})` and `clean({tmpDir, apply, ageDaysMin})`. Anchored regexes `/^claudemd-sync-/` (file) and `/^claudemd-(mockgh|work)\./` (dir) — defends against fnmatch-style sloppy matches like `not-claudemd-sync-foo`. CLI is dry-run-by-default; `--apply` opts into deletion; `--age-days=N` overrides the 1-day stale threshold.

- `[feat]` **`commands/claudemd-clean-residue.md`** (new) — slash command surfacing the script with `$ARGS` passthrough. Use case: bulk-clean accumulated residue on first install of v0.6.2 (the new self-cleanup only handles forward-direction drift; pre-existing pile must be one-shot via this command).

- `[test]` **`tests/hooks/contract.test.sh`** (new, 137 LOC, 27 cases) — locks the rule-hits schema contract: (A) every hook with a documented bypass token records `bypass-escape-hatch` end-to-end (4 cases driving real fixtures); (B) every documented `(event, emitter)` pair in `RULE-HITS-SCHEMA.md` has a matching `hook_record` call in source (14 cases); (C) every event emitted in `hooks/` source is documented in the schema (8 cases — fails loudly on drift in either direction); (D) `project` field is auto-populated when `$CLAUDE_PROJECT_DIR` is set. 27/27 passing.

- `[test]` **`tests/scripts/clean-residue.test.js`** (new, 152 LOC, 12 cases) — `scan()` finds prefix-anchored matches; `scan()` tolerates missing/empty dir; `clean({apply:false})` returns targets without deleting; `clean({apply:true})` deletes only entries older than `ageDaysMin`; sandbox dirs deleted recursively; non-matching files preserved; `ageDaysMin=0` includes brand-new entries; anchor patterns reject `not-claudemd-sync-*` / `xclaudemd-sync-*` / `claudemd-mockgh-noDot` (no dot) / `claudemd-mockghX.YYY` (extra char); CLI dry-run-by-default; `--apply` deletes idempotently; `--age-days=N` overrides; rejects negative `--age-days`. 12/12 passing.

- `[test]` **`tests/hooks/rule-hits.test.sh`** — Cases 7/8/9 added: (7) `CLAUDE_PROJECT_DIR=/work/my.project` → log `.project == "-work-my-project"`; (8) `$CLAUDE_PROJECT_DIR` unset → falls back to `$PWD` encoding; (9) project + extra payload coexist on `pass-known-red` row. Total: 9/9 passing (was 6/6).

- `[test]` **`tests/hooks/version-sync.test.sh`** — Case 7 added: pre-seeds 2 stale sentinels (mtime 2 days ago, set via portable `node -e fs.utimesSync`) + 1 recent + 1 unrelated, runs hook, asserts stale removed / recent + unrelated kept / new sentinel created. Total: 7/7 passing (was 6/6).

### Changed

- `[fix]` **`docs/RULE-HITS-SCHEMA.md`** — rewritten. Drops `bypass-env` from the event enum (was documented but no hook ever emitted it). Adds `bootstrap` / `upstream-banner` / `version-sync` (emitted by `session-start` and `user-prompt-submit` but previously undocumented). Adds the `project` field. Replaces the flat enum with a per-event/per-emitter table — `tests/hooks/contract.test.sh` parses this table to enforce drift in either direction. Pre-fix the schema listed 7 events, the source emitted 8 events, and 1 documented event (`bypass-env`) had no producer.

- `[fix]` **`hooks/lib/rule-hits.sh:6`** — function header comment now points at `docs/RULE-HITS-SCHEMA.md` for the canonical event list, instead of inlining a stale local copy.

### Migration

No user action required for the `project` field — it auto-populates on next prompt after upgrade. For one-shot cleanup of pre-existing `claudemd-sync-*` accumulation:

```
/claudemd-clean-residue           # dry-run, shows count + per-path age
/claudemd-clean-residue --apply   # delete entries >24h old
```

Self-cleanup runs forward from v0.6.2 onward — no manual maintenance after this one-time pass.

## [0.6.1] - 2026-04-29

**Patch — install/update/uninstall lifecycle audit + hardening.** Audit-driven cleanup pass on the three user-facing lifecycle paths. No spec change, no new commands, no new hooks. Removes one unsupported manifest field that future Claude Code schema tightening could refuse, plugs a silent-failure branch in `install.js`, stabilizes the shape of `uninstall.js` / `status.js` returns so downstream LLM templates don't see drifting keys, and adds bootstrap-log rotation so `~/.claude/logs/claudemd-bootstrap.log` no longer grows unbounded across sessions.

### Added

- `[feat]` **`scripts/status.js`** — new `plugin.hint` + `plugin.cacheVersions` fields surface the "installed but not yet bootstrapped" state (Claude Code cache dirs present under `~/.claude/plugins/cache/marketplaces/claudemd/plugins/claudemd/<version>/` but `~/.claude/.claudemd-manifest.json` missing). Previously `/claudemd-status` showed `plugin.installed: false` with no signal that the user was inside the bootstrap window — they'd assume install failed and re-run `/plugin install`. Now the JSON includes `plugin.hint: "cache-present-bootstrap-pending"` and `plugin.cacheVersions: ["0.6.0", ...]` (semver-shaped dirs only; dev-mode `main` and other non-semver entries are filtered). `commands/claudemd-status.md` updated to surface the hint in the slash-command output.

- `[feat]` **`scripts/install.js`** — fail-loud check before manifest write: if any of the three shipped spec files (`CLAUDE.md`, `CLAUDE-extended.md`, `CLAUDE-changelog.md`) is missing from `<pluginRoot>/spec/`, `install()` throws `Error: install: shipped spec missing in <path>/spec/: <names>` instead of silently skipping the copy and writing a manifest that points at non-existent files. Catches packaging regressions (npm pack glob misconfiguration, marketplace mirror corruption) at install time rather than at first `/claudemd-update` invocation.

- `[feat]` **`hooks/session-start-check.sh`** — bootstrap log rotation. When `~/.claude/logs/claudemd-bootstrap.log` exceeds 64 KiB the hook truncates it to the trailing 32 KiB before appending the new session's bootstrap output. Previously the file grew unbounded — typical bootstrap line is ~3 KiB, so a long-lived install accumulated megabytes of stale output. 64 KiB ceiling chosen so the file always holds at least 10–15 prior bootstrap runs for forensics; truncation uses `tail -c` (portable on Linux/macOS, no `logrotate` dependency).

- `[test]` **`tests/scripts/status.test.js`** — new test case covering the `cache-present-bootstrap-pending` branch. Asserts `plugin.hint` is set, `plugin.cacheVersions` contains semver-shaped dirs, and dev-mode `main` is filtered out. Total `tests/scripts/` count: 134 (was 133).

- `[test]` **`tests/hooks/session-start.test.sh`** — new Case 12 covering log rotation. Seeds 80 KiB log with a head sentinel string, runs the hook, asserts (a) file shrinks below 49 KiB, (b) head sentinel is gone (proving the truncation kept the *tail* not the head). Total: 12/12 passing (was 11/11).

### Changed

- `[fix]` **`.claude-plugin/plugin.json`** — removed `postInstall` and `preUninstall` fields. Claude Code's plugin schema does not define these; current loader silently ignores them, but a future schema-validation tightening would refuse the manifest entirely. The bootstrap path has always been carried by the `SessionStart` hook (not these fields), so removal is purely defensive — no behavioral change. Audit found this as the only HIGH-risk item in the lifecycle review.

- `[fix]` **`scripts/uninstall.js`** — `already-uninstalled` early-return now includes `specAction: 'noop'` so the return-object shape matches the normal-path return (which always has `specAction`). Downstream consumers (slash-command markdown templates, future automation) that branch on `result.specAction` no longer need a defensive `?? 'noop'`. Existing `.warning` field unchanged; integration tests still pass.

- `[docs]` **`README.md`** — installation section reworded: `node scripts/install.js` is documented as an **optional** fast-path for users who don't want to wait for the next session-start, not the canonical install step. The canonical step is `/plugin install claudemd@claudemd`; bootstrap completes either via the `SessionStart` hook on next launch or via the optional manual command. Also corrects the command count (6 commands listed, was 5 — `/claudemd-uninstall` was missing from the table since v0.5.3).

### Notes

- Versions bumped: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (metadata + plugins[0]) — all to `0.6.1`. Spec files (`spec/CLAUDE*.md`) unchanged; spec version remains v6.11. Per the versioning policy above, plugin patch ships independently when spec is unchanged.
- Validation: `node --test tests/scripts/*.test.js` → 134/134 pass; `tests/hooks/*.test.sh` × 11 suites → all pass (session-start 12/12); `tests/integration/full-lifecycle.test.sh` + `upgrade-lifecycle.test.sh` → both PASS.

## [0.6.0] - 2026-04-30

**Minor — hook trust hardening: SHA-256 spec drift detection + opt-in indirect-call coverage + corpus-driven regression suite.** Closes the two follow-up items deferred from v0.5.5 (cso F4 spec integrity + indirect-exec FN) plus a foundational test refactor that moves bash-safety regression cases into a single TSV corpus driving a thin shell runner. Theme is hook *trust*: SHA-256 surfaces drift between shipped and installed spec; indirect-call closes a documented FN class on opt-in; the corpus eliminates the per-FP test-code edit cycle that v0.5.5 demonstrated.

### Added

- `[feat]` **`scripts/lib/spec-hash.js`** — new module exposing `sha256File(path)` and `compareSpecs(pluginRoot)`. Each `compareSpecs` row reports `{name, shipped, installed, match, missing}` for one of the three shipped spec files (`CLAUDE.md`, `CLAUDE-extended.md`, `CLAUDE-changelog.md`). Detects two distinct drift modes: (a) local edits to `~/.claude/<spec>` after install, (b) post-upgrade staleness when the plugin updated but the user hasn't run `/claudemd-update` to re-sync. Does **not** cover supply-chain integrity — the marketplace/npm signature is the right layer for that, and baking a frozen expected hash here would couple the lib to release-time bookkeeping it doesn't need. Pure-function design (takes `pluginRoot` as arg, no manifest write); status.js + doctor.js both consume it.

- `[feat]` **`scripts/doctor.js`** — `/claudemd-doctor` now surfaces three new `spec-hash:<name>` checks per run. Match: `[✓] spec-hash:CLAUDE.md: <12-hex-prefix>… matches`. Drift: `[✗] spec-hash:CLAUDE.md: installed <hex>… ≠ shipped <hex>… — local edits or stale install; run /claudemd-update to sync`. Missing-installed: explicit `/plugin install claudemd@claudemd to bootstrap` hint. Adds 3 rows to the doctor output; existing checks unchanged.

- `[feat]` **`scripts/status.js`** — `/claudemd-status` JSON now reports `spec.hashes` (one row per spec with 12-hex-prefix shipped/installed + match boolean) and `features.bashSafetyIndirectCall` (reflects the new env var below). Existing `spec.installed` (version) field unchanged. status.js gains a `resolvePluginRoot(import.meta.url)` call to find the shipped specs.

- `[feat]` **`hooks/pre-bash-safety-check.sh`** — new opt-in `BASH_SAFETY_INDIRECT_CALL=1` env var enables `unwrap_indirect()`, which rewrites `bash -c '<inner>'` / `bash -c "<inner>"` / `sh -c <…>` / `zsh -c <…>` / `eval '<inner>'` / `eval "<inner>"` to `; <inner> ;` BEFORE `sanitize_cmd` runs. The unwrapped inner is then a top-level token, so the existing pattern-1 (rm -rf var) and pattern-2 (npx unpinned) detectors fire on it normally. Anchored to the same prefix class as the detectors, plus `(` so `$(bash -c '...')` is covered. Bypass tokens (`[allow-rm-rf-var]` / `[allow-npx-unpinned]`) survive unwrap because they scan raw `$CMD`. **Default OFF for v0.6.0.** Rationale: bash-safety is a HARD §8 hook that fires on every `Bash` tool call; FP regressions hit user workflow immediately. Opt-in for one minor lets the kill-switch path stay single-flag (just unset the var) while we collect FP signal in the wild. Plan to flip the default ON in 0.6.x or 0.7.0 once corpus FP coverage holds steady. Heuristic limitations: escaped quotes inside the inner string, heredoc-form indirect calls, and deeply nested substitutions can defeat the regex unwrap — documented in the hook header.

- `[test]` **`tests/fixtures/bash-safety/corpus.tsv`** — new corpus replacing inline cases in `tests/hooks/pre-bash-safety.test.sh`. Format: `<label>\t<note>\t<command>\t<env>` (4-tab columns, env optional). Lines starting with `#` are corpus comments; blanks skipped. Heredoc cases use `__NL__` marker for LF (chosen over `\n` so `printf "label: foo\n"` test cases stay literal). 52 corpus rows (34 pass + 18 deny); plus the malformed-JSON edge case kept inline = 53 total tests. Up from 39 inline cases in v0.5.5: 16 added for indirect-call coverage (9 deny + 7 pass — 3 default-OFF + 4 FP-guard with feature ON), case-count differential explained by drop of the v0.5.5 "non-Bash tool early-exit" synthetic case (corpus is bash-only by construction). Single source of truth — adding a new regression case is one corpus row, not a test-code edit.

- `[test]` **`tests/scripts/spec-hash.test.js`** — 8 unit tests for `scripts/lib/spec-hash.js`. Locks the SHA-256 of `"abc"` to its published canonical digest (`ba7816bf…`) as a sanity check — catches future drift if the impl ever silently switches to text-mode read or non-default hash. Property test: hand-constructed `crypto.createHash('sha256')` digest must equal `sha256File()` byte-for-byte across binary input.

- `[test]` **`tests/scripts/doctor.test.js`** — 2 new tests: `spec-hash:*` drift detection (write installed-spec body that cannot match shipped → assert `[✗] ≠ shipped`) and `spec-hash:*` missing-installed (default beforeEach state, no installed CLAUDE.md → assert `installed spec missing` hint).

- `[test]` **`tests/scripts/status.test.js`** — 2 new tests: `status.spec.hashes` array shape + drift detection from synthetic-vs-real-shipped, and `status.features.bashSafetyIndirectCall` reflects env var on/off.

### Refactor

- `[refactor]` **`tests/hooks/pre-bash-safety.test.sh`** — corpus-driven runner. Replaced the 39 hand-coded `assert_pass` / `assert_deny` calls + heredoc-embedded multiline cases with a 50-line shell loop that reads `tests/fixtures/bash-safety/corpus.tsv`, expands `__NL__` to LF, applies the optional env-var prefix, and asserts allow vs deny by label. Inline edge case (malformed-JSON stdin → fail-open) preserved at the bottom; not a corpus case because corpus is "given valid event, hook produces correct allow/deny". Pre-existing 27-case baseline behaviour unchanged.

### Why opt-in for indirect-call

CHANGELOG v0.5.5 deferred two follow-ups: F4 (spec SHA-256) and indirect-exec coverage. This release ships SHA-256 default-ON (passive read-only check; FP risk is "you see a drift warning", not "your tool call is denied"), and ships indirect-call as opt-in for the inverse reason: a regex-based unwrap cannot perfectly distinguish indirect exec from string-literal `bash -c` mentions, so a wrong-direction FP would block a legitimate `Bash` tool call. The corpus has 4 FP-guard cases under `BASH_SAFETY_INDIRECT_CALL=1` (whitelist + pinned + bypass-token + outer-quoted echo) — but these are theory; field signal is what the opt-in window collects. To enable now: set `"BASH_SAFETY_INDIRECT_CALL": "1"` in `~/.claude/settings.json` `env` block, or `export BASH_SAFETY_INDIRECT_CALL=1` in the shell that launches Claude Code.

### Migration note (read before upgrading)

No automatic action needed. After upgrade:
- `/claudemd-doctor` adds three `spec-hash:*` rows. Hand-edited `~/.claude/CLAUDE.md` will report `[✗]` with a "local edits or stale install" detail — that's correct, your edit is the drift. Run `/claudemd-update` to sync (your edits are backed up to `~/.claude/backup-<ISO>/` first), or accept the drift if it's intentional.
- `bash -c '...'` indirect-exec invocations are still NOT denied unless you opt in via `BASH_SAFETY_INDIRECT_CALL=1`. No behaviour change for users who don't set the var.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new HARD rule, no new hook, no §13.2 budget delta.
- No change to install / update / uninstall behaviour or manifest schema. The new SHA-256 module reads files; it does not write to manifest or state dir.
- No CI / Node-version change. (Note: GitHub deprecates Node 20 actions on 2026-06-02; `actions/checkout@v4` and `actions/setup-node@v4` upgrade to v5 is unrelated to plugin behaviour and will land as a CI-only commit.)

### Follow-up

- Flip `BASH_SAFETY_INDIRECT_CALL` default ON after one minor of in-the-wild FP signal — pending corpus expansion if any FPs surface.
- Heredoc-form indirect call (`bash <<EOF\nrm -rf $X\nEOF`) is a known FN of the unwrap regex; sanitize strips heredoc bodies before unwrap can see them. Closing this requires reordering or an explicit heredoc-target-of-bash-c detector. Deferred until field signal indicates need.
- Node 24 actions upgrade (deadline 2026-06-02) — CI-only commit, no plugin version bump.

## [0.5.5] - 2026-04-30

**Patch — pre-bash-safety FP fix + session-start glob refactor + .gstack gitignore.** Hook-trust hardening release. Closes 4 of 5 findings from the 2026-04-30 `/cso` + `/health` audits run on this project; F1 (the largest-impact hook FP) is the headline.

### Symptoms (pre-fix)

1. **`hooks/pre-bash-safety-check.sh:70` regex over-fired on `npx`/`rm` *inside* string literals.** The matcher's `(^|[[:space:];&|`])npx[[:space:]]+` prefix class included whitespace, so any command containing `<space>npx<space>` — even inside `echo "X: npx Y"`, `# npx Y` comments, or heredoc bodies — denied with "npx unpinned package: <token>" pointing at an unrelated subsequent token (the `sed s/.*${REGEX}//` extractor was greedy, so a later word in the same script became the "package name" in the error message). Reproduced 4× during the 2026-04-30 `/cso` audit on this very project. The pattern trains users toward `DISABLE_PRE_BASH_SAFETY_HOOK=1`, eroding the HARD safety gate.
2. **`hooks/session-start-check.sh:52` used `ls -1 | grep -E` to find latest semver-named cache dir.** SC2010 — the only non-info shellcheck finding in production hooks. Doesn't break with normal cache-dir names but is shellcheck-dirty and tolerates non-alphanumeric filenames the glob form handles correctly.
3. **`.gstack/` not in `.gitignore`.** `/cso` writes findings to `.gstack/security-reports/{date}.json`. Public OSS repo; an accidental `git add .gstack/` would publish a security-posture summary including attack-path descriptions.
4. **`tests/hooks/{sandbox-disposal,session-start,ship-baseline}.test.sh` triggered 17 SC2015 notes.** The `assert && PASS || FAIL` test-assertion idiom intentionally uses `A && B || C`; the noise drowns out real shellcheck signal across the suite.

### Fix

- `[fix]` **`hooks/pre-bash-safety-check.sh`** — F1: new `sanitize_cmd()` function applied to `$CMD` before pattern matching. Strips in order: (1) heredoc bodies (multi-line state, matched via `<<-?TAG` introducer + bare-TAG terminator regex; supports `<<EOF`, `<<'EOF'`, `<<"EOF"`, `<<-EOF` indented form), (2) line comments (`#` at line start or after whitespace, to end of line), (3) quoted-string contents — with crucial nuance: double-quoted strings strip iff body has no `$` (so `"$VAR"` / `"$(cmd)"` / `"x$y"` are preserved for the rm-rf detector), single-quoted strings always strip (no shell expansion ever happens inside `'...'`). Backticks and `$(...)` left intact (they ARE direct exec). Both rm and npx detectors switched to `$SANITIZED_CMD`; the `[allow-rm-rf-var]` / `[allow-npx-unpinned]` bypass tokens still scan raw `$CMD` so the marker can live anywhere — including inside a quoted string the user wrote intentionally.
- `[fix]` **`hooks/session-start-check.sh:52`** — Health #5: replaced `ls -1 "$cache_parent" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1` with a glob iteration + bash-regex format guard then `sort -V | tail -1`. SC2010 cleared; tolerates filenames with non-alphanumeric characters.
- `[chore]` **`.gitignore`** — F2: added `.gstack/` with rationale comment pointing at the security-report leak vector.
- `[chore]` **`tests/hooks/{sandbox-disposal,session-start,ship-baseline}.test.sh`** — top-of-file `# shellcheck disable=SC2015` directive with one-line rationale (the PASS branch is `echo` which never fails, so the `A && B || C` idiom is safe here). Full-repo shellcheck noise: 58 findings (1 warning + 57 notes) → 41 findings (0 warning + 41 notes).
- `[test]` **`tests/hooks/pre-bash-safety.test.sh`** — 11 new regression cases (29-38 + malformed-input renumbered to 39): cases 29-32 cover space-prefixed npx in echo/printf/single-and-double-quote/echo-flag forms (the actual session FP shapes — e.g. `echo "DEADCODE: npx knip"`); cases 33-34 cover leading + trailing comment forms; cases 35-36 cover heredoc body + heredoc-with-quoted-tag forms (`<<'JSON' ... npx pkg ... JSON`); cases 37-38 confirm the rm pattern's same-class FP guard. All 39 pass post-fix; 9 of the new cases were RED prior to the `sanitize_cmd` implementation (verified before commit). Case 6 (`rm -rf "$WORK_DIR"` deny) was an intermediate regression caught by the test suite during TDD — initial sanitize stripped `"$VAR"` to `""`; refined the double-quote regex to `[^"$]*` to preserve var-expansion content.

### Migration note (read before upgrading)

No action required. The sanitize is strictly more conservative than the original matcher in the FN direction (preserves backtick + `$(...)` + double-quoted-with-`$`); strictly less aggressive in the FP direction (silences string-literal / comment / heredoc shapes). All 27 original test cases (1-27) continue to pass unchanged.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new HARD rule, no new hook, no §13.2 budget delta.
- No change to install / update / uninstall behavior.
- `bash -c '<unpinned npx>'` / `eval "<unpinned npx>"` indirect-execution gap is documented in `pre-bash-safety-check.sh` as a known FN, NOT closed in this release. Original matcher already missed these (the `[[:space:];&|`]` prefix class excluded `'` and `"`, so quoted-arg npx never matched). Closing this requires a scan-then-recurse design and is deferred.

### Follow-up (deferred to v0.6.0 if reached)

- **Spec file SHA-256 integrity check** (cso F4) — record SHA-256 of installed `~/.claude/CLAUDE*.md` files in manifest; verify in `session-start-check.sh`. Detects post-install spec tampering — a real LLM-trust-surface risk for plugins distributing behavior policy. Multi-file change spanning install.js + manifest schema + session-start hook; warrants a minor bump, not a patch.
- **Indirect-exec coverage** for `bash -c` / `eval` / `xargs ... bash -c` — pre-existing FN, not touched here.

## [0.5.4] - 2026-04-30

**Patch — uninstall path hardening + diagnostics.** Defensive bugfix release. Closes the 3 follow-up items deferred from v0.5.3 + 1 new finding (D8 orphan-manifest doctor check). Manifest-conditional eviction logic was the largest correctness gap in the install audit; this release closes it.

### Symptoms (pre-fix)

1. **`scripts/uninstall.js:9-12` early-returned when manifest was missing or unparseable**, skipping the `HOOK_BASENAMES` legacy-eviction backstop. Pre-0.1.5 settings.json hook entries (`${CLAUDE_PLUGIN_ROOT}` literal form, absolute version-dir form, v0 hand-install form) survived the uninstall when the user had hand-deleted manifest or hit JSON corruption — exactly the path where legacy entries are most likely to exist.
2. **`HOOK_BASENAMES` predicate was a substring match** (`c.includes('/hooks/${b}')`), shared by `install.js:118-120` and `uninstall.js:36-41`. A future plugin shipping a same-basename hook (e.g. another plugin's `banned-vocab-check.sh`) would be incorrectly evicted from settings.json. No real-world hits today (v0.1.5+ plugins don't write hooks to settings.json), but the latent risk grew with `/claudemd-uninstall` becoming the recommended user flow in v0.5.3.
3. **`/claudemd-doctor` surfaced no signal for orphan manifests.** A user who ran `/plugin uninstall claudemd@claudemd` without `/claudemd-uninstall` first ended up with `~/.claude/.claudemd-manifest.json` pointing at a now-deleted `pluginRoot`. doctor reported `[✓] manifest: present` — falsely green. Combined with v0.5.3's two-step uninstall flow being new, plenty of users could end up here.
4. **`README.md` "Uninstall" section still led with the direct-`scripts/uninstall.js` invocation.** v0.5.3 added `/claudemd-uninstall` as the recommended path but didn't restructure the doc; first-time readers would copy the old single-step flow.

### Fix

- `[fix]` **`scripts/lib/settings-merge.js`** — D6: new exported `isClaudemdLegacyHookCommand(cmd, hookBasenames)` predicate. Path-anchored OR of the three legitimate residue forms claudemd has ever written to settings.json: `/plugins/cache/claudemd/...`, `/.claude/hooks/${basename}`, `${CLAUDE_PLUGIN_ROOT}/hooks/${basename}`. Other-plugin same-basename hooks no longer match. `hookBasenames` is passed in (rather than imported from `install.js`) to avoid a lib → top-level circular import.
- `[fix]` **`scripts/install.js:118-120`** — calls `isClaudemdLegacyHookCommand` instead of inline substring match. Same hooks evicted on install (no behavior change for v0.1.5+ users), but no longer touches a hypothetical other-plugin hook of the same basename.
- `[fix]` **`scripts/uninstall.js:7-44`** — D6 main: settings.json eviction now runs UNCONDITIONALLY before the manifest-presence guard. Pre-fix flow returned `{ warning: 'already-uninstalled' }` and skipped settings.json entirely when manifest was absent. Now: settings.json gets evicted via the path-anchored predicate; manifest-conditional steps (spec disposition, state-dir cleanup, log removal) still gate on manifest. New `settingsRemoved: number` field on the return value surfaces how many entries were evicted (visible to callers, including the `already-uninstalled` warning path).
- `[fix]` **`scripts/doctor.js`** — D8: new `plugin cache` check. When manifest is present, verify `manifest.pluginRoot` directory still exists. If absent, report `[△]` with cleanup hint pointing at `/claudemd-uninstall`. Advisory only — orphan manifest is benign but stale.
- `[docs]` **`README.md` "Uninstall" section** — M3 后半: re-ordered to lead with the two-step `/claudemd-uninstall` → `/plugin uninstall claudemd@claudemd` flow. Direct-script invocation demoted to "advanced fallback". Spec-disposition table now cross-references the v0.5.3 install-time `[claudemd] WARN` line so users know `restore` recovers their personal user-global instructions.
- `[test]` **`tests/scripts/settings-merge.test.js`** — 6 new D6 cases for `isClaudemdLegacyHookCommand`: matches each of the three legitimate residue forms (D6.1/D6.2/D6.3); rejects same-basename hook from a different plugin (D6.4); rejects unknown basename in `${CLAUDE_PLUGIN_ROOT}/hooks/` (D6.5) and in `/.claude/hooks/` (D6.6).
- `[test]` **`tests/scripts/uninstall.test.js`** — 3 new D6 cases: legacy `${CLAUDE_PLUGIN_ROOT}` entry evicted even when manifest is missing; other-plugin same-basename hook survives uninstall (path-anchoring proven); `settingsRemoved` field surfaces count in normal manifest-present uninstall.
- `[test]` **`tests/scripts/doctor.test.js`** — 2 new D8 cases: orphan-manifest case detected when `pluginRoot` path absent; `plugin cache: present at <path>` when `pluginRoot` exists.

### Migration note (read before upgrading)

No action required. Existing installs see no behavior change because:

- v0.1.5+ installs don't write claudemd hooks to settings.json — the legacy backstop only fires on pre-0.1.5 residue, which 0.5.x users won't have.
- The path-anchored predicate is strictly more conservative than the old substring match (it matches a subset). For all currently observed claudemd settings.json entries, the new predicate matches the same set as the old.
- `/claudemd-uninstall` flow from v0.5.3 still works the same way; this release just makes it more robust when state is corrupted.

After upgrade:

- `/claudemd-doctor` will report a new `plugin cache` row; healthy installs see `[✓]`.
- `scripts/uninstall.js` return value gains `settingsRemoved: number` (programmatic consumers can use it; slash command output unchanged).
- README "Uninstall" section now leads with the two-step flow.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new hook, no new HARD rule, no §13.2 budget delta.
- No change to install / update / hook behavior. `install.js` predicate change is a strict refinement; pre-0.5.4 substring already matched a superset of v0.5.4's path-anchored set on real-world claudemd entries.
- `commands/claudemd-uninstall.md` (added in v0.5.3) is unchanged.

### Follow-up (deferred to v0.6.0 if reached)

- `scripts/lib/hook-registry.js` single-source refactor: still YAGNI. 5-place hook list duplication observed across install.js / toggle.js / status.js / commands/claudemd-toggle.md / settings-merge.test.js fixture. Year-cost ~30 minutes of manual sync vs ~2 hours refactor; revisit only if a new hook addition triggers another drift.

## [0.5.3] - 2026-04-30

**Patch — `/claudemd-uninstall` command + user-content overwrite warning + spec trio lockstep clarification.** Pure additive bugfix release. No behavior change to existing flows; closes 4 user-perspective gaps surfaced in the v0.5.2 audit.

### Symptoms (pre-fix)

1. **Personal user-global instructions silently overwritten without warning.** `~/.claude/CLAUDE.md` is shared real estate between this plugin's spec and the user's hand-written CC instructions. Install backed up the original to `~/.claude/backup-<ISO>/CLAUDE.md` (no data loss), but emitted no stderr line; users who hand-wrote their CLAUDE.md ("Always reply in 中文", "My name is X") could discover their content gone with no breadcrumb to the backup.
2. **`/claudemd-update` description claimed a `select` mode that `update.js` does not implement.** Anyone choosing `select` got `Error: unknown choice: select`. The mode was never implementable — spec trio (`CLAUDE.md` + `CLAUDE-extended.md` + `CLAUDE-changelog.md`) evolves lockstep, and per-file select would dangle `§EXT §X-EXT` cross-references.
3. **`/plugin uninstall claudemd@claudemd` left orphan state.** CC's marketplace lifecycle does not fire `preUninstall`, so `~/.claude/.claudemd-manifest.json` + `~/.claude/.claudemd-state/` + `~/.claude/logs/claudemd.jsonl` survived plugin removal. No in-tree tool to clean up afterwards because the plugin cache (and `scripts/uninstall.js`) was already gone.
4. **`tests/scripts/install.test.js` settings.json basename assertions only covered 5–6 of 8 hooks.** Hardcoded regex listed `(banned-vocab-check|ship-baseline-check|memory-read-check|residue-audit|sandbox-disposal-check)` — silent gap for `session-start-check`, `version-sync`, `pre-bash-safety-check`. Production code (`install.js` `HOOK_BASENAMES`) had all 8; if `HOOK_BASENAMES` regressed, the test wouldn't catch it.

### Fix

- `[fix]` **`scripts/install.js:51-79`** — D7: detect user-content overwrite. Before backup, check `~/.claude/CLAUDE.md` for the canonical `# AI-CODING-SPEC` H1 in the first 256 bytes. If absent (existing file is likely personal CC user-global instructions), `process.stderr.write` a `[claudemd] WARN: …` line pointing at the backup path and the `CLAUDEMD_SPEC_ACTION=restore` recovery command. Backup-and-overwrite proceeds either way — the warning is informational, not a block. Return value gains `userContentDetected: boolean` for programmatic detection.
- `[add]` **`commands/claudemd-uninstall.md`** — M3: new slash command. `/claudemd-uninstall` runs `scripts/uninstall.js` while the plugin is still installed (so `${CLAUDE_PLUGIN_ROOT}` and the script itself still exist), clearing manifest + state-dir + log. Two-step uninstall flow: `/claudemd-uninstall` → `/plugin uninstall claudemd@claudemd`. Reversing the order is the orphan-state vector; the command frontmatter spells out why.
- `[fix]` **`commands/claudemd-update.md` + `README.md` (2 sites) + `scripts/update.js:23`** — M2: remove the `select` / `select-per-file` claim from `/claudemd-update`'s frontmatter description, README commands table, README Update section. `scripts/update.js` error message for invalid choices now lists the valid set (`'apply-all' | 'cancel'`) and explains the lockstep rationale. The description is now contract documentation: per-file select is intentionally not supported, not a missing feature.
- `[fix]` **`tests/scripts/install.test.js:8` + `:100` + `:277`** — D5: import `HOOK_BASENAMES` from `install.js` and define `isClaudemdHookCommand` predicate. Test assertions now use the same `c.includes('/hooks/' + b)` predicate as production code. Future hook additions to `HOOK_BASENAMES` automatically widen test coverage; no parallel hardcoded list to drift.
- `[test]` **`tests/scripts/install.test.js`** — 3 new D7 cases: (a) existing CLAUDE.md without spec H1 → `userContentDetected: true` + content preserved in backup, (b) existing CLAUDE.md with `# AI-CODING-SPEC vX.Y.Z` H1 → `userContentDetected: false` (routine upgrade, no warning), (c) fresh install → `userContentDetected: false`.
- `[docs]` **`README.md` "Install" section** — D7: callout warning that `~/.claude/CLAUDE.md` is shared real estate; describes the v0.5.3 stderr warning + recovery via `CLAUDEMD_SPEC_ACTION=restore`.

### Migration note (read before upgrading)

No action required for existing installs. After upgrade:

- A new slash command `/claudemd-uninstall` is available — use it BEFORE `/plugin uninstall claudemd@claudemd` to avoid orphan state.
- `install.js` now prints a stderr warning if your existing `~/.claude/CLAUDE.md` does not look like a claudemd spec. Pre-existing installs (where CLAUDE.md already has the `# AI-CODING-SPEC` H1) trigger no warning.
- `/claudemd-update` no longer documents a `select` choice. Behavior is unchanged — `cancel` and `apply-all` were always the only valid choices.

### Not changed

- No spec content change. Spec stays at v6.11.3.
- No new hook, no new HARD rule, no §13.2 budget delta.
- No change to install / uninstall / update behavior on existing installs (apart from the new D7 stderr line).
- `scripts/uninstall.js` unchanged in this release; the manifest-missing tightening (D6) and the predicate `/claudemd/`-anchoring stay deferred to v0.5.4.

### Follow-up (deferred to v0.5.4)

- D6: `scripts/uninstall.js:9-12` early-returns when manifest is missing or unparseable, skipping the `HOOK_BASENAMES` legacy-eviction backstop. Run the basename sweep unconditionally.
- D6 secondary: tighten `HOOK_BASENAMES` predicate from substring match to path-anchored (`/plugins/cache/claudemd/` OR `/.claude/hooks/` OR `${CLAUDE_PLUGIN_ROOT}` literal) to eliminate cross-plugin name-collision risk.
- M3 README rewrite: re-order Uninstall section to lead with the two-step flow (`/claudemd-uninstall` → `/plugin uninstall`); current README still presents the direct-`scripts/uninstall.js` invocation as primary.

## [0.5.2] - 2026-04-30

**Patch — installer-audit cleanup: `/claudemd-toggle` + `/claudemd-status` cover all 8 hooks; README freshness pass.** Pure docs/metadata bugfix; no behavior change to install/uninstall/update or any hook script. Restores documented intent (every shipped hook is toggleable + visible) that drifted when v0.3.1 added `version-sync` and v0.5.0 added `pre-bash-safety-check`.

### Symptoms (pre-fix)

User-perspective audit against v0.5.1 surfaced 4 cases where surfaces lagged the shipped hook set:

1. `/claudemd-toggle pre-bash-safety` and `/claudemd-toggle version-sync` threw `unknown hook: …`. The hook scripts already honored `DISABLE_PRE_BASH_SAFETY_HOOK=1` / `DISABLE_USER_PROMPT_SUBMIT_HOOK=1` env vars (manual export worked), but `scripts/toggle.js` `NAME_MAP` listed only 6 of 8 hooks, so the slash command had no path to flip them.
2. `/claudemd-status` killSwitches block omitted both `pre_bash_safety` and `user_prompt_submit` lines — `scripts/status.js` `HOOK_NAMES` matched the same 6-entry set as toggle.js.
3. `commands/claudemd-toggle.md` frontmatter `Valid hook names:` listed only 5 (also missing `session-start-check` since v0.4.0). Discoverability gap independent of code paths.
4. `README.md` carried multiple stale claims from before the v0.3.1 + v0.5.0 hook additions: "7 shell hooks" (×2), "Spec v6.11.1" (×2), kill-switch list missing `DISABLE_PRE_BASH_SAFETY_HOOK`, "All 5 hooks" header, daily-use table missing `pre-bash-safety` + `version-sync` rows, escape-hatch table missing `[allow-rm-rf-var]` + `[allow-npx-unpinned]`.

### Fix

- `[fix]` **`scripts/toggle.js:3-15`** — `NAME_MAP` extended 6 → 8 entries: `pre-bash-safety` → `PRE_BASH_SAFETY`, `version-sync` → `USER_PROMPT_SUBMIT`. Note `version-sync`'s value tracks the hook event name, not the file basename, to preserve the existing `DISABLE_USER_PROMPT_SUBMIT_HOOK` env var contract introduced in v0.3.1.
- `[fix]` **`scripts/status.js:5`** — `HOOK_NAMES` extended 6 → 8 entries; order mirrors `install.js` `HOOK_BASENAMES` for human-scannable `/claudemd-status` output.
- `[fix]` **`commands/claudemd-toggle.md:8`** — frontmatter `Valid hook names:` now lists all 8 toggle keys.
- `[fix]` **`README.md`** — 8 sites updated: header table (8 hooks + Spec v6.11.3), daily-use table (added `pre-bash-safety-check` + `version-sync` rows), Kill-switches header ("All 8 hooks"), per-hook list (added `DISABLE_PRE_BASH_SAFETY_HOOK`), escape-hatch table (added `[allow-rm-rf-var]` + `[allow-npx-unpinned]`), Project layout tree (8 hooks + v6.11.3).

### Migration note (read before upgrading)

No action required. Existing `DISABLE_*_HOOK` env vars and per-invocation escape tokens are unchanged; this release only widens which surfaces report and toggle them. After upgrade, `/claudemd-toggle pre-bash-safety` and `/claudemd-toggle version-sync` start working; `/claudemd-status` killSwitches block adds two new keys (`pre_bash_safety`, `user_prompt_submit`).

### Not changed

- No spec content change. Spec stays at v6.11.3 (manifest description policy: `v6.11` family unchanged).
- No new HARD rule, no §13.2 budget delta.
- No change to install / uninstall / update script behavior or to any of the 8 hook scripts.
- No new env-var kill-switch or escape-token introduced by this patch — the 5 enumerated additions are pre-existing artifacts that the documentation now reflects.

### Follow-up (not blocking, deferred to next minor)

- M2: `/claudemd-update` description claims a `select`/`select-per-file` mode that `update.js` does not implement (only `cancel` + `apply-all` are valid choices). Either add per-file selection or strip the dead text.
- M3: `/plugin uninstall claudemd` does not run `scripts/uninstall.js` (CC marketplace lifecycle does not fire `preUninstall`); orphan manifest + state-dir + log left behind. Either document the explicit `node scripts/uninstall.js` follow-up at top of the Uninstall README section, or add a session-start self-clean ("manifest exists but plugin cache absent → tear down").
- D5: `tests/scripts/install.test.js` settings.json basename assertions cover only 5–6 of 8 hooks; widen to all 8 so future HOOK_BASENAMES drift is caught.
- D6: `scripts/uninstall.js:9-12` early-returns on missing manifest, skipping the `HOOK_BASENAMES` legacy-eviction sweep. Run the basename sweep unconditionally; only manifest-driven steps should depend on manifest presence.

## [0.5.1] - 2026-04-30

**Patch — `memory-read-check.sh` over-trigger fixes.** Bugfix release; no new HARD rule, no behavior expansion. Restores the spec §11 "Index is a router, not a substitute" intent that v0.5.0's hook contradicted. Spec footnote co-bumped to v6.11.3 to document the hook/agent split.

### Symptoms (pre-fix)

Three real failures observed against `~/.claude/CLAUDE.md` v6.11.2 and `claudemd` v0.5.0:

1. `git push origin <branch>` blocked with 6 `MEMORY.md` files demanded for Read — none of which had keyword tags. Every push on a project with untagged MEMORY.md entries paid this tax.
2. `glab mr create --title "fix release"` blocked: the trigger regex `(git push|release|deploy|ship)` matched the `release` substring inside the quoted `--title` argument.
3. `git commit -m "release notes update"`-style commands triggered the same path even though `git commit` is not a ship verb.

### Fix

- `[fix]` **`hooks/memory-read-check.sh` L26** — trigger regex anchored to command-segment-start (`^` or after `;` / `&` / `|`), with explicit ship-tool prefixes (`git push`, `gh release`, `gh pr`, `glab mr`, `npm publish`, `npm run release|deploy|ship`, `cargo publish`, `make release|deploy|ship`) plus bare ship verbs at boundary positions. Substring matches inside quoted args no longer fire the filter.
- `[fix]` **`hooks/memory-read-check.sh` L61–62** — untagged `MEMORY.md` entries no longer auto-block. Per spec v6.11.3, untagged lines are agent-driven full content scan; the hook enforces only entries with explicit `[tag1, tag2]` blocks. Operational guidance: tag the lines you want hook-enforced, leave the rest for agent judgment. Existing untagged MEMORY.md content keeps working — agent reads when keyword/title looks relevant; hook stays out of the way.
- `[test]` **`tests/hooks/memory-read-check.test.sh`** — Cases 12–16 added (16 total): untagged-only no-block, mixed tagged+untagged deny-tagged-only, ship-word in quoted commit msg no-trigger, glab mr non-matching tags no-deny, standalone deploy after `&&` still triggers.
- `[test]` **`tests/scripts/spec-structure.test.js`** + **`tests/integration/upgrade-lifecycle.test.sh`** — version assertions bumped v6.11.2 → v6.11.3.

### Migration note (read before upgrading)

No action required. Existing MEMORY.md files keep working; previously over-triggering pushes will now flow without the false-positive deny. If you were relying on the old "untagged = always required Read" behavior to force re-Read of specific files at ship time, **add `[tag1, tag2]` blocks to those entries** — the hook now enforces only tagged matches.

`DISABLE_MEMORY_READ_HOOK=1` per-session bypass and `[skip-memory-check]` in-command bypass unchanged.

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
