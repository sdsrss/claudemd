// code-ext-parity.test.js — "what counts as a code file" has four copies in
// three languages, and until v0.91.0 nothing held them to each other.
//
// The copies: `hooks/evidence-gate.sh` and `hooks/ledger-staleness.sh` (jq
// regexes), `hooks/rework-breaker.sh` (a bash `case` glob list), and
// `scripts/sampling-audit.js` (`CODE_FILE_RE`). Pre-ship review of v0.91.0
// found the three hook copies already disagreed: `evidence-gate.sh` omitted
// `.cjs` and `.cts`, which `rework-breaker.sh` has had since v0.90.0, while a
// comment in each file claimed all of them were the same list. So a CommonJS
// session read as "no code edit" to one hook and as code work to the next.
//
// The assertions are BEHAVIOURAL. A textual diff of four differently-spelled
// matchers proves nothing about what they match, and the spellings are not
// convertible: `m?[jt]sx?` is one regex atom covering six extensions and the
// bash copy writes those six out.
//
// `scripts/sampling-audit.js` is held to a DIFFERENT assertion on purpose. Its
// `CODE_FILE_RE` is the pre-registered G0 measurement matcher
// (docs/spec-optimization-roadmap-2026-09-21.md §3.2b) — the published
// code-only rework denominator was computed with it, so widening it would
// silently move a number this project has already shipped. It is pinned here
// as "the hook set minus exactly {cjs, cts}", which is a fact that has to be
// re-approved to change rather than a drift that can happen quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// Every extension any copy claims, plus negatives. The negatives are the point
// of a parity gate as much as the positives: a matcher that accepted
// everything would satisfy the positive half alone.
const CODE = [
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'rs',
  'py',
  'go',
  'sh',
  'rb',
  'java',
  'c',
  'cpp',
  'h',
];
const NOT_CODE = ['md', 'json', 'yaml', 'txt', 'lock', 'toml', 'csv', 'png', ''];
const ALL = [...CODE, ...NOT_CODE];
const pathFor = ext => (ext === '' ? '/p/src/Makefile' : `/p/src/mod.${ext}`);

// --- the four matchers, each evaluated by its own engine --------------------

function jqRegexFrom(rel) {
  const src = read(rel);
  const m = src.match(/test\("(\\\\\.\([^"]+)";\s*"i"\)/);
  assert.ok(m, `${rel}: no jq test("…") code-extension regex found — the extractor is stale`);
  // The source carries the jq-level escape (`\\.`); jq itself wants `\.`.
  return m[1].replace(/\\\\/g, '\\');
}

function jqMatches(rel) {
  const re = jqRegexFrom(rel);
  const res = spawnSync('jq', ['-r', '--arg', 're', re, '.[] | if test($re; "i") then "1" else "0" end'], {
    input: JSON.stringify(ALL.map(pathFor)),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `${rel}: jq failed: ${res.stderr}`);
  const bits = res.stdout.trim().split('\n');
  assert.equal(bits.length, ALL.length, `${rel}: jq returned ${bits.length} verdicts`);
  return new Set(ALL.filter((_, i) => bits[i] === '1'));
}

function caseGlobMatches(rel) {
  const src = read(rel);
  const m = src.match(/case "\$FILE_PATH" in\n\s*(\*\.[^)]+)\)/);
  assert.ok(m, `${rel}: no \`case "$FILE_PATH" in\` code-extension glob list found`);
  const pattern = m[1].trim();
  const script = ALL.map(pathFor)
    .map(p => `case "${p}" in\n  ${pattern}) echo 1 ;;\n  *) echo 0 ;;\nesac`)
    .join('\n');
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, `${rel}: bash failed: ${res.stderr}`);
  const bits = res.stdout.trim().split('\n');
  assert.equal(bits.length, ALL.length, `${rel}: bash returned ${bits.length} verdicts`);
  return new Set(ALL.filter((_, i) => bits[i] === '1'));
}

function jsRegexMatches(rel) {
  const src = read(rel);
  const m = src.match(/const CODE_FILE_RE = \/(.+?)\/i;/);
  assert.ok(m, `${rel}: CODE_FILE_RE not found`);
  const re = new RegExp(m[1], 'i');
  return new Set(ALL.filter(e => re.test(pathFor(e))));
}

const HOOK_COPIES = [
  ['hooks/evidence-gate.sh', () => jqMatches('hooks/evidence-gate.sh')],
  ['hooks/ledger-staleness.sh', () => jqMatches('hooks/ledger-staleness.sh')],
  ['hooks/rework-breaker.sh', () => caseGlobMatches('hooks/rework-breaker.sh')],
];

test('code-ext-parity: every hook copy accepts the same set', () => {
  const sets = HOOK_COPIES.map(([rel, f]) => [rel, f()]);
  const expected = new Set(CODE);
  for (const [rel, got] of sets) {
    assert.deepEqual(
      [...got].sort(),
      [...expected].sort(),
      `${rel} does not match the hook-side code-extension set. ` +
        `Extra: ${[...got].filter(e => !expected.has(e))}. Missing: ${[...expected].filter(e => !got.has(e))}.`
    );
  }
});

test('code-ext-parity: and rejects the same non-code files', () => {
  for (const [rel, f] of HOOK_COPIES) {
    const got = f();
    const wrong = NOT_CODE.filter(e => got.has(e));
    assert.deepEqual(wrong, [], `${rel} treats non-code file(s) as code: ${wrong}`);
  }
});

test('code-ext-parity: the G0 measurement matcher is the hook set minus exactly {cjs, cts}', () => {
  // Deliberate, not drift. CODE_FILE_RE produced the published code-only
  // rework denominator; widening it would move a shipped number. Stated as an
  // equality so that a change to EITHER side fails here.
  const measured = jsRegexMatches('scripts/sampling-audit.js');
  const hookSet = new Set(CODE);
  const missing = [...hookSet].filter(e => !measured.has(e)).sort();
  const extra = [...measured].filter(e => !hookSet.has(e)).sort();
  assert.deepEqual(missing, ['cjs', 'cts'], `unexpected gap between the hooks and CODE_FILE_RE`);
  assert.deepEqual(extra, [], `CODE_FILE_RE accepts an extension no hook does: ${extra}`);
});

test('code-ext-parity: the extractors discriminate (mutation control)', () => {
  // Each extractor is a regex over source text, so a renamed variable or a
  // reformatted line could make it silently match nothing and every assertion
  // above would pass vacuously. These prove the extractors see a real matcher
  // by checking that they DISagree with a deliberately wrong expectation.
  for (const [rel, f] of HOOK_COPIES) {
    const got = f();
    assert.ok(got.size > 0, `${rel}: extractor returned an empty set — it is not reading the matcher`);
    assert.ok(got.has('py'), `${rel}: extractor produced a set without .py, which every copy has`);
  }
  assert.ok(jsRegexMatches('scripts/sampling-audit.js').has('go'), 'CODE_FILE_RE extractor is stale');
});
