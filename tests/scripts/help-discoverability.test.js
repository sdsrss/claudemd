// help-discoverability.test.js — Round-1 user-test regression: every
// slash-command CLI must (a) accept `--help` / `-h` and exit 0 with a
// usage block, (b) reject unknown args with exit 2 (no silent fallback).
//
// Pre-fix history (this round):
//   - status.js / lint-argv.js silently ignored ALL args and exited 0 —
//     same antipattern family documented in feedback_cli_flag_shape_silent_fallback.md.
//   - audit / sparkline / hard-rules-audit / clean-residue / doctor
//     rejected `--help` as `Unknown argument: '--help'.` (exit 2),
//     blocking new-user discoverability on the most universal CLI probe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Each entry: [scriptRelPath, usageMatcher].
// usageMatcher is a regex that must match stdout when --help fires.
const SCRIPTS = [
  ['scripts/audit.js', /Usage:.*audit\.js/],
  ['scripts/sparkline.js', /Usage:.*sparkline\.js/],
  ['scripts/hard-rules-audit.js', /Usage:.*hard-rules-audit\.js/],
  ['scripts/clean-residue.js', /Usage:.*clean-residue\.js/],
  ['scripts/doctor.js', /Usage:.*doctor\.js/],
  ['scripts/status.js', /Usage:.*status\.js/],
  ['scripts/lint-argv.js', /Usage:.*lint-argv\.js/],
  // Takes a positional <doc.md>, so its bogus-arg path is parseStrictOrExit on
  // the flag half — the same exit-2 contract, reached a different way.
  ['scripts/doc-check.mjs', /Usage:.*doc-check\.mjs/],
  // Round-5 additions: lifecycle scripts. Pre-fix `install --help` actually
  // RAN the install destructively because argv was silently dropped.
  ['scripts/install.js', /Usage:.*install\.js/],
  ['scripts/uninstall.js', /Usage:.*uninstall\.js/],
  ['scripts/update.js', /Usage:.*update\.js/],
];

const run = (relScript, args) =>
  spawnSync(process.execPath, [path.join(REPO_ROOT, relScript), ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });

