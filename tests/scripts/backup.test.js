import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';
import {
  createBackup,
  listBackups,
  pruneBackups,
  pruneSettingsBackups,
  restoreBackup,
  findLegacySpecBackups,
  looksLikeSpec,
} from '../../scripts/lib/backup.js';

// First node consumer of tests/lib/home-sandbox.mjs (R11-27). The hand-written
// setup this replaces mkdtemp-ed a home, saved and restored process.env.HOME,
// and created `.claude` — correct for backup.js, which only reads `~/.claude`,
// and one seam short for anything it comes to call. The helper sets every path
// seam, so that gap cannot reopen here silently.
const box = useHomeSandbox('bk');

test('createBackup moves files into timestamped dir', () => {
  const src1 = path.join(box.home, '.claude/CLAUDE.md');
  fs.writeFileSync(src1, 'core');
  const { dir, movedFiles } = createBackup([src1]);
  // isoStamp now includes milliseconds to prevent sub-second collisions (F10).
  assert.match(path.basename(dir), /^backup-\d{8}T\d{6}(\d{3})?Z$/);
  assert.equal(movedFiles.length, 1);
  assert.equal(fs.existsSync(src1), false);
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'core');
});

test('createBackup skips non-existent files silently', () => {
  const missing = path.join(box.home, '.claude/NOPE.md');
  const { movedFiles } = createBackup([missing]);
  assert.equal(movedFiles.length, 0);
});

test('listBackups returns newest first', async () => {
  fs.mkdirSync(path.join(box.home, '.claude/backup-20260101T000000Z'));
  fs.mkdirSync(path.join(box.home, '.claude/backup-20260301T000000Z'));
  fs.mkdirSync(path.join(box.home, '.claude/backup-20260201T000000Z'));
  const backups = listBackups();
  assert.equal(backups.length, 3);
  assert.equal(backups[0].iso, '20260301T000000Z');
  assert.equal(backups[2].iso, '20260101T000000Z');
});

test('pruneBackups keeps N newest and removes rest', () => {
  for (const iso of [
    '20260101T000000Z',
    '20260201T000000Z',
    '20260301T000000Z',
    '20260401T000000Z',
    '20260501T000000Z',
    '20260601T000000Z',
  ]) {
    fs.mkdirSync(path.join(box.home, `.claude/backup-${iso}`));
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
  for (const name of [
    'backup-20260101T000000000Z',
    'backup-20260102T000000000Z',
    'backup-20260103T000000000Z',
    'backup-20260103T000000000Z-1',
    'backup-20260103T000000000Z-2',
  ]) {
    fs.mkdirSync(path.join(box.home, '.claude', name));
  }
  assert.equal(listBackups().length, 5, 'collision dirs must be listed');
  // -2 sorts newest (longest string > base), then -1, then the 3 plain stamps.
  assert.ok(listBackups()[0].dir.endsWith('Z-2'));
  pruneBackups(2);
  assert.equal(listBackups().length, 2, 'prune must reach collision dirs too');
});

test('pruneSettingsBackups: keeps N newest settings.json.claudemd-backup-* files', () => {
  const dir = path.join(box.home, '.claude');
  const iso = [
    '20260101T000000Z',
    '20260201T000000Z',
    '20260301T000000Z',
    '20260401T000000Z',
    '20260501T000000Z',
    '20260601T000000Z',
  ];
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
  const dir = path.join(box.home, '.claude');
  fs.writeFileSync(path.join(dir, 'settings.json.claudemd-backup-20260601T000000000Z'), 'x');
  fs.writeFileSync(path.join(dir, 'settings.json.claudemd-backup-20260601T000000000Z-1'), 'x');
  fs.writeFileSync(path.join(dir, 'settings.json.claudemd-backup-20260101T000000Z'), 'x');
  const removed = pruneSettingsBackups(2);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].endsWith('20260101T000000Z'));
});

test('pruneSettingsBackups: missing .claude dir returns [] without throw', () => {
  fs.rmSync(path.join(box.home, '.claude'), { recursive: true, force: true });
  assert.deepEqual(pruneSettingsBackups(5), []);
});

test('restoreBackup copies files back to targetRoot', () => {
  const bkDir = path.join(box.home, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'restored');
  const target = path.join(box.home, '.claude');
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
  const bk = path.join(box.home, '.claude/backup-20260101T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# My own notes\n');
  fs.symlinkSync(path.join(box.home, '.claude/gone-forever'), path.join(bk, 'dangling'));

  const listed = listBackups();
  assert.equal(listed.length, 1, 'the dir is still a backup');
  assert.equal(
    listed[0].size,
    '# My own notes\n'.length,
    'the readable file is counted; the dangling entry contributes 0'
  );
});

test('HIGH-1: a plain FILE matching the backup name grammar is not treated as a dir', () => {
  // Matches labelRegex but readdir'ing it throws ENOTDIR.
  fs.writeFileSync(path.join(box.home, '.claude/backup-20260101T000000000Z'), 'not a dir');
  assert.deepEqual(listBackups(), []);
});

test('HIGH-1: a missing backup root returns [] rather than throwing', () => {
  fs.rmSync(path.join(box.home, '.claude'), { recursive: true, force: true });
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
  const bk = path.join(box.home, '.claude/backup-20260601T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');

  const found = findLegacySpecBackups();
  assert.equal(found.length, 1);
  assert.equal(path.basename(found[0].dir), 'backup-20260601T000000000Z');
});

