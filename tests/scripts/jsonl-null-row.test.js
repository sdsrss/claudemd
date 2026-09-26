// One line reading `null` takes down four readers (Round-14 audit ALG-M1).
//
// `JSON.parse("null")` succeeds and returns `null`, so every one of these
// readers walked past its `try/catch` — which is guarding against a PARSE
// failure — and then dereferenced a property on it. A JSONL line that is any
// other non-object (`3`, `"x"`, `[]`) is handled: the property read yields
// undefined and the row is counted or skipped. Only `null` throws.
//
// The blast radius is not uniform, which is why this is one gate rather than
// four fixes: `claudemd audit` printed a V8 stack and exited 1, and exit 1 is
// also its "hits found" code — so a corrupt log line reads as a §10-V finding.
//
// This file is a CLASS gate, and the last test is what makes it one. The header
// used to claim "the four call sites are the entire read surface" and instruct
// the next maintainer to "add a new JSONL reader to READERS below" — there was
// no READERS, the claim was never rechecked, and by 2026-09-14 the tree held
// six per-line parse sites against five cases here. A named list is the form
// this repo has twice rejected for exactly this reason:
// tests/hooks/trigger-view-parity.test.sh:12-16 ("A test that named the
// consumers would have been written against the same list that was already
// wrong. This one derives the consumer set from the source.") and
// tests/hooks/memory-tags-parity.test.sh:28-30. So the read surface below is
// derived from source and compared against a declared table; a new reader is
// red until somebody classifies it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseTranscript, countStringContentAssistantRows } from '../../scripts/lib/lint.js';
import { readLogRows, readHits } from '../../scripts/lib/rule-hits-parse.js';
import { readTranscript, wasApplied } from '../../scripts/lesson-bypass-audit.js';
import { samplingAudit } from '../../scripts/sampling-audit.js';

const assistantRow = t =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { content: [{ type: 'text', text: t }] },
  });

// Every non-object JSON scalar, not just `null`: the fix must be "this line is
// not an object", not "this line is not the literal null".
const NON_OBJECT_LINES = ['null', '3', '"a string"', '[]', 'true'];

function transcriptWithNulls() {
  return (
    [assistantRow('Done: first turn.'), ...NON_OBJECT_LINES, assistantRow('Done: second turn.')].join('\n') +
    '\n'
  );
}

test('ALG-M1: lint.parseTranscript survives a bare null line and counts it', () => {
  const integrity = {};
  const turns = parseTranscript(transcriptWithNulls(), integrity);
  assert.equal(turns.length, 2, 'both real turns must still be scanned');
  assert.equal(
    integrity.badLines,
    NON_OBJECT_LINES.length,
    'and every non-object line must be counted, not silently dropped'
  );
});

test('ALG-M1: lint.countStringContentAssistantRows survives a bare null line', () => {
  assert.equal(countStringContentAssistantRows(transcriptWithNulls()), 0);
  const withStringContent =
    [JSON.stringify({ type: 'assistant', message: { content: 'plain text' } }), 'null'].join('\n') + '\n';
  assert.equal(countStringContentAssistantRows(withStringContent), 1);
});

