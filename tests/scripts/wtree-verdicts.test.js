// wtree-verdicts.test.js — the R3 cross-tab (tasks/specs/wtree-evidence.md) on
// synthetic log rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossTab, gateReading } from '../../scripts/offline-eval/wtree-verdicts.mjs';

const run = (ts, session, wtree) => ({
  ts,
  session_id: session,
  hook: 'verify-log',
  event: 'verify-run',
  extra: { tier: 'T2', wtree },
});
const claim = (ts, session, verdict, wtree) => ({
  ts,
  session_id: session,
  hook: 'evidence-gate',
  event: 'claim-wtree',
  extra: { verdict, wtree },
});

test('wtree-verdicts: the gate reading groups its verdicts', () => {
  assert.equal(gateReading('verified'), 'gate-verified');
  assert.equal(gateReading('no-code-edit'), 'gate-no-edit');
  for (const v of ['command-but-no-runner', 'error-output-only', 'edit-output-only', 'no-command-output']) {
    assert.equal(gateReading(v), 'gate-fires');
  }
});

test('wtree-verdicts: a run on the same content before the claim verifies it; after it, or on other content, does not', () => {
  const rows = [
    run('2026-10-01T00:00:01Z', 's1', 'A'),
    claim('2026-10-01T00:00:02Z', 's1', 'no-command-output', 'A'), // gate fires, content verified -> disagreement
    claim('2026-10-01T00:00:03Z', 's1', 'verified', 'B'), // gate silent, content never verified -> disagreement
    run('2026-10-01T00:00:05Z', 's1', 'C'),
    claim('2026-10-01T00:00:04Z', 's1', 'verified', 'C'), // the run came AFTER the claim
    claim('2026-10-01T00:00:06Z', 's2', 'verified', 'A'), // verified in another session
    claim('2026-10-01T00:00:07Z', 's2', 'verified', null),
  ];
  const r = crossTab(rows);
  assert.equal(r.claims, 5);
  assert.deepEqual(r.table, {
    'gate-fires × wtree-verified': 1,
    'gate-verified × wtree-unverified': 2,
    'gate-verified × wtree-verified-other-session': 1,
    'gate-verified × no-fingerprint': 1,
  });
  assert.deepEqual(
    r.disagreements.map(d => d.ts),
    ['2026-10-01T00:00:02Z', '2026-10-01T00:00:03Z', '2026-10-01T00:00:04Z']
  );
});

test('wtree-verdicts: --since drops earlier claims only', () => {
  const rows = [run('2026-10-01T00:00:01Z', 's1', 'A'), claim('2026-10-01T00:00:02Z', 's1', 'verified', 'A')];
  assert.equal(crossTab(rows, '2026-10-02').claims, 0);
  assert.equal(crossTab(rows, '2026-10-01').claims, 1);
});
