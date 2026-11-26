// version-cascade-check — pre-tag sanity for spec ship pipeline. Two checks
// (the Sizing-line check that sat between them went with the line, 0.123.0):
//
//   1. Minor-version cascade: every `v6.\d+(?:\.\d+)?` token in README.md +
//      `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` MUST
//      match (at minor granularity) `spec/hard-rules.json#spec_version`.
//
//   3. Plugin semver agreement (v0.47.4): the plugin's own semver MUST be
//      identical in `package.json#version`, `.claude-plugin/plugin.json#version`,
//      `.claude-plugin/marketplace.json#metadata.version`, and
//      `.claude-plugin/marketplace.json#plugins[0].version`. package-lock.json
//      carried two more sites from v0.72.0 until 0.117.2 deleted the lockfile
//      (D#612: Claude Code installs a plugin's devDependencies from it). Distinct from check
//      1, which is about the SPEC version (v6.X) — the plugin semver and the spec
//      semver are independent by policy (see CHANGELOG "Versioning policy").
//
// History (failure modes these guards exist for):
//   - v0.47.1 / v0.47.2 / v0.47.3 all shipped with `package.json` still at
//     0.47.0 while both `.claude-plugin/` manifests advanced. The ship runbook's
//     step-2 grep list is `spec/ tests/ scripts/ README.md .claude-plugin/` —
//     package.json is not in it, so three consecutive releases followed the
//     runbook faithfully and missed the same file. It matters because
//     `scripts/lib/paths.js#readPluginVersion` reads **package.json**, not
//     plugin.json: install.js stamps that value into
//     `~/.claude/.claudemd-manifest.json`, so /claudemd-status and /claudemd-doctor
//     reported 0.47.0 for a live 0.47.3 install, and the v0.36.0 stale-root guard
//     — which compares exactly this number — could not tell 0.47.0 from 0.47.3.
//     Memory rule was not the fix; this check is (mechanical > remembered).
//   - v0.17.6 minor-bump shipped with 3 cascade files still pointing at the
//     prior spec version. Captured as `feedback_spec_version_bump_cascade_grep.md`
//     — "grep OLD_VER across spec/hard-rules.json + tests/ before listing
//     modify-targets." Rule remembered, execution skipped.
//   - v0.19.0 minor-bump shipped with README.md (7 v6.11 mentions) and
//     marketplace.json description (2 v6.11 mentions) stale; a docs-only
//     catch-up commit (d044194) repaired them after the fact.
// The feedback is the rule; this script is the mechanical enforcement.
//
// What it does NOT check:
//   - spec/CLAUDE*.md cascade tokens (the spec is its own source of truth —
//     version line inside the spec IS the canonical, not a derived copy).
//   - spec/CLAUDE-changelog.md (historical entries reference prior versions
//     intentionally and forever).
//   - tests/* (test fixtures may pin historical versions in upgrade-lifecycle
//     phase setup; tests/scripts/spec-structure.test.js already asserts the
//     current version explicitly).
//
// Exit codes: 0 ok | 1 cascade or semver drift found | 2 argv-shape error.

import fs from 'node:fs';
import path from 'node:path';
import { resolvePluginRoot } from './lib/paths.js';
import { parseStrict, ArgvError, printHelpAndExit, invokedAsMain } from './lib/argv.js';

const USAGE = `Usage: node scripts/version-cascade-check.js [--json]

Pre-tag guard. Verifies two invariants:

  1. Spec minor version (vX.Y) is consistent across README.md, plugin.json,
     and marketplace.json (vs. spec/hard-rules.json#spec_version).
  2. Plugin semver agrees across package.json, .claude-plugin/plugin.json,
     both .claude-plugin/marketplace.json sites
     and every claudemd-cli@X.Y.Z pin in README.md — a PATCH-level check the
     vX.Y comparison in (1) structurally cannot make.

Options:
  --json       Emit JSON instead of human-readable.
  --help, -h   Print this message and exit.

Exit codes: 0 success | 1 cascade or semver drift | 2 argv-shape error.`;

const SCANNED_FILES = ['README.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'];

// Token regex is derived per-run from the spec major (see specMajorTokenRe),
// NOT a fixed `/v6\./`. Scanning a fixed major means that after a `v7.0.0`
// bump the check goes silent — a stale `v7.5` in README/plugin.json never
// matches `/v6\./`, so the cascade-staleness it exists to catch (v0.17.6 /
// v0.19.0 incidents) slips through with ok:true. Deriving the major from
// spec_version keeps the check live across major bumps while still ignoring
// the plugin's own `v0.x` version tokens that share these files.
function specMajorTokenRe(specVersion) {
  const m = specVersion.match(/^v(\d+)\./);
  if (!m) throw new Error(`spec_version '${specVersion}' is not v<major>.<minor>[.patch]`);
  return new RegExp(`v${m[1]}\\.\\d+(?:\\.\\d+)?`, 'g');
}

function toMinor(token) {
  // "v6.13.0" → "v6.13" ; "v6.13" → "v6.13"
  const m = token.match(/^(v\d+\.\d+)/);
  return m ? m[1] : token;
}

