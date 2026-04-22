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

test('diffSpec shows nonzero delta for reordered lines (F2)', () => {
  // Regression: Set-based diff reported 0/0 for reorders since both texts had
  // the same line set. LCS-based diff surfaces the real change so
  // /claudemd-update isn't misleading about what apply-all will overwrite.
  const a = "alpha\nbeta\ngamma\n";
  const b = "gamma\nbeta\nalpha\n";
  const d = diffSpec(a, b);
  assert.ok(d.added > 0 || d.removed > 0,
    `expected nonzero delta for reordered lines, got ${JSON.stringify(d)}`);
});

test('diffSpec handles empty inputs', () => {
  assert.deepEqual(diffSpec('', ''), { added: 0, removed: 0 });
  // 'x\n'.split('\n') === ['x', ''] — shares the trailing '' with ''.split('\n') === ['']
  assert.deepEqual(diffSpec('', 'x\n'), { added: 1, removed: 0 });
  assert.deepEqual(diffSpec('x\n', ''), { added: 0, removed: 1 });
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
