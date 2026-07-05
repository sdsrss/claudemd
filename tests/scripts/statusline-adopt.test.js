import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detect, adopt, remove } from '../../scripts/lib/statusline.js';

let tmpHome, savedHome, pluginRoot;
const settingsFile = () => path.join(tmpHome, '.claude/settings.json');
const destFile = () => path.join(tmpHome, '.claude/claudemd-statusline.sh');
const prevFile = () => path.join(tmpHome, '.claude/.claudemd-state/statusline-prev.json');
const readS = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
const writeS = (o) => fs.writeFileSync(settingsFile(), JSON.stringify(o, null, 2));
const CMD = 'bash "$HOME/.claude/claudemd-statusline.sh"';

beforeEach(() => {
  delete process.env.CLAUDEMD_NO_STATUSLINE;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sl-'));
  pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-slpkg-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'scripts/statusline.sh'), '#!/usr/bin/env bash\necho claudemd-sl\n');
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(pluginRoot, { recursive: true, force: true });
});

test('absent → set (settings written, DEST copied+exec)', () => {
  assert.equal(detect().verdict, 'absent');
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'set');
  assert.equal(readS().statusLine.command, CMD);
  assert.ok(fs.existsSync(destFile()));
  assert.ok((fs.statSync(destFile()).mode & 0o111) !== 0, 'DEST is executable');
  assert.equal(detect().verdict, 'claudemd');
});

test('claudemd → refreshed (settings unchanged, DEST re-copied)', () => {
  adopt({ pluginRoot });
  const before = fs.readFileSync(settingsFile(), 'utf8');
  fs.rmSync(destFile());
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'refreshed');
  assert.equal(fs.readFileSync(settingsFile(), 'utf8'), before);
  assert.ok(fs.existsSync(destFile()));
});

test('foreign + emptyOnly → skipped, nothing touched', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = adopt({ pluginRoot, emptyOnly: true });
  assert.equal(r.action, 'skipped-foreign');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
  assert.ok(!fs.existsSync(destFile()));
});

test('foreign, no force → foreign report, untouched', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'foreign');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
  assert.ok(!fs.existsSync(destFile()));
});

test('foreign + force → replaced, prior saved', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = adopt({ pluginRoot, force: true });
  assert.equal(r.action, 'replaced');
  assert.ok(r.settingsBackup && fs.existsSync(r.settingsBackup), 'settings.json backed up before force-replace');
  assert.equal(readS().statusLine.command, CMD);
  assert.equal(JSON.parse(fs.readFileSync(prevFile(), 'utf8')).command, 'node /other/x.js');
});

test('remove after set → key cleared, DEST gone', () => {
  adopt({ pluginRoot });
  const r = remove();
  assert.equal(r.action, 'removed');
  assert.equal(readS().statusLine, undefined);
  assert.ok(!fs.existsSync(destFile()));
});

test('remove after force → prior restored, DEST gone', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  adopt({ pluginRoot, force: true });
  const r = remove();
  assert.equal(r.action, 'restored');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
  assert.ok(!fs.existsSync(destFile()));
  assert.ok(!fs.existsSync(prevFile()));
});

test('remove when foreign → not-ours, untouched', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  const r = remove();
  assert.equal(r.action, 'not-ours');
  assert.equal(readS().statusLine.command, 'node /other/x.js');
});

test('dry-run → no writes', () => {
  const r = adopt({ pluginRoot, dryRun: true });
  assert.equal(r.action, 'dry-run');
  assert.ok(!fs.existsSync(destFile()));
  const sPath = settingsFile();
  assert.ok(!fs.existsSync(sPath) || readS().statusLine === undefined);
});

test('adopt throws without pluginRoot', () => {
  assert.throws(() => adopt({}), /pluginRoot/);
});
