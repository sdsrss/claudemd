import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { update } from '../../scripts/update.js';
import { createBackup, listBackups } from '../../scripts/lib/backup.js';

const UPDATE_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/update.js');

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-upd-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), 'plugin-new\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), 'plugin-new-ext\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), 'plugin-new-cl\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/OPERATOR.md'), 'plugin-new-op\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'home-old\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-extended.md'), 'plugin-new-ext\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-changelog.md'), 'home-old-cl\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/OPERATOR.md'), 'plugin-new-op\n');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('dry-run: returns per-file diff summary', async () => {
  const res = await update({ pluginRoot, choice: 'cancel' });
  assert.equal(res.applied, false);
  assert.equal(res.diffs.length, 4);
  const core = res.diffs.find(d => d.file === 'CLAUDE.md');
  assert.ok(core.added > 0 || core.removed > 0);
  const ext = res.diffs.find(d => d.file === 'CLAUDE-extended.md');
  assert.equal(ext.added, 0);
  assert.equal(ext.removed, 0);
});

test('apply-all: backup created and all files updated', async () => {
  const res = await update({ pluginRoot, choice: 'apply-all' });
  assert.equal(res.applied, true);
  assert.ok(res.backupDir);
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'plugin-new\n');
  assert.equal(fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'), 'home-old\n');
});

// --- audit-2026-08-22 P1-1: backup namespace collision --------------------
//
// install.js backs the user's PERSONAL ~/.claude/CLAUDE.md up under label
// `backup` and its own comment claims that backup is "the SOLE backup → prune
// can never bury it". update.js used the SAME label, so every /claudemd-update
// pushed a spec-only backup on top of it: `CLAUDEMD_SPEC_ACTION=restore`
// (uninstall.js takes listBackups()[0], the newest) returned the OLD SPEC, and
// pruneBackups(5) evicted the personal content for good after five updates.
// That is the v0.23.11 data-loss mode reopened through the update path.

const seedPersonalBackup = home => {
  const personal = path.join(home, '.claude/CLAUDE.md');
  fs.writeFileSync(personal, 'personal user-global instructions\n');
  const bk = createBackup([personal], { label: 'backup' });
  // install then drops the spec into the vacated path.
  fs.writeFileSync(personal, 'home-old\n');
  return bk.dir;
};

test('P1-1: after an update, the newest restorable backup is still the personal one', async () => {
  const personalDir = seedPersonalBackup(tmpHome);
  await update({ pluginRoot, choice: 'apply-all' });

  const newest = listBackups()[0];
  assert.equal(
    newest.dir,
    personalDir,
    'uninstall restore takes listBackups()[0] — an update backup must not sit on top of it'
  );
  assert.equal(
    fs.readFileSync(path.join(newest.dir, 'CLAUDE.md'), 'utf8'),
    'personal user-global instructions\n',
    'restore must return the user content, not the spec it replaced'
  );
});

test('P1-1: five updates do not prune the personal backup out of existence', async () => {
  const personalDir = seedPersonalBackup(tmpHome);
  for (let i = 0; i < 6; i++) {
    fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), `plugin-v${i}\n`);
    const res = await update({ pluginRoot, choice: 'apply-all' });
    assert.equal(res.applied, true, `update ${i} must have had something to apply`);
  }
  assert.ok(
    fs.existsSync(personalDir),
    'pruneBackups(5) must not reach the personal backup — 6 updates evicted it pre-fix'
  );
  assert.equal(listBackups()[0].dir, personalDir);
});

test('P1-1: update still rotates its OWN backups (no unbounded growth)', async () => {
  for (let i = 0; i < 8; i++) {
    fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), `plugin-v${i}\n`);
    await update({ pluginRoot, choice: 'apply-all' });
  }
  const specBackups = fs.readdirSync(path.join(tmpHome, '.claude')).filter(n => n.startsWith('spec-backup-'));
  assert.ok(
    specBackups.length <= 5,
    `separating the namespace must not disable rotation (found ${specBackups.length})`
  );
  assert.ok(specBackups.length > 0, 'update must still take a backup before overwriting');
});

test('unknown choice throws', async () => {
  await assert.rejects(() => update({ pluginRoot, choice: 'select' }), /unknown choice/);
});

