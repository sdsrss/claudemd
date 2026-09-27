// claim-drift.test.js — the candidate-list script from docs/audit/20260926-180700.md
// 9.6 D3. It is not a gate, so the tests pin what it lists and what it leaves out:
// a name changed by the diff, mentioned elsewhere, is listed; the diff's own
// lines, hook CODE lines and docs/audit/ are not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractNames, changedLines, proseFiles, findMentions } from '../../scripts/claim-drift.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/claim-drift.js');

const DIFF = `diff --git a/hooks/foo-check.sh b/hooks/foo-check.sh
--- a/hooks/foo-check.sh
+++ b/hooks/foo-check.sh
@@ -10,2 +10,3 @@
-  [[ "\${DISABLE_FOO_HOOK:-0}" == 1 ]] && exit 0
+  [[ "\${DISABLE_FOO_CHECK:-0}" == 1 ]] && exit 0
+  hook_record foo-check foo-advisory null
diff --git a/CHANGELOG.md b/CHANGELOG.md
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -3,0 +4 @@
+- DISABLE_FOO_CHECK replaces DISABLE_FOO_HOOK.
`;

test('claim-drift: names come from changed files and changed lines', () => {
  const n = extractNames(DIFF);
  for (const want of ['foo-check', 'DISABLE_FOO_HOOK', 'DISABLE_FOO_CHECK', 'foo-advisory']) {
    assert.ok(n.has(want), `missing ${want}: ${[...n].join(', ')}`);
  }
  assert.ok(!n.has('HOME'), 'common environment names are skipped');
});

test('claim-drift: changed lines are the new-side hunk ranges', () => {
  const c = changedLines(DIFF);
  assert.deepEqual([...c.get('hooks/foo-check.sh')], [10, 11, 12]);
  assert.deepEqual([...c.get('CHANGELOG.md')], [4]);
});

test('claim-drift: prose files exclude code, tests, docs/audit and dated records', () => {
  const files = proseFiles([
    'README.md',
    'docs/HOOK-PROTOCOL.md',
    'docs/audit/20260926-180700.md',
    'docs/superpowers/plans/2026-04-21-claudemd-plugin.md',
    'hooks/foo-check.sh',
    'scripts/x.js',
    'tests/hooks/x.test.sh',
    'spec/CLAUDE.md',
    'commands/claudemd-x.md',
  ]);
  assert.deepEqual(files, [
    'README.md',
    'docs/HOOK-PROTOCOL.md',
    'hooks/foo-check.sh',
    'spec/CLAUDE.md',
    'commands/claudemd-x.md',
  ]);
});

test('claim-drift: mentions skip the diff lines and hook code lines, keep hook comments', () => {
  const files = {
    'README.md': 'intro\nexport DISABLE_FOO_HOOK=1   # turns foo off\n',
    'CHANGELOG.md': '# log\n\n\n- DISABLE_FOO_CHECK replaces DISABLE_FOO_HOOK.\n',
    'hooks/foo-check.sh': '#!/bin/bash\n# Kill switch: DISABLE_FOO_HOOK=1\nX=DISABLE_FOO_HOOK\n',
  };
  const m = findMentions(
    new Set(['DISABLE_FOO_HOOK']),
    Object.keys(files),
    changedLines(DIFF),
    f => files[f]
  );
  const got = m.get('DISABLE_FOO_HOOK').map(x => `${x.file}:${x.line}`);
  assert.deepEqual(got, ['README.md:2', 'hooks/foo-check.sh:2']);
});

test('claim-drift: a name matches whole, not inside a longer one (control)', () => {
  const m = findMentions(
    new Set(['foo-check']),
    ['README.md'],
    new Map(),
    () => 'see foo-check-extra and foo-checker\n'
  );
  assert.equal(m.get('foo-check').length, 0);
});

test('claim-drift CLI: --help exits 0, an unknown flag exits 2', () => {
  assert.equal(spawnSync('node', [SCRIPT, '--help']).status, 0);
  assert.equal(spawnSync('node', [SCRIPT, '--bogus']).status, 2);
});

test('claim-drift CLI: end to end on a scratch repository', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-test-claimdrift-'));
  try {
    const g = (...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' });
    g('init', '-q');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 't');
    fs.mkdirSync(path.join(d, 'hooks'));
    fs.writeFileSync(path.join(d, 'hooks/foo-check.sh'), '#!/bin/bash\nexit 0\n');
    fs.writeFileSync(path.join(d, 'README.md'), 'Set BAR_LIMIT_MAX to tune foo-check.\n');
    g('add', '.');
    g('commit', '-qm', 'a');
    fs.writeFileSync(
      path.join(d, 'hooks/foo-check.sh'),
      '#!/bin/bash\nBAR_LIMIT_MAX=${BAR_LIMIT_MAX:-5}\nexit 0\n'
    );
    g('commit', '-qam', 'b');
    const r = spawnSync('node', [SCRIPT, '--json'], { cwd: d, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(
      j.mentions.BAR_LIMIT_MAX.map(x => `${x.file}:${x.line}`),
      ['README.md:1'],
      'the README line is listed, the changed hook line is not'
    );
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
