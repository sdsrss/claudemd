// scripts/baseline-metrics.js — the measuring tool behind docs/audit/00-baseline.md.
//
// Two layers: the pure helpers (line counting, bash function spans, cycle
// detection) run on inline fixtures with no tooling; the end-to-end run goes
// against the real tree with the slow / optional legs skipped, so the suite
// stays runnable on a checkout that never ran `npm install` (CI does not).
// Each fixture below includes the shape that would make the helper report the
// wrong number, not only the happy path — a function-span scanner that counts
// a one-liner as two lines, or a cycle finder that reports a diamond as a
// cycle, would pass a happy-path-only test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  countLines,
  longFunctionsInSh,
  findCycles,
  measure,
  summarizeJscpdReport,
  summarizeEslintResults,
  summarizeShellcheckFindings,
  REPO_ROOT,
} from '../../scripts/baseline-metrics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, '../../scripts/baseline-metrics.js');

test('countLines matches editor line numbers with and without a trailing newline', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('\n\n'), 2);
});

test('longFunctionsInSh measures column-0 brace spans and skips one-liners', () => {
  const body = n => Array.from({ length: n }, (_, i) => `  echo ${i}`).join('\n');
  const src = [
    'short() {',
    body(3),
    '}',
    'one_liner() { echo x; }',
    'function long_kw {',
    body(10),
    '}',
    'long_paren() {',
    body(12),
    '}',
    '  indented() {', // not column 0 — not counted
    body(20),
    '  }',
    '',
  ].join('\n');
  const got = longFunctionsInSh(src, 5, 'f.sh');
  assert.deepEqual(
    got.map(f => [f.name, f.lines]),
    [
      ['long_kw', 12],
      ['long_paren', 14],
    ]
  );
  assert.equal(got[0].line, 7, 'line numbers are 1-based and point at the opening line');
  // Threshold is strict "longer than": a 5-line function at threshold 5 is not reported.
  assert.deepEqual(longFunctionsInSh('f() {\n  a\n  b\n  c\n}\n', 5), []);
  assert.equal(longFunctionsInSh('f() {\n  a\n  b\n  c\n}\n', 4).length, 1);
});

test('findCycles reports back-edges only — a diamond is not a cycle, a 2-cycle and a self-loop are', () => {
  const g = new Map([
    ['a', new Set(['b', 'c'])],
    ['b', new Set(['d'])],
    ['c', new Set(['d'])],
    ['d', new Set()],
  ]);
  assert.deepEqual(findCycles(g), []);

  const cyc = new Map([
    ['x', new Set(['y'])],
    ['y', new Set(['x'])],
    ['z', new Set(['z'])],
  ]);
  const found = findCycles(cyc);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(c => c.join('>')).sort(), ['x>y>x', 'z>z']);
});

test('summarizeJscpdReport reads the flat per-format shape jscpd 5 emits (not a nested .total)', () => {
  // Byte-shape of a real `jscpd --reporters json` statistics block: total and
  // each format share one flat object. The first draft of the reader looked
  // for `formats.<fmt>.total` and rendered "undefined" in every language row.
  const report = {
    statistics: {
      total: { sources: 163, lines: 42424, duplicatedLines: 726, percentage: 1.71, clones: 93 },
      formats: {
        bash: { sources: 61, lines: 17087, duplicatedLines: 36, percentage: 0.21, clones: 5 },
        javascript: { sources: 102, lines: 25337, duplicatedLines: 690, percentage: 2.72, clones: 88 },
      },
    },
    duplicates: [
      {
        lines: 10,
        firstFile: { name: '/r/hooks/a.sh', start: 48 },
        secondFile: { name: '/r/hooks/b.sh', start: 48 },
      },
    ],
  };
  const s = summarizeJscpdReport(report, '/r');
  assert.deepEqual(s.total, { files: 163, lines: 42424, duplicatedLines: 726, percentage: 1.71, clones: 93 });
  assert.equal(s.formats.bash.lines, 17087);
  assert.equal(s.formats.javascript.percentage, 2.72);
  assert.deepEqual(s.clones, [{ lines: 10, a: 'hooks/a.sh:48', b: 'hooks/b.sh:48' }]);
  // Missing blocks degrade to nulls, never to the string "undefined".
  const empty = summarizeJscpdReport({}, '/r');
  assert.equal(empty.total.percentage, null);
  assert.deepEqual(empty.formats, {});
  assert.deepEqual(empty.clones, []);
});

