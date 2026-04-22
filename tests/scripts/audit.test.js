import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit } from '../../scripts/audit.js';

const AUDIT_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/audit.js');

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

test('audit CLI rejects non-numeric --days (L1)', () => {
  // Regression: parseInt('garbage', 10) → NaN → cutoff NaN → every row
  // filtered out silently. Previous runs returned 0 hits with no error.
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=garbage'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive integer/i);
});

test('audit CLI rejects --days=0 (L1)', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=0'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive integer/i);
});

test('audit CLI --days=N takes precedence over env var', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=1'], {
    env: { ...process.env, HOME: tmpHome, CLAUDEMD_AUDIT_DAYS: '90' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
  const r = JSON.parse(result.stdout);
  assert.equal(r.windowDays, 1);
});
