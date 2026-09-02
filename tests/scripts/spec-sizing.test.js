// spec-sizing.test.js — the two release gates that read the spec's `**Sizing**`
// line must give the same answer about the same line (2026-09-02 audit R11-13a).
//
// Before scripts/lib/spec-sizing.js existed they each had their own regex:
// version-cascade-check.js parsed per target and accepted the arrowless
// "core 24417 bytes" form; spec-coherence-audit.js used one combined regex that
// demanded the exact framing "core N → N bytes …; extended N → N bytes". So a
// legal line could make one ship gate red and the other green — and "the ship
// gates disagree" has no correct resolution at tag time.
//
// Two halves here, and both are load-bearing:
//   1. the shapes that used to split them now produce identical verdicts;
//   2. nobody has quietly grown a third parser
//      (feedback_extraction_needs_consumer_gate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SIZING_TARGETS,
  SIZING_TOLERANCE_BYTES,
  findSizingLine,
  extractSizingClaim,
  parseSizingLine,
} from '../../scripts/lib/spec-sizing.js';
import { runSpecSizingCheck } from '../../scripts/version-cascade-check.js';
import { auditSpecCoherence } from '../../scripts/spec-coherence-audit.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A spec tree whose files are exactly the sizes the given Sizing line claims,
// so any drift a gate reports comes from PARSING, not from a real size delta.
function specTree(sizingLine, { core = 1000, extended = 2000, operator = 500 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sizing-'));
  const specDir = path.join(root, 'spec');
  fs.mkdirSync(specDir);
  fs.writeFileSync(path.join(specDir, 'CLAUDE.md'), 'x'.repeat(core));
  fs.writeFileSync(path.join(specDir, 'OPERATOR.md'), 'x'.repeat(operator));
  // The extended file has to BE `extended` bytes and contain the line, so pad
  // to the target length around it.
  const body = `${sizingLine}\n`;
  const pad = Math.max(0, extended - Buffer.byteLength(body, 'utf8'));
  fs.writeFileSync(path.join(specDir, 'CLAUDE-extended.md'), body + 'y'.repeat(pad));
  return root;
}

// What each gate concludes about the line, reduced to one comparable verdict.
function verdicts(root) {
  const cascade = runSpecSizingCheck({ root });
  const cascadeParseFailed =
    !!cascade.skipped ||
    cascade.drifts.some(d => d.reason === 'claim-parse-failed' && d.name !== 'OPERATOR.md');

  const coherence = auditSpecCoherence({ pluginRoot: root, projectCwd: root });
  const sizing = coherence.checks.find(c => c.name === 'sizing-accuracy');
  const coherenceParseFailed = sizing.findings.some(f => /not found or unparseable/i.test(f.detail));

  return { cascadeParseFailed, coherenceParseFailed };
}

const SIZE = { core: 1000, extended: 2000, operator: 500 };
const line = body => `**Sizing** (v6.25.4): ${body}`;

// Each of these is a line one gate read and the other refused.
const SHAPES = [
  [
    'canonical arrowed form',
    line(
      'core 900 → 1000 bytes (Δ +100); extended 1900 → 2000 bytes (Δ +100); OPERATOR.md 400 → 500 bytes (Δ +100).'
    ),
  ],
  [
    'arrowless form — version-cascade accepted it, spec-coherence called it unparseable',
    line('core 1000 bytes; extended 2000 bytes; OPERATOR.md 500 bytes.'),
  ],
  [
    'extended named before core — the combined regex was order-locked',
    line('extended 1900 → 2000 bytes; core 900 → 1000 bytes; OPERATOR.md 400 → 500 bytes.'),
  ],
  [
    'ASCII arrows',
    line('core 900 -> 1000 bytes; extended 1900 -> 2000 bytes; OPERATOR.md 400 -> 500 bytes.'),
  ],
  [
    'mixed: one target arrowed, one plain',
    line('core 900 → 1000 bytes; extended 2000 bytes; OPERATOR.md 400 → 500 bytes.'),
  ],
];

for (const [label, sizingLine] of SHAPES) {
  test(`both ship gates agree on a Sizing line: ${label}`, () => {
    const root = specTree(sizingLine, SIZE);
    try {
      const v = verdicts(root);
      assert.equal(
        v.cascadeParseFailed,
        v.coherenceParseFailed,
        `the two ship gates disagree about whether this line is readable — cascade parseFailed=${v.cascadeParseFailed}, coherence parseFailed=${v.coherenceParseFailed}\n  line: ${sizingLine}`
      );
      assert.equal(v.cascadeParseFailed, false, 'this shape is legal and both gates should read it');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('both ship gates agree when there is no Sizing line at all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sizing-'));
  try {
    fs.mkdirSync(path.join(root, 'spec'));
    for (const f of ['CLAUDE.md', 'CLAUDE-extended.md', 'OPERATOR.md']) {
      fs.writeFileSync(path.join(root, 'spec', f), 'no sizing line here\n');
    }
    const v = verdicts(root);
    assert.equal(v.cascadeParseFailed, true);
    assert.equal(v.coherenceParseFailed, true, 'a missing Sizing line must fail BOTH gates, not one');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractSizingClaim: post-arrow value, exact match text, and a usable OLD/NEW edit', () => {
  const l = line('core 24417 → 24500 bytes (Δ +83); extended 49000 bytes.');
  const core = extractSizingClaim(l, 'core');
  assert.equal(core.value, 24500, 'the claim is the POST-arrow number, not the before');
  assert.equal(core.matched, 'core 24417 → 24500 bytes');
  assert.equal(core.suggestReplacement(24999), 'core 24417 → 24999 bytes');

  const ext = extractSizingClaim(l, 'extended');
  assert.equal(ext.value, 49000);
  assert.equal(ext.suggestReplacement(49123), 'extended 49123 bytes');

  assert.equal(extractSizingClaim(l, 'OPERATOR.md'), null, 'an unnamed target is null, not 0');
  // `OPERATOR.md` carries a regex metacharacter. Unescaped, `.` matches any
  // character and `OPERATORxmd` would parse as the same target.
  const dotted = line('OPERATORxmd 111 bytes; OPERATOR.md 222 bytes.');
  assert.equal(extractSizingClaim(dotted, 'OPERATOR.md').value, 222);
});

test('findSizingLine returns the line or null, never a partial match', () => {
  assert.equal(findSizingLine('a\n**Sizing** (x): core 1 bytes\nb'), '**Sizing** (x): core 1 bytes');
  assert.equal(findSizingLine('no line'), null);
  assert.equal(findSizingLine(''), null);
  assert.equal(findSizingLine(undefined), null);
  // Not at line start — the canonical line is a top-level paragraph, and a
  // mid-sentence mention of **Sizing** is prose about it, not the line itself.
  assert.equal(findSizingLine('see the **Sizing** (x): core 1 bytes above'), null);
});

test('parseSizingLine resolves every target in SIZING_TARGETS', () => {
  const l = line('core 1 → 2 bytes; extended 3 → 4 bytes; OPERATOR.md 5 → 6 bytes.');
  const parsed = parseSizingLine(`${l}\n`);
  assert.deepEqual(Object.keys(parsed.claims).sort(), SIZING_TARGETS.map(t => t.name).sort());
  assert.equal(parsed.claims.core.value, 2);
  assert.equal(parsed.claims['OPERATOR.md'].value, 6);
  assert.equal(parseSizingLine('nothing here'), null);
});

// --- consumer enumeration -----------------------------------------------------

test('every Sizing-line parser in the tree comes from scripts/lib/spec-sizing.js', () => {
  const files = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', 'scripts/*.js', 'bin/*.js'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter(f => f !== 'scripts/lib/spec-sizing.js');

  const importers = [];
  const privateParsers = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    if (/from '\.\.?\/(lib\/)?spec-sizing\.js'/.test(src)) importers.push(rel);
    // A private parser is a regex that reaches for the Sizing line or a
    // "<target> N bytes" claim. Comment lines are excluded: this repo has a long
    // record of gates counting prose as code (feedback_gate_reads_prose_not_code),
    // and both consumers now DESCRIBE the old regexes in their comments.
    const code = src
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    if (/\\\*\\\*Sizing\\\*\\\*/.test(code) || /\bbytes\b[^\n]*\bexec\(/.test(code)) {
      privateParsers.push(rel);
    }
  }

  assert.deepEqual(
    importers.sort(),
    ['scripts/spec-coherence-audit.js', 'scripts/version-cascade-check.js'],
    'the set of Sizing-line consumers changed — a new one must import the shared parser, and this list must say so'
  );
  assert.deepEqual(
    privateParsers,
    [],
    `these files parse the Sizing line themselves instead of importing scripts/lib/spec-sizing.js: ${privateParsers.join(', ')}`
  );
});

test('the shared tolerance is the one both gates actually apply', () => {
  assert.equal(SIZING_TOLERANCE_BYTES, 20);
  for (const t of SIZING_TARGETS) {
    assert.equal(
      t.threshold,
      SIZING_TOLERANCE_BYTES,
      `${t.name} carries its own threshold — that is the second source this module exists to remove`
    );
  }
  // And the real tree still passes, so the convergence did not change the answer
  // for the spec as it is actually written today.
  const live = runSpecSizingCheck({ root: REPO_ROOT });
  assert.equal(live.ok, true, JSON.stringify(live.drifts));
});
