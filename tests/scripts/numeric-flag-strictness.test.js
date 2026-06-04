// numeric-flag-strictness.test.js — Round-3 user-test regression: numeric
// CLI flags that take "positive integer" must reject decimal inputs instead
// of silently truncating via parseInt.
//
// Pre-fix history (this round):
//   - `parseInt('2.5', 10) === 2` so `--days=1.5` silently ran with `--days=1`
//     and `--prune-backups=2.5` silently DELETED backups using retain=2.
//     Same silent-fallback antipattern documented in
//     feedback_cli_flag_shape_silent_fallback.md.
// Fix: `parseInt(raw, 10)` → `Number(raw)`. `Number('1.5') === 1.5` then the
// existing `Number.isInteger` guard rejects.
//
// Round-N follow-up: `Number()` is too permissive in the OTHER direction —
// `Number('0x1e') === 30`, `Number('1e2') === 100` pass `Number.isInteger`
// despite the "positive integer" contract. Centralized into
// `parsePositiveInt` (scripts/lib/argv.js), which gates on plain-decimal
// shape first. The OVERCOERCE_CASES below lock that: hex / exponential are
// rejected, integer-valued floats ('30.0') still accepted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// [scriptRel, flag, badValue, validValue, errorRe]
const CASES = [
  ['scripts/audit.js',            '--days',           '1.5',     '30',         /requires a positive integer/],
  ['scripts/sparkline.js',        '--days',           '1.5,2,3', '30,60,90',   /≥2 comma-separated positive integers/],
  ['scripts/hard-rules-audit.js', '--days',           '2.7',     '90',         /requires a positive integer/],
  ['scripts/doctor.js',           '--prune-backups',  '2.5',     '5',          /requires a positive integer/],
  ['scripts/lesson-bypass-audit.js', '--days',        '2.7',     '30',         /requires a positive integer/],
];

const run = (relScript, args) => spawnSync(
  process.execPath,
  [path.join(REPO_ROOT, relScript), ...args],
  { encoding: 'utf8', timeout: 10000 },
);

for (const [rel, flag, bad, valid, errorRe] of CASES) {
  test(`${rel}: ${flag}=${bad} (decimal) rejects with exit 1 + clear message`, () => {
    const r = run(rel, [`${flag}=${bad}`]);
    assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, errorRe);
    assert.match(r.stderr, new RegExp(`got '${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  });

  test(`${rel}: ${flag}=${valid} (valid) still works`, () => {
    const r = run(rel, [`${flag}=${valid}`]);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
  });

  // '30.0' parses as integer 30 under Number() — must still be accepted so
  // we don't break users / scripts that pass trailing-zero shapes.
  const trailingZero = valid.split(',').map(v => `${v}.0`).join(',');
  test(`${rel}: ${flag}=${trailingZero} (trailing .0) still accepted`, () => {
    const r = run(rel, [`${flag}=${trailingZero}`]);
    assert.equal(r.status, 0, `expected exit 0; stderr=${r.stderr}`);
  });

  // Over-coercion regression: hex / exponential must be rejected (Number()
  // alone would coerce '0x1e'→30, '1e2'→100 past Number.isInteger).
  for (const over of ['0x1e', '1e2']) {
    const overVal = valid.includes(',') ? valid.split(',').map(() => over).join(',') : over;
    test(`${rel}: ${flag}=${overVal} (over-coerced ${over}) rejects with exit 1`, () => {
      const r = run(rel, [`${flag}=${overVal}`]);
      assert.equal(r.status, 1, `expected exit 1; stdout=${r.stdout} stderr=${r.stderr}`);
    });
  }
}
