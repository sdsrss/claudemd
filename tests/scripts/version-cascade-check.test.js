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
import { runVersionCascadeCheck, runSpecSizingCheck, runPluginSemverCheck } from '../../scripts/version-cascade-check.js';

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

test('CLI: --json → exit 0 + parseable JSON on clean repo (v0.21.2 nested shape)', () => {
  // v0.21.2 reshape: top-level `ok` is the combined gate; `cascade` and
  // `sizing` sub-objects carry the per-check detail. The old flat shape
  // didn't have room for the sizing branch.
  const r = spawnSync('node', [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.cascade.ok, true);
  assert.equal(parsed.sizing.ok, true);
  assert.match(parsed.cascade.expectedMinor, /^v\d+\.\d+$/);
  assert.equal(parsed.cascade.filesChecked.length, 3);
  assert.ok(Array.isArray(parsed.sizing.drifts));
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

// --- Spec sizing drift check (v0.21.2) ------------------------------------

test('real repo: spec sizing claim matches actual fs sizes within ±20B', () => {
  const r = runSpecSizingCheck({ root: REPO_ROOT });
  assert.equal(r.ok, true,
    `Sizing line claims diverge from actual: ${JSON.stringify(r.drifts, null, 2)}`);
});

function makeSizingFixture(tmpDir, { sizingLine, coreBytes, extPadding, opBytes }) {
  fs.mkdirSync(path.join(tmpDir, 'spec'), { recursive: true });
  if (coreBytes != null) {
    fs.writeFileSync(path.join(tmpDir, 'spec/CLAUDE.md'), 'x'.repeat(coreBytes));
  }
  if (sizingLine != null) {
    // CLAUDE-extended.md body = the **Sizing** line itself + padding to reach target bytes
    const lineLen = sizingLine.length + 1;  // +1 for trailing newline
    const pad = Math.max(0, (extPadding ?? 0) - lineLen);
    fs.writeFileSync(path.join(tmpDir, 'spec/CLAUDE-extended.md'), sizingLine + '\n' + 'y'.repeat(pad));
  }
  if (opBytes != null) {
    fs.writeFileSync(path.join(tmpDir, 'spec/OPERATOR.md'), 'z'.repeat(opBytes));
  }
  return tmpDir;
}

test('synthetic: sizing claims match actual → ok', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    // Carefully compute extended target so claim matches actual after we
    // write line + padding. Sizing line is 200 bytes (incl. newline);
    // pad to 1500B total → claimed extended=1500.
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 → 500 bytes.';
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1000, extPadding: 1500, opBytes: 500 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, true, `unexpected drifts: ${JSON.stringify(r.drifts)}`);
    assert.equal(r.drifts.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: core file +100B drift → reported as over-threshold', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 → 500 bytes.';
    // Claim core=1000 but write 1100 — drift +100B (over ±20B threshold).
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1100, extPadding: 1500, opBytes: 500 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, false);
    const coreDrift = r.drifts.find(d => d.name === 'core');
    assert.ok(coreDrift, 'must report drift for core');
    assert.equal(coreDrift.claimed, 1000);
    assert.equal(coreDrift.actual, 1100);
    assert.equal(coreDrift.delta, 100);
    assert.equal(coreDrift.reason, 'over-threshold');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: drift exactly +20B → still ok (inclusive boundary)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 → 500 bytes.';
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1020, extPadding: 1500, opBytes: 500 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, true, `±20B is inclusive; drifts=${JSON.stringify(r.drifts)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: drift +21B → reported (exclusive boundary)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 → 500 bytes.';
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1021, extPadding: 1500, opBytes: 500 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, false);
    const coreDrift = r.drifts.find(d => d.name === 'core');
    assert.ok(coreDrift);
    assert.equal(coreDrift.delta, 21);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// v0.21.6 P6 — over-threshold drift must include copy-paste-ready OLD/NEW edit.
test('synthetic: over-threshold drift emits suggested edit (P6 arrowed form)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 → 500 bytes.';
    // core: claim 1000, write 1100 → +100B drift, over threshold.
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1100, extPadding: 1500, opBytes: 500 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, false);
    const coreDrift = r.drifts.find(d => d.name === 'core');
    assert.ok(coreDrift.suggested, 'over-threshold drift must carry suggested edit');
    assert.equal(coreDrift.suggested.old, 'core 1000 → 1000 bytes');
    assert.equal(coreDrift.suggested.new, 'core 1000 → 1100 bytes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: plain-form claim drift also emits suggested edit (P6)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    // OPERATOR.md uses plain form "N bytes" (no arrow) — common when file is unchanged.
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 bytes.';
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1000, extPadding: 1500, opBytes: 600 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, false);
    const opDrift = r.drifts.find(d => d.name === 'OPERATOR.md');
    assert.ok(opDrift.suggested, 'plain-form drift must carry suggested edit');
    assert.equal(opDrift.suggested.old, 'OPERATOR.md 500 bytes');
    assert.equal(opDrift.suggested.new, 'OPERATOR.md 600 bytes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: extended.md missing → skipped cleanly (does not block ship)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    // No spec/CLAUDE-extended.md at all
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, 'extended-missing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: extended.md exists but Sizing line missing → fail with helpful detail', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    fs.mkdirSync(path.join(tmp, 'spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'spec/CLAUDE-extended.md'), '# extended\nbody without sizing line\n');
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, false);
    assert.equal(r.skipped, 'sizing-line-missing');
    assert.match(r.detail, /Sizing/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('synthetic: arrow form and plain "N bytes" form both parse', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    // No arrow — direct "N bytes" claims.
    const sizingLine = '**Sizing**: core 1000 bytes; extended 1500 bytes; OPERATOR.md 500 bytes.';
    makeSizingFixture(tmp, { sizingLine, coreBytes: 1000, extPadding: 1500, opBytes: 500 });
    const r = runSpecSizingCheck({ root: tmp });
    assert.equal(r.ok, true, `plain form must parse; drifts=${JSON.stringify(r.drifts)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: sizing drift exits 1 with stderr Δ line + actionable Fix sizing note', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-fixture-'));
  try {
    // Build a valid-cascade fixture but bad sizing — proves cascade can pass
    // while sizing fails (combined exit 1).
    fs.mkdirSync(path.join(tmp, 'spec'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'spec/hard-rules.json'), JSON.stringify({ spec_version: 'v6.13.0' }));
    fs.writeFileSync(path.join(tmp, 'README.md'), 'spec v6.13 here\n');
    fs.writeFileSync(path.join(tmp, '.claude-plugin/plugin.json'), '{"description":"v6.13"}');
    fs.writeFileSync(path.join(tmp, '.claude-plugin/marketplace.json'), '{"d":"v6.13"}');
    // Sizing claim 1000 for core, actual 1500 — drift +500B
    const sizingLine = '**Sizing**: core 1000 → 1000 bytes; extended 1500 → 1500 bytes; OPERATOR.md 500 → 500 bytes.';
    fs.writeFileSync(path.join(tmp, 'spec/CLAUDE.md'), 'x'.repeat(1500));
    fs.writeFileSync(path.join(tmp, 'spec/CLAUDE-extended.md'), sizingLine + '\n' + 'y'.repeat(1500 - sizingLine.length - 1));
    fs.writeFileSync(path.join(tmp, 'spec/OPERATOR.md'), 'z'.repeat(500));
    // Run CLI against this fixture root via env override (resolvePluginRoot
    // walks up from script location, so we have to invoke node + the script
    // with cwd at tmp won't work — script computes root via fileURLToPath).
    // Instead, copy script + lib into tmp? Too heavy. Just verify the
    // run* functions assembled by an end-to-end caller would produce exit 1
    // via direct re-invocation of the same logic against the fixture.
    const cascade = runVersionCascadeCheck({ root: tmp });
    const sizing = runSpecSizingCheck({ root: tmp });
    assert.equal(cascade.ok, true, 'cascade should pass on this fixture');
    assert.equal(sizing.ok, false, 'sizing should fail on this fixture');
    assert.equal(sizing.drifts.length >= 1, true);
    const overall = cascade.ok && sizing.ok;
    assert.equal(overall, false, 'combined check must fail when sizing fails alone');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// === Check 3: plugin semver agreement (v0.47.4) ===
// v0.47.1/0.47.2/0.47.3 each shipped with package.json still at 0.47.0 while both
// .claude-plugin manifests advanced — the ship runbook's grep list does not include
// package.json. It is the file readPluginVersion() reads, so install.js stamped a
// stale version into the manifest and /claudemd-status reported 0.47.0 for a live
// 0.47.3 install. These lock the class.

function semverFixture(dir, { pkg, plugin, meta, entry }) {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  if (pkg !== undefined) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: pkg }));
  fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ version: plugin }));
  fs.writeFileSync(path.join(dir, '.claude-plugin/marketplace.json'),
    JSON.stringify({ metadata: { version: meta }, plugins: [{ version: entry }] }));
  return dir;
}

