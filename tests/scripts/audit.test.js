import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { audit } from '../../scripts/audit.js';

const AUDIT_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/audit.js');

let tmpHome, savedHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-au-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = new Date().toISOString();
  // Mix: 2 v0.7.0 rows with spec_section + 1 legacy v0.6.x row missing the
  // field (audit `bySection` must surface it under the `(unset)` bucket so
  // pre-upgrade data is visible during the audit-window transition).
  fs.writeFileSync(log,
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["significantly"]}}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["70% faster"]}}\n` +
    `{"ts":"${now}","hook":"ship-baseline","event":"deny","extra":null}\n` +
    `{"ts":"${now}","hook":"banned-vocab","event":"bypass-escape-hatch","spec_section":"§10-V","extra":{"token":"allow-banned-vocab"}}\n` +
    `{"ts":"${now}","hook":"pre-bash-safety","event":"bypass-escape-hatch","spec_section":"§8-rm-rf-var","extra":{"token":"allow-rm-rf-var"}}\n` +
    `{"ts":"${now}","hook":"pre-bash-safety","event":"bypass-escape-hatch","spec_section":"§8-rm-rf-var","extra":{"token":"allow-rm-rf-var"}}\n`
  );
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('audit aggregates by hook', async () => {
  const r = await audit({ days: 30 });
  assert.equal(r.byHook['banned-vocab'].total, 3);
  assert.equal(r.byHook['banned-vocab'].byEvent.deny, 2);
  assert.equal(r.byHook['banned-vocab'].byEvent['bypass-escape-hatch'], 1);
  assert.equal(r.byHook['ship-baseline'].total, 1);
  assert.equal(r.byHook['pre-bash-safety'].total, 2);
});

test('audit top patterns for banned-vocab', async () => {
  const r = await audit({ days: 30 });
  assert.ok(r.topPatterns.length >= 2);
  const names = r.topPatterns.map(([name]) => name);
  assert.ok(names.includes('significantly'));
});

test('audit bySection aggregates v0.7.0 spec_section field', async () => {
  const r = await audit({ days: 30 });
  // §10-V fired 3× (2 deny + 1 bypass on banned-vocab)
  assert.equal(r.bySection['§10-V'].total, 3);
  assert.equal(r.bySection['§10-V'].byEvent.deny, 2);
  assert.equal(r.bySection['§10-V'].byEvent['bypass-escape-hatch'], 1);
  assert.equal(r.bySection['§10-V'].byHook['banned-vocab'], 3);
  // §8-rm-rf-var fired 2× (both bypass on pre-bash-safety)
  assert.equal(r.bySection['§8-rm-rf-var'].total, 2);
});

test('audit bySection surfaces legacy rows under (unset)', async () => {
  // The ship-baseline row in the fixture has no spec_section field
  // (simulates pre-v0.7.0 row that's still in the audit window).
  const r = await audit({ days: 30 });
  assert.ok(r.bySection['(unset)'], '(unset) bucket must exist when legacy rows present');
  assert.equal(r.bySection['(unset)'].total, 1);
  assert.equal(r.bySection['(unset)'].byHook['ship-baseline'], 1);
});

test('audit byBypass aggregates per-token override usage', async () => {
  const r = await audit({ days: 30 });
  // 1× allow-banned-vocab + 2× allow-rm-rf-var in fixture
  assert.equal(r.byBypass['allow-banned-vocab'].total, 1);
  assert.equal(r.byBypass['allow-banned-vocab'].byHook['banned-vocab'], 1);
  assert.equal(r.byBypass['allow-rm-rf-var'].total, 2);
  assert.equal(r.byBypass['allow-rm-rf-var'].byHook['pre-bash-safety'], 2);
});

test('audit byBypass empty when no bypass-escape-hatch events present', async () => {
  // Replace fixture with deny-only data.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  fs.writeFileSync(log,
    `{"ts":"${new Date().toISOString()}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":{"matched":["robust"]}}\n`
  );
  const r = await audit({ days: 30 });
  assert.deepEqual(r.byBypass, {});
});

test('R-N3: byTrend flags regression when recent doubles prior', async () => {
  // 5 events in last 7d, 1 event in 7-14d window → ratio 5.0 → regression.
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const recent = new Date(now - 1 * 86400 * 1000).toISOString();
  const prior = new Date(now - 10 * 86400 * 1000).toISOString();
  const rows = [
    `{"ts":"${recent}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`.repeat(5),
    `{"ts":"${prior}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`,
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await audit({ days: 30, trendDays: 7 });
  assert.ok(r.byTrend, 'byTrend must be present');
  assert.equal(r.byTrend['§10-V'].recent, 5);
  assert.equal(r.byTrend['§10-V'].prior, 1);
  assert.equal(r.byTrend['§10-V'].ratio, 5);
  assert.equal(r.byTrend['§10-V'].flag, 'regression');
});

