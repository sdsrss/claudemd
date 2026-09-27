// command-args-placeholder.test.js — slash-command bodies must use the argument
// placeholder Claude Code substitutes. Its docs list `$ARGUMENTS`, `$0`/`$1`…
// and named arguments; `$ARGS` is not among them, so a body that says
// `node x.js $ARGS` hands the literal text to the model and the flags a user
// typed reach the script only if the model happens to rewrite the line
// (docs/audit/20260926-180700.md K1 / F7; nine command files used it).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(REPO_ROOT, 'commands');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md'));

test('command-args: the commands directory is not empty (liveness)', () => {
  assert.ok(files.length >= 10, `expected the plugin's command files, found ${files.length}`);
});

test('command-args: no command body uses the unsupported $ARGS placeholder', () => {
  const offenders = [];
  for (const f of files) {
    fs.readFileSync(path.join(DIR, f), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/\$(ARGS(?![A-Za-z0-9_])|\{ARGS\b)/.test(line))
          offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  assert.deepEqual(offenders, [], `use $ARGUMENTS instead:\n${offenders.join('\n')}`);
});

test('command-args: the matcher sees a real $ARGS and ignores $ARGUMENTS (control)', () => {
  const re = /\$(ARGS(?![A-Za-z0-9_])|\{ARGS\b)/;
  assert.ok(re.test('node x.js $ARGS'));
  assert.ok(re.test('split `$ARGS` into'));
  assert.ok(re.test('X=${ARGS:-30} node x.js'));
  assert.ok(!re.test('node x.js $ARGUMENTS'));
});