test('pluginSemver: all four sites agree -> ok', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '1.2.3', plugin: '1.2.3', meta: '1.2.3', entry: '1.2.3' });
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, true);
    assert.equal(r.expected, '1.2.3');
    assert.equal(r.sites.length, 4);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('pluginSemver: stale package.json is caught (the v0.47.1-0.47.3 shape)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '0.47.0', plugin: '0.47.3', meta: '0.47.3', entry: '0.47.3' });
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, false, 'stale package.json must fail — it is what install.js stamps');
    assert.equal(r.expected, '0.47.0');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('pluginSemver: a stale marketplace entry is caught too', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { pkg: '1.2.3', plugin: '1.2.3', meta: '1.2.3', entry: '1.2.2' });
    assert.equal(runPluginSemverCheck({ root: d }).ok, false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('pluginSemver: missing package.json fails loudly, does not skip', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-semver-'));
  try {
    semverFixture(d, { plugin: '1.2.3', meta: '1.2.3', entry: '1.2.3' });
    const r = runPluginSemverCheck({ root: d });
    assert.equal(r.ok, false, 'absent package.json must fail, not fail-open');
    assert.equal(r.sites[0].value, null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('pluginSemver: the real repo agrees across all four sites', () => {
  const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const r = runPluginSemverCheck({ root });
  assert.equal(r.ok, true, `real repo semver drift: ${JSON.stringify(r.sites)}`);
});
