import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBackup, listBackups, pruneBackups, pruneSettingsBackups, restoreBackup } from '../../scripts/lib/backup.js';

let tmpHome;
let savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-bk-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('createBackup moves files into timestamped dir', () => {
  const src1 = path.join(tmpHome, '.claude/CLAUDE.md');
  fs.writeFileSync(src1, 'core');
  const { dir, movedFiles } = createBackup([src1]);
  // isoStamp now includes milliseconds to prevent sub-second collisions (F10).
  assert.match(path.basename(dir), /^backup-\d{8}T\d{6}(\d{3})?Z$/);
  assert.equal(movedFiles.length, 1);
  assert.equal(fs.existsSync(src1), false);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'core');
});

test('createBackup skips non-existent files silently', () => {
  const missing = path.join(tmpHome, '.claude/NOPE.md');
  const { movedFiles } = createBackup([missing]);
  assert.equal(movedFiles.length, 0);
});

test('listBackups returns newest first', async () => {
  fs.mkdirSync(path.join(tmpHome, '.claude/backup-20260101T000000Z'));
  fs.mkdirSync(path.join(tmpHome, '.claude/backup-20260301T000000Z'));
  fs.mkdirSync(path.join(tmpHome, '.claude/backup-20260201T000000Z'));
  const backups = listBackups();
  assert.equal(backups.length, 3);
  assert.equal(backups[0].iso, '20260301T000000Z');
  assert.equal(backups[2].iso, '20260101T000000Z');
});

test('pruneBackups keeps N newest and removes rest', () => {
  for (const iso of ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z',
                     '20260401T000000Z', '20260501T000000Z', '20260601T000000Z']) {
    fs.mkdirSync(path.join(tmpHome, `.claude/backup-${iso}`));
  }
  const removed = pruneBackups(5);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].endsWith('backup-20260101T000000Z'));
  assert.equal(listBackups().length, 5);
});

test('pruneSettingsBackups: keeps N newest settings.json.claudemd-backup-* files', () => {
  const dir = path.join(tmpHome, '.claude');
  const iso = ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z',
               '20260401T000000Z', '20260501T000000Z', '20260601T000000Z'];
  for (const s of iso) {
    fs.writeFileSync(path.join(dir, `settings.json.claudemd-backup-${s}`), 'x');
  }
  // Also drop an unrelated sibling to verify the regex filter.
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'y');

  const removed = pruneSettingsBackups(5);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].endsWith('settings.json.claudemd-backup-20260101T000000Z'));

  const remaining = fs.readdirSync(dir).filter(n => n.startsWith('settings.json.claudemd-backup-'));
  assert.equal(remaining.length, 5);
  assert.equal(fs.existsSync(path.join(dir, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'unrelated.txt')), true);
});

test('pruneSettingsBackups: accepts ms-precision and -N collision suffix', () => {
  const dir = path.join(tmpHome, '.claude');
  fs.writeFileSync(path.join(dir, 'settings.json.claudemd-backup-20260601T000000000Z'), 'x');
  fs.writeFileSync(path.join(dir, 'settings.json.claudemd-backup-20260601T000000000Z-1'), 'x');
  fs.writeFileSync(path.join(dir, 'settings.json.claudemd-backup-20260101T000000Z'), 'x');
  const removed = pruneSettingsBackups(2);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].endsWith('20260101T000000Z'));
});

test('pruneSettingsBackups: missing .claude dir returns [] without throw', () => {
  fs.rmSync(path.join(tmpHome, '.claude'), { recursive: true, force: true });
  assert.deepEqual(pruneSettingsBackups(5), []);
});

test('restoreBackup copies files back to targetRoot', () => {
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'restored');
  const target = path.join(tmpHome, '.claude');
  const restored = restoreBackup(bkDir, target);
  assert.equal(restored.length, 1);
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'restored');
});
