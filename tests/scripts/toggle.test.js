import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { toggle } from '../../scripts/toggle.js';

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
