// version-cascade-check — pre-tag sanity that spec minor (`v6.X`) is consistent
// across docs and plugin manifests. Read-only.
//
// History (failure mode this guard exists for):
//   - v0.17.6 minor-bump shipped with 3 cascade files still pointing at the
//     prior spec version. Captured as `feedback_spec_version_bump_cascade_grep.md`
//     — "grep OLD_VER across spec/hard-rules.json + tests/ before listing
//     modify-targets." Rule remembered, execution skipped.
//   - v0.19.0 minor-bump shipped with README.md (7 v6.11 mentions) and
//     marketplace.json description (2 v6.11 mentions) stale; a docs-only
//     catch-up commit (d044194) repaired them after the fact.
//
// The feedback is the rule; this script is the mechanical enforcement.
//
// What it checks: every `v6.\d+(?:\.\d+)?` token in `README.md`,
// `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` MUST match
// (at minor granularity) `spec/hard-rules.json#spec_version`.
//
// What it does NOT check:
//   - spec/CLAUDE*.md (the spec is its own source of truth — version line
//     inside the spec IS the canonical, not a derived copy).
//   - spec/CLAUDE-changelog.md (historical entries reference prior versions
//     intentionally and forever).
//   - tests/* (test fixtures may pin historical versions in upgrade-lifecycle
//     phase setup; tests/scripts/spec-structure.test.js already asserts the
//     current version explicitly).
//
// Exit codes: 0 ok | 1 mismatch found | 2 argv-shape error.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePluginRoot } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit } from './lib/argv.js';

const USAGE = `Usage: node scripts/version-cascade-check.js [--json]

Verify spec minor version (v6.X) is consistent across:
  - README.md
  - .claude-plugin/plugin.json
  - .claude-plugin/marketplace.json

Reference: spec/hard-rules.json#spec_version (the source of truth).

Options:
  --json       Emit JSON instead of human-readable.
  --help, -h   Print this message and exit.

Exit codes: 0 success | 1 cascade mismatch | 2 argv-shape error.`;

const SCANNED_FILES = [
  'README.md',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
];

const VERSION_TOKEN = /v6\.\d+(?:\.\d+)?/g;

function toMinor(token) {
  // "v6.13.0" → "v6.13" ; "v6.13" → "v6.13"
  const m = token.match(/^(v\d+\.\d+)/);
  return m ? m[1] : token;
}

export function runVersionCascadeCheck({ root }) {
  const manifestPath = path.join(root, 'spec/hard-rules.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const specVersion = manifest.spec_version;
  if (typeof specVersion !== 'string') {
    throw new Error(`spec/hard-rules.json#spec_version missing or not a string (got: ${typeof specVersion})`);
  }
  const expectedMinor = toMinor(specVersion);

  const offenders = [];
  const filesChecked = [];

  for (const rel of SCANNED_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      offenders.push({ file: rel, line: 0, found: null, expected: expectedMinor, context: '<file missing>' });
      continue;
    }
    filesChecked.push(rel);
    const content = fs.readFileSync(abs, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.match(VERSION_TOKEN);
      if (!matches) continue;
      for (const token of matches) {
        const tokenMinor = toMinor(token);
        if (tokenMinor !== expectedMinor) {
          offenders.push({
            file: rel,
            line: i + 1,
            found: token,
            expected: expectedMinor,
            context: line.trim().slice(0, 140),
          });
        }
      }
    }
  }

  return {
    ok: offenders.length === 0,
    specVersion,
    expectedMinor,
    filesChecked,
    offenders,
  };
}

// CLI wrapper — only fires when invoked directly, not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    printHelpAndExit(process.argv.slice(2), USAGE);
    const argv = parseStrict(process.argv.slice(2), { bools: ['--json'] });
    const root = resolvePluginRoot(import.meta.url);
    const result = runVersionCascadeCheck({ root });

    if (argv.bools.has('--json')) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (result.ok) {
      process.stdout.write(
        `version-cascade-check: ok (${result.expectedMinor} consistent across ${result.filesChecked.length} file(s))\n`
      );
    } else {
      process.stderr.write(
        `version-cascade-check: ${result.offenders.length} stale mention(s) (expected ${result.expectedMinor}):\n`
      );
      for (const o of result.offenders) {
        process.stderr.write(`  ${o.file}:${o.line} — found ${o.found ?? '<missing>'} (expected ${o.expected})\n`);
        process.stderr.write(`    > ${o.context}\n`);
      }
      process.stderr.write(
        `\nFix: update each line to use ${result.expectedMinor}, or move historical refs into CLAUDE-changelog.md.\n`
      );
    }
    process.exit(result.ok ? 0 : 1);
  } catch (e) {
    if (e instanceof ArgvError) {
      process.stderr.write(`version-cascade-check: ${e.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`version-cascade-check: ${e.message}\n`);
    process.exit(2);
  }
}
