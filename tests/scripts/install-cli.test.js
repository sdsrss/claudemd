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
