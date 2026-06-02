// rule-hits-parse.test.js — unit tests for the parse helpers backing
// /claudemd-audit, /claudemd-rules, /claudemd-sparkline. Coverage was
// implicit (via consumer scripts) before v0.9.20 added logFirstTs;
// dedicated test file lets future readers find behavior in one place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { logFirstTs, readHits, groupBySection, excludeTestSessions, byProjectClass, classifyProject, isBlockingDeny } from '../../scripts/lib/rule-hits-parse.js';

// v0.23.8 — self-dogfood vs external classification + per-hook split.
test('classifyProject: claudemd repo (both cwd encodings) → self', () => {
  assert.equal(classifyProject('-mnt-data-ssd-dev-projects-claudemd'), 'self');
  assert.equal(classifyProject('-mnt-data_ssd-dev-projects-claudemd'), 'self'); // legacy underscore form
});

test('classifyProject: downstream repo → external; missing → unknown', () => {
  assert.equal(classifyProject('-home-u-dev-daagu'), 'external');
  assert.equal(classifyProject('-work-code-graph-mcp'), 'external');
  assert.equal(classifyProject(null), 'unknown');
  assert.equal(classifyProject(''), 'unknown');
  assert.equal(classifyProject(undefined), 'unknown');
});

test('classifyProject: trailing-segment anchor, not bare substring', () => {
  assert.equal(classifyProject('-work-claudemd-fork-experiments'), 'external'); // mid-path
  assert.equal(classifyProject('-home-u-myclaudemd'), 'external');              // suffix, not a segment
  assert.equal(classifyProject('-home-u-claudemd'), 'self');                    // true trailing segment
  assert.equal(classifyProject('claudemd'), 'self');                            // bare
});

test('isBlockingDeny: deny family counts; deny-prose-dry-run excluded', () => {
  assert.equal(isBlockingDeny('deny'), true);
  assert.equal(isBlockingDeny('deny-repeat'), true);          // ship-baseline escalation, still hook_deny
  assert.equal(isBlockingDeny('deny-prose'), true);           // banned-vocab real prose block
  assert.equal(isBlockingDeny('deny-prose-dry-run'), false);  // exits 0, observability only — not a block
  assert.equal(isBlockingDeny('bypass-escape-hatch'), false);
  assert.equal(isBlockingDeny('pass'), false);
  assert.equal(isBlockingDeny(null), false);
});

test('byProjectClass: deny-family per-hook self/external/unknown split', () => {
  const hits = [
    { hook: 'banned-vocab', event: 'deny', project: '-x-claudemd' },
    { hook: 'banned-vocab', event: 'deny', project: '-x-data_ssd-claudemd' },
    { hook: 'banned-vocab', event: 'deny', project: '-home-daagu' },
    { hook: 'banned-vocab', event: 'deny-prose-dry-run', project: '-home-daagu' }, // excluded (exits 0)
    { hook: 'banned-vocab', event: 'bypass-escape-hatch', project: '-home-daagu' }, // excluded (not deny)
    { hook: 'ship-baseline', event: 'deny', project: '-home-daagu' },
    { hook: 'ship-baseline', event: 'deny-repeat', project: '-home-gsd' },          // counts — still hook_deny
    { hook: 'pre-bash-safety', event: 'deny' },                                     // no project → unknown
  ];
  const r = byProjectClass(hits, { mode: 'deny' });
  assert.deepEqual(r['banned-vocab'], { total: 3, self: 2, external: 1, unknown: 0 });
  assert.deepEqual(r['ship-baseline'], { total: 2, self: 0, external: 2, unknown: 0 }); // deny + deny-repeat
  assert.deepEqual(r['pre-bash-safety'], { total: 1, self: 0, external: 0, unknown: 1 });
});

test('byProjectClass: mode:all classifies every event regardless of type', () => {
  const hits = [
    { hook: 'banned-vocab', event: 'deny', project: '-x-claudemd' },
    { hook: 'banned-vocab', event: 'bypass-escape-hatch', project: '-home-daagu' },
  ];
  const r = byProjectClass(hits, { mode: 'all' });
  assert.equal(r['banned-vocab'].total, 2);
  assert.equal(r['banned-vocab'].self, 1);
  assert.equal(r['banned-vocab'].external, 1);
});

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

