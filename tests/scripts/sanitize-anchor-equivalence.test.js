// sanitize-anchor-equivalence.test.js — differential proof that the run-start
// lookbehinds added to lint.js#stripIdentifiers (clauses 3 and 4) are a pure
// COMPLEXITY change with no semantic effect.
//
// The argument for equivalence is: the required delimiter (`/` for clause 3,
// `.` for clause 4) is never itself a member of the leading character class,
// so the greedy run always ends exactly at the delimiter candidate, and a
// shorter prefix is always followed by another class char — backtracking
// inside the run can never find a match the maximal run missed. Anchoring at
// the run start therefore only removes offsets that could not have matched.
//
// That argument is sound but it is an argument. This gate is the measurement:
// both spellings are run over a seeded corpus built from the exact character
// classes involved, and every output must be byte-identical. If a future edit
// changes either class so the delimiter becomes a member, this fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripDottedFileTokens } from '../../scripts/lib/lint.js';

// Pre-fix spellings, preserved verbatim as the differential baseline.
const OLD3 = () => /[A-Za-z0-9._@~-]*\/[A-Za-z0-9._/@~-]*/g;
const OLD4 = () => /[A-Za-z0-9_-]+\.[a-z][a-z0-9]*/g;
// Post-fix clause 3: a run-start lookbehind. Legal here only because clause 3's
// trailing class is a superset of its leading one.
const NEW3 = () => /(?<![A-Za-z0-9._@~-])[A-Za-z0-9._@~-]*\/[A-Za-z0-9._/@~-]*/g;
// Post-fix clause 4: an explicit single-pass scan. The lookbehind spelling was
// tried first and THIS harness rejected it — `_a9Zaz.aZ9Z_.a中` matches twice
// under /g because the ext class `[a-z0-9]` is a strict subset of the run class,
// so the first match ends mid-run and the second starts after a run char. The
// case is kept as a named probe below so the reason cannot be lost.
const NEW4 = stripDottedFileTokens;

// Deterministic LCG — a seeded corpus reproduces byte-for-byte on every run,
// so a failure is always re-playable (Math.random would not be).
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Alphabet chosen to stress the boundaries: class members of BOTH classes, the
// two delimiters, chars that are in one class but not the other (`@ ~`),
// non-class separators (space, `+`, `=`), uppercase (fails `[a-z]` after the
// dot), and a CJK char (multibyte, outside every ASCII class).
const ALPHABET = [...'aazZ09__--..//@~ +=X中'];

function corpus() {
  const out = [
    '',
    '/',
    '.',
    'a',
    'a.b',
    'a/b',
    'a.b.js',
    'foo.bar.js',
    'v6.14',
    '3.5x',
    '9x.5',
    'ab+cd/ef',
    'ab+/cd',
    '/abc',
    'abc/',
    'a_b-c.ts',
    'A_B.9x',
    'docs/comprehensive-audit.md',
    'refactor comprehensive-parser.js now',
    '~/.claude/CLAUDE.md',
    'user@host:path',
    'a//b',
    '..//..',
    '中文/路径.md',
    'a'.repeat(64) + '.js',
    '_'.repeat(32),
    '-'.repeat(32) + '/x',
    // The exact shape that rejected the clause-4 lookbehind: two /g matches in
    // one run, the first ending mid-run at the uppercase Z.
    '_a9Zaz.aZ9Z_.a中  ',
    'ab.cDe.fg',
    'x1.aB2.cd',
  ];
  const rnd = lcg(20260816);
  for (let i = 0; i < 4000; i++) {
    const len = 1 + Math.floor(rnd() * 24);
    let s = '';
    for (let j = 0; j < len; j++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    out.push(s);
  }
  return out;
}

test('clause 3 (slashed-path): anchored and unanchored spellings agree byte-for-byte', () => {
  let checked = 0;
  for (const s of corpus()) {
    assert.equal(
      s.replace(NEW3(), ' '),
      s.replace(OLD3(), ' '),
      `clause-3 divergence on ${JSON.stringify(s)}`
    );
    checked++;
  }
  assert.ok(checked > 4000, `corpus too small to be evidence (got ${checked})`);
});

test('clause 4 (bare name.ext): single-pass scan matches the /g regex byte-for-byte', () => {
  let checked = 0;
  for (const s of corpus()) {
    assert.equal(NEW4(s), s.replace(OLD4(), ' '), `clause-4 divergence on ${JSON.stringify(s)}`);
    checked++;
  }
  assert.ok(checked > 4000, `corpus too small to be evidence (got ${checked})`);
});

test('clause 4: the lookbehind spelling this harness rejected stays rejected', () => {
  // Regression pin, not a hypothetical: a run-start lookbehind is the obvious
  // way to make clause 4 linear and it is WRONG here, because a match can end
  // mid-run. Anyone re-deriving the "delimiter is not in the leading class"
  // argument will reach for it again. This asserts the divergence is real.
  const LOOKBEHIND = () => /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]+\.[a-z][a-z0-9]*/g;
  const probe = '_a9Zaz.aZ9Z_.a中  ';
  assert.notEqual(
    probe.replace(LOOKBEHIND(), ' '),
    probe.replace(OLD4(), ' '),
    'the lookbehind spelling is expected to diverge — if it no longer does, the classes changed'
  );
  assert.equal(NEW4(probe), probe.replace(OLD4(), ' '));
});

test('control: the differential harness can actually detect a divergence', () => {
  // Controls-first — a harness that reports "all equal" is worthless until it
  // has been shown to report "not equal" for a spelling that IS different.
  // `[a-z]` → `[a-zA-Z]` after the dot changes which inputs match.
  const BROKEN = () => /[A-Za-z0-9_-]+\.[a-zA-Z][a-z0-9]*/g;
  const diverged = corpus().some(s => s.replace(BROKEN(), ' ') !== s.replace(OLD4(), ' '));
  assert.ok(
    diverged,
    'harness failed to detect a known-different regex — corpus does not exercise the clause'
  );
  // …and the same for clause 3.
  const BROKEN3 = () => /[A-Za-z0-9._@~-]*\/[A-Za-z0-9._@~-]*/g; // trailing class loses '/'
  assert.ok(
    corpus().some(s => s.replace(BROKEN3(), ' ') !== s.replace(OLD3(), ' ')),
    'harness does not exercise clause 3 either'
  );
});