// Check 3 — the plugin's own semver must agree across every manifest that
// carries it. `package.json` is listed FIRST deliberately: it is the one
// readPluginVersion() actually reads, and the one three consecutive releases
// forgot. Missing file or missing key => a site with value null, which cannot
// equal `expected`, so the check fails loudly rather than skipping.
export function runPluginSemverCheck({ root }) {
  const readJson = rel => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const pkg = readJson('package.json');
  const plugin = readJson('.claude-plugin/plugin.json');
  const market = readJson('.claude-plugin/marketplace.json');
  const sites = [
    { file: 'package.json', path: 'version', value: pkg?.version ?? null },
    { file: '.claude-plugin/plugin.json', path: 'version', value: plugin?.version ?? null },
    {
      file: '.claude-plugin/marketplace.json',
      path: 'metadata.version',
      value: market?.metadata?.version ?? null,
    },
    {
      file: '.claude-plugin/marketplace.json',
      path: 'plugins[0].version',
      value: market?.plugins?.[0]?.version ?? null,
    },
  ];
  // README's CI example pins `claudemd-cli@X.Y.Z`; nothing bumped it: 0.113.4
  // stood there from 0.115.0 through 0.116.4. One site per pin, so a README without one
  // adds none.
  let readme = '';
  try {
    readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  } catch {
    // no README, no pins
  }
  readme.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/claudemd-cli@(\d+\.\d+\.\d+)/g)) {
      sites.push({ file: 'README.md', path: `claudemd-cli@ (line ${i + 1})`, value: m[1] });
    }
  });
  // package.json is the reference: it is what install.js stamps into the manifest.
  const expected = sites[0].value;
  const ok = expected != null && sites.every(s => s.value === expected);
  return { ok, expected, sites };
}

export function runVersionCascadeCheck({ root }) {
  const manifestPath = path.join(root, 'spec/hard-rules.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const specVersion = manifest.spec_version;
  if (typeof specVersion !== 'string') {
    throw new Error(`spec/hard-rules.json#spec_version missing or not a string (got: ${typeof specVersion})`);
  }
  const expectedMinor = toMinor(specVersion);
  const versionToken = specMajorTokenRe(specVersion);

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
    // Presence floor (2026-07-26 audit). The loop below only reports tokens whose
    // minor DISAGREES, so a file that lost every `vX.Y` mention produced an empty
    // offenders list — the same output as "all correct". The header's own incident
    // history (v0.19.0: README carrying 7 stale mentions) is the presence case;
    // absence had no check at all, and these files are scanned precisely because
    // they are supposed to carry the version.
    if (!versionToken.test(content)) {
      offenders.push({
        file: rel,
        line: 0,
        found: null,
        expected: expectedMinor,
        context: '<no version token in file — expected at least one>',
      });
      versionToken.lastIndex = 0;
      continue;
    }
    versionToken.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.match(versionToken);
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
if (invokedAsMain(import.meta.url)) {
  try {
    printHelpAndExit(process.argv.slice(2), USAGE);
    const argv = parseStrict(process.argv.slice(2), { bools: ['--json'] });
    const root = resolvePluginRoot(import.meta.url);
    const cascadeResult = runVersionCascadeCheck({ root });
    const semverResult = runPluginSemverCheck({ root });
    const overallOk = cascadeResult.ok && semverResult.ok;

    if (argv.bools.has('--json')) {
      process.stdout.write(
        JSON.stringify(
          {
            ok: overallOk,
            cascade: cascadeResult,
            pluginSemver: semverResult,
          },
          null,
          2
        ) + '\n'
      );
    } else if (overallOk) {
      process.stdout.write(
        `version-cascade-check: ok (${cascadeResult.expectedMinor} consistent across ${cascadeResult.filesChecked.length} file(s); ` +
          `plugin semver ${semverResult.expected} consistent across ${semverResult.sites.length} site(s))\n`
      );
    } else {
      if (!semverResult.ok) {
        process.stderr.write(`version-cascade-check: plugin semver disagrees across its sites:\n`);
        for (const s of semverResult.sites) {
          process.stderr.write(
            `  ${s.value === semverResult.expected ? ' ' : '✗'} ${s.file}#${s.path} = ${s.value}\n`
          );
        }
        process.stderr.write(
          // Derived, not written down. The literal said "four" while this gate
          // enumerated six sites (the lockfile pair had been added), and
          // nothing re-checked the sentence when the list grew (round-17
          // REL-M3). A count in prose beside the array it counts is a number
          // with no owner.
          `\nAll ${semverResult.sites.length} MUST match. package.json is the one the runbook's grep list historically missed, ` +
            `and it is the one that matters most: scripts/lib/paths.js#readPluginVersion reads package.json ` +
            `(NOT .claude-plugin/plugin.json), so a stale value there is what install.js stamps into ` +
            `~/.claude/.claudemd-manifest.json — making status/doctor report the wrong version and blinding ` +
            `the v0.36.0 stale-root guard, which compares exactly this number.\n`
        );
      }
      if (!cascadeResult.ok) {
        process.stderr.write(
          `version-cascade-check: ${cascadeResult.offenders.length} stale mention(s) (expected ${cascadeResult.expectedMinor}):\n`
        );
        for (const o of cascadeResult.offenders) {
          process.stderr.write(
            `  ${o.file}:${o.line} — found ${o.found ?? '<missing>'} (expected ${o.expected})\n`
          );
          process.stderr.write(`    > ${o.context}\n`);
        }
        process.stderr.write(
          `\nFix cascade: update each line to use ${cascadeResult.expectedMinor}, or move historical refs into CLAUDE-changelog.md.\n`
        );
      }
    }
    process.exit(overallOk ? 0 : 1);
  } catch (e) {
    if (e instanceof ArgvError) {
      process.stderr.write(`version-cascade-check: ${e.message}\n`);
      process.exit(2);
    }
    // Exit 1, not 2: 2 is documented as "argv-shape error", so reusing it for a
    // malformed spec/hard-rules.json made a corrupt input indistinguishable from
    // a typo'd flag (2026-07-26 audit). Only the ArgvError branch above owns 2.
    process.stderr.write(`version-cascade-check: ${e.message}\n`);
    process.exit(1);
  }
}