test('groupBySection: bins by spec_section, falls back to (unset) when cutoverTs not passed', () => {
  const hits = [
    { hook: 'x', event: 'deny', spec_section: '§10-V' },
    { hook: 'x', event: 'warn', spec_section: '§10-V' },
    { hook: 'x', event: 'deny' /* no spec_section */ },
  ];
  const g = groupBySection(hits);
  assert.equal(g['§10-V'].total, 2);
  assert.equal(g['§10-V'].byEvent.deny, 1);
  assert.equal(g['§10-V'].byEvent.warn, 1);
  // Back-compat: no cutoverTs ⇒ legacy single `(unset)` bucket.
  assert.equal(g['(unset)'].total, 1);
  assert.equal(g['(unset-historical)'], undefined);
  assert.equal(g['(unset-current)'], undefined);
});

test('v0.9.37: groupBySection with cutoverTs splits unset into historical / current', async () => {
  const { groupBySection } = await import('../../scripts/lib/rule-hits-parse.js');
  const cutoverIso = '2026-05-09T15:16:00Z';
  const cutoverMs = new Date(cutoverIso).getTime();
  const hits = [
    // Pre-cutover null-section rows → (unset-historical).
    { ts: '2026-04-22T12:00:00Z', hook: 'sandbox-disposal', event: 'warn' /* null section */ },
    { ts: '2026-04-23T12:00:00Z', hook: 'ship-baseline',    event: 'pass' /* null section */ },
    // Post-cutover null-section row (intentional housekeeping: session-start
    // bootstrap is by-design null) → (unset-current).
    { ts: '2026-05-10T08:00:00Z', hook: 'session-start',    event: 'bootstrap' /* null section */ },
    // Post-cutover with section → its own bucket.
    { ts: '2026-05-10T09:00:00Z', hook: 'banned-vocab',     event: 'deny', spec_section: '§10-V' },
  ];
  const g = groupBySection(hits, cutoverMs);
  assert.ok(!('(unset)' in g), 'with cutoverTs the legacy (unset) bucket must not appear');
  assert.equal(g['(unset-historical)'].total, 2);
  assert.deepEqual(Object.keys(g['(unset-historical)'].byHook).sort(),
    ['sandbox-disposal', 'ship-baseline']);
  assert.equal(g['(unset-current)'].total, 1);
  assert.equal(g['(unset-current)'].byHook['session-start'], 1);
  assert.equal(g['§10-V'].total, 1);
});

test('v0.17.7: excludeTestSessions drops t/test sentinels, keeps null and UUIDs', () => {
  const hits = [
    { session_id: 't', hook: 'banned-vocab' },
    { session_id: 'test', hook: 'pre-bash-safety' },
    { session_id: null, hook: 'session-start' },
    { session_id: 'b46b028b-cb04-4338-aff6-d9cdfbe055b8', hook: 'pre-bash-safety' },
    { session_id: 'test-baseline-cv', hook: 'banned-vocab' }, // not a sentinel — full match only
  ];
  const real = excludeTestSessions(hits);
  assert.equal(real.length, 3);
  assert.deepEqual(real.map(h => h.session_id),
    [null, 'b46b028b-cb04-4338-aff6-d9cdfbe055b8', 'test-baseline-cv']);
});

test('v0.9.37: detectCutover finds earliest ts with non-null spec_section', async () => {
  const { detectCutover } = await import('../../scripts/lib/rule-hits-parse.js');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-cut-'));
  try {
    const log = path.join(tmpHome, 'claudemd.jsonl');
    fs.writeFileSync(log,
      `{"ts":"2026-04-22T10:00:00Z","hook":"x","event":"warn","spec_section":null}\n` +
      `{"ts":"2026-04-22T11:00:00Z","hook":"x","event":"deny"}\n` +
      `{"ts":"2026-05-09T15:16:00Z","hook":"y","event":"warn","spec_section":"§8.V4"}\n` +
      `{"ts":"2026-05-10T08:00:00Z","hook":"z","event":"deny","spec_section":"§10-V"}\n`
    );
    const cut = detectCutover(log);
    assert.equal(new Date(cut).toISOString(), '2026-05-09T15:16:00.000Z');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('v0.9.37: detectCutover returns null when no spec_section row exists', async () => {
  const { detectCutover } = await import('../../scripts/lib/rule-hits-parse.js');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-cut-'));
  try {
    const log = path.join(tmpHome, 'claudemd.jsonl');
    fs.writeFileSync(log,
      `{"ts":"2026-04-22T10:00:00Z","hook":"x","event":"warn"}\n` +
      `{"ts":"2026-04-22T11:00:00Z","hook":"x","event":"deny","spec_section":null}\n`
    );
    assert.equal(detectCutover(log), null);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('v0.9.37: detectCutover returns null when log missing', async () => {
  const { detectCutover } = await import('../../scripts/lib/rule-hits-parse.js');
  assert.equal(detectCutover('/tmp/definitely-not-here-xyz.jsonl'), null);
});
