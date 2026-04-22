import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pluginCacheDir, stateDir, logsDir, settingsPath, backupRoot, specHome, manifestPath, legacyManifestPath, readManifest } from '../../scripts/lib/paths.js';
import path from 'node:path';
import os from 'node:os';

test('pluginCacheDir points to ~/.claude/plugins/cache/claudemd', () => {
  assert.equal(pluginCacheDir(), path.join(os.homedir(), '.claude/plugins/cache/claudemd'));
});

test('stateDir points to ~/.claude/.claudemd-state', () => {
  assert.equal(stateDir(), path.join(os.homedir(), '.claude/.claudemd-state'));
});

test('logsDir points to ~/.claude/logs', () => {
  assert.equal(logsDir(), path.join(os.homedir(), '.claude/logs'));
});

test('settingsPath points to ~/.claude/settings.json', () => {
  assert.equal(settingsPath(), path.join(os.homedir(), '.claude/settings.json'));
});

test('backupRoot points to ~/.claude', () => {
  assert.equal(backupRoot(), path.join(os.homedir(), '.claude'));
});

test('specHome returns three CLAUDE*.md paths in ~/.claude', () => {
  const paths = specHome();
  assert.equal(paths.length, 3);
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE-extended.md')));
  assert.ok(paths.includes(path.join(os.homedir(), '.claude/CLAUDE-changelog.md')));
});

test('HOME override respected', () => {
  const saved = process.env.HOME;
  process.env.HOME = '/tmp/fake-home';
  try {
    assert.equal(pluginCacheDir(), '/tmp/fake-home/.claude/plugins/cache/claudemd');
  } finally {
    process.env.HOME = saved;
  }
});

test('manifestPath is outside stateDir — rm -rf stateDir keeps manifest (v0.1.9 P1)', () => {
  // v0.1.9 relocates the install manifest out of the runtime state dir so
  // that clearing residue-audit/sandbox-disposal baselines via
  // `rm -rf ~/.claude/.claudemd-state/` no longer erases install metadata.
  const saved = process.env.HOME;
  process.env.HOME = '/tmp/fake-home';
  try {
    assert.equal(manifestPath(), '/tmp/fake-home/.claude/.claudemd-manifest.json');
    assert.equal(legacyManifestPath(), '/tmp/fake-home/.claude/.claudemd-state/installed.json');
    assert.ok(!manifestPath().startsWith(stateDir()));
  } finally {
    process.env.HOME = saved;
  }
});

test('readManifest migrates legacy ~/.claudemd-state/installed.json to new location (v0.1.9 P1a)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
    const legacy = path.join(tmpHome, '.claude/.claudemd-state/installed.json');
    const newPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
    const payload = { version: 'test', entries: [{ event: 'X' }] };
    fs.writeFileSync(legacy, JSON.stringify(payload));

    const r = readManifest();
    assert.equal(r.exists, true);
    assert.equal(r.migrated, true);
    assert.equal(r.data.version, 'test');
    assert.equal(r.path, newPath);
    assert.ok(fs.existsSync(newPath), 'new manifest must be written');
    assert.ok(!fs.existsSync(legacy), 'legacy manifest must be unlinked');
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('readManifest returns exists=false when neither path present (v0.1.9)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const r = readManifest();
    assert.equal(r.exists, false);
    assert.equal(r.data, null);
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('readManifest prefers new manifest over stale legacy (v0.1.9)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-paths-'));
  const saved = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    fs.mkdirSync(path.join(tmpHome, '.claude/.claudemd-state'), { recursive: true });
    const legacy = path.join(tmpHome, '.claude/.claudemd-state/installed.json');
    const newPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
    fs.writeFileSync(legacy, JSON.stringify({ version: 'stale' }));
    fs.writeFileSync(newPath, JSON.stringify({ version: 'fresh' }));

    const r = readManifest();
    assert.equal(r.data.version, 'fresh');
    assert.equal(r.migrated, false);
  } finally {
    process.env.HOME = saved;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
