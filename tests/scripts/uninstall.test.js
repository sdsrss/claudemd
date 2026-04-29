import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install } from '../../scripts/install.js';
import { uninstall } from '../../scripts/uninstall.js';

let tmpHome, savedHome, pluginRoot;

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-uninst-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-pkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE.md'), 'plugin\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-extended.md'), 'plugin-ext\n');
  fs.writeFileSync(path.join(pluginRoot, 'spec/CLAUDE-changelog.md'), 'plugin-cl\n');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  for (const n of ['banned-vocab-check','ship-baseline-check','residue-audit','memory-read-check','sandbox-disposal-check']) {
    fs.writeFileSync(path.join(pluginRoot, 'hooks', `${n}.sh`), '#!/bin/bash\nexit 0\n');
  }
  // Co-existing foreign hook
  fs.writeFileSync(path.join(tmpHome, '.claude/settings.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node /foreign/hook.mjs', timeout: 5 }] }] }
  }));
  await install({ pluginRoot });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('keep option: spec files remain, plugin entries removed', async () => {
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.specAction, 'keep');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')));
  const s = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf8'));
  assert.equal(s.hooks.PreToolUse?.length || 0, 0);
  assert.equal(s.hooks.PostToolUse[0].hooks[0].command, 'node /foreign/hook.mjs');
});

test('delete option: requires confirmHardAuth=true, then removes spec', async () => {
  const refused = await uninstall({ specAction: 'delete', confirmHardAuth: false });
  assert.equal(refused.specAction, 'abort');
  assert.ok(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), 'refused delete preserves files');

  const approved = await uninstall({ specAction: 'delete', confirmHardAuth: true });
  assert.equal(approved.specAction, 'delete');
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/CLAUDE.md')), false);
});

test('restore option: finds newest backup and copies back', async () => {
  // Simulate a prior spec existed before install by creating a backup dir manually
  const bkDir = path.join(tmpHome, '.claude/backup-20260101T000000Z');
  fs.mkdirSync(bkDir);
  fs.writeFileSync(path.join(bkDir, 'CLAUDE.md'), 'prior-version\n');

  const res = await uninstall({ specAction: 'restore' });
  assert.equal(res.specAction, 'restore');
  assert.equal(fs.readFileSync(path.join(tmpHome, '.claude/CLAUDE.md'), 'utf8'), 'prior-version\n');
});

test('manifest consumed for precise removal', async () => {
  const manifest = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  assert.ok(fs.existsSync(manifest));
  await uninstall({ specAction: 'keep', purge: true });
  assert.equal(fs.existsSync(path.join(tmpHome, '.claude/.claudemd-state')), false);
});

test('idempotent: running uninstall twice is safe', async () => {
  await uninstall({ specAction: 'keep' });
  const second = await uninstall({ specAction: 'keep' });
  assert.equal(second.warning, 'already-uninstalled');
});

test('aborted delete (no confirm) does not mutate settings.json or manifest (F14)', async () => {
  // Regression: the unconfirmed-delete abort was returned AFTER settings.json
  // had already been cleaned of plugin hooks. Users saw "abort", thought
  // nothing changed, but hooks were silently removed.
  const settingsPath = path.join(tmpHome, '.claude/settings.json');
  const manifestPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  const before = fs.readFileSync(settingsPath, 'utf8');
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');

  const r = await uninstall({ specAction: 'delete', confirmHardAuth: false });
  assert.equal(r.specAction, 'abort');
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before,
    'settings.json must be untouched after aborted delete');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBefore,
    'manifest must be untouched after aborted delete');
});

test('aborted restore (no backups) does not mutate settings.json or manifest (F14)', async () => {
  const settingsPath = path.join(tmpHome, '.claude/settings.json');
  const manifestPath = path.join(tmpHome, '.claude/.claudemd-manifest.json');
  const before = fs.readFileSync(settingsPath, 'utf8');
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');
  // No backup-* dirs were created during install (fresh HOME had no prior
  // spec files; beforeEach already ensured that).
  const r = await uninstall({ specAction: 'restore' });
  assert.equal(r.specAction, 'abort');
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), before);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBefore);
});

