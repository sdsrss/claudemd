import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readPatterns, scan } from '../../scripts/lib/lint.js';

// hooks/banned-vocab.patterns is the single source consumed by TWO regex engines:
//   • banned-vocab-check.sh via `grep -iE` (POSIX ERE)
//   • lint.js / the npm CLI via `new RegExp(posixClassesToJs(...), 'i')` (JS RegExp)
// ERE and JS RegExp diverge on \b, POSIX classes, and anchors, so a pattern can
// block at `git commit` yet pass the CLI/transcript path (or vice-versa) with no
// signal. spec-pattern-drift.test.js only bans \s/\d/\w from reappearing; it does
// NOT prove the two engines agree on a verdict. This closes that seam (2026-07-15
// audit, arch-audit MEDIUM) by asserting identical verdicts for every
// (pattern, probe) pair, using the same `grep` the hook resolves at run time.

const patterns = readPatterns();

// One should-match probe per pattern + boundary and clean cases. EXTEND this
// when adding a pattern — the coverage test below fails loudly on a pattern no
// probe exercises, so parity can never silently skip a pattern.
const PROBES = [
  'this significantly improves throughput',
  'a robust solution',
  'comprehensive coverage',
  'this should work now',
  '这个改动显著改善了延迟',
  '50% faster than before',
  'the api is production-ready',
  'follow best practice here',
  'the industry-standard approach',
  'this is cleaner code',
  'it seems to work',
  'the output appears correct',
  'in principle this holds',
  'in theory it converges',
  'presumably the cache helps',
  'it should be fine',
  '性能显著提升',
  '新算法显著优于旧的',
  '吞吐大幅提升',
  '延迟大幅改善',
  '这样更高效',
  '明显优于基线',
  '功能基本可用',
  '效果相当不错',
  '5x faster path',
  '缓存后 50%更快',
  '优化带来 3倍提升',
  // Boundary + clean (parity must agree here too):
  'robustness testing suite',        // \brobust\b must NOT match robust-ness
  'the fix is verified, 12/12 tests', // clean
  'refactor the parser module',       // clean
  'p99 580ms then 140ms after',       // clean, no banned token
];

function grepMatches(regex, probe) {
  const r = spawnSync('grep', ['-iE', '--', regex], { input: probe, encoding: 'utf8' });
  // grep exit: 0 = match, 1 = no match, 2 = error. Treat 2/spawn-error as a
  // hard failure — a silently-broken grep would fake agreement.
  if (r.error || r.status === 2) {
    throw new Error(`grep failed for /${regex}/: ${r.error ? r.error.message : r.stderr}`);
  }
  return r.status === 0;
}

test('§10-V: grep -iE and JS RegExp return the same verdict for every (pattern, probe)', () => {
  const divergences = [];
  for (const p of patterns) {
    for (const probe of PROBES) {
      const jsHit = scan(probe, { patterns: [p] }).length > 0;
      const grepHit = grepMatches(p.regex, probe);
      if (jsHit !== grepHit) {
        divergences.push(`/${p.regex}/ vs "${probe}": js=${jsHit} grep=${grepHit}`);
      }
    }
  }
  assert.deepEqual(divergences, [], `engine divergence:\n${divergences.join('\n')}`);
});

test('§10-V: every pattern is exercised by at least one matching probe (no untested pattern)', () => {
  const unexercised = patterns
    .filter((p) => !PROBES.some((probe) => scan(probe, { patterns: [p] }).length > 0))
    .map((p) => p.regex);
  assert.deepEqual(
    unexercised,
    [],
    `patterns with no matching probe — add one so engine parity is actually tested:\n${unexercised.join('\n')}`,
  );
});
