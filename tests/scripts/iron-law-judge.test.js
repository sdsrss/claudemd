// iron-law-judge.test.js — the pure parts of scripts/offline-eval/iron-law-judge.mjs
// (R4(a)): turn windows, verdict parsing, the majority vote and the score. The
// judge itself calls claude -p and is not run here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  turnWindows,
  renderWindow,
  parseVerdict,
  majority,
  score,
} from '../../scripts/offline-eval/iron-law-judge.mjs';

const human = t => ({ type: 'user', message: { content: t } });
const use = (id, name, input) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
});
const result = (id, text, err = false, extra = {}) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: err, content: text }] },
  ...extra,
});
const say = t => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });

test('iron-law-judge: turns split at human prompts; machine turns do not start one', () => {
  const rows = [
    human('fix the parser'),
    use('a', 'Edit', { file_path: '/p/src/a.js' }),
    use('b', 'Bash', { command: 'npm test' }),
    result('b', '3 passed'),
    say('Done: fixed.'),
    human('<task-notification>x</task-notification>'),
    say('noted'),
    human('update the README'),
    use('c', 'Edit', { file_path: '/p/README.md' }),
    say('Done.'),
    human('now via bash'),
    use('d', 'Bash', { command: "python3 - <<'EOF'\n...\nEOF" }),
    result('d', '', false, { toolUseResult: { bashEditDiff: { changedFiles: ['/p/src/b.py'] } } }),
    say('Done: patched b.py.'),
  ];
  const t = turnWindows(rows);
  assert.equal(t.length, 3);
  assert.equal(t[0].codeEdit, true);
  assert.equal(t[0].final, 'noted', 'a machine turn is part of the turn it arrives in');
  assert.deepEqual(
    t[0].events.map(e => e.t),
    ['edit', 'bash']
  );
  assert.equal(t[1].codeEdit, false, 'a README edit is not a code edit');
  assert.equal(t[2].codeEdit, true, 'a Bash command whose bashEditDiff lists a code file is a code edit');
  assert.match(renderWindow(t[2]), /BASH \(edits code\) \$ python3/);
});

test('iron-law-judge: verdict parsing takes the first word of the first line only', () => {
  assert.equal(parseVerdict('FAIL\nno test after the edit'), 'FAIL');
  assert.equal(parseVerdict('**PASS** — ran the suite'), 'PASS');
  assert.equal(parseVerdict('unknown: truncated'), 'UNKNOWN');
  assert.equal(parseVerdict('The answer is FAIL'), 'UNKNOWN');
  assert.equal(parseVerdict(undefined), 'UNKNOWN');
});

test('iron-law-judge: majority of three; a three-way split is UNKNOWN', () => {
  assert.equal(majority(['FAIL', 'FAIL', 'PASS']), 'FAIL');
  assert.equal(majority(['PASS', 'UNKNOWN', 'PASS']), 'PASS');
  assert.equal(majority(['PASS', 'FAIL', 'UNKNOWN']), 'UNKNOWN');
  assert.equal(majority([]), 'UNKNOWN');
});

test('iron-law-judge: FAIL is the positive class; unknown and unlabeled are counted apart', () => {
  const labels = new Map([
    ['a', 'FAIL'],
    ['b', 'FAIL'],
    ['c', 'PASS'],
    ['d', 'PASS'],
    ['e', 'PASS'],
    ['f', ''],
  ]);
  const r = score(labels, [
    ['a', 'FAIL'],
    ['b', 'PASS'],
    ['c', 'FAIL'],
    ['d', 'PASS'],
    ['e', 'UNKNOWN'],
    ['f', 'FAIL'],
  ]);
  assert.deepEqual([r.tp, r.fp, r.fn, r.tn, r.unknown, r.unlabeled], [1, 1, 1, 1, 1, 1]);
  assert.equal(r.precision, 0.5);
  assert.equal(r.recall, 0.5);
  assert.equal(r.passesGate, false);
  assert.equal(score(new Map([['a', 'FAIL']]), [['a', 'FAIL']]).passesGate, true);
});
