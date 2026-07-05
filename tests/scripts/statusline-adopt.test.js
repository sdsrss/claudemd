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

test('present-but-unrecognised slot shapes classify foreign, never absent (I1)', () => {
  // The #1 invariant: the empty-slot install path must never clobber a slot it
  // does not own. Any present statusLine that is not our {command:<MARKER>} —
  // a bare string, {}, empty command, a numeric command, an alternate type —
  // must read as 'foreign' (occupied), not 'absent' (free to take), and the
  // emptyOnly install path must skip it untouched.
  const foreignShapes = [
    'x.sh',                                       // bare string (undocumented shorthand)
    {},                                           // object, no command
    { command: '' },                              // empty command
    { command: 123 },                             // non-string command
    { type: 'static', text: 'hi' },               // alternate type, no command
    { type: 'command', command: 'node /o.js' },   // real foreign
  ];
  for (const shape of foreignShapes) {
    writeS({ statusLine: shape });
    assert.equal(detect().verdict, 'foreign', `shape ${JSON.stringify(shape)} must be foreign`);
    const r = adopt({ pluginRoot, emptyOnly: true });
    assert.equal(r.action, 'skipped-foreign', `install must skip ${JSON.stringify(shape)}`);
    assert.deepEqual(readS().statusLine, shape, 'foreign slot left byte-for-byte intact');
    assert.ok(!fs.existsSync(destFile()), 'no renderer copied when skipping foreign');
  }
});

test('genuinely empty slot shapes still classify absent (I1 boundary)', () => {
  // null / '' / a missing key must stay 'absent' so the empty-slot install
  // still adopts a truly-free slot.
  writeS({ statusLine: null });
  assert.equal(detect().verdict, 'absent');
  writeS({ statusLine: '' });
  assert.equal(detect().verdict, 'absent');
  writeS({ other: 1 });
  assert.equal(detect().verdict, 'absent');
});

test('set over a stale prev file → remove clears, does not resurrect it (M1)', () => {
  // A leftover statusline-prev.json from an earlier --force undone out-of-band
  // must not make a plain empty-slot set → remove restore the stale command.
  fs.mkdirSync(path.dirname(prevFile()), { recursive: true });
  fs.writeFileSync(prevFile(), JSON.stringify({ command: 'node /stale/foreign.js' }));
  const r = adopt({ pluginRoot });               // empty slot → set
  assert.equal(r.action, 'set');
  assert.ok(!fs.existsSync(prevFile()), 'stale prev cleared on absent→set');
  const rm = remove();
  assert.equal(rm.action, 'removed');            // cleared, not 'restored'
  assert.equal(readS().statusLine, undefined);
});

test('detect: a code-graph composite slot → verdict host (not foreign)', () => {
  writeS({ statusLine: { type: 'command', command: 'node "/cg/0.1/scripts/statusline-composite.js"' } });
  const d = detect();
  assert.equal(d.verdict, 'host');
  assert.equal(d.host, 'code-graph');
  assert.equal(d.guestRegistered, false);
});

test('detect: host + claudemd already in registry → guestRegistered true', () => {
  writeS({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } });
  const reg = path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg, JSON.stringify([{ id: 'claudemd', command: 'bash "/x/claudemd-statusline.sh"', needsStdin: true }]));
  assert.equal(detect().guestRegistered, true);
});

test('detect: a plain non-composite command stays foreign', () => {
  writeS({ statusLine: { type: 'command', command: 'node /other/x.js' } });
  assert.equal(detect().verdict, 'foreign');
  assert.equal(detect().host, null);
});

const seedCg = (list) => {
  const reg = path.join(tmpHome, '.cache/code-graph/statusline-registry.json');
  const mir = path.join(tmpHome, '.claude/statusline-providers.json');
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg, JSON.stringify(list));
  fs.writeFileSync(mir, JSON.stringify(list));
  writeS({ statusLine: { type: 'command', command: 'node "/cg/scripts/statusline-composite.js"' } });
};
const cgReg = () => JSON.parse(fs.readFileSync(path.join(tmpHome, '.cache/code-graph/statusline-registry.json'), 'utf8'));

test('adopt: host + emptyOnly → host-detected, nothing written', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const r = adopt({ pluginRoot, emptyOnly: true });
  assert.equal(r.action, 'host-detected');
  assert.equal(r.host, 'code-graph');
  assert.equal(cgReg().some((p) => p.id === 'claudemd'), false);
  assert.ok(!fs.existsSync(destFile()));
});

test('adopt: host (command) → registers claudemd at front, copies renderer', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'registered');
  assert.equal(r.host, 'code-graph');
  assert.deepEqual(cgReg().map((p) => p.id), ['claudemd', 'code-graph']);
  const me = cgReg().find((p) => p.id === 'claudemd');
  assert.equal(me.command, `bash "${destFile()}"`, 'guest command is absolute path');
  assert.equal(me.needsStdin, true);
  assert.ok(fs.existsSync(destFile()));
});

test('adopt: host re-register is idempotent → already-registered', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  adopt({ pluginRoot });
  const r = adopt({ pluginRoot });
  assert.equal(r.action, 'already-registered');
  assert.equal(cgReg().filter((p) => p.id === 'claudemd').length, 1);
});

test('adopt: host + supersede → old provider saved to prev and removed', () => {
  seedCg([
    { id: 'user-ps1', command: 'bash "/home/x/.claude/statusline-command.sh"', needsStdin: true },
    { id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false },
  ]);
  const r = adopt({ pluginRoot, supersede: 'user-ps1' });
  assert.equal(r.action, 'registered');
  assert.equal(r.superseded, 'user-ps1');
  assert.deepEqual(cgReg().map((p) => p.id), ['claudemd', 'code-graph'], 'user-ps1 gone, claudemd at front');
  const prev = JSON.parse(fs.readFileSync(prevFile(), 'utf8'));
  assert.equal(prev.superseded.id, 'user-ps1');
  assert.equal(prev.superseded.command, 'bash "/home/x/.claude/statusline-command.sh"');
});

test('adopt: host + dry-run → no writes', () => {
  seedCg([{ id: 'code-graph', command: 'node "/cg/statusline.js"', needsStdin: false }]);
  const r = adopt({ pluginRoot, dryRun: true });
  assert.equal(r.action, 'dry-run');
  assert.equal(cgReg().some((p) => p.id === 'claudemd'), false);
  assert.ok(!fs.existsSync(destFile()));
});
