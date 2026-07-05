import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'scripts/statusline-adopt.js');

let tmpHome, savedHome;
function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, HOME: tmpHome, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
    encoding: 'utf8',
  });
}

beforeEach(() => {
  delete process.env.CLAUDEMD_NO_STATUSLINE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-slcli-'));
  savedHome = process.env.HOME;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('detect on empty slot → absent', () => {
  const r = run(['detect', '--json']);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).verdict, 'absent');
});

test('adopt then detect → claudemd', () => {
  assert.equal(JSON.parse(run(['adopt']).stdout).action, 'set');
  assert.equal(JSON.parse(run(['detect', '--json']).stdout).verdict, 'claudemd');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/claudemd-statusline.sh')));
});

test('unknown mode → exit 2', () => {
  assert.equal(run(['bogus']).status, 2);
});

test('unknown flag → exit 2', () => {
  assert.equal(run(['adopt', '--nope']).status, 2);
});

test('--help → exit 0 with usage', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: node scripts\/statusline-adopt\.js/);
});
