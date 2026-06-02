// v0.12.0 — Spec ↔ implementation coherence audit tests.
// Mix of (a) real-repo smoke tests (locked to current shipped spec per
// feedback_test_fixture_format_drift.md — byte-exact assertions catch
// drift in one shot) and (b) synthetic-fixture tests for failure cases
// (where the real repo can't easily reproduce the bad state).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { auditSpecCoherence } from '../../scripts/spec-coherence-audit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

// --- Real-repo smoke tests --------------------------------------------------

test('audit runs against the real repo and returns structured report', () => {
  const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: '/nonexistent-cwd-for-test' });
  assert.equal(r.checks.length, 4, 'expected 4 checks');
  assert.ok(r.summary.checksRun === 4);
  assert.ok(Array.isArray(r.checks));
  for (const c of r.checks) {
    assert.ok(typeof c.name === 'string');
    assert.ok(typeof c.ok === 'boolean');
    assert.ok(Array.isArray(c.findings));
  }
});

test('ext-cross-refs: every §EXT ref in shipped core resolves in extended', () => {
  const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: '/nonexistent-cwd-for-test' });
  const check = r.checks.find(c => c.name === 'ext-cross-refs');
  assert.ok(check, 'ext-cross-refs check should exist');
  assert.equal(check.ok, true,
    `unresolved §EXT refs in shipped spec: ${JSON.stringify(check.findings)}`);
  assert.ok(check.stats.refsFound >= 5, `expected ≥5 refs in core, got ${check.stats.refsFound}`);
  assert.ok(check.stats.sectionsFound >= 5, `expected ≥5 sections in extended, got ${check.stats.sectionsFound}`);
});

test('sizing-accuracy: shipped Sizing line within ±20B of actual wc -c', () => {
  const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: '/nonexistent-cwd-for-test' });
  const check = r.checks.find(c => c.name === 'sizing-accuracy');
  assert.ok(check, 'sizing-accuracy check should exist');
  // The shipped repo should pass this. Spec maintainers update the Sizing
  // line during ship; CI catches drift beyond tolerance.
  assert.equal(check.ok, true,
    `Sizing drift beyond tolerance: ${JSON.stringify(check.findings)} | stats: ${JSON.stringify(check.stats)}`);
});

test('sizing-headroom: shipped core/extended within HARD caps (no HIGH breach)', () => {
  const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: '/nonexistent-cwd-for-test' });
  const check = r.checks.find(c => c.name === 'sizing-headroom');
  assert.ok(check, 'sizing-headroom check should exist');
  // Real invariant: shipped spec must never exceed the §0.1 HARD cap. If a
  // future edit pushes core past 25K, this fails — which is the gate's point.
  assert.ok(check.stats.coreActual <= check.stats.coreCap,
    `core ${check.stats.coreActual}B exceeds HARD cap ${check.stats.coreCap}B`);
  assert.ok(check.stats.extendedActual <= check.stats.extendedCap,
    `extended ${check.stats.extendedActual}B exceeds HARD cap ${check.stats.extendedCap}B`);
  assert.ok(!check.findings.some(f => f.severity === 'HIGH'),
    `within-cap spec must never emit HIGH; got ${JSON.stringify(check.findings)}`);
});