for (const [rel, usageRe] of SCRIPTS) {
  test(`${rel}: --help exits 0 and prints usage to stdout`, () => {
    const r = run(rel, ['--help']);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, usageRe);
    assert.match(r.stdout, /--help.*[Pp]rint/);
  });

  test(`${rel}: -h exits 0 and prints usage to stdout`, () => {
    const r = run(rel, ['-h']);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, usageRe);
  });

  test(`${rel}: bogus arg exits 2 (not silent-success)`, () => {
    // Pre-fix behavior for status.js + lint-argv.js was exit 0 with full
    // output ignoring the bogus arg — the silent-fallback antipattern.
    const r = run(rel, ['--zzz-not-a-real-flag=1']);
    assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout}`);
    assert.match(r.stderr, /Unknown flag|Unknown argument/);
  });
}

// bin/claudemd-lint.js USAGE → npm bin-name consistency.
// Pre-fix, USAGE listed every subcommand as `claudemd lint <text>` but the
// installed npm bin is `claudemd-cli` (per package.json). A user copying the
// help-text command verbatim hit `command not found: claudemd`. README,
// CHANGELOG, and pre-commit example all use the correct `claudemd-cli` form,
// so the help-text was the only surface drifted.
test('bin/claudemd-lint.js: USAGE references actual npm bin name', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const binName = Object.keys(pkg.bin)[0]; // "claudemd-cli"
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin/claudemd-lint.js'), '--help'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
  // Every documented subcommand line must use the real bin name.
  for (const sub of ['lint', 'audit', '--version', '--help']) {
    const wrongRe = new RegExp(`(^|\\s)claudemd\\s+(${sub.replace(/[-]/g, '\\-')})\\b`, 'm');
    assert.ok(
      !wrongRe.test(r.stdout),
      `USAGE references 'claudemd ${sub}' (without -cli suffix); should be '${binName} ${sub}'.`
    );
    const rightRe = new RegExp(`${binName}\\s+${sub.replace(/[-]/g, '\\-')}`, 'm');
    assert.match(r.stdout, rightRe, `USAGE should mention '${binName} ${sub}'`);
  }
});

// SCR-M3 (round-17): the accepted-flag set, derived from the parser call, must
// reach BOTH places a user looks. `sampling-audit.js` grew `--until` and
// `--force` and neither reached its `Usage:` synopsis line or the flag table in
// commands/claudemd-sampling-audit.md — `--until` being the headline feature of
// the release that added it.
//
// Deliberately a named list rather than every CLI: this asserts a doc SHAPE (a
// `| `--flag` |` table row) that only the commands/ twins use. Adding a pair
// here is one line, and a missing twin fails loudly rather than silently
// narrowing the gate.
const FLAG_DOC_PAIRS = [['scripts/sampling-audit.js', 'commands/claudemd-sampling-audit.md']];

test('SCR-M3: every accepted flag reaches the Usage synopsis and the command doc', () => {
  assert.ok(FLAG_DOC_PAIRS.length > 0, 'this gate would pass over nothing');
  for (const [scriptRel, docRel] of FLAG_DOC_PAIRS) {
    const src = fs.readFileSync(path.join(REPO_ROOT, scriptRel), 'utf8');

    // Derived from the parser call, not a second hand-kept list — the whole
    // defect is a hand-kept list falling behind the one that decides.
    const spec = src.match(/parseStrictOrExit\(\s*process\.argv\.slice\(2\),\s*\{([\s\S]*?)\}\s*\)/);
    assert.ok(spec, `${scriptRel}: could not locate the parseStrictOrExit flag spec`);
    const flags = [...spec[1].matchAll(/'(--[a-z-]+)'/g)].map(m => m[1]);
    // The floor is derived from the spec's own array ELEMENTS, counted with a
    // DIFFERENT regex than the one under test: /'[^']*'/ accepts any quoted
    // token, while the extraction above accepts only --[a-z-]+. Equality between
    // the two is what catches a narrowed extraction; a shared regex would just
    // agree with itself. The old floor was a hand-written `>= 3` against an
    // actual 6, so narrowing the flag regex dropped the count and the suite
    // stayed 35/35 — the exact slip its own message names (0.92.0 review, F10).
    const declared = [...spec[1].matchAll(/(?:bools|values)\s*:\s*\[([^\]]*)\]/g)].reduce(
      (n, m) => n + [...m[1].matchAll(/'[^']*'/g)].length,
      0
    );
    assert.ok(
      declared >= 3,
      `${scriptRel}: counted ${declared} flags in the parser spec — re-anchor this floor`
    );
    assert.equal(
      flags.length,
      declared,
      `${scriptRel}: extracted ${flags.length} flags from a spec declaring ${declared} — the spec regex slipped`
    );

    // The synopsis is the `Usage:` line plus its wrapped continuation lines,
    // i.e. up to the first blank line. `--help` is conventionally listed under
    // Options rather than in the synopsis, so it is exempt there.
    const usage = src.match(/Usage:[\s\S]*?\n\s*\n/);
    assert.ok(usage, `${scriptRel}: no Usage: synopsis block`);
    const doc = fs.readFileSync(path.join(REPO_ROOT, docRel), 'utf8');

    for (const flag of flags) {
      assert.ok(
        usage[0].includes(flag),
        `${scriptRel}: ${flag} is accepted but missing from the Usage synopsis line`
      );
      assert.ok(
        new RegExp(`\\|\\s*\`${flag}(=[A-Za-z]+)?\`\\s*\\|`).test(doc),
        `${docRel}: ${flag} is accepted by ${scriptRel} but has no row in the flag table`
      );
    }
  }
});
