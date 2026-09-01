// spec-routing-consumers.test.js — the §4/§12 skill tokenizer has one home, and
// everyone who needs it imports it.
//
// scripts/lib/spec-routing.js was extracted on 2026-09-01 when doctor.js needed
// to ask the same question of the INSTALLED spec that spec-structure.test.js asks
// of the repo's. Extraction without a gate over the consumer set drifts back —
// this repo has the receipts (feedback_extraction_needs_consumer_gate: v0.58.0
// extracted flatten/heredoc into hook-common.sh, wired two of three siblings, and
// the third kept a comment claiming parity it did not have).
//
// Two assertions, because the two failure modes are different. A consumer can
// stop importing (caught by the import join). Or a consumer can keep the import
// AND grow its own copy of the regex next to it, which the import join cannot
// see — so the distinctive pattern is required to exist exactly once.
//
// Comments are stripped from both haystacks first. A header quoting the regex to
// explain it, or naming a consumer, is prose about code; a gate that accepts it
// is reading its own documentation back (feedback_gate_reads_prose_not_code, three
// separate instances in this repo inside one week).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = 'scripts/lib/spec-routing.js';
const CONSUMERS = ['scripts/doctor.js', 'tests/scripts/spec-structure.test.js'];

// The namespace-alternation head of the skill tokenizer. Spliced from two
// fragments so this line is not itself the second occurrence it exists to ban —
// a detector whose definition site is its own first finding is a permanent false
// positive (feedback_self_referential_marker_regex).
const TOKENIZER_SPELLING = '(?:\\b(sp' + '|gs):';

const stripComments = (text) => text.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');

const trackedJs = () => execFileSync('git', ['ls-files', '*.js', '*.mjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

test('the §4 skill tokenizer is spelled in exactly one tracked file', () => {
  const files = trackedJs();
  assert.ok(files.length >= 20,
    `only ${files.length} tracked .js file(s) resolved — not a git checkout, or the layout moved; ` +
    'refusing to report a clean single-spelling scan over that few.');

  const holders = files.filter((f) => {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return false; }
    return stripComments(text).includes(TOKENIZER_SPELLING);
  });

  assert.deepEqual(holders, [MODULE],
    `the skill-tokenizer regex must live only in ${MODULE}; found in: ${holders.join(', ') || '(nowhere — the module lost it)'}. ` +
    'A second copy is the drift the extraction removed. Import it instead.');
});

test('every known consumer imports the shared tokenizer', () => {
  assert.ok(CONSUMERS.length >= 2, 'the consumer list collapsed — a single-consumer module needs no gate, so this is a defect in the gate');
  const unwired = [];
  for (const c of CONSUMERS) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, c), 'utf8'));
    // An IMPORT, not a mention: `from '<path>spec-routing.js'`. A `// see
    // spec-routing.js` note and a fail-open `typeof routingPrimaries` guard both
    // name the module without consuming it, and the sibling gate in this repo was
    // fed by exactly those two shapes before it was tightened.
    if (!/from\s+'[^']*spec-routing\.js'/.test(code)) unwired.push(c);
  }
  assert.deepEqual(unwired, [],
    `consumer(s) of the §4 routing tables that do not import ${MODULE}:\n      ` + unwired.join('\n      ') +
    `\n      Either the file grew its own copy of the parser, or it stopped reading §4 and should come off this list.`);
});
