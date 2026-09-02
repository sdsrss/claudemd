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
//
// The spelling assertion has a ceiling, and the pre-tag review found it: swap
// the alternation to `gs|sp`, keep every other byte, and you have a
// byte-different regex with identical behaviour that the ban cannot see — the
// whole suite green. That particular escape is harmless (an equivalent parser IS the
// shared parser, in every way a caller can observe), but the same move with one
// rule dropped is not, and the ban cannot tell the two apart. So the third test
// asks the question that actually matters, of the consumer that has its own
// runtime: parse the real §4 table through doctor and require the primary set
// it resolves to equal, name for name, what the shared module returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor } from '../../scripts/doctor.js';
import { routingPrimaries } from '../../scripts/lib/spec-routing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = 'scripts/lib/spec-routing.js';
const CONSUMERS = ['scripts/doctor.js', 'tests/scripts/spec-structure.test.js'];

// The namespace-alternation head of the skill tokenizer. Spliced from two
// fragments so this line is not itself the second occurrence it exists to ban —
// a detector whose definition site is its own first finding is a permanent false
// positive (feedback_self_referential_marker_regex).
const TOKENIZER_SPELLING = '(?:\\b(sp' + '|gs):';

const stripComments = text =>
  text
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n');

const trackedJs = () =>
  execFileSync('git', ['ls-files', '*.js', '*.mjs'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

test('the §4 skill tokenizer is spelled in exactly one tracked file', () => {
  const files = trackedJs();
  assert.ok(
    files.length >= 20,
    `only ${files.length} tracked .js file(s) resolved — not a git checkout, or the layout moved; ` +
      'refusing to report a clean single-spelling scan over that few.'
  );

  const holders = files.filter(f => {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    } catch {
      return false;
    }
    return stripComments(text).includes(TOKENIZER_SPELLING);
  });

  assert.deepEqual(
    holders,
    [MODULE],
    `the skill-tokenizer regex must live only in ${MODULE}; found in: ${holders.join(', ') || '(nowhere — the module lost it)'}. ` +
      'A second copy is the drift the extraction removed. Import it instead.'
  );
});

test('every known consumer imports the shared tokenizer', () => {
  assert.ok(
    CONSUMERS.length >= 2,
    'the consumer list collapsed — a single-consumer module needs no gate, so this is a defect in the gate'
  );
  const unwired = [];
  for (const c of CONSUMERS) {
    const code = stripComments(fs.readFileSync(path.join(ROOT, c), 'utf8'));
    // An IMPORT, not a mention: `from '<path>spec-routing.js'`. A `// see
    // spec-routing.js` note and a fail-open `typeof routingPrimaries` guard both
    // name the module without consuming it, and the sibling gate in this repo was
    // fed by exactly those two shapes before it was tightened.
    if (!/from\s+'[^']*spec-routing\.js'/.test(code)) unwired.push(c);
  }
  assert.deepEqual(
    unwired,
    [],
    `consumer(s) of the §4 routing tables that do not import ${MODULE}:\n      ` +
      unwired.join('\n      ') +
      `\n      Either the file grew its own copy of the parser, or it stopped reading §4 and should come off this list.`
  );
});

// Behaviour, not text. doctor is the consumer with a runtime of its own, so it
// can be asked the question directly: given the shipped §4 table as the
// installed spec and every primary switched off, the skills it names back are
// exactly the ones it parsed. Compared against the shared module over the same
// bytes, that is a parity assertion — the shape this repo already uses for the
// §10-V two-engine check and the cwd encoder.
//
// The fixture is the real spec on purpose. §4 carries `**gs:/investigate**`,
// bare `/name` continuations and a Notes column full of skill mentions that are
// not primaries; a synthetic table would have to reproduce all three to be worth
// anything, and would then drift from the one in production. Two assertions,
// because the disabled list alone cannot see a parser that resolves MORE than
// the shared one: the total is compared as well.
test("doctor resolves §4 into exactly the shared tokenizer's primary set", async () => {
  const expected = [
    ...routingPrimaries(fs.readFileSync(path.join(ROOT, 'spec/CLAUDE-extended.md'), 'utf8')).keys(),
  ];
  assert.ok(
    expected.length >= 15,
    `the shared module resolved only ${expected.length} primaries from the shipped spec — ` +
      'the §4 table moved, and this parity check would be comparing two empty answers.'
  );

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-routing-parity-'));
  const savedHome = process.env.HOME;
  try {
    process.env.HOME = home;
    fs.mkdirSync(path.join(home, '.claude/.claudemd-state'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude/logs'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.claude/.claudemd-manifest.json'),
      JSON.stringify({ version: '0.1.0', entries: [] })
    );
    fs.copyFileSync(
      path.join(ROOT, 'spec/CLAUDE-extended.md'),
      path.join(home, '.claude/CLAUDE-extended.md')
    );
    // Every primary off, so the check has to name all of them: the report is the
    // only window onto what doctor parsed, and a partial override would only
    // reveal the tokens it happened to ask about.
    fs.writeFileSync(
      path.join(home, '.claude/settings.json'),
      JSON.stringify({
        skillOverrides: Object.fromEntries(expected.map(t => [t.split('/')[1], 'off'])),
      })
    );

    const check = (await doctor({})).checks.find(c => c.name === 'routing:skills-enabled');
    assert.ok(
      check,
      'routing:skills-enabled did not run — the staging above stopped matching what doctor reads'
    );
    const named = (check.detail.match(/skillOverrides: ([^.]+)\./) || [])[1];
    assert.ok(
      named,
      `routing:skills-enabled did not report the disabled primaries; detail was:\n      ${check.detail}`
    );

    // The total, not just the disabled list. `off` is filtered against the
    // overrides staged above, so a parser resolving a strict SUPERSET — the
    // `gs/after` that appears the moment the list-boundary lookbehind is dropped,
    // one of the three rules spec-routing.js's header says cost the most to learn
    // — contributes a token that is not in skillOverrides, gets filtered out of
    // `off`, and leaves the named list identical. The v0.71.2 pre-tag review
    // reproduced exactly that, green. The count is where a superset shows up.
    const total = Number((check.detail.match(/of (\d+) §4 Routing primaries/) || [])[1]);
    assert.equal(
      total,
      expected.length,
      `doctor resolved ${total} §4 Routing primaries where scripts/lib/spec-routing.js resolves ` +
        `${expected.length} over the same spec. A parser that finds MORE is as wrong as one that ` +
        'finds fewer, and only the total can see it.'
    );

    assert.equal(
      named,
      expected.join(', '),
      'doctor resolved a different §4 primary set than scripts/lib/spec-routing.js does over the ' +
        'same spec. A consumer parsing §4 its own way is the drift the extraction removed, and it ' +
        'survives every spelling check because the copy need not be spelled the same.'
    );
  } finally {
    process.env.HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
