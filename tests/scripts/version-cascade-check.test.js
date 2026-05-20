// version-cascade-check tests. Pattern follows spec-coherence-audit.test.js:
// real-repo smoke (catches drift on every `npm test`) + synthetic fixtures
// for failure paths the real repo can't reproduce while green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runVersionCascadeCheck } from '../../scripts/version-cascade-check.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/version-cascade-check.js');

// --- Real-repo smoke -------------------------------------------------------

test('real repo: README + plugin.json + marketplace.json all match spec_version minor', () => {
  const r = runVersionCascadeCheck({ root: REPO_ROOT });
  assert.equal(r.ok, true,
    `cascade drift: ${JSON.stringify(r.offenders, null, 2)}`);
  assert.equal(r.filesChecked.length, 3);
  assert.match(r.expectedMinor, /^v\d+\.\d+$/);
});

// --- Synthetic fixtures: failure paths ------------------------------------

function makeFixture(tmpDir, { specVersion, readme, pluginJson, marketplaceJson }) {
  fs.mkdirSync(path.join(tmpDir, 'spec'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, 'spec/hard-rules.json'),
    JSON.stringify({ spec_version: specVersion }, null, 2)
  );
  fs.writeFileSync(path.join(tmpDir, 'README.md'), readme);
  fs.writeFileSync(path.join(tmpDir, '.claude-plugin/plugin.json'), pluginJson);
  fs.writeFileSync(path.join(tmpDir, '.claude-plugin/marketplace.json'), marketplaceJson);
  return tmpDir;
}

test('synthetic: stale README minor → offender reported with file:line + context', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fixture-'));
  try {
    makeFixture(tmp, {
      specVersion: 'v6.13.0',
      readme: 'line 1\nAI-CODING-SPEC v6.11 HARD rules\nline 3\n',
      pluginJson: '{"description":"plugin v6.13 enforcement"}',
      marketplaceJson: '{"metadata":{"description":"marketplace v6.13"}}',
    });
    const r = runVersionCascadeCheck({ root: tmp });
    assert.equal(r.ok, false);
    assert.equal(r.offenders.length, 1);
    assert.equal(r.offenders[0].file, 'README.md');
    assert.equal(r.offenders[0].line, 2);
    assert.equal(r.offenders[0].found, 'v6.11');
    assert.equal(r.offenders[0].expected, 'v6.13');
    assert.match(r.offenders[0].context, /v6\.11/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: patch-only mismatch (v6.13.0 vs v6.13.1) does NOT trip — minor match is enough', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fixture-'));
  try {
    makeFixture(tmp, {
      specVersion: 'v6.13.0',
      readme: 'Spec v6.13.1 docs\n',
      pluginJson: '{"description":"v6.13 plugin"}',
      marketplaceJson: '{"description":"v6.13 market"}',
    });
    const r = runVersionCascadeCheck({ root: tmp });
    assert.equal(r.ok, true,
      `unexpected offenders: ${JSON.stringify(r.offenders)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: multiple stale mentions reported in scan order', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-fixture-'));
  try {
    makeFixture(tmp, {
      specVersion: 'v6.13.0',
      readme: 'A v6.11 line\nAnother v6.10.5 line\n',
      pluginJson: '{"description":"v6.13 ok"}',
      marketplaceJson: '{"d":"old v6.12 stale here too"}',
    });
    const r = runVersionCascadeCheck({ root: tmp });
    assert.equal(r.ok, false);
    assert.equal(r.offenders.length, 3);
    const files = r.offenders.map(o => o.file);
    assert.deepEqual(files, ['README.md', 'README.md', '.claude-plugin/marketplace.json']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- CLI exit codes --------------------------------------------------------

test('CLI: clean repo → exit 0 + stdout ok line', () => {
  const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /ok/);
});

test('CLI: --json → exit 0 + parseable JSON on clean repo', () => {
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  assert.match(parsed.expectedMinor, /^v\d+\.\d+$/);
  assert.equal(parsed.filesChecked.length, 3);
});

test('CLI: --help → exit 0 + usage on stdout', () => {
  const r = spawnSync('node', [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('CLI: unknown flag → exit 2 + argv-shape error', () => {
  const r = spawnSync('node', [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown/);
});
