// home-sandbox-consumers.test.js — R11-27, node half.
//
// tests/lib/home-sandbox.mjs is the single source for "redirect every write off
// the real ~/.claude". This gate is what keeps a partial migration from
// becoming a permanent one, the same way assert-helper-consumers.test.js does
// for the bash suites: the un-migrated set is an explicit list that may only
// shrink, and a NEW suite may not join it.
//
// Two properties, because the failure has two halves:
//   1. Who uses the helper. A suite that hand-writes `process.env.HOME = …` is
//      correct on the day it is written and one key short the day a new seam
//      appears — the shape that ran `clean-residue --apply` against the
//      maintainer's live state directory.
//   2. What the helper covers. A list of seams is itself a hand-written set, so
//      it is DERIVED from the source here rather than trusted: every
//      `process.env.CLAUDEMD_*_DIR` that scripts/ and bin/ actually read must
//      appear in PATH_SEAMS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATH_SEAMS } from '../lib/home-sandbox.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SUITE_DIR = path.join(REPO_ROOT, 'tests/scripts');
const SHARED = 'tests/lib/home-sandbox.mjs';

// Classified by MECHANISM: does this file redirect HOME itself? Either spelling
// counts — the in-process assignment and the env literal handed to spawnSync —
// because both are a private copy of what the helper centralises. Naming the
// variable (`tmpHome`, `sandboxHome`, …) would be classifying by content along
// the wrong axis, which is the mistake the bash-side gate had to correct.
const setsHomeByHand = text => /process\.env\.HOME\s*=/.test(text) || /(^|[^A-Za-z_])HOME:\s/.test(text);
const usesShared = text => text.includes('lib/home-sandbox.mjs');

// Measured 2026-09-04. This list may only get shorter. It is the migration
// backlog, not an allowlist for new work — the "no new entries" property is
// what the second test enforces.
const LEGACY_OWN_HOME = [
  'audit.test.js',
  'cache-prune.test.js',
  'design-detect.test.js',
  'doctor.test.js',
  'hard-rules-audit.test.js',
  'install.test.js',
  'lesson-bypass-audit.test.js',
  'lifecycle-help-noop.test.js',
  'paths.test.js',
  'sampling-audit.test.js',
  'settings-merge.test.js',
  'sparkline.test.js',
  'spec-coherence-audit.test.js',
  'spec-hash.test.js',
  'spec-routing-consumers.test.js',
  'status.test.js',
  'statusline-adopt.test.js',
  'statusline-cli.test.js',
  'statusline-hosts.test.js',
  'structure-scan-parity.test.js',
  'toggle.test.js',
  'uninstall.test.js',
  'update.test.js',
];

// This file imports PATH_SEAMS, so without the exclusion it counts ITSELF as a
// consumer — and `migrated.length >= 1` below would then be satisfied by the
// gate alone, on a repo where nothing else had migrated. A gate that certifies
// an empty set is the failure this suite family exists to prevent.
const SELF = path.basename(fileURLToPath(import.meta.url));

function suites() {
  return fs
    .readdirSync(SUITE_DIR)
    .filter(f => f.endsWith('.test.js') && f !== SELF)
    .map(f => ({ name: f, text: fs.readFileSync(path.join(SUITE_DIR, f), 'utf8') }));
}

test('R11-27: the gate states how many suites it judged', t => {
  const all = suites();
  const redirecting = all.filter(s => setsHomeByHand(s.text) || usesShared(s.text));
  const migrated = all.filter(s => usesShared(s.text)).map(s => s.name);
  t.diagnostic(
    `judged ${all.length} node suite(s); ${redirecting.length} redirect HOME, ` +
      `${migrated.length} on ${SHARED}, ${LEGACY_OWN_HOME.length} still hand-written`
  );
  // Floor on the SCANNED set: a readdir that returns two files must fail rather
  // than report a clean migration over nothing.
  assert.ok(all.length >= 50, `expected ≥50 node suites under tests/scripts, found ${all.length}`);
  assert.ok(migrated.length >= 1, 'the shared sandbox must have at least one real consumer');
});

