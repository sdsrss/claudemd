import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pruneCache } from '../../scripts/lib/cache-prune.js';

let sandbox, versionsDir;

function mkVersion(name) {
  const dir = path.join(versionsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker'), name);
  return dir;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-prune-'));
  versionsDir = path.join(sandbox, 'cache/claudemd/claudemd');
  fs.mkdirSync(versionsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('keeps top 3 newest by semver, removes older', () => {
  for (const v of ['0.1.1', '0.1.4', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  const current = path.join(versionsDir, '0.2.1');
  const r = pruneCache(current, { keep: 3 });
  assert.deepEqual(r.kept.sort(), ['0.1.6', '0.1.9', '0.2.1']);
  assert.equal(r.removed.length, 2);
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')));
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.4')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.6')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.2.1')));
});

test('always keeps current version even if older than top-3 newest', () => {
  // User rolled back: current is 0.1.6 but cache still has 0.2.1 + 0.1.9 + 0.1.7
  for (const v of ['0.1.1', '0.1.6', '0.1.7', '0.1.9', '0.2.1']) mkVersion(v);
  const current = path.join(versionsDir, '0.1.6');
  const r = pruneCache(current, { keep: 3 });
  assert.ok(r.kept.includes('0.1.6'), 'current version must survive prune');
  assert.equal(r.kept.length, 3);
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.6')));
});

test('fewer than keep → keep all, no removal', () => {
  for (const v of ['0.1.6', '0.2.1']) mkVersion(v);
  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });
  assert.equal(r.removed.length, 0);
  assert.equal(r.kept.length, 2);
});

test('non-semver sibling dirs are ignored, not deleted', () => {
  mkVersion('0.1.9');
  mkVersion('0.2.0');
  mkVersion('0.2.1');
  mkVersion('0.1.6');
  fs.mkdirSync(path.join(versionsDir, 'scratch-notes'), { recursive: true });
  fs.writeFileSync(path.join(versionsDir, 'scratch-notes/note.md'), 'x');
  const r = pruneCache(path.join(versionsDir, '0.2.1'), { keep: 3 });
  assert.ok(fs.existsSync(path.join(versionsDir, 'scratch-notes')),
    'non-semver dirs must be left alone');
  assert.ok(!r.kept.includes('scratch-notes'));
  assert.ok(!r.removed.some(p => p.endsWith('scratch-notes')));
});

test('non-semver pluginRoot basename skips pruning (dev-mode safety)', () => {
  // Running install.js from source repo: pluginRoot basename is 'claudemd'
  // (not X.Y.Z) — must NOT scan siblings of the repo dir.
  for (const v of ['0.1.6', '0.2.1']) mkVersion(v);
  const devRoot = path.join(sandbox, 'dev-checkout');
  fs.mkdirSync(devRoot, { recursive: true });
  const r = pruneCache(devRoot, { keep: 3 });
  assert.equal(r.skipped, 'non-semver-plugin-root');
  assert.equal(r.removed.length, 0);
  // All siblings untouched
  assert.ok(fs.existsSync(path.join(versionsDir, '0.1.6')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.2.1')));
});

test('missing versions parent dir → no-op', () => {
  const ghost = path.join(sandbox, 'does/not/exist/0.2.1');
  const r = pruneCache(ghost, { keep: 3 });
  assert.equal(r.skipped, 'missing-versions-dir');
  assert.equal(r.removed.length, 0);
});

test('semver sort handles multi-digit parts correctly (0.10.x > 0.9.x)', () => {
  for (const v of ['0.9.5', '0.10.0', '0.10.1', '0.11.0']) mkVersion(v);
  const r = pruneCache(path.join(versionsDir, '0.11.0'), { keep: 3 });
  assert.deepEqual(r.kept.sort(), ['0.10.0', '0.10.1', '0.11.0']);
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.9.5')));
  assert.ok(fs.existsSync(path.join(versionsDir, '0.10.0')));
});