test('CLI: unknown CLAUDEMD_UPDATE_CHOICE → clean stderr + exit 1 (no Node stack trace)', () => {
  // Pre-fix, an unknown env value surfaced as a raw Node promise-rejection
  // stack trace dumped to stderr (lines starting with `Error:` and
  // `    at update (file:.../update.js:41:11)`). The .catch wrapper translates
  // it into a one-line message + exit 1 — same UX contract as audit.js /
  // sparkline.js validation errors.
  const r = spawnSync('node', [UPDATE_JS], {
    env: { ...process.env, CLAUDEMD_UPDATE_CHOICE: 'YOLO' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown choice: YOLO/);
  // No raw Node stack trace lines (the `    at update (file:.../` pattern).
  assert.doesNotMatch(r.stderr, /^\s*at update \(/m);
});

// --- audit-2026-08-29 R10-02: fail-before-touch on a truncated plugin cache -
//
// install.js has carried this pre-flight since the 2026-07-12 audit (SCRIPT-1);
// update.js never got it. A missing plugin spec file reads as `pluginText ===
// ''`, so diffSpec marks the whole file removed and it becomes a *target*:
// createBackup renameSync-moves every home spec away, present files copy, the
// absent one throws ENOENT — half the spec upgraded, half only in the backup
// dir. That is the lockstep violation update.js:37-39 explicitly forbids.
test('R10-02: incomplete plugin cache → update refuses, ~/.claude untouched', async () => {
  const before = Object.fromEntries(
    ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md', 'OPERATOR.md'].map(n => [
      n,
      fs.readFileSync(path.join(tmpHome, '.claude', n), 'utf8'),
    ])
  );

  fs.rmSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md')); // truncated cache

  await assert.rejects(
    () => update({ pluginRoot, choice: 'apply-all' }),
    /shipped spec missing.*CLAUDE-changelog\.md/
  );

  // Every home file still at its pre-update content, at its home path.
  for (const [name, text] of Object.entries(before)) {
    assert.equal(
      fs.readFileSync(path.join(tmpHome, '.claude', name), 'utf8'),
      text,
      `${name} must be untouched`
    );
  }
  // And nothing was moved into a backup dir.
  assert.equal(listBackups({ label: 'spec-backup' }).length, 0, 'no spec backup — nothing was moved');
});

test('R10-02: dry-run still reports diffs against a truncated cache', async () => {
  // The pre-flight sits behind the `cancel` early-return, so a diagnostic
  // dry-run against a broken cache keeps working (it writes nothing).
  fs.rmSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'));
  const res = await update({ pluginRoot, choice: 'cancel' });
  assert.equal(res.applied, false);
  assert.equal(res.diffs.length, 4);
});

// --- R11-09 (2026-09-02 audit): a mid-copy failure must not strand the spec ---
// createBackup RENAMES the user's ~/.claude/CLAUDE*.md into the backup dir
// (backup.js:82), then update copied the shipped files in with a bare
// copyFileSync loop — no post-copy hash check, no rollback. A failure on the
// second file left ~/.claude holding one new file and three missing ones, with
// nothing to put them back. update.js:37-39 forbids exactly this: the spec trio
// is lockstep because §EXT cross-references dangle if only some files land.
// install.js had the SHA post-check since SCRIPT-1; update never got it.
//
// INJECTION POINT MATTERS. The first version of this test chmod'd a shipped
// file to 000, which throws in the DIFF phase (update.js:31 reads every plugin
// file) — before createBackup runs. Nothing had been moved, so the "everything
// is restored" assertions passed against the unfixed code: a false green. The
// failure has to be injected at the copy itself.

test('R11-09: a mid-copy failure restores every spec file from the backup', async t => {
  const before = {};
  for (const n of ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md', 'OPERATOR.md']) {
    before[n] = fs.readFileSync(path.join(tmpHome, '.claude', n), 'utf8');
  }
  // Poison the FORWARD copy only — keyed on src being the shipped file, not on
  // dest. Keyed on dest, the mock also intercepted the ROLLBACK's copy out of
  // the backup dir and re-broke the file it had just restored, which reads as a
  // product failure and is not one.
  // CLAUDE.md, because `targets` holds only the files that DIFFER: the fixture
  // gives CLAUDE-extended.md and OPERATOR.md the same content on both sides, so
  // they are never copied and poisoning them proves nothing.
  const realCopy = fs.copyFileSync;
  const shippedDir = path.join(pluginRoot, 'spec');
  t.mock.method(fs, 'copyFileSync', (src, dest, ...rest) => {
    if (String(src).startsWith(shippedDir) && String(src).endsWith('CLAUDE.md')) {
      throw Object.assign(new Error("EACCES: permission denied, copyfile -> 'CLAUDE.md'"), {
        code: 'EACCES',
      });
    }
    return realCopy(src, dest, ...rest);
  });

  await assert.rejects(() => update({ pluginRoot, choice: 'apply-all' }), /EACCES|CLAUDE\.md/);
  t.mock.restoreAll();

  for (const [n, content] of Object.entries(before)) {
    const p = path.join(tmpHome, '.claude', n);
    assert.ok(fs.existsSync(p), `${n} must be restored, not left missing`);
    assert.equal(fs.readFileSync(p, 'utf8'), content, `${n} must hold its pre-update content`);
  }
});

test('R11-09: a copy that silently writes the wrong bytes is caught and rolled back', async t => {
  const before = fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE-changelog.md'), 'utf8');
  const realCopy = fs.copyFileSync;
  const shippedDir = path.join(pluginRoot, 'spec');
  t.mock.method(fs, 'copyFileSync', (src, dest, ...rest) => {
    // Truncated write that does NOT throw — the shape install.js's SCRIPT-1
    // post-copy hash check exists to catch (disk full, concurrent writer).
    // Guarded on src like the case above so the rollback copy runs for real.
    if (String(src).startsWith(shippedDir) && String(src).endsWith('CLAUDE-changelog.md')) {
      return fs.writeFileSync(dest, 'trunc');
    }
    return realCopy(src, dest, ...rest);
  });

  await assert.rejects(() => update({ pluginRoot, choice: 'apply-all' }), /integrity|does not match/i);
  t.mock.restoreAll();

  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE-changelog.md'), 'utf8'), before);
});

test('R11-09: a successful update still lands every file byte-exact', async () => {
  const res = await update({ pluginRoot, choice: 'apply-all' });
  assert.equal(res.applied, true);
  for (const [n, expected] of [
    ['CLAUDE.md', 'plugin-new\n'],
    ['CLAUDE-extended.md', 'plugin-new-ext\n'],
    ['CLAUDE-changelog.md', 'plugin-new-cl\n'],
    ['OPERATOR.md', 'plugin-new-op\n'],
  ]) {
    assert.equal(fs.readFileSync(path.join(tmpHome, '.claude', n), 'utf8'), expected);
  }
});
