// install-cli.test.js — what `node scripts/install.js` prints, run as the user
// runs it, against the shared sandbox home. install.test.js drives install()
// in-process with a home of its own; this file spawns the CLI, because what is
// under test here is its output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useHomeSandbox } from '../lib/home-sandbox.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const box = useHomeSandbox('inst-cli');
// CLAUDE_PLUGIN_ROOT pinned to this checkout: a session running the suite may
// export the installed plugin's root, which would install that one instead.
const runInstall = () =>
  spawnSync(process.execPath, [path.join(REPO, 'scripts/install.js')], {
    encoding: 'utf8',
    env: box.env({ CLAUDE_PLUGIN_ROOT: REPO, CLAUDEMD_NO_STATUSLINE: '1' }),
  });

// Mode bits do not stop root, so these cases would install successfully.
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// 160b, reproduced 2026-10-20: with ~/.claude mode 555 install printed only
// Node's `install failed: EACCES: permission denied, mkdir
// '…/.claude/.claudemd-state'` — the path it tried to create, not the
// directory that refused it, and nothing about what to do. Three rows, one per
// place the first refused write can land: the state dir's mkdir (the reported
// shape), the spec copy into ~/.claude once the state dir exists, and the lock
// file inside a read-only state dir.
for (const [name, lockedDir, prepare] of [
  [
    '~/.claude read-only, state dir absent',
    () => box.claude(),
    () => fs.rmSync(box.stateDir, { recursive: true }),
  ],
  ['~/.claude read-only, state dir present', () => box.claude(), () => {}],
  ['state dir read-only', () => box.stateDir, () => {}],
]) {
  test(
    `160b: ${name} — the failure names the directory and how to make it writable`,
    { skip: asRoot },
    () => {
      prepare();
      const dir = lockedDir();
      fs.chmodSync(dir, 0o555);
      let r;
      try {
        r = runInstall();
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      assert.equal(r.status, 1, r.stderr);
      // One line, with the prefix hook_spawn_install keeps for the
      // bootstrap-failed banner (`sed -n 's/^install failed: //p' | tail -n 1`).
      const failed = r.stderr.split('\n').filter(l => l.startsWith('install failed: '));
      assert.equal(failed.length, 1, r.stderr);
      assert.ok(failed[0].includes(`${dir} is not writable by this user`), failed[0]);
      assert.ok(failed[0].includes(`chmod u+rwx '${dir}'`), failed[0]);
      // Node's own text stays, as the cause.
      assert.match(failed[0], /EACCES: permission denied/);
    }
  );
}

test(
  '160b control: a permission error whose target directory is writable keeps Node’s text',
  { skip: asRoot },
  () => {
    // An unreadable shipped spec file fails the copy with EACCES too, but
    // ~/.claude is writable: calling it "not writable" would send the user to
    // chmod the wrong directory.
    const pkg = box.dir('pkg');
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: 'claudemd', version: '9.9.9-test' })
    );
    fs.cpSync(path.join(REPO, 'spec'), path.join(pkg, 'spec'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'hooks'));
    fs.copyFileSync(path.join(REPO, 'hooks/hooks.json'), path.join(pkg, 'hooks/hooks.json'));
    const unreadable = path.join(pkg, 'spec/CLAUDE.md');
    fs.chmodSync(unreadable, 0o000);
    let r;
    try {
      r = spawnSync(process.execPath, [path.join(REPO, 'scripts/install.js')], {
        encoding: 'utf8',
        env: box.env({ CLAUDE_PLUGIN_ROOT: pkg, CLAUDEMD_NO_STATUSLINE: '1' }),
      });
    } finally {
      fs.chmodSync(unreadable, 0o644);
    }
    assert.equal(r.status, 1, r.stderr);
    const failed = r.stderr.split('\n').filter(l => l.startsWith('install failed: '));
    assert.equal(failed.length, 1, r.stderr);
    assert.ok(
      failed[0].startsWith(`install failed: EACCES: permission denied, copyfile '${unreadable}'`),
      failed[0]
    );
    assert.ok(!failed[0].includes('is not writable'), failed[0]);
  }
);