test('R-N3: byTrend flags newly_active when prior=0 recent>0', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const recent = new Date(now - 2 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${recent}","hook":"memory-read-check","event":"deny","spec_section":"§11-memory-read","extra":null}\n`.repeat(3)
  );
  const r = await audit({ days: 30, trendDays: 7 });
  assert.equal(r.byTrend['§11-memory-read'].recent, 3);
  assert.equal(r.byTrend['§11-memory-read'].prior, 0);
  assert.equal(r.byTrend['§11-memory-read'].ratio, null);
  assert.equal(r.byTrend['§11-memory-read'].flag, 'newly_active');
});

test('R-N3: byTrend flags silenced when recent=0 prior>0', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const prior = new Date(now - 10 * 86400 * 1000).toISOString();
  fs.writeFileSync(log,
    `{"ts":"${prior}","hook":"sandbox-disposal","event":"warn","spec_section":"§8.V4","extra":null}\n`.repeat(4)
  );
  const r = await audit({ days: 30, trendDays: 7 });
  assert.equal(r.byTrend['§8.V4'].recent, 0);
  assert.equal(r.byTrend['§8.V4'].prior, 4);
  assert.equal(r.byTrend['§8.V4'].ratio, 0);
  assert.equal(r.byTrend['§8.V4'].flag, 'silenced');
});

test('R-N3: byTrend marks recovery when ratio ≤ 0.5', async () => {
  const log = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
  const now = Date.now();
  const recent = new Date(now - 1 * 86400 * 1000).toISOString();
  const prior = new Date(now - 10 * 86400 * 1000).toISOString();
  const rows = [
    `{"ts":"${recent}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`,
    `{"ts":"${prior}","hook":"banned-vocab","event":"deny","spec_section":"§10-V","extra":null}\n`.repeat(4),
  ].join('');
  fs.writeFileSync(log, rows);
  const r = await audit({ days: 30, trendDays: 7 });
  assert.equal(r.byTrend['§10-V'].recent, 1);
  assert.equal(r.byTrend['§10-V'].prior, 4);
  assert.equal(r.byTrend['§10-V'].ratio, 0.25);
  assert.equal(r.byTrend['§10-V'].flag, 'recovery');
});

test('audit CLI rejects non-numeric --days (L1)', () => {
  // Regression: parseInt('garbage', 10) → NaN → cutoff NaN → every row
  // filtered out silently. Previous runs returned 0 hits with no error.
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=garbage'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive integer/i);
});

test('audit CLI rejects --days=0 (L1)', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=0'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive integer/i);
});

test('audit CLI --days=N takes precedence over env var', () => {
  const result = spawnSync(process.execPath, [AUDIT_JS, '--days=1'], {
    env: { ...process.env, HOME: tmpHome, CLAUDEMD_AUDIT_DAYS: '90' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
  const r = JSON.parse(result.stdout);
  assert.equal(r.windowDays, 1);
});
