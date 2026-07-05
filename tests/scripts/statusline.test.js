import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/statusline.sh');
const ESC = '\x1b';

function render(payload) {
  return spawnSync('bash', [SCRIPT], { input: JSON.stringify(payload), encoding: 'utf8' }).stdout;
}

test('full payload renders PS1-colored segments', () => {
  const out = render({ cwd: '/tmp/nonrepo-xyz', model: { display_name: 'Opus 4.8 (1M context)' }, context_window: { used_percentage: 6 } });
  assert.match(out, new RegExp(`^${ESC}\\[01;32m.+@.+${ESC}\\[00m:`));            // user@host green + colon
  assert.ok(out.includes(`${ESC}[01;34m/tmp/nonrepo-xyz${ESC}[00m`));             // path blue
  assert.ok(out.includes(`${ESC}[00;36mOpus 4.8 (1M context)${ESC}[00m`));        // model cyan
  assert.ok(out.includes(`${ESC}[00;32m[ctx:6%]${ESC}[00m`));                     // ctx green (<50)
});

test('ctx threshold colors at boundaries', () => {
  const ctx = (p) => render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: p } });
  assert.ok(ctx(49).includes(`${ESC}[00;32m[ctx:49%]`), 'green <50');
  assert.ok(ctx(50).includes(`${ESC}[00;33m[ctx:50%]`), 'yellow 50');
  assert.ok(ctx(79).includes(`${ESC}[00;33m[ctx:79%]`), 'yellow 79');
  assert.ok(ctx(80).includes(`${ESC}[00;31m[ctx:80%]`), 'red 80');
  assert.ok(ctx(6.2).includes(`${ESC}[00;32m[ctx:6%]`), 'decimal floored');
});

test('ctx hidden when absent or non-numeric', () => {
  assert.ok(!render({ cwd: '', model: { display_name: '' } }).includes('[ctx:'));
  assert.ok(!render({ cwd: '', model: { display_name: '' }, context_window: { used_percentage: 'N/A' } }).includes('[ctx:'));
});

test('empty stdin → user@host only, exit 0', () => {
  const res = spawnSync('bash', [SCRIPT], { input: '', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, new RegExp(`^${ESC}\\[01;32m.+@.+${ESC}\\[00m:$`));
});

test('git repo → branch segment; non-repo → none', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-repo-'));
  const genv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execSync('git init -q && git commit -q --allow-empty -m init', { cwd: repo, env: genv });
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  assert.ok(render({ cwd: repo, model: { display_name: '' } }).includes(`${ESC}[00;35m(${branch})${ESC}[00m`));
  fs.rmSync(repo, { recursive: true, force: true });

  const nonrepo = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-nonrepo-'));
  assert.ok(!render({ cwd: nonrepo, model: { display_name: '' } }).includes(`${ESC}[00;35m(`));
  fs.rmSync(nonrepo, { recursive: true, force: true });
});
