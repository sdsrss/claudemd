// lint-argv.test.js — verify the argv-lint gate detects the three antipattern
// signatures, honors inline + file-level allowlists, and stays silent on
// pure-comment lines that mention the patterns as documentation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { scan, REPO_ROOT } from '../../scripts/lint-argv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.resolve(HERE, '../../scripts/lint-argv.js');

function makeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'argv-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('argv-lint: live repo is clean (0 hits)', () => {
  const hits = scan({ root: REPO_ROOT });
  assert.deepEqual(hits, [], `unexpected hits: ${JSON.stringify(hits, null, 2)}`);
});

test('argv-lint: detects args.includes(--literal)', () => {
  const root = makeFixture({
    'scripts/bad.js': "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'args.includes(--literal)');
    assert.equal(hits[0].file, 'scripts/bad.js');
    assert.equal(hits[0].line, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: detects args.find(a => a.startsWith(--))', () => {
  const root = makeFixture({
    'scripts/bad.js': "const flag = args.find(a => a.startsWith('--days='));\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'args.find(a => a.startsWith(--))');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: detects args.indexOf(--literal)', () => {
  const root = makeFixture({
    'scripts/bad.js': "const i = args.indexOf('--file');\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pattern, 'args.indexOf(--literal)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: inline `// argv-lint:allow` suppresses the hit', () => {
  const root = makeFixture({
    'scripts/vetted.js': "const json = args.includes('--json'); // argv-lint:allow — validated upstream\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: file-level allowlist suppresses the file', () => {
  const root = makeFixture({
    'scripts/vetted.js': "const json = args.includes('--json');\n",
  });
  try {
    const hits = scan({
      root,
      dirs: ['scripts'],
      fileAllowlist: { 'scripts/vetted.js': 'test fixture: allowlisted' },
    });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: pure-comment line is NOT flagged (meta-recursion guard)', () => {
  const root = makeFixture({
    'scripts/doc.js': "// the bug: args.includes('--json') silently drops --json=yes\nconst safe = 1;\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.deepEqual(hits, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: end-of-line comment on code IS still scanned', () => {
  const root = makeFixture({
    'scripts/sneaky.js': "const json = args.includes('--json'); // pretending it's documentation\n",
  });
  try {
    const hits = scan({ root, dirs: ['scripts'], fileAllowlist: {} });
    assert.equal(hits.length, 1, 'code with end-of-line comment must still be flagged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('argv-lint: CLI exit 0 + stdout on clean (live-repo equivalent)', () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, `gate must exit 0 on live repo. stderr:\n${r.stderr}`);
  assert.match(r.stdout, /0 hits/);
});
