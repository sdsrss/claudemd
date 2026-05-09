// sparkline.test.js — R-N9 (v0.8.4) cumulative trend report tests.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sparkline, formatMarkdown } from '../../scripts/sparkline.js';

const SPARKLINE_JS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/sparkline.js');

let tmpHome, savedHome, logPath;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-spark-'));
  savedHome = process.env.HOME;
  process.env.HOME = tmpHome;
  fs.mkdirSync(path.join(tmpHome, '.claude/logs'), { recursive: true });
  logPath = path.join(tmpHome, '.claude/logs/claudemd.jsonl');
});

afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Helper: write rows with each row's `daysAgo` translated into an ISO timestamp.
function writeRows(rows) {
  const now = Date.now();
  const lines = rows.map(r => {
    const ts = new Date(now - r.daysAgo * 86400 * 1000).toISOString();
    const obj = {
      ts,
      hook: r.hook || 'banned-vocab',
      event: r.event || 'deny',
      spec_section: r.section,
      extra: r.extra || null,
    };
    return JSON.stringify(obj);
  });
  fs.writeFileSync(logPath, lines.join('\n') + '\n');
}

test('empty log → no rows + (no signal events) message', () => {
  fs.writeFileSync(logPath, '');
  const r = sparkline();
  assert.equal(r.rows.length, 0);
  const md = formatMarkdown(r);
  assert.match(md, /no signal events in any window/);
});

