import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { sha256File, compareSpecs } from '../../scripts/lib/spec-hash.js';

let tmpHome, tmpPluginRoot, savedHome;

function writeShipped(name, content) {
  const dir = path.join(tmpPluginRoot, 'spec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}

function writeInstalled(name, content) {
  fs.writeFileSync(path.join(tmpHome, '.claude', name), content);
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sh-h-'));
  tmpPluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-sh-p-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpPluginRoot, { recursive: true, force: true });
});

test('sha256File returns hex digest of file contents', () => {
  const f = path.join(tmpHome, 'sample.txt');
  fs.writeFileSync(f, 'abc');
  // Locked to the published SHA-256 of "abc" — if the algorithm impl
  // ever drifts, every spec-hash check downstream silently lies. Pin it.
  assert.equal(sha256File(f),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256File returns null for missing file', () => {
  assert.equal(sha256File(path.join(tmpHome, 'nope.txt')), null);
});

test('sha256File matches Node crypto implementation byte-for-byte', () => {
  // Property test: hand-constructed digest must equal sha256File output.
  // Catches any future "we read as text and trim" drift.
  const f = path.join(tmpHome, 'binary');
  const data = Buffer.from([0x00, 0xff, 0x10, 0x42, 0x7e]);
  fs.writeFileSync(f, data);
  const expected = crypto.createHash('sha256').update(data).digest('hex');
  assert.equal(sha256File(f), expected);
});

test('compareSpecs reports match when installed equals shipped', () => {
  const body = '# AI-CODING-SPEC v6.11.3 — Core\nbody.\n';
  writeShipped('CLAUDE.md', body);
  writeShipped('CLAUDE-extended.md', 'ext\n');
  writeShipped('CLAUDE-changelog.md', 'log\n');
  writeInstalled('CLAUDE.md', body);
  writeInstalled('CLAUDE-extended.md', 'ext\n');
  writeInstalled('CLAUDE-changelog.md', 'log\n');

  const r = compareSpecs(tmpPluginRoot);
  assert.equal(r.length, 3);
  for (const row of r) {
    assert.equal(row.match, true, `${row.name} should match`);
    assert.equal(row.missing, false);
    assert.equal(row.shipped, row.installed);
  }
});

test('compareSpecs reports drift when installed differs from shipped', () => {
  writeShipped('CLAUDE.md', 'shipped\n');
  writeShipped('CLAUDE-extended.md', 'ext\n');
  writeShipped('CLAUDE-changelog.md', 'log\n');
  writeInstalled('CLAUDE.md', 'shipped\n');
  writeInstalled('CLAUDE-extended.md', 'EDITED locally\n');
  writeInstalled('CLAUDE-changelog.md', 'log\n');

  const r = compareSpecs(tmpPluginRoot);
  const ext = r.find(x => x.name === 'CLAUDE-extended.md');
  assert.equal(ext.match, false, 'edited spec must report drift');
  assert.notEqual(ext.shipped, ext.installed);
  assert.equal(ext.missing, false);

  const main = r.find(x => x.name === 'CLAUDE.md');
  assert.equal(main.match, true, 'unedited spec must still match');
});

test('compareSpecs reports missing when installed file absent', () => {
  writeShipped('CLAUDE.md', 'shipped\n');
  // CLAUDE.md NOT written to home — fresh-install state.

  const r = compareSpecs(tmpPluginRoot);
  const main = r.find(x => x.name === 'CLAUDE.md');
  assert.equal(main.installed, null);
  assert.equal(main.match, false);
  assert.equal(main.missing, true);
});

test('compareSpecs reports missing when shipped file absent', () => {
  writeInstalled('CLAUDE.md', 'installed\n');
  // shipped NOT written — broken plugin distribution.

  const r = compareSpecs(tmpPluginRoot);
  const main = r.find(x => x.name === 'CLAUDE.md');
  assert.equal(main.shipped, null);
  assert.equal(main.match, false);
  assert.equal(main.missing, true);
});

test('compareSpecs covers all three spec files in fixed order', () => {
  // The order matters for human-scannable doctor output. Lock it.
  writeShipped('CLAUDE.md', 'a');
  writeShipped('CLAUDE-extended.md', 'b');
  writeShipped('CLAUDE-changelog.md', 'c');
  const r = compareSpecs(tmpPluginRoot);
  assert.deepEqual(r.map(x => x.name),
    ['CLAUDE.md', 'CLAUDE-extended.md', 'CLAUDE-changelog.md']);
});
