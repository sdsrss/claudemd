// rule-hits-parse.test.js — unit tests for the parse helpers backing
// /claudemd-audit, /claudemd-rules, /claudemd-sparkline. Coverage was
// implicit (via consumer scripts) before v0.9.20 added logFirstTs;
// dedicated test file lets future readers find behavior in one place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { logFirstTs, readHits, groupBySection } from '../../scripts/lib/rule-hits-parse.js';

function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhp-'));
  const file = path.join(dir, 'claudemd.jsonl');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('logFirstTs: missing file → null', () => {
  withFixture((file) => {
    assert.equal(logFirstTs(file), null);
  });
});

test('logFirstTs: empty file → null', () => {
  withFixture((file) => {
    fs.writeFileSync(file, '');
    assert.equal(logFirstTs(file), null);
  });
});

test('logFirstTs: returns earliest ts across rows', () => {
  withFixture((file) => {
    const oldTs = '2026-01-01T00:00:00Z';
    const newTs = '2026-05-01T00:00:00Z';
    fs.writeFileSync(file,
      `{"ts":"${newTs}","hook":"x","event":"deny"}\n` +
      `{"ts":"${oldTs}","hook":"x","event":"deny"}\n` +
      `{"ts":"${newTs}","hook":"x","event":"deny"}\n`
    );
    assert.equal(logFirstTs(file), new Date(oldTs).getTime());
  });
});

test('logFirstTs: skips malformed JSON lines', () => {
  withFixture((file) => {
    const validTs = '2026-03-15T00:00:00Z';
    fs.writeFileSync(file,
      'this is not json\n' +
      `{"ts":"${validTs}","hook":"x","event":"deny"}\n` +
      'still not json\n'
    );
    assert.equal(logFirstTs(file), new Date(validTs).getTime());
  });
});

test('logFirstTs: skips rows with non-finite timestamps', () => {
  withFixture((file) => {
    const validTs = '2026-04-01T00:00:00Z';
    fs.writeFileSync(file,
      `{"ts":"not-a-date","hook":"x","event":"deny"}\n` +
      `{"ts":"${validTs}","hook":"x","event":"deny"}\n`
    );
    assert.equal(logFirstTs(file), new Date(validTs).getTime());
  });
});

test('readHits: respects daysBack cutoff', () => {
  withFixture((file) => {
    const now = Date.now();
    const oldTs = new Date(now - 100 * 86400 * 1000).toISOString();
    const newTs = new Date(now - 5 * 86400 * 1000).toISOString();
    fs.writeFileSync(file,
      `{"ts":"${oldTs}","hook":"x","event":"deny"}\n` +
      `{"ts":"${newTs}","hook":"x","event":"deny"}\n`
    );
    const { hits } = readHits(file, 30);
    assert.equal(hits.length, 1, 'rows older than cutoff must be dropped');
    assert.equal(hits[0].ts, newTs);
  });
});

test('readHits: surfaces skipped count for malformed rows', () => {
  // Round-6: data-integrity transparency. 5 valid + 3 corrupt → skipped=3.
  // Pre-fix the 3 corrupt rows were silently swallowed; §13.1 audit was
  // biased on 3/8 = 37% data loss with zero operator visibility.
  withFixture((file) => {
    const now = Date.now();
    const ts = new Date(now - 1 * 86400 * 1000).toISOString();
    fs.writeFileSync(file,
      `{"ts":"${ts}","hook":"x","event":"deny"}\n` +
      `garbage line\n` +
      `{"ts":"${ts}","hook":"x","event":"deny"}\n` +
      `{truncated\n` +
      `{"ts":"${ts}","hook":"x","event":"deny"}\n` +
      `not-json\n` +
      `{"ts":"${ts}","hook":"x","event":"deny"}\n` +
      `{"ts":"${ts}","hook":"x","event":"deny"}\n`
    );
    const { hits, totalLines, parsed, skipped } = readHits(file, 30);
    assert.equal(totalLines, 8);
    assert.equal(parsed, 5);
    assert.equal(skipped, 3);
    assert.equal(hits.length, 5);
  });
});

test('readHits: missing file returns zero counters', () => {
  const r = readHits('/tmp/definitely-not-here.jsonl', 30);
  assert.deepEqual(r, { hits: [], totalLines: 0, parsed: 0, skipped: 0 });
});

test('groupBySection: bins by spec_section, falls back to (unset)', () => {
  const hits = [
    { hook: 'x', event: 'deny', spec_section: '§10-V' },
    { hook: 'x', event: 'warn', spec_section: '§10-V' },
    { hook: 'x', event: 'deny' /* no spec_section */ },
  ];
  const g = groupBySection(hits);
  assert.equal(g['§10-V'].total, 2);
  assert.equal(g['§10-V'].byEvent.deny, 1);
  assert.equal(g['§10-V'].byEvent.warn, 1);
  assert.equal(g['(unset)'].total, 1);
});
