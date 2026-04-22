import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor } from '../../scripts/doctor.js';

const DOCTOR_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/doctor.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'), JSON.stringify({
    version: '0.1.0', entries: []
  }));
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('doctor returns checks array with at least 5 entries', async () => {
  const r = await doctor({});
  assert.ok(Array.isArray(r.checks));
  assert.ok(r.checks.length >= 5);
});

test('doctor --prune-backups removes old backups', async () => {
  for (const iso of ['20260101T000000Z','20260201T000000Z','20260301T000000Z',
                     '20260401T000000Z','20260501T000000Z','20260601T000000Z']) {
    fs.mkdirSync(path.join(tmpHome, `.claude/backup-${iso}`));
  }
  const r = await doctor({ pruneBackups: 3 });
  assert.equal(r.pruned.length, 3);
});

test('doctor CLI rejects --prune-backups=0 (F9)', () => {
  // Regression: --prune-backups=0 meant "retain zero", which deleted ALL
  // backups silently. Users reasonably read "0" as "prune zero of them".
  const result = spawnSync(process.execPath, [DOCTOR_JS, '--prune-backups=0'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'must exit non-zero on prune=0');
  assert.match(result.stderr, /positive integer/i);
});

test('doctor logs check reports size and warns above threshold (L5)', async () => {
  const logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  // 6 MB of pseudo-entries — beyond the 5 MB warn threshold.
  const row = `{"ts":"2026-04-22T00:00:00Z","hook":"banned-vocab","event":"deny","extra":null}\n`;
  const rowsNeeded = Math.ceil((6 * 1024 * 1024) / row.length);
  fs.writeFileSync(logPath, row.repeat(rowsNeeded));
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.ok(logs, 'logs check must exist');
  assert.equal(logs.ok, false, 'must fail when log exceeds 5 MB threshold');
  assert.match(logs.detail, /MB/);
  assert.match(logs.detail, /truncate/i);
});

test('doctor logs check ok when small (L5)', async () => {
  const logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(logPath, `{"ts":"2026-04-22T00:00:00Z","hook":"x","event":"pass","extra":null}\n`);
  const r = await doctor({});
  const logs = r.checks.find(c => c.name === 'logs');
  assert.equal(logs.ok, true);
  assert.match(logs.detail, /1 rule-hits row/);
});
