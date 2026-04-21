import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { doctor } from '../../scripts/doctor.js';

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-dr-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/.claudemd-state/installed.json'), JSON.stringify({
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
