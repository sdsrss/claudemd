// lifecycle-help-noop.test.js — Round-5 user-test regression: when a user
// runs `node scripts/install.js --help` (a universally-safe first probe),
// the script must NOT perform the destructive install. Pre-fix, argv was
// silently dropped and `--help` ran the install side-effect — same
// silent-fallback antipattern family as Round-1 status.js / lint-argv.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makeFreshHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-r5-help-'));
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude/settings.json'), '{}');
  return tmp;
}

const run = (rel, args, home) => spawnSync(
  process.execPath,
  [path.join(REPO_ROOT, rel), ...args],
  { encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: home } },
);

test('install.js --help does NOT create the install manifest', () => {
  const home = makeFreshHome();
  try {
    const r = run('scripts/install.js', ['--help'], home);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
    assert.match(r.stdout, /Usage:.*install\.js/);
    // Critical: --help must NOT have written the manifest. Pre-fix it did.
    const manifest = path.join(home, '.claude/.claudemd-manifest.json');
    assert.equal(fs.existsSync(manifest), false,
      `install --help must be a no-op; manifest was written to ${manifest}`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install.js --bogus exits 2 (not silent-success)', () => {
  const home = makeFreshHome();
  try {
    const r = run('scripts/install.js', ['--zzz-bogus'], home);
    assert.equal(r.status, 2, `expected exit 2; stdout=${r.stdout}`);
    assert.match(r.stderr, /Unknown flag|Unknown argument/);
    const manifest = path.join(home, '.claude/.claudemd-manifest.json');
    assert.equal(fs.existsSync(manifest), false,
      'install --bogus must exit before any side effect');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('uninstall.js --help does NOT touch settings.json', () => {
  const home = makeFreshHome();
  const settingsPath = path.join(home, '.claude/settings.json');
  // Seed a sentinel value so we can detect any write.
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { SENTINEL: '1' } }));
  const beforeMtime = fs.statSync(settingsPath).mtimeMs;
  try {
    const r = run('scripts/uninstall.js', ['--help'], home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:.*uninstall\.js/);
    const afterMtime = fs.statSync(settingsPath).mtimeMs;
    assert.equal(beforeMtime, afterMtime, 'settings.json must be untouched');
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(after.env.SENTINEL, '1', 'sentinel must survive uninstall --help');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('update.js --help does NOT modify spec files', () => {
  const home = makeFreshHome();
  const specPath = path.join(home, '.claude/CLAUDE.md');
  fs.writeFileSync(specPath, '# AI-CODING-SPEC v1.0.0 — Core\n\nuser-edits-here\n');
  const before = fs.readFileSync(specPath, 'utf8');
  try {
    const r = run('scripts/update.js', ['--help'], home);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:.*update\.js/);
    const after = fs.readFileSync(specPath, 'utf8');
    assert.equal(before, after, 'spec must be unchanged after update --help');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
