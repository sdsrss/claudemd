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
  // 0-30d: 10 events; 30-60d: 1 event; 60-90d: 1 event, 88 days ago, where
  // the log starts. Cumulative: 30d=10, 60d=11, 90d=12.
  // Per-period rate: recent=10/30, old=1/28 → recent > old*1.2, and equal
  // rates put 10 or more of 11 events in the recent 30 of 58 days with
  // p = 0.008 < 0.025 → ↗.
  writeRows([
    ...[1, 3, 5, 8, 10, 13, 15, 18, 22, 25].map(d => ({ daysAgo: d, section: '§10-V' })),
    { daysAgo: 45, section: '§10-V' },
    { daysAgo: 88, section: '§10-V' },
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§10-V');
  assert.ok(row, 'must have §10-V row');
  assert.deepEqual(row.counts, [10, 11, 12]);
  assert.equal(row.trend.arrow, '↗');
});

test('monotonic ↘: rule dying — older periods had more events', () => {
  // 0-30d: 1; 30-60d: 5; 60-90d: 10.
  // Per-period rate: recent=1/30, old=10/25 (the log starts 85 days back) →
  // recent < old*0.8, and equal rates put 1 or fewer of 11 events in the
  // recent 30 of 55 days with p = 0.002 < 0.025 → ↘.
  writeRows([
    { daysAgo: 15, section: '§7-ship-baseline' },
    ...[35, 40, 45, 50, 55].map(d => ({ daysAgo: d, section: '§7-ship-baseline' })),
    ...[62, 65, 68, 70, 73, 75, 78, 80, 83, 85].map(d => ({ daysAgo: d, section: '§7-ship-baseline' })),
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§7-ship-baseline');
  assert.deepEqual(row.counts, [1, 6, 16]);
  assert.equal(row.trend.arrow, '↘');
});

test('newly active: oldest bucket empty, recent has events → ↗ + annotation', () => {
  // 0-30d: 5; 30-60d: 0; 60-90d: 0. Marker: oldest bucket = 0, recent > 0.
  // Round-6: include a sentinel `daysAgo: 89` event for an UNRELATED section
  // so log span ≥ longest window. Without this, log span = 20d < 30d (shortest
  // window), insufficientSpan defense fires and suppresses the `newly active`
  // annotation — the (correct) "we can't tell newly active vs no-data" guard.
  // Adding the sentinel attests the log DID cover 30-90d, so §11-memory-read's
  // empty older buckets are a real signal.
  writeRows([
    { daysAgo: 1, section: '§11-memory-read' },
    { daysAgo: 3, section: '§11-memory-read' },
    { daysAgo: 7, section: '§11-memory-read' },
    { daysAgo: 12, section: '§11-memory-read' },
    { daysAgo: 20, section: '§11-memory-read' },
    { daysAgo: 89, section: '§7-ship-baseline' }, // span sentinel — unrelated section
  ]);
  const r = sparkline();
  assert.equal(r.insufficientSpan, false, 'log span (≥89d) covers shortest window (30d)');
  const row = r.rows.find(x => x.section === '§11-memory-read');
  assert.deepEqual(row.counts, [5, 5, 5]);
  assert.equal(row.trend.arrow, '↗');
  assert.equal(row.trend.annotation, 'newly active');
});

test('insufficient log span suppresses newly-active annotation (Round-6 fix)', () => {
  // Pre-fix: 3d log + 30/60/90 windows → every section labeled `newly active`
  // because 30-60d / 60-90d buckets are trivially zero. Maintainers reading
  // `/claudemd-sparkline` could mistake "log just started" for "all rules
  // ramping" — biased input to §0.1 promote/demote review. The fix surfaces
  // logSpanDays + suppresses misleading annotations.
  writeRows([
    { daysAgo: 1, section: '§10-V' },
    { daysAgo: 2, section: '§10-V' },
  ]);
  const r = sparkline();
  assert.equal(r.insufficientSpan, true);
  assert.ok(r.logSpanDays < 30, `expected logSpanDays < 30; got ${r.logSpanDays}`);
  const row = r.rows.find(x => x.section === '§10-V');
  assert.equal(row.trend.annotation, null, 'newly-active must be suppressed under insufficient span');
});

test('R15: a log shorter than the longest window compares against the bucket it covers', () => {
  // 41-day log, windows 30/60/90: the (60,90] bucket holds no log at all, so
  // its rate was 0 and every rule read ↗. This one fell from 9 hits in days
  // 31-40 to 1 in the last 30.
  writeRows([
    { daysAgo: 5, section: '§8-curl-sh' },
    ...[31, 32, 33, 34, 35, 36, 37, 38, 40].map(d => ({ daysAgo: d, section: '§8-curl-sh' })),
    { daysAgo: 41, section: '§10-V' }, // span: the log starts here
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§8-curl-sh');
  assert.deepEqual(row.counts, [1, 10, 10]);
  assert.equal(row.trend.arrow, '↘');
});

test('R18 M4: a baseline bucket the log covers for a fraction of a day decides nothing', () => {
  // Log spans 30.2 days: (30,60] is covered for 0.2 days, so an install-day
  // burst of 3 read as 15/day against a steady 2/day and printed ↘.
  writeRows([
    ...[30.2, 30.18, 30.16].map(d => ({ daysAgo: d, section: '§X' })),
    ...Array.from({ length: 60 }, (_, i) => ({ daysAgo: 0.25 + i / 2, section: '§X' })),
  ]);
  const row = sparkline().rows.find(x => x.section === '§X');
  assert.deepEqual(row.counts, [60, 63, 63]);
  assert.equal(row.trend.arrow, '');
});

test('R20 L1: a duplicated window is not a zero-width baseline', () => {
  // --days=30,30,90 made bucket (30,30] zero days wide; 0 >= min(7, 0) counted
  // it as covered and its rate 0 turned a steady rule into ↗.
  writeRows(Array.from({ length: 66 }, (_, i) => ({ daysAgo: 0.25 + i / 2, section: '§S' })));
  const row = sparkline({ windows: [30, 30, 90] }).rows.find(x => x.section === '§S');
  assert.notEqual(row.trend.arrow, '↗');
});

test('R20 L3: a silenced rule keeps its annotation when no baseline is covered enough', () => {
  // 12 hits 30-33 days ago, none since, a 33-day log: the early return for an
  // uncovered baseline also dropped `silenced`, which needs no baseline rate.
  writeRows(
    [30.5, 31, 31.5, 32, 32.5, 32.9].flatMap(d => [
      { daysAgo: d, section: '§Q' },
      { daysAgo: d, section: '§Q' },
    ])
  );
  const row = sparkline().rows.find(x => x.section === '§Q');
  assert.equal(row.trend.annotation, 'silenced');
  assert.equal(row.trend.arrow, '↘');
});

test('a rate gap the counts cannot tell from chance reads ≈, not a direction', () => {
  // The arrow was a bare ±20% rate comparison: 3 events against 1 read ↗,
  // though equal rates give a split at least that lopsided 33% of the time.
  // A direction now also needs the exact two-sided 5% test on the counts.
  writeRows([
    ...[2, 9, 20].map(d => ({ daysAgo: d, section: '§10-V' })),
    { daysAgo: 70, section: '§10-V' },
    { daysAgo: 89, section: '§11-memory-read' }, // the log reaches the (60,90] bucket
  ]);
  const row = sparkline().rows.find(x => x.section === '§10-V');
  assert.deepEqual(row.counts, [3, 3, 4]);
  assert.equal(row.trend.arrow, '≈');
});

test('a few install-day events in a week-long baseline do not read ↘', () => {
  // A steady 1/day over a 37.5-day log, plus 4 events on its first day: the
  // (30,60] baseline covers 7.5 days and holds 12, so 1.6/day against 1.0/day
  // read ↘. Equal rates give 30 or fewer of 42 in the recent bucket 12% of
  // the time. Moving the coverage floor only moved where this happened.
  writeRows([
    ...Array.from({ length: 38 }, (_, i) => ({ daysAgo: i + 0.5, section: '§7-ship-baseline' })),
    ...[37.4, 37.4, 37.4, 37.4].map(d => ({ daysAgo: d, section: '§7-ship-baseline' })),
  ]);
  const row = sparkline().rows.find(x => x.section === '§7-ship-baseline');
  assert.deepEqual(row.counts, [30, 42, 42]);
  assert.equal(row.trend.arrow, '≈');
});

test('R15: under insufficient span there is no arrow either', () => {
  // The banner says "trend annotations suppressed"; the arrow was still ↗.
  writeRows([
    { daysAgo: 1, section: '§10-V' },
    { daysAgo: 2, section: '§10-V' },
  ]);
  const r = sparkline();
  assert.equal(r.insufficientSpan, true);
  assert.equal(r.rows.find(x => x.section === '§10-V').trend.arrow, '');
});

test('formatMarkdown emits insufficient-span banner', () => {
  writeRows([
    { daysAgo: 1, section: '§10-V' },
    { daysAgo: 2, section: '§10-V' },
  ]);
  const md = formatMarkdown(sparkline());
  assert.match(md, /insufficient log span/);
  assert.doesNotMatch(md, /newly active/, 'banner present + annotation suppressed');
});

test('silenced: recent bucket empty but older buckets had events → ↘ + annotation', () => {
  // 0-30d: 0; 30-60d: 4; 60-90d: 0.
  writeRows([
    { daysAgo: 35, section: '§8.V4' },
    { daysAgo: 40, section: '§8.V4' },
    { daysAgo: 50, section: '§8.V4' },
    { daysAgo: 55, section: '§8.V4' },
  ]);
  const r = sparkline();
  const row = r.rows.find(x => x.section === '§8.V4');
  assert.deepEqual(row.counts, [0, 4, 4]);
  assert.equal(row.trend.arrow, '↘');
  assert.equal(row.trend.annotation, 'silenced');
});

test('only signal events counted; pass / pass-known-red / bootstrap / (unset) excluded', () => {
  writeRows([
    { daysAgo: 5, section: '§10-V', event: 'deny' }, // counted
    { daysAgo: 5, section: '§10-V', event: 'bypass-escape-hatch' }, // counted
    { daysAgo: 5, section: '§7-ship-baseline', event: 'pass' }, // EXCLUDED
    { daysAgo: 5, section: '§7-ship-baseline', event: 'pass-known-red' }, // EXCLUDED
    { daysAgo: 5, section: '§8.V4', event: 'warn' }, // counted
    { daysAgo: 5, section: '§10-V', event: 'advisory', hook: 'transcript-vocab-scan' }, // counted
    { daysAgo: 5, section: null, event: 'bootstrap', hook: 'session-start' }, // EXCLUDED ((unset))
  ]);
  const r = sparkline();
  const sections = r.rows.map(x => x.section).sort();
  assert.deepEqual(sections, ['§10-V', '§8.V4']);
  assert.equal(r.rows.find(x => x.section === '§10-V').counts[0], 3); // 1 deny + 1 bypass + 1 advisory
  assert.equal(r.rows.find(x => x.section === '§8.V4').counts[0], 1);
});

test('v0.23.11: deny FAMILY (deny-repeat / deny-prose) counted; deny-prose-dry-run excluded', () => {
  // Re-audit: SIGNAL_EVENTS had literal `deny` only, undercounting §11-memory-read
  // (deny-repeat) and §10-V (deny-prose) in the release trend. dry-run stays out.
  writeRows([
    { daysAgo: 5, section: '§11-memory-read', event: 'deny' },
    { daysAgo: 5, section: '§11-memory-read', event: 'deny-repeat' },
    { daysAgo: 5, section: '§10-V', event: 'deny-prose', hook: 'banned-vocab' },
    { daysAgo: 5, section: '§10-V', event: 'deny-prose-dry-run', hook: 'banned-vocab' }, // EXCLUDED
  ]);
  const r = sparkline();
  assert.equal(r.rows.find(x => x.section === '§11-memory-read').counts[0], 2, 'deny + deny-repeat');
  assert.equal(r.rows.find(x => x.section === '§10-V').counts[0], 1, 'deny-prose counted, dry-run excluded');
});

test('formatMarkdown emits aligned table with header + arrows', () => {
  // Add daysAgo:89 sentinel so log span covers all default windows and the
  // partial-coverage banner does NOT fire (Round-6: a banner line on the
  // partial-coverage path doesn't carry a trend arrow and would break the
  // per-row arrow assertion below).
  writeRows([
    { daysAgo: 1, section: '§10-V' },
    { daysAgo: 2, section: '§10-V' },
    { daysAgo: 80, section: '§7-ship-baseline' },
    { daysAgo: 95, section: '§8.V4' }, // > longest window — full coverage
  ]);
  const md = formatMarkdown(sparkline());
  assert.match(md, /Rule usage trend \(30d \/ 60d \/ 90d, signal events only\):/);
  assert.match(md, /§10-V/);
  assert.match(md, /§7-ship-baseline/);
  assert.doesNotMatch(md, /insufficient log span|partial coverage/, 'no banner on full coverage');
  // Skip header line; assert each rule row ends with a trend glyph.
  const lines = md.trim().split('\n').slice(1);
  for (const l of lines) {
    assert.match(l, /[↗↘≈]/, `expected trend arrow in row: ${l}`);
  }
});

test('custom --days windows: [7,14,28] still produces the same shape', () => {
  writeRows([
    { daysAgo: 1, section: '§10-V' },
    { daysAgo: 3, section: '§10-V' },
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

// R11-26 (2026-09-03 audit): CLAUDEMD_SPARKLINE_DAYS had zero occurrences in
// tests/. The env→arg path has its own validation branch (resolveDaysListFlag
// reads the env only when --days is absent), so a regression there would have
// shipped green — and this env var is what /claudemd-sparkline and the release
// header use to widen the windows.
test('R11-26: CLAUDEMD_SPARKLINE_DAYS sets the windows, and --days overrides it', () => {
  writeRows([{ daysAgo: 1, section: '§10-V' }]);
  const env = { ...process.env, HOME: tmpHome, CLAUDEMD_SPARKLINE_DAYS: '7,14,28' };

  const fromEnv = spawnSync(process.execPath, [SPARKLINE_JS], { env, encoding: 'utf8' });
  assert.equal(fromEnv.status, 0, `stderr=${fromEnv.stderr}`);
  assert.match(fromEnv.stdout, /7d/);
  assert.match(fromEnv.stdout, /28d/);
  assert.doesNotMatch(fromEnv.stdout, /\b90d\b/, 'the default 30,60,90 must not win over the env');

  // USAGE promises "overridden by --days when both set" — assert the promise.
  const overridden = spawnSync(process.execPath, [SPARKLINE_JS, '--days=5,50'], { env, encoding: 'utf8' });
  assert.equal(overridden.status, 0, `stderr=${overridden.stderr}`);
  assert.match(overridden.stdout, /50d/);
  assert.doesNotMatch(overridden.stdout, /\b28d\b/);
});

test('R11-26: a malformed CLAUDEMD_SPARKLINE_DAYS fails loudly, not to the default', () => {
  // The list validator rejects the WHOLE list rather than truncating; via the
  // env that has to surface as exit 1, not as a silent fall back to 30,60,90.
  for (const bad of ['1.5,2,3', '30', 'abc,def', '0,10']) {
    const r = spawnSync(process.execPath, [SPARKLINE_JS], {
      env: { ...process.env, HOME: tmpHome, CLAUDEMD_SPARKLINE_DAYS: bad },
      encoding: 'utf8',
    });
    assert.equal(r.status, 1, `CLAUDEMD_SPARKLINE_DAYS=${bad} must exit 1, got ${r.status}`);
    assert.match(r.stderr, /--days expects ≥2 comma-separated positive integers/);
  }
});