test('sizing-headroom: HIGH when core exceeds the 25K HARD cap (--strict-blocking)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-hr-'));
  try {
    makeSpecFixture(tmpDir, { coreContent: 'x'.repeat(25001), extendedContent: 'y'.repeat(100) });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'sizing-headroom');
    assert.equal(check.ok, false);
    assert.equal(check.severity, 'HIGH');
    assert.ok(check.findings.some(f => f.severity === 'HIGH' && /core/.test(f.detail) && /HARD cap/.test(f.detail)),
      `expected HIGH core-over-cap finding; got ${JSON.stringify(check.findings)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sizing-headroom: LOW advisory in the 97–100% danger band (not --strict-blocking)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-hr-'));
  try {
    // 24600B = 98.4% of 25000 — past the 0.97 danger ratio, under the cap.
    makeSpecFixture(tmpDir, { coreContent: 'x'.repeat(24600), extendedContent: 'y'.repeat(100) });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'sizing-headroom');
    assert.equal(check.ok, false);
    assert.equal(check.severity, 'LOW', 'danger band is advisory, never HIGH');
    assert.ok(check.findings.length >= 1 && check.findings.every(f => f.severity === 'LOW'),
      `danger band should yield only LOW findings; got ${JSON.stringify(check.findings)}`);
    assert.ok(/core/.test(check.findings[0].detail));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sizing-headroom: clean when both files comfortably under the danger band', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-hr-'));
  try {
    makeSpecFixture(tmpDir, { coreContent: 'x'.repeat(1000), extendedContent: 'y'.repeat(1000) });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'sizing-headroom');
    assert.equal(check.ok, true);
    assert.equal(check.findings.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Synthetic-fixture tests for failure cases ------------------------------

function makeSpecFixture(tmpDir, { coreContent, extendedContent }) {
  const specDir = path.join(tmpDir, 'spec');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'CLAUDE.md'), coreContent);
  fs.writeFileSync(path.join(specDir, 'CLAUDE-extended.md'), extendedContent);
  return tmpDir;
}

test('ext-cross-refs: surfaces unresolved §EXT ref as CRITICAL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-'));
  try {
    makeSpecFixture(tmpDir, {
      coreContent: 'See §EXT §99.7-EXT for the missing ref.\n',
      extendedContent: '## §1-EXT exists\n\n## §2-EXT also here\n',
    });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'ext-cross-refs');
    assert.equal(check.ok, false);
    assert.equal(check.findings.length, 1);
    assert.equal(check.findings[0].severity, 'CRITICAL');
    assert.match(check.findings[0].detail, /§99\.7-EXT/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ext-cross-refs: literal §X-EXT placeholder is NOT treated as a ref', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-'));
  try {
    makeSpecFixture(tmpDir, {
      coreContent: 'New rule defaults to extended §X-EXT. Promote later.\n' +
                   'See §EXT §1-EXT for the real ref.\n',
      extendedContent: '## §1-EXT exists\n',
    });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'ext-cross-refs');
    assert.equal(check.ok, true, `should not flag the literal X-EXT placeholder: ${JSON.stringify(check.findings)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sizing-accuracy: HIGH when actual exceeds claim by >20B', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-'));
  try {
    // Core file: 100 bytes. Claim 50 → delta +50, beyond ±20B → HIGH.
    const coreBody = 'x'.repeat(100);
    const extendedBody = '**Sizing** (v6.99.0, 2026-01-01): core 50 → 50 bytes (...); extended 200 → 200 bytes (...)';
    makeSpecFixture(tmpDir, { coreContent: coreBody, extendedContent: extendedBody });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'sizing-accuracy');
    assert.equal(check.ok, false);
    assert.ok(check.findings.some(f => f.severity === 'HIGH' && /core/.test(f.detail)),
      `expected HIGH finding on core delta; got: ${JSON.stringify(check.findings)}`);
    // The extended file is ~95 bytes; claim 200 → delta -105 also HIGH.
    assert.ok(check.findings.some(f => f.severity === 'HIGH' && /extended/.test(f.detail)),
      `expected HIGH finding on extended delta; got: ${JSON.stringify(check.findings)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('sizing-accuracy: ±20B drift accepted', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-'));
  try {
    // Core file: 100 bytes. Claim 110 → delta -10, within ±20B → ok.
    const coreBody = 'x'.repeat(100);
    // Extended: claim 200, write ~215 bytes (delta +15, in tolerance).
    const extendedBody = `**Sizing** (v6.99.0, 2026-01-01): core 110 → 110 bytes (...); extended 200 → 200 bytes (...).\n` +
                          'y'.repeat(115);
    makeSpecFixture(tmpDir, { coreContent: coreBody, extendedContent: extendedBody });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    const check = r.checks.find(c => c.name === 'sizing-accuracy');
    // Whether ext drift is in tolerance depends on actual size; the strict
    // assertion here is on core (claimed 110, actual 100, delta -10, ok).
    const coreFinding = check.findings.find(f => /core/.test(f.detail));
    assert.equal(coreFinding, undefined, `core within tolerance should have no finding; got: ${JSON.stringify(check.findings)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('memory-index: dangling ref → MEDIUM finding', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-mem-'));
  const savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const cwd = '/work/test-dangling';
    const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    const memDir = path.join(tmpHome, '.claude/projects', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    // Index references a file that doesn't exist on disk.
    fs.writeFileSync(path.join(memDir, 'MEMORY.md'),
      '- [Real](feedback_real.md) `[tag]` — exists\n' +
      '- [Missing](feedback_missing.md) `[tag]` — dangling\n');
    fs.writeFileSync(path.join(memDir, 'feedback_real.md'), 'x');
    const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: cwd });
    const check = r.checks.find(c => c.name === 'memory-index');
    assert.equal(check.ok, false);
    assert.ok(check.findings.some(f => f.severity === 'MEDIUM' && /feedback_missing\.md/.test(f.detail)),
      `expected MEDIUM dangling finding; got: ${JSON.stringify(check.findings)}`);
  } finally {
    process.env.HOME = savedHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('memory-index: orphan file → LOW finding', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-mem-'));
  const savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const cwd = '/work/test-orphan';
    const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    const memDir = path.join(tmpHome, '.claude/projects', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'MEMORY.md'),
      '- [Real](feedback_real.md) `[tag]` — exists\n');
    fs.writeFileSync(path.join(memDir, 'feedback_real.md'), 'x');
    fs.writeFileSync(path.join(memDir, 'feedback_orphan.md'), 'y'); // not in index
    const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: cwd });
    const check = r.checks.find(c => c.name === 'memory-index');
    assert.equal(check.ok, false);
    assert.ok(check.findings.some(f => f.severity === 'LOW' && /feedback_orphan\.md/.test(f.detail)),
      `expected LOW orphan finding; got: ${JSON.stringify(check.findings)}`);
  } finally {
    process.env.HOME = savedHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('memory-index: missing MEMORY.md is silent (no findings, status note)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-mem-'));
  const savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: '/work/no-memory-yet' });
    const check = r.checks.find(c => c.name === 'memory-index');
    assert.equal(check.ok, true);
    assert.equal(check.findings.length, 0);
    assert.equal(check.stats.status, 'no-index');
  } finally {
    process.env.HOME = savedHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('CWD encoding handles /, ., _ uniformly (parity with §11 hooks)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-mem-'));
  const savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  try {
    const cwd = '/mnt/data_ssd/my.proj_v2';
    const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    const memDir = path.join(tmpHome, '.claude/projects', encoded, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '- [X](feedback_x.md) `[t]` — y\n');
    fs.writeFileSync(path.join(memDir, 'feedback_x.md'), 'z');
    const r = auditSpecCoherence({ pluginRoot: REPO_ROOT, projectCwd: cwd });
    const check = r.checks.find(c => c.name === 'memory-index');
    assert.equal(check.ok, true,
      `slash/dot/underscore encoding should map to existing memory dir; check: ${JSON.stringify(check)}`);
    assert.equal(check.stats.indexedCount, 1);
    assert.equal(check.stats.onDiskCount, 1);
  } finally {
    process.env.HOME = savedHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('summary severityCounts aggregates across checks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specco-agg-'));
  try {
    // Bad spec — both ext-cross-refs and sizing fail.
    makeSpecFixture(tmpDir, {
      coreContent: 'See §EXT §99-EXT (unresolved).\n' + 'x'.repeat(50),
      extendedContent: '## §1-EXT here\n**Sizing** (v6.99.0, 2026-01-01): core 9999 → 9999 bytes (...); extended 9999 → 9999 bytes (...)',
    });
    const r = auditSpecCoherence({ pluginRoot: tmpDir, projectCwd: '/nonexistent' });
    assert.ok(r.summary.severityCounts.CRITICAL >= 1,
      `expected ≥1 CRITICAL; got ${JSON.stringify(r.summary.severityCounts)}`);
    assert.ok(r.summary.severityCounts.HIGH >= 1,
      `expected ≥1 HIGH; got ${JSON.stringify(r.summary.severityCounts)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