// 163, reproduced 2026-10-20: install once, edit ~/.claude/CLAUDE.md, install
// again — the output said `"spec":"overwrite-spec","backupDir":null` with
// nothing on stderr, while a `spec-backup-<stamp>/` holding the edited file had
// been created. Its path lived only in a local. `backupDir` keeps its meaning
// (the PERSONAL backup restore reads, null on this branch); the spec copy gets a
// field of its own.
test('163: overwriting an edited installed spec reports where the previous files were copied', () => {
  const json = r => {
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const fresh = json(runInstall());
  assert.equal(fresh.spec, 'fresh');

  const home = box.claude('CLAUDE.md');
  const edited = `${fs.readFileSync(home, 'utf8')}\n## My notes\nAlways prefer tabs.\n`;
  fs.writeFileSync(home, edited);
  const r = runInstall();
  const out = json(r);
  assert.equal(out.spec, 'overwrite-spec');
  assert.equal(out.backupDir, null, 'backupDir stays the personal backup, which this branch never makes');
  assert.equal(typeof out.specBackupDir, 'string', JSON.stringify(out));
  assert.equal(path.dirname(out.specBackupDir), box.claude());
  assert.match(path.basename(out.specBackupDir), /^spec-backup-/);
  assert.equal(fs.readFileSync(path.join(out.specBackupDir, 'CLAUDE.md'), 'utf8'), edited);
  const named = r.stderr.split('\n').filter(l => l.includes(out.specBackupDir));
  assert.equal(named.length, 1, r.stderr);
  assert.match(named[0], /^\[claudemd\] /);

  // Controls: a fresh install and a re-install over unchanged files copy
  // nothing and say nothing; the field is there, and null.
  assert.equal(fresh.specBackupDir, null, JSON.stringify(fresh));
  const again = runInstall();
  assert.equal(json(again).specBackupDir, null);
  assert.doesNotMatch(again.stderr, /spec-backup-/);
});

// 0.115.0 pre-tag review M2: the chmod advice cannot work on a directory that
// belongs to another user (a ~/.claude created by `sudo claude` is root's), and
// a chown command is not offered either: the directory named is the nearest
// existing ancestor, which can be a system directory. `/` stands in for one.
const rootOwned = (() => {
  try {
    return fs.statSync('/').uid !== process.getuid();
  } catch {
    return false;
  }
})();
test(
  '160b: a directory owned by another user — the failure says chmod by this user cannot fix it, and offers no command',
  { skip: asRoot || !rootOwned },
  () => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts/install.js')], {
      encoding: 'utf8',
      env: box.env({ HOME: '/', CLAUDE_PLUGIN_ROOT: REPO, CLAUDEMD_NO_STATUSLINE: '1' }),
    });
    assert.equal(r.status, 1, r.stderr);
    const failed = r.stderr.split('\n').filter(l => l.startsWith('install failed: '));
    assert.equal(failed.length, 1, r.stderr);
    assert.ok(failed[0].includes('/ is not writable by this user and belongs to another user'), failed[0]);
    assert.doesNotMatch(failed[0], /chmod u\+rwx|chown/);
    assert.match(failed[0], /EACCES: permission denied/);
  }
);

// 0.115.0 pre-tag review L7: the copy loop skips a file it cannot read, and the
// stderr line still said every previous file was in the backup. It names the
// ones it could not copy.
test('163: a previous spec file the backup could not copy is named, not claimed', { skip: asRoot }, () => {
  assert.equal(runInstall().status, 0);
  const home = box.claude('CLAUDE.md');
  fs.writeFileSync(home, `${fs.readFileSync(home, 'utf8')}\n## Mine\n`);
  const ext = box.claude('CLAUDE-extended.md');
  fs.appendFileSync(ext, '\n## Also mine\n');
  fs.chmodSync(ext, 0o000);
  let r;
  try {
    r = runInstall();
  } finally {
    if (fs.existsSync(ext)) fs.chmodSync(ext, 0o644);
  }
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(fs.existsSync(path.join(out.specBackupDir, 'CLAUDE-extended.md')), false);
  const line = r.stderr.split('\n').find(l => l.includes(out.specBackupDir));
  assert.ok(line, r.stderr);
  assert.match(line, /except CLAUDE-extended\.md \(EACCES\), which could not be copied/);
});