test('HIGH-2: reporting does not move, rename or delete anything', () => {
  const specDir = path.join(box.home, '.claude/backup-20260601T000000000Z');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');
  const before = fs.readdirSync(path.join(box.home, '.claude')).sort();

  findLegacySpecBackups();

  assert.deepEqual(
    fs.readdirSync(path.join(box.home, '.claude')).sort(),
    before,
    '~/.claude must be byte-for-byte unchanged — this function only looks'
  );
  assert.equal(listBackups().length, 1, 'the dir stays in the personal namespace');
});

test('HIGH-2: sibling user files are surfaced, because they decide the call', () => {
  // The pre-v0.23.11 install.js shape: spec-shaped CLAUDE.md alongside content
  // that is unambiguously the user's. A mover would have taken these with it.
  const bk = path.join(box.home, '.claude/backup-20260601T000000000Z');
  fs.mkdirSync(path.join(bk, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# AI-CODING-SPEC v6.25.2 — Core\n');
  fs.writeFileSync(path.join(bk, 'CLAUDE-extended.md'), '# my hand-written extended\n');
  fs.writeFileSync(path.join(bk, 'hooks', 'banned-vocab-check.sh'), '#!/bin/sh\n');

  const found = findLegacySpecBackups();
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].siblings.sort(), ['CLAUDE-extended.md', 'hooks']);
});

test('HIGH-2: a user-shaped CLAUDE.md is not reported', () => {
  const bk = path.join(box.home, '.claude/backup-20260101T000000000Z');
  fs.mkdirSync(bk, { recursive: true });
  fs.writeFileSync(path.join(bk, 'CLAUDE.md'), '# My own notes\n');
  assert.deepEqual(findLegacySpecBackups(), []);
});

test('HIGH-2: a dir with no CLAUDE.md is not reported', () => {
  const bk = path.join(box.home, '.claude/backup-20260101T000000000Z');
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

// --- audit-2026-08-29 R10-03/R10-04 ---------------------------------------

test('R10-03: prune excludes legacy spec dirs — genuine personal backup survives', () => {
  const SPEC = '# AI-CODING-SPEC v6.25.2 — Core\n';
  // Pre-0.68.3 layout: update.js wrote its spec backups into the PERSONAL
  // namespace, and because updates are frequent they are the NEWEST dirs there.
  const personal = path.join(box.home, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(personal);
  fs.writeFileSync(path.join(personal, 'CLAUDE.md'), '# My personal global instructions\n');
  for (const stamp of ['20260201T000000Z', '20260301T000000Z']) {
    const d = path.join(box.home, `.claude/backup-${stamp}`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), SPEC);
  }

  const legacy = findLegacySpecBackups().map(b => b.dir);
  assert.equal(legacy.length, 2, 'both spec-shaped dirs identified');

  // Retain 1. Unfiltered, "the 1 newest" is a spec dir and the personal backup
  // is deleted — the v0.23.11 data-loss mode through a maintenance flag.
  const removed = pruneBackups(1, { exclude: legacy });

  assert.ok(fs.existsSync(path.join(personal, 'CLAUDE.md')), 'genuine personal backup must survive');
  assert.deepEqual(removed, [], 'nothing to remove: 1 non-legacy dir, retain 1');
  // Legacy dirs are skipped, not deleted — backup.js stays report-only.
  for (const d of legacy) assert.ok(fs.existsSync(d), `${d} left for the user to decide`);
});

test('R10-03: exclusion does not disable pruning of genuine backups', () => {
  // FP guard: the skip must not turn --prune-backups into a no-op for the
  // dirs it is actually meant to rotate.
  const SPEC = '# AI-CODING-SPEC v6.25.2 — Core\n';
  const specDir = path.join(box.home, '.claude/backup-20260901T000000Z');
  fs.mkdirSync(specDir);
  fs.writeFileSync(path.join(specDir, 'CLAUDE.md'), SPEC);
  const personals = ['20260101T000000Z', '20260201T000000Z', '20260301T000000Z'].map(s => {
    const d = path.join(box.home, `.claude/backup-${s}`);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'CLAUDE.md'), '# My personal global instructions\n');
    return d;
  });

  const removed = pruneBackups(1, { exclude: findLegacySpecBackups().map(b => b.dir) });

  assert.equal(removed.length, 2, 'two oldest personal dirs rotated out');
  assert.ok(fs.existsSync(personals[2]), 'newest personal retained');
  assert.ok(!fs.existsSync(personals[0]));
  assert.ok(fs.existsSync(specDir), 'legacy dir untouched');
});

test('R10-04: restoreBackup skips a dangling symlink instead of throwing', () => {
  // createBackup uses renameSync, and rename(2) on a symlink moves the LINK —
  // so a ~/.claude/CLAUDE.md symlinked into a dotfiles repo lands in the backup
  // dir and dangles once its target moves. dirSize was hardened for this input
  // in 0.68.3; restoreBackup kept a bare statSync and threw ENOENT out of the
  // uninstall restore path, after settings had already been evicted.
  const bkDir = path.join(box.home, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  // Name the dangling link so readdir is likely to hit it FIRST — a partial
  // restore is the failure this guards, not just the throw.
  fs.symlinkSync(path.join(box.home, 'gone/CLAUDE.md'), path.join(bkDir, 'AAA-dangling.md'));
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'core');
  fs.writeFileSync(path.join(bkDir, 'zzz.md'), 'tail');
  const target = path.join(box.home, '.claude');

  const restored = restoreBackup(bkDir, target);

  assert.equal(restored.length, 2, 'both real files restored');
  assert.equal(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), 'core');
  assert.equal(fs.readFileSync(path.join(target, 'zzz.md'), 'utf8'), 'tail');
  assert.ok(!fs.existsSync(path.join(target, 'AAA-dangling.md')));
});
