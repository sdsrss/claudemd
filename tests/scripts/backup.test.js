import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBackup, listBackups, pruneBackups, pruneSettingsBackups, restoreBackup, findLegacySpecBackups, looksLikeSpec } from '../../scripts/lib/backup.js';

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

test('v0.23.11: collision-suffix backup dirs (-N) are listed, sorted, and pruned', () => {
  // createBackup appends `-N` on a same-ms collision. Pre-fix BACKUP_DIR_REGEX
  // lacked `(-\d+)?`, so those dirs were invisible to listBackups/pruneBackups —
  // they leaked in ~/.claude forever and were excluded from restore.
  for (const name of ['backup-20260101T000000000Z', 'backup-20260102T000000000Z',
                      'backup-20260103T000000000Z', 'backup-20260103T000000000Z-1',
                      'backup-20260103T000000000Z-2']) {
    fs.mkdirSync(path.join(tmpHome, '.claude', name));
  }
  assert.equal(listBackups().length, 5, 'collision dirs must be listed');
  // -2 sorts newest (longest string > base), then -1, then the 3 plain stamps.
  assert.ok(listBackups()[0].dir.endsWith('Z-2'));
  pruneBackups(2);
  assert.equal(listBackups().length, 2, 'prune must reach collision dirs too');
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


// --- 0.68.3 delta review HIGH-1: listBackups must survive what is in ~/.claude
//
// `dirSize` statSync'd every entry unguarded, and its callers are install,
// uninstall, doctor and update. The trigger is routine, not exotic:
// `createBackup` uses renameSync and rename(2) on a symlink moves the LINK, so
// a user who symlinks ~/.claude/CLAUDE.md into a dotfiles repo gets that
// symlink stored inside the backup dir — dangling the moment the source moves.
// One stale link then threw ENOENT out of listBackups and killed
// /claudemd-doctor with a bare stack before it printed a single check.

test('HIGH-1: a dangling symlink inside a backup dir does not throw', () => {
  const bk = path.join(tmpHome, '.claude/backup-20260101T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# My own notes\n');
  fs.symlinkSync(path.join(tmpHome, '.claude/gone-forever'), path.join(bk, 'dangling'));

  const listed = listBackups();
  assert.equal(listed.length, 1, 'the dir is still a backup');
  assert.equal(listed[0].size, '# My own notes\n'.length,
    'the readable file is counted; the dangling entry contributes 0');
});

test('HIGH-1: a plain FILE matching the backup name grammar is not treated as a dir', () => {
  // Matches labelRegex but readdir'ing it throws ENOTDIR.
  fs.writeFileSync(path.join(tmpHome, '.claude/backup-20260101T000000000Z'), 'not a dir');
  assert.deepEqual(listBackups(), []);
});

test('HIGH-1: a missing backup root returns [] rather than throwing', () => {
  fs.rmSync(path.join(tmpHome, '.claude'), { recursive: true, force: true });
  assert.deepEqual(listBackups(), []);
});

// --- 0.68.3 delta review HIGH-2: report legacy spec backups, never move them --
//
// A migration for these was written and WITHDRAWN. Its discriminator was
// "install.js only backs up non-spec files, so a spec-shaped `backup-` dir came
// from update.js" — true of today's install.js, false of the one that wrote the
// dirs it targeted (cc36e2b backed up unconditionally; this repo's CHANGELOG
// records the whole pre-v0.23.11 window doing the same). Moving on it would
// carry sibling user files out of the restore path and into a namespace
// update.js prunes every run. These tests pin the read-only contract so a
// future change cannot quietly reintroduce a mover.

test('HIGH-2: a spec-shaped dir in the personal namespace is reported', () => {
  const bk = path.join(tmpHome, '.claude/backup-20260601T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');

  const found = findLegacySpecBackups();
  assert.equal(found.length, 1);
  assert.equal(path.basename(found[0].dir), 'backup-20260601T000000000Z');
});

test('HIGH-2: reporting does not move, rename or delete anything', () => {
  const specDir = path.join(tmpHome, '.claude/backup-20260601T000000000Z');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');
  const before = fs.readdirSync(path.join(tmpHome, '.claude')).sort();

  findLegacySpecBackups();

  assert.deepEqual(fs.readdirSync(path.join(tmpHome, '.claude')).sort(), before,
    '~/.claude must be byte-for-byte unchanged — this function only looks');
  assert.equal(listBackups().length, 1, 'the dir stays in the personal namespace');
});

test('HIGH-2: sibling user files are surfaced, because they decide the call', () => {
  // The pre-v0.23.11 install.js shape: spec-shaped CLAUDE.md alongside content
  // that is unambiguously the user's. A mover would have taken these with it.
  const bk = path.join(tmpHome, '.claude/backup-20260601T000000000Z');
  fs.mkdirSync(path.join(bk, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');
  fs.writeFileSync(path.join(bk, 'CLAUDE-extended.md'), '# my hand-written extended\n');
  fs.writeFileSync(path.join(bk, 'hooks', 'banned-vocab-check.sh'), '#!/bin/sh\n');

  const found = findLegacySpecBackups();
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].siblings.sort(), ['CLAUDE-extended.md', 'hooks']);
});

test('HIGH-2: a user-shaped CLAUDE.md is not reported', () => {
  const bk = path.join(tmpHome, '.claude/backup-20260101T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# My own notes\n');
  assert.deepEqual(findLegacySpecBackups(), []);
});

test('HIGH-2: a dir with no CLAUDE.md is not reported', () => {
  const bk = path.join(tmpHome, '.claude/backup-20260101T000000000Z');
  fs.mkdirSync(path.join(bk, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(bk, 'hooks', 'banned-vocab-check.sh'), '#!/bin/sh\n');
  assert.deepEqual(findLegacySpecBackups(), []);
});

test('HIGH-2: looksLikeSpec reads the H1 only, and says so by example', () => {
  // Pinned because the withdrawn migration leaned on this being decisive, and
  // it is not: a user's own additions below the H1 are invisible to it. That is
  // acceptable for a REPORT and was not acceptable for a move.
  assert.equal(looksLikeSpec('# AI-CODING-SPEC v6.25.2 — Core\n'), true);
  assert.equal(looksLikeSpec('# AI-CODING-SPEC v6.0.0 — Core\n\n## MY OWN SECTION\n'), true);
  assert.equal(looksLikeSpec('# My own notes\n'), false);
  assert.equal(looksLikeSpec(''), false);
  assert.equal(looksLikeSpec(undefined), false);
});
