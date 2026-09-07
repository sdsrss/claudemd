import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPatterns, scan } from '../../scripts/lib/lint.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  '3× faster path', // unicode × — same claim shape as 5x
  '这个应该可以了',
  '缓存后 50%更快',
  '优化带来 3倍提升',
  // Boundary + clean (parity must agree here too):
  'robustness testing suite', // \brobust\b must NOT match robust-ness
  'the fix is verified, 12/12 tests', // clean
  'refactor the parser module', // clean
  'p99 580ms then 140ms after', // clean, no banned token
  // MIXED SCRIPT (Round-14 audit ALG-H1). Not one of the 34 probes above was
  // mixed, and mixed is what this maintainer writes: `\b` in GNU grep under a
  // UTF-8 locale treats CJK as word constituents, so there is no boundary at
  // 更|r and the blocking hook allowed every English banned word embedded in
  // 中文 prose while `claudemd lint` exited 1 on the same string. Both engines
  // now read the boundary the ASCII way — the hook greps under LC_ALL=C, which
  // is the locale grepMatches below spawns.
  '实现更robust的重试逻辑',
  '这个改动significantly提升了吞吐',
  '覆盖很comprehensive了',
  '中文里的robustness不该命中', // boundary control, mixed script
];

// LC_ALL=C, because that is what hook_vocab_grep (hooks/lib/hook-common.sh)
// runs and therefore what ships. Spawning grep in the ambient locale measured a
// grep no hook invokes, which is how the mixed-script divergence below stayed
// green: `\b` is locale-aware in GNU grep and ASCII-only in JS. The consumer
// test at the bottom of this file is what keeps the two spellings together.
function grepMatches(regex, probe) {
  const r = spawnSync('grep', ['-iE', '--', regex], {
    input: probe,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
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

// The parity above is measured under LC_ALL=C. That measurement is only worth
// something if the shipped engines match under LC_ALL=C too, so this pins the
// consumers rather than the locale string: every §10-V pattern grep in both
// bash engines must go through hook_vocab_grep, which is the single place the
// locale is set. Cardinality is asserted in both directions — a file that
// stopped matching patterns entirely would otherwise pass with zero offenders
// (feedback_gate_must_report_its_cardinality).
const BASH_ENGINES = ['hooks/banned-vocab-check.sh', 'hooks/transcript-vocab-scan.sh'];

test('§10-V: both bash engines match patterns through hook_vocab_grep (the LC_ALL=C seam)', () => {
  for (const rel of BASH_ENGINES) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const code = src.split('\n').filter(l => !/^\s*#/.test(l));
    const patternGreps = code.filter(l => /grep\s+-[qo]iE\s+"\$local_regex"/.test(l));
    const throughHelper = patternGreps.filter(l => /hook_vocab_grep\s+-[qo]iE/.test(l));
    assert.ok(
      patternGreps.length >= 2,
      `${rel}: expected at least 2 §10-V pattern greps (a -qiE test and a -oiE extract), found ${patternGreps.length} — the matcher stopped matching, so this gate judges nothing`
    );
    assert.deepEqual(
      patternGreps.filter(l => !throughHelper.includes(l)).map(l => l.trim()),
      [],
      `${rel}: a §10-V pattern grep bypasses hook_vocab_grep, so it runs in the ambient locale and \\b stops agreeing with the JS engine on mixed-script text`
    );
  }
  // …and the helper's own body, which nothing here read (v0.81.0 pre-tag review,
  // LOW-5). Deleting `LC_ALL=C` from hook_vocab_grep left this whole file green
  // while restoring the exact ALG-H1 divergence — the locale this test spawns
  // grep under was hard-coded here and asserted nowhere against the shipped one.
  const helper = fs.readFileSync(path.join(REPO_ROOT, 'hooks/lib/hook-common.sh'), 'utf8');
  assert.match(
    helper,
    /^hook_vocab_grep\(\) \{\n {2}LC_ALL=C grep "\$@"\n\}$/m,
    'hooks/lib/hook-common.sh: hook_vocab_grep must be exactly `LC_ALL=C grep "$@"` — the locale is the whole point of the helper, and the parity above is measured under it'
  );
});

test('§10-V: every pattern is exercised by at least one matching probe (no untested pattern)', () => {
  const unexercised = patterns
    .filter(p => !PROBES.some(probe => scan(probe, { patterns: [p] }).length > 0))
    .map(p => p.regex);
  assert.deepEqual(
    unexercised,
    [],
    `patterns with no matching probe — add one so engine parity is actually tested:\n${unexercised.join('\n')}`
  );
});