test('single section, monotonic ↗: more events recently than long ago', () => {
  // 0-30d: 5 events; 30-60d: 1 event; 60-90d: 1 event.
  // Cumulative: 30d=5, 60d=6, 90d=7.
  // Per-period rate: recent=5/30, mid=1/30, old=1/30 → recent > old*1.2 → ↗.
  writeRows([
    { daysAgo: 1, section: '§10-V' }, { daysAgo: 5, section: '§10-V' },
    { daysAgo: 10, section: '§10-V' }, { daysAgo: 15, section: '§10-V' },
    { daysAgo: 25, section: '§10-V' },
    { daysAgo: 45, section: '§10-V' },
    { daysAgo: 75, section: '§10-V' },
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§10-V');
  assert.ok(row, 'must have §10-V row');
  assert.deepEqual(row.counts, [5, 6, 7]);
  assert.equal(row.trend.arrow, '↗');
});

test('monotonic ↘: rule dying — older periods had more events', () => {
  // 0-30d: 1; 30-60d: 5; 60-90d: 5.
  // Per-period rate: recent=1/30, mid=5/30, old=5/30 → recent < old*0.8 → ↘.
  writeRows([
    { daysAgo: 15, section: '§7-ship-baseline' },
    { daysAgo: 35, section: '§7-ship-baseline' }, { daysAgo: 40, section: '§7-ship-baseline' },
    { daysAgo: 45, section: '§7-ship-baseline' }, { daysAgo: 50, section: '§7-ship-baseline' },
    { daysAgo: 55, section: '§7-ship-baseline' },
    { daysAgo: 65, section: '§7-ship-baseline' }, { daysAgo: 70, section: '§7-ship-baseline' },
    { daysAgo: 75, section: '§7-ship-baseline' }, { daysAgo: 80, section: '§7-ship-baseline' },
    { daysAgo: 85, section: '§7-ship-baseline' },
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§7-ship-baseline');
  assert.deepEqual(row.counts, [1, 6, 11]);
  assert.equal(row.trend.arrow, '↘');
});

test('newly active: oldest bucket empty, recent has events → ↗ + annotation', () => {
  // 0-30d: 5; 30-60d: 0; 60-90d: 0. Marker: oldest bucket = 0, recent > 0.
  writeRows([
    { daysAgo: 1, section: '§11-memory-read' }, { daysAgo: 3, section: '§11-memory-read' },
    { daysAgo: 7, section: '§11-memory-read' }, { daysAgo: 12, section: '§11-memory-read' },
    { daysAgo: 20, section: '§11-memory-read' },
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§11-memory-read');
  assert.deepEqual(row.counts, [5, 5, 5]);
  assert.equal(row.trend.arrow, '↗');
  assert.equal(row.trend.annotation, 'newly active');
});

test('silenced: recent bucket empty but older buckets had events → ↘ + annotation', () => {
  // 0-30d: 0; 30-60d: 4; 60-90d: 0.
  writeRows([
    { daysAgo: 35, section: '§8.V4' }, { daysAgo: 40, section: '§8.V4' },
    { daysAgo: 50, section: '§8.V4' }, { daysAgo: 55, section: '§8.V4' },
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§8.V4');
  assert.deepEqual(row.counts, [0, 4, 4]);
  assert.equal(row.trend.arrow, '↘');
  assert.equal(row.trend.annotation, 'silenced');
});

test('only signal events counted; pass / pass-known-red / bootstrap / (unset) excluded', () => {
  writeRows([
    { daysAgo: 5, section: '§10-V', event: 'deny' },         // counted
    { daysAgo: 5, section: '§10-V', event: 'bypass-escape-hatch' }, // counted
    { daysAgo: 5, section: '§7-ship-baseline', event: 'pass' },     // EXCLUDED
    { daysAgo: 5, section: '§7-ship-baseline', event: 'pass-known-red' }, // EXCLUDED
    { daysAgo: 5, section: '§8.V4', event: 'warn' },         // counted
    { daysAgo: 5, section: '§10-V', event: 'advisory', hook: 'transcript-vocab-scan' }, // counted
    { daysAgo: 5, section: null, event: 'bootstrap', hook: 'session-start' }, // EXCLUDED ((unset))
  ]);
  const r = sparkline();
  const sections = r.rows.map(x => x.section).sort();
  assert.deepEqual(sections, ['§10-V', '§8.V4']);
  assert.equal(r.rows.find(x => x.section === '§10-V').counts[0], 3); // 1 deny + 1 bypass + 1 advisory
  assert.equal(r.rows.find(x => x.section === '§8.V4').counts[0], 1);
});

test('formatMarkdown emits aligned table with header + arrows', () => {
  writeRows([
    { daysAgo: 1, section: '§10-V' }, { daysAgo: 2, section: '§10-V' },
    { daysAgo: 80, section: '§7-ship-baseline' },
  ]);
  const md = formatMarkdown(sparkline());
  assert.match(md, /Rule usage trend \(30d \/ 60d \/ 90d, signal events only\):/);
  assert.match(md, /§10-V/);
  assert.match(md, /§7-ship-baseline/);
  // Each row ends with one of the trend glyphs
  const lines = md.trim().split('\n').slice(1);
  for (const l of lines) {
    assert.match(l, /[↗↘≈]/, `expected trend arrow in row: ${l}`);
  }
});

test('custom --days windows: [7,14,28] still produces the same shape', () => {
  writeRows([
    { daysAgo: 1, section: '§10-V' }, { daysAgo: 3, section: '§10-V' },
    { daysAgo: 10, section: '§10-V' },
    { daysAgo: 20, section: '§10-V' },
  ]);
  const r = sparkline({ windows: [7, 14, 28] });
  assert.deepEqual(r.windows, [7, 14, 28]);
  const row = r.rows.find(x => x.section === '§10-V');
  // 0-7d: 2 events (1, 3); 0-14d: 3 (adds the 10); 0-28d: 4 (adds the 20)
  assert.deepEqual(row.counts, [2, 3, 4]);
});

test('sparkline CLI rejects space-form --days 7,14,28 (was silent default)', () => {
  const r = spawnSync(process.execPath, [SPARKLINE_JS, '--days', '7,14,28'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, `expected exit 2, stderr: ${r.stderr}`);
  assert.match(r.stderr, /requires '=value' form/);
});

test('sparkline CLI rejects unknown flag (was silent ignore)', () => {
  const r = spawnSync(process.execPath, [SPARKLINE_JS, '--bogus=1'], {
    env: { ...process.env, HOME: tmpHome },
    encoding: 'utf8',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown flag.*--bogus/);
});
