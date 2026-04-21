import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install } from '../../scripts/install.js';

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-inst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });

  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), '# Core v6.9.2\nVersion: 6.9.2\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), '# Extended v6.9.2\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), '# Changelog\n');

  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  for (const name of ['banned-vocab-check', 'ship-baseline-check', 'residue-audit',
                      'memory-read-check', 'sandbox-disposal-check']) {
    fs.writeFileSync(path.join(pluginRoot, 'hooks', `${name}.sh`), '#!/bin/bash\nexit 0\n');
  }
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('fresh HOME: spec copied, no backup', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.spec, 'fresh');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# Core v6.9.2\nVersion: 6.9.2\n');
  const items = fs.readdirSync(path.join(tmpHome, '.claude'));
  assert.ok(!items.some(n => n.startsWith('backup-')));
});

test('existing spec: backup created, new spec in place', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'OLD\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/CLAUDE-extended.md'), 'OLD-EXT\n');
  const res = await install({ pluginRoot });
  assert.equal(res.spec, 'backup-and-overwrite');
  assert.ok(res.backupDir && fs.existsSync(res.backupDir));
  assert.equal(fs.readFileSync(path.join(res.backupDir, 'CLAUDE.md'), 'utf8'), 'OLD\n');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), '# Core v6.9.2\nVersion: 6.9.2\n');
});

test('settings.json gets 5 hook entries on fresh install', async () => {
  await install({ pluginRoot });
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  const bashHooks = s.hooks.PreToolUse.find(m => m.matcher === 'Bash').hooks;
  assert.equal(bashHooks.length, 3);
  const stopHooks = s.hooks.Stop.find(m => m.matcher === '*').hooks;
  assert.equal(stopHooks.length, 2);
});

test('idempotent: running install 3x leaves settings.json unchanged', async () => {
  await install({ pluginRoot });
  const after1 = fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8');
  await install({ pluginRoot });
  await install({ pluginRoot });
  const after3 = fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8');
  assert.equal(after1, after3);
});

test('installed.json manifest records entries', async () => {
  await install({ pluginRoot });
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/.claudemd-state/installed.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.entries.length, 5);
  assert.ok(manifest.entries.every(e => typeof e.sha256 === 'string' && e.sha256.length === 64));
});

test('logs directory and empty jsonl created', async () => {
  await install({ pluginRoot });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  assert.ok(fs.existsSync(log));
  assert.equal(fs.readFileSync(log, 'utf8'), '');
});

test('pre-merge settings.json backup created when settings.json existed', async () => {
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), '{"hooks":{}}');
  const res = await install({ pluginRoot });
  assert.ok(res.settingsBackup, 'settingsBackup path should be populated');
  assert.ok(fs.existsSync(res.settingsBackup), 'backup file should exist on disk');
  assert.match(path.basename(res.settingsBackup), /^settings\.json\.claudemd-backup-\d{8}T\d{6}Z$/);
  assert.equal(fs.readFileSync(res.settingsBackup, 'utf8'), '{"hooks":{}}');
});

test('fresh install (no settings.json): settingsBackup is null', async () => {
  const res = await install({ pluginRoot });
  assert.equal(res.settingsBackup, null);
});
