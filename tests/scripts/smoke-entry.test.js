// smoke-entry.test.js — G1a (docs/spec-optimization-roadmap-2026-09-21.md §7).
//
// `npm run smoke` is the oracle a completion claim about this repo is supposed
// to be able to cite, so the thing that can quietly break it is not a failing
// suite — it is the entry point naming a suite that no longer exists, running
// one file instead of two, and still printing a green line. This gate joins the
// list in tests/smoke.sh against tests/integration/ on disk.
//
// It does NOT run the smoke suites: they take minutes and `npm test` already
// runs both through run-all.sh. What is checked here is the wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SMOKE_SH = path.join(REPO_ROOT, 'tests/smoke.sh');

/** The suite names tests/smoke.sh will iterate, read out of its own source. */
export function smokeSuiteNames(text) {
  const m = text.match(/^SMOKE_SUITES="([^"]*)"/m);
  if (!m) return null;
  return m[1]
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

test('G1a: package.json exposes `smoke` and it runs tests/smoke.sh', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(typeof pkg.scripts.smoke, 'string', 'package.json must define a `smoke` script');
  assert.match(pkg.scripts.smoke, /tests\/smoke\.sh/);
  assert.ok(fs.existsSync(SMOKE_SH), 'tests/smoke.sh must exist');
  // Executable bit: npm runs it through `bash`, but a non-executable file in a
  // repo whose CI also greps for the bit is a portability trap this repo has
  // hit before.
  assert.ok(fs.statSync(SMOKE_SH).mode & 0o111, 'tests/smoke.sh must be executable');
});

test('G1a: every suite tests/smoke.sh names exists, and there are at least two', () => {
  const text = fs.readFileSync(SMOKE_SH, 'utf8');
  const names = smokeSuiteNames(text);
  assert.ok(names, 'SMOKE_SUITES assignment not found — the extraction anchor moved');
  assert.ok(names.length >= 2, `smoke must drive ≥2 integration suites, found ${names.length}: ${names}`);
  const missing = names.filter(n => !fs.existsSync(path.join(REPO_ROOT, `tests/integration/${n}.test.sh`)));
  assert.deepEqual(
    missing,
    [],
    `tests/smoke.sh names suite(s) not in tests/integration/: ${missing.join(', ')}`
  );
});

test('G1a: the join is capable of failing (mutation control)', () => {
  const text = fs.readFileSync(SMOKE_SH, 'utf8');
  // Mutate INSIDE the assignment, not the first occurrence of a suite name in
  // the file. The first draft of this test used a bare
  // `text.replace('user-journey', …)`, which renamed the mention in the header
  // comment and left the list untouched — the mutation "applied", the file
  // differed, and the control passed while proving nothing. It failed on the
  // first run, which is the only reason that is written down here rather than
  // shipped.
  const rename = text.replace(/^(SMOKE_SUITES=")([^\n"]+)/m, '$1$2-renamed');
  assert.notEqual(rename, text, 'rename mutation did not apply — the assignment shape changed');
  assert.ok(
    smokeSuiteNames(rename).some(n => !fs.existsSync(path.join(REPO_ROOT, `tests/integration/${n}.test.sh`))),
    'a renamed suite still resolved — the existence join cannot fail'
  );

  // The other direction drift arrives from: a suite is added to the list and
  // the file is never written.
  const added = text.replace(/^(SMOKE_SUITES="[^"]*)"/m, '$1\nsuite-that-does-not-exist"');
  assert.notEqual(added, text, 'append mutation did not apply — the assignment shape changed');
  const addedNames = smokeSuiteNames(added);
  assert.ok(addedNames.includes('suite-that-does-not-exist'), 'the parser must see the appended name');
  assert.ok(
    addedNames.some(n => !fs.existsSync(path.join(REPO_ROOT, `tests/integration/${n}.test.sh`))),
    'an unwritten suite still resolved — the existence join cannot fail'
  );
});

test('G1a: smoke.sh reports how many suites ran, and fails short of the whole list', () => {
  const text = fs.readFileSync(SMOKE_SH, 'utf8');
  // "0 failed" over 0 suites and "0 failed" over 2 print the same thing unless
  // the count is stated and the shortfall is an error.
  assert.match(text, /SMOKE: \$RAN\/\$EXPECTED suite\(s\) passed/, 'the success line must state the count');
  assert.match(text, /\$RAN" -ne "\$EXPECTED/, 'a short run must be a failure, not a quiet pass');
  assert.match(text, /exit 1/, 'the failure paths must exit non-zero');
});
