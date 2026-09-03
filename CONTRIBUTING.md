# Contributing

This is a personal AI-coding discipline harness (see "Status & scope" in the README) —
fork-and-adapt is the expected mode, but issues and PRs are welcome.

- **Run everything**: `npm test` (wraps `bash tests/run-all.sh`: node test suites, hook
  suites, integration, shellcheck, bash-3.2 construct gate). Node >= 20 and `jq` required;
  `shellcheck` recommended. No `npm install` needed for that.
- **Lint / format / metrics** (these DO need `npm install` — devDependencies only, nothing
  ships): `npm run lint` (= `lint:argv` · `version-check` · `lint:sh` shellcheck warning+ ·
  `lint:js` eslint — in that order, so the two ship gates run before the slow one and are
  not stranded behind a failure), `npm run format:check` / `npm run format` (prettier, JS only),
  `npm run test:coverage` (c8 around the node leg), `npm run metrics`
  (`scripts/baseline-metrics.js` — files/lines, functions over 50 lines, jscpd duplication,
  import cycles, and the lint results as one report; `--skip-coverage` for a ~10 s run).
  Baselines from past audits live outside the repo (`docs/` is ignore-by-default), so
  re-run the tool on the commit you want to compare against rather than looking for a
  checked-in number.
- **Dev docs**: `docs/ARCHITECTURE.md` (component map + state locations),
  `docs/ADDING-NEW-HOOK.md` (step-by-step, names its drift gates),
  `docs/HOOK-PROTOCOL.md`, `docs/RULE-HITS-SCHEMA.md` (telemetry schema),
  `docs/ROLLBACK.md` (release rollback).
- **Conventions**: scripts parse argv via `scripts/lib/argv.js#parseStrict`
  (`node scripts/lint-argv.js` gates it); hooks source `hooks/lib/hook-common.sh`; spec
  edits go through `spec/` WITH a version bump in the same change (CI gates this against
  the last tag).
- **Exit codes** — one table, because a `USAGE` string that disagrees with its own
  `process.exit` is a lie a caller acts on:

  | Code | Meaning | Notes |
  |---:|---|---|
  | 0 | success | the run completed and printed its report |
  | 1 | validation or runtime error | a bad flag *value*, a bad env value, or a failed run. Some tools also use 1 to signal *findings* (`claudemd-cli lint`/`audit` = hits found; `spec-coherence-audit --strict` = CRITICAL/HIGH) — those say so in their own `USAGE`, and a runtime failure is distinguished by its `[claudemd] … failed:` stderr line plus the absent report |
  | 2 | argv-shape error | unknown flag, space-form `--flag value`, missing required positional — raised by `parseStrict` before any work happens |
  | 3 | work remains after the command ran | `doctor` (checks that failed) and `clean-residue` (`--apply` left targets behind). Both reserve 1 for their own runtime failures, so 3 means "ran fine, the state is not clean yet" — the meaning is per-command; read its `USAGE` |

  Every CLI's `USAGE` ends with the subset it actually uses. If you add an exit path, update
  that line in the same commit.