test('ALG-M1: rule-hits readLogRows counts a bare null line as corrupt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-nullrow-'));
  try {
    const logPath = path.join(dir, 'claudemd.jsonl');
    const good = ts => JSON.stringify({ ts, hook: 'banned-vocab', event: 'deny', spec_section: '§10-V' });
    fs.writeFileSync(
      logPath,
      [good('2026-09-06T00:00:00Z'), ...NON_OBJECT_LINES, good('2026-09-06T01:00:00Z')].join('\n') + '\n'
    );

    const { rows, totalLines, badJson } = readLogRows(logPath);
    assert.equal(totalLines, 2 + NON_OBJECT_LINES.length);
    assert.equal(badJson, NON_OBJECT_LINES.length, 'non-object rows are corrupt rows');
    assert.equal(rows.length, 2, 'and the usable rows still come back');

    // readHits is the consumer `claudemd audit` actually calls.
    const hits = readHits(logPath, 3650);
    assert.equal(hits.hits.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M1: lesson-bypass readTranscript/wasApplied survive a bare null line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-nullrow-lb-'));
  try {
    const p = path.join(dir, 't.jsonl');
    fs.writeFileSync(p, transcriptWithNulls());
    const integrity = {};
    const rows = readTranscript(p, integrity);
    assert.equal(integrity.badLines, NON_OBJECT_LINES.length);
    // wasApplied walks every row and reads `row.timestamp`.
    assert.equal(wasApplied(rows, '2000-01-01T00:00:00Z', 'feedback_x.md'), false);
    const withHit = rows.concat([
      { timestamp: new Date().toISOString(), type: 'assistant', message: { content: 'read feedback_x.md' } },
    ]);
    assert.equal(wasApplied(withHit, '2000-01-01T00:00:00Z', 'feedback_x.md'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ALG-M1: samplingAudit survives a bare null line and counts it malformed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-nullrow-sa-'));
  try {
    fs.writeFileSync(path.join(dir, 'nulls.jsonl'), transcriptWithNulls());
    const r = await samplingAudit({ projectsDir: dir, days: 3650 });
    assert.equal(r.scannedTranscripts, 1);
    assert.equal(r.totalAssistantTextRows, 2, 'the two real turns still scanned');
    assert.equal(r.malformedTranscripts.length, 1);
    assert.equal(r.malformedTranscripts[0].lines, NON_OBJECT_LINES.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the read surface, derived from source ----------------------------------
// A per-line JSONL parse is the shape this gate is about, so the derivation
// anchors on it structurally: a file that splits on newlines AND calls
// JSON.parse. That set is wider than the readers — it also catches files that
// happen to do both for unrelated reasons — so every site is classified, and
// the classification is the part a human has to write.
//
// Sites are keyed by their own source LINE, not by line number. Round 7 of the
// converge loop spent a whole round re-deriving a table of line numbers that a
// seven-line edit had shifted; an anchor survives the edit, and the gate below
// also requires each anchor to occur exactly once, because a fragment that
// matches twice names two places and therefore names neither.
const SRC_GLOBS = ['scripts/*.js', 'scripts/lib/*.js', 'bin/*.js'];
const SPLIT_ON_NEWLINE = /\.split\((?:"\\n"|'\\n'|`\\n`|\/\\r\?\\n\/[a-z]*)\)/;

// kind: 'jsonl-row' parses one line of a JSONL file and must be null-guarded.
// 'not-a-row' parses a whole file or a tool's stdout in one go — a `null` there
// is a broken config, not a corrupt row, and fails loudly by design.
const DECLARED = [
  [
    'bin/claudemd-lint.js',
    "const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));",
    'not-a-row',
    'own package.json',
  ],
  [
    'bin/claudemd-lint.js',
    'row = JSON.parse(l);',
    'jsonl-row',
    "audit's pre-flight; guarded inline by `row && typeof row === 'object'`, so it has no case here",
  ],
  [
    'scripts/doctor.js',
    "const ip = JSON.parse(fs.readFileSync(claudeHome('plugins', 'installed_plugins.json'), 'utf8'));",
    'not-a-row',
    "Claude Code's plugin registry, one JSON document (routing:ship-skill)",
  ],
  [
    'scripts/baseline-metrics.js',
    "const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));",
    'not-a-row',
    'jscpd report',
  ],
  [
    'scripts/baseline-metrics.js',
    "const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));",
    'not-a-row',
    'c8 summary',
  ],
  [
    'scripts/baseline-metrics.js',
    "findings = JSON.parse(r.stdout || '[]');",
    'not-a-row',
    'shellcheck stdout',
  ],
  [
    'scripts/baseline-metrics.js',
    "const script = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts?.['lint:js'] || '';",
    'not-a-row',
    'package.json scripts',
  ],
  ['scripts/baseline-metrics.js', 'results = JSON.parse(r.stdout);', 'not-a-row', 'eslint stdout'],
  [
    'scripts/baseline-metrics.js',
    "const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));",
    'not-a-row',
    'package.json',
  ],
  [
    'scripts/lesson-bypass-audit.js',
    'const row = JSON.parse(line);',
    'jsonl-row',
    'readTranscript — case above',
  ],
  ['scripts/lib/lint.js', 'row = JSON.parse(lines[i]);', 'jsonl-row', 'parseTranscript — case above'],
  [
    'scripts/lib/lint.js',
    'row = JSON.parse(line);',
    'jsonl-row',
    'countStringContentAssistantRows — case above',
  ],
  ['scripts/lib/rule-hits-parse.js', 'row = JSON.parse(line);', 'jsonl-row', 'readLogRows — case above'],
  [
    'scripts/safety-coverage-audit.js',
    "manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));",
    'not-a-row',
    'plugin manifest',
  ],
  ['scripts/sampling-audit.js', 'obj = JSON.parse(line);', 'jsonl-row', 'samplingAudit — case above'],
  [
    'scripts/version-cascade-check.js',
    "return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));",
    'not-a-row',
    'version-carrying file',
  ],
  [
    'scripts/version-cascade-check.js',
    "const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));",
    'not-a-row',
    'plugin manifest',
  ],
];

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function derivedSites() {
  const files = execFileSync('git', ['-C', REPO, 'ls-files', ...SRC_GLOBS], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const sites = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    if (!src.includes('JSON.parse(') || !SPLIT_ON_NEWLINE.test(src)) continue;
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      // Prose mentioning JSON.parse is not a call site. lint.js's own header
      // quotes `JSON.parse("null")` while explaining this very defect.
      if (line.startsWith('//') || line.startsWith('*')) continue;
      if (line.includes('JSON.parse(')) sites.push([f, line]);
    }
  }
  return sites;
}

test('the JSONL read surface has not drifted from the table above', () => {
  const derived = derivedSites();
  const key = ([f, a]) => `${f} :: ${a}`;
  const got = derived.map(key).sort();
  const want = DECLARED.map(key).sort();
  console.log(
    `  jsonl read surface: ${derived.length} site(s), ${DECLARED.filter(d => d[2] === 'jsonl-row').length} of them per-line`
  );

  // A floor, so an ls-files or regex that silently matched nothing cannot pass
  // as "no drift" — the failure this gate exists to prevent is a quiet one.
  assert.ok(
    derived.length >= 10,
    `derivation found only ${derived.length} site(s) — the scan itself is broken`
  );

  assert.deepEqual(
    got,
    want,
    'a JSON.parse call site appeared or moved in a file that reads line-by-line.\n' +
      'If it parses ONE LINE of a JSONL file, it must be null-guarded and needs a case in this file;\n' +
      'if it parses a whole file or a tool’s stdout, add it to DECLARED as not-a-row with a reason.'
  );

  // Each anchor must identify one place, or the table points at nothing in
  // particular. Same requirement the flow-doc anchor gate makes.
  for (const [f, anchor] of DECLARED) {
    const src = fs.readFileSync(path.join(REPO, f), 'utf8');
    const n = src.split(anchor).length - 1;
    assert.equal(n, 1, `anchor occurs ${n}x in ${f}, so it names no single site — "${anchor}"`);
  }
});

test('the read-surface derivation can fail (mutation control)', () => {
  // The test above passes both when the table is right and when the scan found
  // nothing useful. Drive the three failure shapes through the same pieces.
  assert.equal(SPLIT_ON_NEWLINE.test('const a = s.split("\\n");'), true);
  assert.equal(
    SPLIT_ON_NEWLINE.test('const a = s.split(",");'),
    false,
    'a non-newline split must not enroll a file'
  );
  assert.equal('x JSON.parse( y'.trim().startsWith('//'), false);
  assert.equal(
    '// JSON.parse("null") in prose'.trim().startsWith('//'),
    true,
    'a comment must not read as a call site'
  );
  const twice = 'row = JSON.parse(line);\nrow = JSON.parse(line);';
  assert.equal(
    twice.split('row = JSON.parse(line);').length - 1,
    2,
    'a duplicated anchor must count 2, not 1'
  );
});
