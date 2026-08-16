// sanitize-redos.test.js — bounded-work guard for lint.js#stripIdentifiers.
//
// Both identifier-strip clauses are `<class-run><required-delimiter>` shapes:
//   step 3  [A-Za-z0-9._@~-]*\/…     (slashed paths)
//   step 4  [A-Za-z0-9_-]+\.[a-z]…   (bare name.ext)
// On a long run of class characters that contains NO delimiter, an unanchored
// global regex retries from every offset inside the run and rescans the run
// each time — O(run²). Measured pre-fix on this machine (node 24):
//   len  4k → 6ms | 8k → 24ms | 16k → 94ms | 32k → 376ms | 64k → 1495ms
// a clean 4× per doubling, so ~500KB hung `lint --file` past a 30s timeout.
//
// The bash engines are bounded by construction (POSIX sed does not backtrack,
// and the hook caps its input at `tail -c 4096`); the Node path caps nothing —
// `lint --file`, `audit <transcript>` and sampling-audit all scan whole files.
// A CI job wired to the CLI would hang rather than fail.
//
// This gate asserts BOUNDED WORK, not a specific regex spelling. The
// semantics are pinned separately by sanitize-stage-parity.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripIdentifiers } from '../../scripts/lib/lint.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO_ROOT, 'bin/claudemd-lint.js');

// Deliberately generous so the gate measures the complexity CLASS, not machine
// speed: pre-fix this length costs ~15s, post-fix single-digit ms. Any budget
// between the two separates them; 3s leaves ~5× headroom on slow CI.
const BUDGET_MS = 3000;

const elapsed = (fn) => {
  const t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
};

test('stripIdentifiers: a long delimiter-free class-run is linear, not quadratic', () => {
  // 200k chars of [A-Za-z0-9_-] with no '.' and no '/' — every offset is a
  // candidate start for both clauses and none of them can ever match.
  const run = 'a_'.repeat(100_000);
  const ms = elapsed(() => stripIdentifiers(run));
  assert.ok(ms < BUDGET_MS, `stripIdentifiers took ${ms.toFixed(0)}ms on a 200k class-run (budget ${BUDGET_MS}ms)`);
});

test('stripIdentifiers: a run that ALMOST matches (delimiter only at the end) stays bounded', () => {
  // Worst case for the `+`-then-required-literal shape: the engine consumes the
  // whole run at every offset before failing the final char check.
  const ms = elapsed(() => stripIdentifiers('a_'.repeat(100_000) + '.X'));
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)}ms on a 200k near-miss run (budget ${BUDGET_MS}ms)`);
});

test('stripIdentifiers: long run of the step-3 class (dots, no slash) stays bounded', () => {
  const ms = elapsed(() => stripIdentifiers('a.'.repeat(100_000)));
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)}ms on a 200k dotted run (budget ${BUDGET_MS}ms)`);
});

test('stripIdentifiers: many fence lines do not cost O(lines²)', () => {
  // The fence terminator guard asked "any fence after i?" via
  // lines.slice(i + 1).some(...) — .some short-circuits but .slice still
  // allocates the whole tail every time. Measured pre-fix: 10k lines → 6ms,
  // 20k → 49ms, 40k → 397ms (4× input, 63× time).
  const lines = [];
  for (let i = 0; i < 80_000; i++) lines.push(i % 2 === 0 ? '```' : 'text line');
  lines.push('no closing fence here');
  const ms = elapsed(() => stripIdentifiers(lines.join('\n')));
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)}ms on 80k fence-dense lines (budget ${BUDGET_MS}ms)`);
});

test('stripIdentifiers: fence semantics unchanged by the terminator precompute', () => {
  // The guard's contract: an opening fence with NO closer later is literal
  // text, so everything after it stays scannable; with a closer, the body is
  // blanked. Both directions, since the precompute replaced the predicate.
  const unterminated = '```\nthis is comprehensive work\n';
  assert.match(stripIdentifiers(unterminated), /comprehensive/,
    'unterminated fence must stay literal text (no blank-to-EOF)');
  const terminated = '```\nthis is comprehensive work\n```\ntail\n';
  assert.doesNotMatch(stripIdentifiers(terminated), /comprehensive/,
    'a properly closed fence body must be stripped');
  assert.match(stripIdentifiers(terminated), /tail/, 'text after the fence survives');
});

test('CLI: lint --file on a large delimiter-free file terminates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemd-redos-'));
  try {
    const p = path.join(dir, 'blob.txt');
    fs.writeFileSync(p, 'a_'.repeat(150_000));
    const r = spawnSync(process.execPath, [BIN, 'lint', '--file', p], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(r.signal, null, `CLI was killed by ${r.signal} — did not terminate within 20s`);
    assert.equal(r.status, 0, `expected clean exit; stdout=${r.stdout} stderr=${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
