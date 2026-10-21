// memory-index-links.test.js — backlog item 169: every parser of MEMORY.md index
// lines names the same file as the entry's.
//
// The index format is `- [Title](file.md) [tags] — hook`, so the entry's own
// file is the target of the FIRST `](….md)` on the line. Reproduced 2026-10-20
// with `- [A](feedback_a.md) — supersedes [old](feedback_old.md)`: mem-audit
// read feedback_a.md, while spec-coherence-audit took the LAST `(….md)` and
// reported feedback_old.md as dangling and feedback_a.md as not indexed, and
// parseMemoryIndex (the doctor's tag scan) attributed the entry's tags to
// feedback_old.md.
//
// The lines and the answers live in tests/fixtures/memory-index-links.json,
// which the bash suites of the other parsers (mem-audit, the awk matcher behind
// memory-read-check and memory-prompt-hint) read as well: each parser is held
// to the same per-line answer, so they agree with each other by construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';
import { indexEntryFile, parseMemoryIndex } from '../../scripts/lib/memory-tags.js';
import { auditSpecCoherence } from '../../scripts/spec-coherence-audit.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'tests/fixtures/memory-index-links.json'), 'utf8')
);
const INDEX_TEXT = FIXTURE.lines.map(l => l.line).join('\n') + '\n';

const box = useHomeSandbox('memlinks');

test('item 169: the fixture is not vacuous', () => {
  // Every line must have a decoy-free answer, at least one line must carry the
  // decoy as a second link, and at least one must be untagged and one tagged,
  // or the assertions below compare nothing that the defect could change.
  assert.ok(FIXTURE.lines.length >= 3);
  assert.ok(FIXTURE.lines.every(l => l.file !== FIXTURE.neverAnEntry));
  assert.ok(FIXTURE.lines.some(l => l.line.includes(`](${FIXTURE.neverAnEntry})`)));
  assert.ok(FIXTURE.lines.some(l => l.tags.length === 0));
  assert.ok(FIXTURE.lines.some(l => l.tags.length > 0));
});

test('item 169: parseMemoryIndex names the first `](….md)` as the entry file', () => {
  const got = parseMemoryIndex(INDEX_TEXT).map(e => ({ file: e.file, tags: e.tags }));
  const want = FIXTURE.lines.filter(l => l.tags.length > 0).map(l => ({ file: l.file, tags: l.tags }));
  assert.deepEqual(got, want);
});

test('item 169: spec-coherence-audit indexes the first `](….md)` of each line', () => {
  const cwd = '/work/memlinks-proj';
  const memDir = box.claude('projects', cwd.replace(/[^a-zA-Z0-9-]/g, '-'), 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'MEMORY.md'), INDEX_TEXT);
  for (const f of FIXTURE.onDisk) fs.writeFileSync(path.join(memDir, f), 'x\n');

  const check = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: cwd }).checks.find(
    c => c.name === 'memory-index'
  );
  assert.equal(check.stats.memDir, memDir, 'the check read a memory dir outside the sandbox');
  assert.deepEqual(
    check.findings.map(f => f.detail),
    [],
    'every line names an existing file, and every file is named by one line'
  );
  assert.equal(check.stats.indexedCount, new Set(FIXTURE.lines.map(l => l.file)).size);
});

// 0.115.0 pre-tag review M1: a line with no `](….md)` link keeps the reading it
// had before item 169, the rightmost `(….md)`, as memtags_file does — the §11
// gate matches tags on such lines.
test('item 169 fallback: a line with no ](….md) link names its rightmost (….md), as before', () => {
  assert.equal(
    indexEntryFile('- Ship notes (feedback_fb_ship.md) [fbship] — the title is not a link'),
    'feedback_fb_ship.md'
  );
  assert.equal(
    indexEntryFile('- [Deploy] (feedback_fb_deploy.md) [fbdeploy] — a space before the paren'),
    'feedback_fb_deploy.md'
  );
  assert.equal(indexEntryFile('- [Docs](https://example.com/x) [t] — see (a.md) and (b.md)'), 'b.md');
  assert.equal(indexEntryFile('- [A](feedback_a.md) — supersedes [old](feedback_old.md)'), 'feedback_a.md');
  assert.equal(indexEntryFile('- no file here'), null);
});
