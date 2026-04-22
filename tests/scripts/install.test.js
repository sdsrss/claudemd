import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { install } from '../../scripts/install.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let tmpHome, savedHome, pluginRoot;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-inst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });

  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify({ name: 'claudemd', version: '9.9.9-test' }));

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
  assert.equal(manifest.version, '9.9.9-test');
  assert.equal(manifest.entries.length, 5);
  assert.ok(manifest.entries.every(e => typeof e.sha256 === 'string' && e.sha256.length === 64));
});

test('installed.json version falls back to "unknown" when package.json missing', async () => {
  fs.rmSync(path.join(pluginRoot, 'package.json'));
  await install({ pluginRoot });
  const manifest = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/.claudemd-state/installed.json'), 'utf8'));
  assert.equal(manifest.version, 'unknown');
});

test('CLI smoke: `node scripts/install.js` with no env + no args succeeds via self-derived pluginRoot', () => {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/install.js')], {
    env: { ...process.env, HOME: tmpHome, CLAUDE_PLUGIN_ROOT: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `exit non-zero. stderr: ${result.stderr}`);
  const manifestPath = path.join(tmpHome, '.claude/.claudemd-state/installed.json');
  assert.ok(fs.existsSync(manifestPath), 'installed.json should be written');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.pluginRoot, REPO_ROOT);
  assert.equal(manifest.entries.length, 5);
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

test('migrates hand-installed banned-vocab hook into backup', async () => {
  // Place hand-installed artifacts
  fs.mkdirSync(path.join(tmpHome, '.claude/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh'), '#!/bin/bash\n# v0 hand-install\nexit 0\n');
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/banned-vocab.patterns'), 'foo|reason\n');
  // settings.json pointing to hand-installed hook
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command',
      command: `bash "${path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh')}"`, timeout: 3 }] }] }
  }));

  const res = await install({ pluginRoot });

  // Old files moved into backup-<ISO>/hooks/
  assert.ok(res.backupDir);
  assert.ok(fs.existsSync(path.join(res.backupDir, 'hooks/banned-vocab-check.sh')));
  assert.ok(fs.existsSync(path.join(res.backupDir, 'hooks/banned-vocab.patterns')));
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh')), false);

  // settings.json no longer references hand-installed path
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  const bash = s.hooks.PreToolUse.find(m => m.matcher === 'Bash').hooks;
  assert.equal(bash.some(h => h.command.includes(path.join(tmpHome, '.claude/hooks/banned-vocab-check.sh'))), false);
});

test('leaves non-migrated hand hooks untouched', async () => {
  fs.mkdirSync(path.join(tmpHome, '.claude/hooks'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude/hooks/some-other.sh'), '#!/bin/bash\nexit 0\n');
  await install({ pluginRoot });
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/hooks/some-other.sh')));
});
