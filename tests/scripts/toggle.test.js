import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toggle } from '../../scripts/toggle.js';

const TOGGLE_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/toggle.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-tg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({ env: {} }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('toggle enables banned-vocab kill-switch', async () => {
  const r = await toggle('banned-vocab');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.env.DISABLE_BANNED_VOCAB_HOOK, '1');
  assert.equal(r.newState, 'disabled');
});

test('toggle re-enables banned-vocab (clears kill-switch)', async () => {
  await toggle('banned-vocab');
  const r = await toggle('banned-vocab');
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.ok(!s.env.DISABLE_BANNED_VOCAB_HOOK);
  assert.equal(r.newState, 'enabled');
});

test('toggle unknown name → error', async () => {
  await assert.rejects(() => toggle('not-a-hook'), /unknown hook/i);
});

test('toggle CLI with no argument prints usage (F18)', () => {
  // Regression: bare `node toggle.js` printed "unknown hook: undefined" —
  // unhelpful. Should print usage with the valid names.
  const result = spawnSync(process.execPath, [TOGGLE_JS], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/i);
  assert.match(result.stderr, /banned-vocab/);
});
