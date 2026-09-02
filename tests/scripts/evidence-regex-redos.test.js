// evidence-regex-redos.test.js — R11-12 (2026-09-02 audit).
//
// Two regexes scan untrusted whole-file text and are super-linear on a plain
// run of digits — no adversary needed, a lockfile, a hash dump or a data
// column reaches them:
//
//   bin/claudemd-lint.js  HAS_NUMERIC_ARROW    /\d\S*\s*(?:→|->|=>)\s*\d/
//   scripts/sampling-audit.js  EVIDENCE_FINGERPRINT  clause
//                              [0-9]+[^\s]*\s*(→|->|=>)\s*[0-9]+
//
// Both are `<digit-run><unbounded-run>` with no delimiter present, so the
// unanchored scan retries from every offset and rescans the tail each time.
// Measured pre-fix on this machine (node 24), one .test() call:
//   HAS_NUMERIC_ARROW    2k → 4ms    5k → 25ms      (quadratic)
//   EVIDENCE_FINGERPRINT 2k → 2648ms 5k → 40503ms   (cubic; 20k never returned)
//
// lint.js:150-157 records a fix for exactly this family in the sanitizer, but
// bin:364 runs against the RAW text before scan(), so a digit-leading token
// walked around that fix.
//
// This gate asserts BOUNDED WORK, not a regex spelling. The MATCHING semantics
// are pinned by the anchor cases below, which use the real shapes §10 requires
// (p99 580ms→140ms, 1453→1490) — bounding the quantifier must not stop those
// from being recognized.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Derived from source, not retyped: a divergent copy here would test a regex
// the shipped CLI does not use (feedback_extraction_needs_consumer_gate).
// Reads the declaration whether the literal sits on the `=` line or on the next
// one. A single-line `.find(l => l.includes(name + ' = /'))` was layout-coupled:
// `prettier --write` wraps a declaration past printWidth into
//   const NAME =
//     /…/;
// and the extractor then threw "not found" — the whole ReDoS gate stopped
// running over a change that touched no regex. Loud rather than silent, so the
// suite caught it, but the fix belongs in the reader
// (feedback_fixtures_cannot_see_a_broken_reader).
// Split from the file read so both layouts can be exercised directly, without a
// fixture file and without waiting for the real tree to happen to contain one.
function regexBodyFrom(lines, name, where) {
  const i = lines.findIndex(l => new RegExp(`\\b${name}\\s*=\\s*(/|$)`).test(l));
  assert.ok(i >= 0, `${name} not found in ${where}`);
  const decl = lines[i].includes('/') ? lines[i] : lines[i + 1];
  assert.ok(decl && decl.includes('/'), `${name} in ${where} has no regex literal on its declaration`);
  const body = decl.slice(decl.indexOf('/') + 1, decl.lastIndexOf('/'));
  assert.ok(body.length > 0, `${name} in ${where} extracted an empty pattern`);
  return body;
}

function extractRegex(relPath, name) {
  const src = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  return new RegExp(regexBodyFrom(src.split('\n'), name, relPath));
}

const HAS_NUMERIC_ARROW = extractRegex('bin/claudemd-lint.js', 'HAS_NUMERIC_ARROW');
const EVIDENCE_FINGERPRINT = extractRegex('scripts/sampling-audit.js', 'EVIDENCE_FINGERPRINT');

// Reader control. Whichever layout the tree happens to carry today, the OTHER
// one has no coverage — and a reader that silently stops finding the
// declaration turns every timing test below into a test of nothing.
test('regexBodyFrom reads both declaration layouts (reader control)', () => {
  const inline = ['const X = /ab+c/;'];
  const wrapped = ['const X =', '  /ab+c/;'];
  assert.equal(regexBodyFrom(inline, 'X', 'inline'), 'ab+c');
  assert.equal(regexBodyFrom(wrapped, 'X', 'wrapped'), 'ab+c');
  // A `.test()` USE site must not be mistaken for the declaration.
  assert.equal(regexBodyFrom(['if (X.test(s)) return;', 'const X = /ab+c/;'], 'X', 'use-first'), 'ab+c');
  // And a missing declaration must be loud, not an empty pattern that matches
  // everything and makes each anchor assertion below trivially pass.
  assert.throws(() => regexBodyFrom(['const Y = /z/;'], 'X', 'absent'), /X not found/);
});

function timeMs(fn) {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
}

// Generous ceiling: the point is linear-ish vs quadratic/cubic, and CI boxes
// are slow. Post-fix both regexes come in around a millisecond at these sizes.
const BUDGET_MS = 500;

// Per-regex probe sizes, deliberately NOT a shared constant. The size has to be
// large enough that the pre-fix regex busts the budget and small enough that it
// still RETURNS — a gate that hangs instead of failing is not a gate, and a
// shared 20k would have made the cubic case run for hours on a regression.
// Pre-fix at these sizes: HAS_NUMERIC_ARROW 30k ≈ 1050ms (20k came in at
// 468ms — under the budget, so the smaller size only failed on the doubling
// case), EVIDENCE_FINGERPRINT 2k ≈ 2648ms. Both fail in seconds; both pass in
// ~1ms once bounded.
const PROBES = [
  ['HAS_NUMERIC_ARROW', HAS_NUMERIC_ARROW, 30000],
  ['EVIDENCE_FINGERPRINT', EVIDENCE_FINGERPRINT, 2000],
];

for (const [name, re, n] of PROBES) {
  test(`R11-12: ${name} stays bounded on a ${n / 1000}k digit run`, () => {
    const ms = timeMs(() => re.test('1'.repeat(n)));
    assert.ok(ms < BUDGET_MS, `${name} took ${ms.toFixed(1)}ms on ${n} digits (budget ${BUDGET_MS}ms)`);
  });

  test(`R11-12: ${name} does not blow up per doubling (${n / 1000}k vs ${(n * 2) / 1000}k)`, () => {
    const a = timeMs(() => re.test('1'.repeat(n)));
    const b = timeMs(() => re.test('1'.repeat(n * 2)));
    assert.ok(a < BUDGET_MS, `${name} ${n} took ${a.toFixed(1)}ms`);
    assert.ok(b < BUDGET_MS, `${name} ${n * 2} took ${b.toFixed(1)}ms`);
  });
}

// --- semantics preserved: the shapes §10 actually requires must still match ---

test('R11-12: HAS_NUMERIC_ARROW still recognizes real before/after anchors', () => {
  for (const s of ['p99 580ms→140ms', '1453→1490 +2.5%', 'lines 92.12 -> 92.17', '30 => 0 errors']) {
    assert.ok(HAS_NUMERIC_ARROW.test(s), `must match: ${s}`);
  }
  for (const s of ['no numbers here', 'a → b']) {
    assert.equal(HAS_NUMERIC_ARROW.test(s), false, `must not match: ${s}`);
  }
});

test('R11-12: EVIDENCE_FINGERPRINT still recognizes every evidence class', () => {
  for (const s of [
    'scripts/audit.js:42',
    '7 passed',
    'p99 580ms→140ms',
    'Checked: pre-fix TypeError',
    'known-red baseline: flaky',
    '证据：re-ran the suite',
  ]) {
    assert.ok(EVIDENCE_FINGERPRINT.test(s), `must match: ${s}`);
  }
  assert.equal(EVIDENCE_FINGERPRINT.test('it works now'), false);
});