test('R11-27: every suite that redirects HOME uses the shared sandbox or is on the legacy list', () => {
  const offenders = suites()
    .filter(s => setsHomeByHand(s.text) && !usesShared(s.text) && !LEGACY_OWN_HOME.includes(s.name))
    .map(s => s.name);
  assert.deepEqual(
    offenders,
    [],
    `these suites build their own sandbox home instead of importing ${SHARED}:\n  ` +
      offenders.join('\n  ') +
      `\n  A private env literal is one key short the day a new path seam lands; that is how a ` +
      `destructive CLI test reached the maintainer's real ~/.claude/.claudemd-state.`
  );
});

test('R11-27: the legacy list only shrinks', () => {
  const byName = new Map(suites().map(s => [s.name, s]));
  const gone = LEGACY_OWN_HOME.filter(n => !byName.has(n));
  assert.deepEqual(
    gone,
    [],
    `legacy entries name suites that no longer exist — delete them:\n  ${gone.join('\n  ')}`
  );

  // A migrated suite must leave the list, or the entry stays a standing
  // permission for a later edit to walk back off the helper.
  const migrated = LEGACY_OWN_HOME.filter(n => usesShared(byName.get(n).text));
  assert.deepEqual(
    migrated,
    [],
    `these suites already import ${SHARED} — remove them from LEGACY_OWN_HOME:\n  ${migrated.join('\n  ')}`
  );
});

test('R11-27: PATH_SEAMS covers every path seam the shipped code actually reads', () => {
  // Derived from source, not asserted against a second hand-written list. A new
  // `CLAUDEMD_*_DIR` in scripts/ redirects writes; every sandbox that does not
  // set it keeps writing to the real home for that one directory, silently.
  const roots = ['scripts', 'bin'];
  const found = new Set();
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) {
        const code = fs
          .readFileSync(abs, 'utf8')
          .split('\n')
          .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .join('\n');
        for (const m of code.matchAll(/process\.env\.(CLAUDEMD_[A-Z0-9_]*_DIR)/g)) found.add(m[1]);
      }
    }
  };
  for (const r of roots) walk(path.join(REPO_ROOT, r));

  assert.ok(
    found.size >= 2,
    `only ${found.size} CLAUDEMD_*_DIR seam(s) found in ${roots.join('/')} — the scan broke, and an ` +
      'empty set would make this comparison vacuous'
  );
  const missing = [...found].filter(k => !PATH_SEAMS.includes(k)).sort();
  assert.deepEqual(
    missing,
    [],
    `${SHARED} does not redirect these seams: ${missing.join(', ')}. Add them to PATH_SEAMS (and to ` +
      'the sandbox it builds), or every suite using the helper writes to the real home for them.'
  );
  for (const k of ['HOME', 'TMPDIR']) {
    assert.ok(PATH_SEAMS.includes(k), `PATH_SEAMS must always carry ${k}`);
  }
});

test('R11-27: both predicates can return false (mutation control)', () => {
  // The membership rule, against the two shapes it must separate.
  const synthetic = [
    { name: 'zz-new-inprocess.test.js', text: 'process.env.HOME = tmp;\n' },
    { name: 'zz-new-spawnenv.test.js', text: 'spawnSync(x, [], { env: { ...process.env, HOME: tmp } });\n' },
    { name: 'zz-migrated.test.js', text: "import { useHomeSandbox } from '../lib/home-sandbox.mjs';\n" },
  ];
  const flagged = synthetic
    .filter(s => setsHomeByHand(s.text) && !usesShared(s.text) && !LEGACY_OWN_HOME.includes(s.name))
    .map(s => s.name);
  assert.deepEqual(
    flagged,
    ['zz-new-inprocess.test.js', 'zz-new-spawnenv.test.js'],
    'both hand-written spellings must be caught and a migrated suite must not be'
  );

  // The seam rule: a seam absent from PATH_SEAMS has to make the comparison
  // fail. Without this the derivation could be scanning nothing and still green.
  const pretendFound = [...PATH_SEAMS.filter(s => s.startsWith('CLAUDEMD_')), 'CLAUDEMD_ZZ_FAKE_DIR'];
  assert.deepEqual(
    pretendFound.filter(k => !PATH_SEAMS.includes(k)),
    ['CLAUDEMD_ZZ_FAKE_DIR'],
    'an unlisted seam did not survive the filter — the coverage check cannot fail'
  );
});
