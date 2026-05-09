import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan, clean } from '../../scripts/clean-residue.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/clean-residue.js');

let tmpDir;

const setMtime = (p, daysAgo) => {
  const t = (Date.now() - daysAgo * 86400000) / 1000;
  fs.utimesSync(p, t, t);
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-clean-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scan finds claudemd-sync-* files and claudemd-(mockgh|work).* dirs', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-abc'), '');
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-xyz123'), '');
  fs.mkdirSync(path.join(tmpDir, 'claudemd-mockgh.AAA'));
  fs.mkdirSync(path.join(tmpDir, 'claudemd-work.BBB'));
  fs.writeFileSync(path.join(tmpDir, 'unrelated.txt'), '');
  fs.mkdirSync(path.join(tmpDir, 'unrelated-dir'));

  const r = scan({ tmpDir });
  assert.equal(r.sentinels.length, 2);
  assert.equal(r.sandboxes.length, 2);
});

test('scan tolerates missing/empty dir', () => {
  const r = scan({ tmpDir });
  assert.deepEqual(r.sentinels, []);
  assert.deepEqual(r.sandboxes, []);

  const r2 = scan({ tmpDir: path.join(tmpDir, 'nonexistent') });
  assert.deepEqual(r2.sentinels, []);
  assert.deepEqual(r2.sandboxes, []);
});

test('clean dryRun returns targets without deleting', () => {
  const f = path.join(tmpDir, 'claudemd-sync-old');
  fs.writeFileSync(f, '');
  setMtime(f, 5);

  const r = clean({ tmpDir, apply: false });
  assert.equal(r.dryRun, true);
  assert.equal(r.deleted, 0);
  assert.equal(r.targets.length, 1);
  assert.ok(fs.existsSync(f), 'dry-run must not delete');
});

test('clean apply deletes only entries older than ageDaysMin', () => {
  const old = path.join(tmpDir, 'claudemd-sync-old');
  const fresh = path.join(tmpDir, 'claudemd-sync-fresh');
  fs.writeFileSync(old, '');
  fs.writeFileSync(fresh, '');
  setMtime(old, 5);
  // fresh's mtime stays "now" — under the 1-day threshold

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 1);
  assert.ok(!fs.existsSync(old), 'old must be deleted');
  assert.ok(fs.existsSync(fresh), 'fresh must be preserved');
});

test('clean apply deletes sandbox dirs recursively', () => {
  const sandbox = path.join(tmpDir, 'claudemd-mockgh.XYZ');
  fs.mkdirSync(sandbox);
  fs.writeFileSync(path.join(sandbox, 'gh'), 'fake content');
  fs.mkdirSync(path.join(sandbox, 'nested'));
  setMtime(sandbox, 5);
  setMtime(path.join(sandbox, 'gh'), 5);
  setMtime(path.join(sandbox, 'nested'), 5);

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 1);
  assert.ok(!fs.existsSync(sandbox));
});

test('clean does NOT touch non-matching files', () => {
  const safe = path.join(tmpDir, 'unrelated.txt');
  fs.writeFileSync(safe, 'keep me');
  setMtime(safe, 100);

  const safeDir = path.join(tmpDir, 'random-dir');
  fs.mkdirSync(safeDir);
  setMtime(safeDir, 100);

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 0);
  assert.ok(fs.existsSync(safe));
  assert.equal(fs.readFileSync(safe, 'utf8'), 'keep me');
  assert.ok(fs.existsSync(safeDir));
});

test('clean ageDaysMin=0 includes brand-new entries', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-new'), '');
  const r = clean({ tmpDir, apply: true, ageDaysMin: 0 });
  assert.equal(r.deleted, 1);
});

test('clean does NOT match almost-similar names (anchor patterns)', () => {
  // Defense against future fnmatch-style sloppiness.
  fs.writeFileSync(path.join(tmpDir, 'not-claudemd-sync-foo'), '');
  fs.writeFileSync(path.join(tmpDir, 'xclaudemd-sync-foo'), '');
  fs.mkdirSync(path.join(tmpDir, 'claudemd-mockgh-noDot'));
  fs.mkdirSync(path.join(tmpDir, 'claudemd-mockghX.YYY'));
  for (const f of fs.readdirSync(tmpDir)) setMtime(path.join(tmpDir, f), 30);

  const r = clean({ tmpDir, apply: true, ageDaysMin: 1 });
  assert.equal(r.deleted, 0, `unexpected matches: ${r.targets.map(t => t.path).join(', ')}`);
});

test('CLI dry-run by default prints sentinel/sandbox/deleted counts', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-z'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-z'), 5);

  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const r = JSON.parse(result.stdout);
  assert.equal(r.dryRun, true);
  assert.equal(r.sentinels, 1);
  assert.equal(r.deleted, 0);
  assert.ok(fs.existsSync(path.join(tmpDir, 'claudemd-sync-z')), 'CLI default must not delete');
});

test('CLI --apply deletes; subsequent run is idempotent', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-z'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-z'), 5);

  const r1 = spawnSync(process.execPath, [SCRIPT, '--apply'], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  assert.equal(r1.status, 0);
  const o1 = JSON.parse(r1.stdout);
  assert.equal(o1.deleted, 1);
  assert.ok(!fs.existsSync(path.join(tmpDir, 'claudemd-sync-z')));

  const r2 = spawnSync(process.execPath, [SCRIPT, '--apply'], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  const o2 = JSON.parse(r2.stdout);
  assert.equal(o2.deleted, 0);
});

test('CLI --age-days=N overrides default 1-day threshold', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-3d'), '');
  setMtime(path.join(tmpDir, 'claudemd-sync-3d'), 3);

  // age-days=7 should NOT match a 3-day-old file
  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--age-days=7'], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  const o = JSON.parse(r.stdout);
  assert.equal(o.deleted, 0);
  assert.ok(fs.existsSync(path.join(tmpDir, 'claudemd-sync-3d')));
});

test('CLI rejects negative --age-days', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--age-days=-1'], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /non-negative/i);
});

test('CLI rejects space-form --age-days 0 (was silent default → exit 0 + 0 deleted)', () => {
  fs.writeFileSync(path.join(tmpDir, 'claudemd-sync-now'), '');
  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--age-days', '0'], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, `expected exit 2 (ArgvError); got ${r.status}, stderr: ${r.stderr}`);
  assert.match(r.stderr, /requires '=value' form/);
  assert.ok(fs.existsSync(path.join(tmpDir, 'claudemd-sync-now')), 'must not delete on parse error');
});

test('CLI rejects unknown flag (was silent ignore)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--apply', '--bogus=x'], {
    env: { ...process.env, TMPDIR: tmpDir },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown flag.*--bogus/);
});
