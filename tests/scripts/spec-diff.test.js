import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSpec, summarizeDiff } from '../../scripts/lib/spec-diff.js';

test('diffSpec on identical text → empty', () => {
  const a = "line1\nline2\nline3\n";
  const d = diffSpec(a, a);
  assert.equal(d.added, 0);
  assert.equal(d.removed, 0);
});

test('diffSpec counts added and removed lines', () => {
  const a = "line1\nline2\nline3\n";
  const b = "line1\nline2-modified\nline3\nline4\n";
  const d = diffSpec(a, b);
  assert.equal(d.added, 2);
  assert.equal(d.removed, 1);
});

test('summarizeDiff formats human-readable string', () => {
  const s = summarizeDiff([
    { file: 'CLAUDE.md', added: 21, removed: 0 },
    { file: 'CLAUDE-extended.md', added: 50, removed: 5 },
  ]);
  assert.match(s, /CLAUDE\.md/);
  assert.match(s, /\+21/);
  assert.match(s, /-5/);
});
