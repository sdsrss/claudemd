import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pruneCache } from '../../scripts/lib/cache-prune.js';

let sandbox, versionsDir, savedHome;

function mkVersion(name) {
  const dir = path.join(versionsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'marker'), name);
  return dir;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-prune-'));
  // HOME redirect, not a bespoke cacheRoot parameter: pruneCache now checks the
  // scan target against pluginCacheDir() (R11-02), which is derived from HOME
  // like every other path in paths.js. The layout below mirrors production
  // exactly — `~/.claude/plugins/cache/claudemd/claudemd/<version>`, i.e. the
  // versions dir sits ONE level under pluginCacheDir(), not at it.
  savedHome = process.env.HOME;
  process.env.HOME = sandbox;
  versionsDir = path.join(sandbox, '.claude/plugins/cache/claudemd/claudemd');
  fs.mkdirSync(versionsDir, { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
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
  assert.ok(fs.existsSync(path.join(versionsDir, 'scratch-notes')), 'non-semver dirs must be left alone');
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

// --- R11-02 (2026-09-02 audit): the shape guard was basename-only ---
// `SEMVER_RE.test(basename(pluginRoot))` says nothing about WHERE the scan
// happens, so any directory holding semver-named siblings was fair game for
// rm -rf: a `git worktree add ../0.70.0`, a version-named checkout, or a
// CLAUDE_PLUGIN_ROOT pointed at one. paths.js already exported
// pluginCacheDir(); nothing had ever asked it.

test('R11-02.1: semver-named dirs OUTSIDE the plugin cache are never removed', () => {
  const outside = path.join(sandbox, 'checkouts');
  fs.mkdirSync(outside, { recursive: true });
  for (const v of ['0.70.0', '0.71.1', '0.71.2', '0.71.3']) {
    fs.mkdirSync(path.join(outside, v), { recursive: true });
    fs.writeFileSync(path.join(outside, v, 'marker'), v);
  }

  const r = pruneCache(path.join(outside, '0.71.3'), { keep: 3 });

  assert.equal(r.skipped, 'outside-plugin-cache');
  assert.deepEqual(r.removed, []);
  for (const v of ['0.70.0', '0.71.1', '0.71.2', '0.71.3']) {
    assert.ok(fs.existsSync(path.join(outside, v)), `${v} must survive`);
  }
});

test('R11-02.2: the guard resolves symlinks — a link INTO the cache still prunes', () => {
  for (const v of ['0.1.1', '0.1.6', '0.1.9', '0.2.1']) mkVersion(v);
  const link = path.join(sandbox, 'link-to-current');
  fs.symlinkSync(path.join(versionsDir, '0.2.1'), link);

  const r = pruneCache(link, { keep: 3 });

  assert.equal(r.skipped, null, 'realpath lands inside the cache → prune proceeds');
  assert.ok(!fs.existsSync(path.join(versionsDir, '0.1.1')));
});

test('R11-02.3: missing plugin cache dir → skip rather than scan', () => {
  fs.rmSync(path.join(sandbox, '.claude/plugins'), { recursive: true, force: true });
  const ghostVersions = path.join(sandbox, 'elsewhere');
  fs.mkdirSync(path.join(ghostVersions, '0.2.1'), { recursive: true });
  const r = pruneCache(path.join(ghostVersions, '0.2.1'), { keep: 3 });
  assert.equal(r.skipped, 'outside-plugin-cache');
  assert.deepEqual(r.removed, []);
});
