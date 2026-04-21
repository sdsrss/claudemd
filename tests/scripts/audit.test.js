import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { audit } from '../../scripts/audit.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-au-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","extra":{"matched":["significantly"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","extra":{"matched":["70% faster"]}}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","extra":null}\n`
  );
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('audit aggregates by hook', async () => {
  const r = await audit({ days: 30 });
  assert.equal(r.byHook['banned-vocab'].total, 2);
  assert.equal(r.byHook['ship-baseline'].total, 1);
});

test('audit top patterns for banned-vocab', async () => {
  const r = await audit({ days: 30 });
  assert.ok(r.topPatterns.length >= 2);
  const names = r.topPatterns.map(([name]) => name);
  assert.ok(names.includes('significantly'));
});