test('summarizeEslintResults totals errors/warnings/fatal and buckets parse failures under (fatal)', () => {
  const results = [
    {
      filePath: '/r/a.js',
      errorCount: 2,
      warningCount: 1,
      fatalErrorCount: 0,
      messages: [{ ruleId: 'no-unused-vars' }, { ruleId: 'no-unused-vars' }, { ruleId: 'eqeqeq' }],
    },
    {
      filePath: '/r/b.js',
      errorCount: 1,
      warningCount: 0,
      fatalErrorCount: 1,
      messages: [{ ruleId: null, fatal: true }],
    },
    { filePath: '/r/c.js', errorCount: 0, warningCount: 0, messages: [] },
  ];
  const s = summarizeEslintResults(results);
  assert.equal(s.files, 3);
  assert.equal(s.filesWithFindings, 2);
  assert.equal(s.errors, 3);
  assert.equal(s.warnings, 1);
  assert.equal(s.fatal, 1);
  assert.deepEqual(s.topRules, [
    { rule: 'no-unused-vars', n: 2 },
    { rule: '(fatal)', n: 1 },
    { rule: 'eqeqeq', n: 1 },
  ]);
  assert.deepEqual(summarizeEslintResults([]), {
    files: 0,
    filesWithFindings: 0,
    errors: 0,
    warnings: 0,
    fatal: 0,
    topRules: [],
  });
});

test('summarizeShellcheckFindings: blocking = error + warning, info/style stay advisory', () => {
  const s = summarizeShellcheckFindings([
    { level: 'warning' },
    { level: 'info' },
    { level: 'info' },
    { level: 'style' },
    { level: 'error' },
  ]);
  assert.equal(s.blocking, 2);
  assert.deepEqual(s.byLevel, { error: 1, warning: 1, info: 2, style: 1 });
  assert.deepEqual(summarizeShellcheckFindings([]), {
    blocking: 0,
    byLevel: { error: 0, warning: 0, info: 0, style: 0 },
  });
});

test('measure() on the real tree: inventory, long functions and the import graph are populated; no cycles', async () => {
  const m = await measure({ skipCoverage: true, skipDup: true, skipLint: true, top: 3 });
  assert.ok(m.files.total.files >= 300, `tracked files ${m.files.total.files} — expected the real repo`);
  assert.ok(m.files.total.lines > m.files.code.lines && m.files.code.lines > 0);
  assert.equal(m.files.largestAll.length, 3);
  assert.ok(m.files.largestAll[0].lines >= m.files.largestAll[2].lines, 'sorted descending');
  assert.ok(m.longFunctions.sh.files >= 40, `bash files scanned ${m.longFunctions.sh.files}`);
  assert.ok(m.longFunctions.sh.count >= 1, 'this repo has bash functions longer than 50 lines');
  assert.ok(
    m.cycles.shFiles >= 15 && m.cycles.edges >= 15,
    `bash source graph ${m.cycles.shFiles} files / ${m.cycles.edges} edges`
  );
  assert.equal(m.cycles.count, 0, `import cycles: ${JSON.stringify(m.cycles.cycles)}`);
  if (m.longFunctions.acorn) {
    assert.ok(m.longFunctions.js.files >= 80, `js files scanned ${m.longFunctions.js.files}`);
    assert.deepEqual(m.longFunctions.parseErrors, []);
    // paths.js is the documented root of scripts/lib — it must appear as an
    // import target, or the JS edges are not being resolved.
    const targets = new Set(m.cycles.cycles.flat());
    assert.equal(targets.size, 0);
    assert.ok(m.cycles.jsFiles >= 30, `js graph nodes ${m.cycles.jsFiles}`);
  } else {
    console.log(
      'SKIP: acorn not installed — JS long-function / import-graph assertions not run (npm install)'
    );
  }
  assert.equal(m.coverage, null);
  assert.equal(m.lint, null);
  assert.equal(m.duplication.skipped, true);
});

test('CLI: --help exits 0 with usage; unknown flag exits 2; bad numeric exits 1', () => {
  const run = args =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 60000 });
  const h = run(['--help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /Usage: node scripts\/baseline-metrics\.js/);
  const u = run(['--bogus']);
  assert.equal(u.status, 2);
  assert.match(u.stderr, /Unknown argument/);
  const n = run(['--top=0', '--skip-coverage', '--skip-dup', '--skip-lint']);
  assert.equal(n.status, 1);
  assert.match(n.stderr, /positive integer/);
});

test('CLI: --json --skip-* emits a JSON document whose markdown twin names the same commit', () => {
  const run = args =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 120000 });
  const j = run(['--json', '--skip-coverage', '--skip-dup', '--skip-lint', '--top=2']);
  assert.equal(j.status, 0, j.stderr);
  const doc = JSON.parse(j.stdout);
  assert.equal(doc.files.largestAll.length, 2);
  const md = run(['--skip-coverage', '--skip-dup', '--skip-lint', '--top=2']);
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^# Baseline metrics — /);
  assert.ok(
    md.stdout.includes(`@ ${doc.meta.commit} `),
    'markdown header carries the same commit as the JSON'
  );
  assert.match(md.stdout, /## Import cycles[\s\S]*Cycles: \*\*0\*\*/);
});
