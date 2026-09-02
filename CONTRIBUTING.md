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
  (`scripts/baseline-metrics.js` — the numbers behind `docs/audit/00-baseline.md`).
- **Dev docs**: `docs/ARCHITECTURE.md` (component map + state locations),
  `docs/ADDING-NEW-HOOK.md` (step-by-step, names its drift gates),
  `docs/HOOK-PROTOCOL.md`, `docs/RULE-HITS-SCHEMA.md` (telemetry schema),
  `docs/ROLLBACK.md` (release rollback).
- **Conventions**: scripts parse argv via `scripts/lib/argv.js#parseStrict`
  (`node scripts/lint-argv.js` gates it); hooks source `hooks/lib/hook-common.sh`; exit
  codes 0 success / 1 failure / 2 argv-shape (doctor: 3 for failed checks); spec edits go
  through `spec/` WITH a version bump in the same change (CI gates this against the last tag).