test('purge: deletes only claudemd.jsonl, preserves other tools\' logs (H1)', async () => {
  // Regression: ~/.claude/logs is shared with other plugins (claude-mem-lite etc).
  // Purge used to rm -rf the whole directory and nuke neighbor logs.
  const logsDir = path.join(tmpHome, '.claude/logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const claudemdLog = path.join(logsDir, 'claudemd.jsonl');
  const foreignLog = path.join(logsDir, 'claude-mem-lite.jsonl');
  const foreignSubdir = path.join(logsDir, 'some-tool');
  fs.writeFileSync(claudemdLog, '{"own":true}\n');
  fs.writeFileSync(foreignLog, '{"foreign":true}\n');
  fs.mkdirSync(foreignSubdir);
  fs.writeFileSync(path.join(foreignSubdir, 'x.log'), 'keep-me\n');

  await uninstall({ specAction: 'keep', purge: true });

  assert.equal(fs.existsSync(claudemdLog), false, 'own jsonl must be removed');
  assert.ok(fs.existsSync(foreignLog), 'foreign plugin log must be preserved');
  assert.ok(fs.existsSync(foreignSubdir), 'foreign subdir must be preserved');
  assert.ok(fs.existsSync(logsDir), 'logs dir must remain (other tools may still use it)');
});

test('purge: removes logs dir when empty after claudemd.jsonl deletion (H1)', async () => {
  const logsDir = path.join(tmpHome, '.claude/logs');
  // install() in beforeEach already created logsDir + empty claudemd.jsonl.
  // Nothing else lives there, so purge should clean up the now-empty dir.
  await uninstall({ specAction: 'keep', purge: true });
  assert.equal(fs.existsSync(logsDir), false,
    'empty logs dir after own-log removal should be cleaned up');
});

test('D6: manifest missing but settings.json has legacy ${CLAUDE_PLUGIN_ROOT} entry → eviction still runs', async () => {
  // Real scenario: user installed ≤0.1.4 (which wrote ${CLAUDE_PLUGIN_ROOT}-
  // literal entries into settings.json), then hand-deleted manifest. Pre-fix
  // uninstall.js early-returned `'already-uninstalled'` without clearing
  // settings.json — orphan hook entry left forever.
  fs.unlinkSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'));
  const settingsP = path.join(tmpHome, '.claude/settings.json');
  const s = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  s.hooks ||= {};
  s.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [
    { type: 'command', command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/banned-vocab-check.sh"', timeout: 3 },
  ] }];
  fs.writeFileSync(settingsP, JSON.stringify(s));

  const res = await uninstall({ specAction: 'keep' });

  assert.equal(res.warning, 'already-uninstalled');
  assert.equal(res.settingsRemoved, 1, 'legacy ${CLAUDE_PLUGIN_ROOT} entry must be evicted even with manifest missing');

  const after = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  const all = [];
  for (const event of Object.keys(after.hooks || {})) {
    for (const block of after.hooks[event]) for (const h of block.hooks || []) all.push(h.command);
  }
  assert.equal(all.some(c => c.includes('banned-vocab-check.sh')), false,
    'no claudemd hook command should remain after eviction');
  assert.ok(all.some(c => c.includes('node /foreign/hook.mjs')),
    'foreign hook from beforeEach must survive');
});

test('D6: predicate is path-anchored — does NOT evict same-basename hook from another plugin', async () => {
  // Pre-0.5.4 substring predicate `c.includes('/hooks/banned-vocab-check.sh')`
  // would have matched a hypothetical other-plugin hook with the same
  // basename, accidentally evicting it. v0.5.4 path-anchors to known claudemd
  // residue forms only.
  fs.unlinkSync(path.join(tmpHome, '.claude/.claudemd-manifest.json'));
  const settingsP = path.join(tmpHome, '.claude/settings.json');
  const s = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  s.hooks ||= {};
  // Hypothetical other-plugin shipping a same-basename hook. Note: this path
  // contains `/plugins/cache/` but NOT `/plugins/cache/claudemd/`, so the
  // path-anchored predicate must reject it.
  s.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [
    { type: 'command',
      command: 'bash "/home/x/.claude/plugins/cache/some-other-plugin/0.1.0/hooks/banned-vocab-check.sh"',
      timeout: 3 },
  ] }];
  fs.writeFileSync(settingsP, JSON.stringify(s));

  const res = await uninstall({ specAction: 'keep' });

  assert.equal(res.warning, 'already-uninstalled');
  assert.equal(res.settingsRemoved, 0, 'must not evict other-plugin hook of same basename');

  const after = JSON.parse(fs.readFileSync(settingsP, 'utf8'));
  const all = [];
  for (const event of Object.keys(after.hooks || {})) {
    for (const block of after.hooks[event]) for (const h of block.hooks || []) all.push(h.command);
  }
  assert.ok(all.some(c => c.includes('plugins/cache/some-other-plugin/0.1.0/hooks/banned-vocab-check.sh')),
    'other-plugin hook must survive uninstall');
});

test('D6: settingsRemoved field present on normal keep path (manifest exists)', async () => {
  // Sanity check: uninstall return value carries settingsRemoved (number) on
  // the success path, not just on the manifest-missing path. The exact count
  // depends on what install wrote — this fixture omits hooks/hooks.json so
  // install records 0 manifest entries. Numeric coverage of the field is what
  // matters; the eviction count itself is exercised by the two D6 cases above.
  const res = await uninstall({ specAction: 'keep' });
  assert.equal(res.specAction, 'keep');
  assert.equal(typeof res.settingsRemoved, 'number',
    'settingsRemoved must be a number on normal keep path');
});
