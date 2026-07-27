// Version comparison: bash `sort -V` vs JS semverCmp (2026-07-27 audit, M9).
//
// The audit reported these two as a live cross-language divergence — bash would
// call `0.61.0-dev` newer than `0.61.0` while install.js declines to compare
// non-strict versions at all. Verified against source: NOT reachable. Every
// bash comparison site pre-filters both operands with `^[0-9]+\.[0-9]+\.[0-9]+$`
// (session-start-check.sh direction gate, stale_cache_check, semver_cache_max,
// the remote-tag gate, version-sync.sh), which is exactly what SEMVER_RE encodes.
// The finding is downgraded to what is actually true: that guard is HAND-REPEATED
// at every site, so a future comparison added without it silently reopens the
// divergence — the same shape as the flatten seam this audit did find live.
//
// Test 1 enumerates the call sites and requires the guard. Test 2 pins the two
// engines to the same verdicts over strict-semver pairs, so "gated" and "agrees
// once gated" are both held rather than assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEMVER_RE, semverCmp } from '../../scripts/lib/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const HOOKS_DIR = path.join(REPO_ROOT, 'hooks');

const SEMVER_GUARD = /\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+|\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+/;

test('every `sort -V` comparison in hooks/ is semver-gated', () => {
  const sites = [];
  for (const f of fs.readdirSync(HOOKS_DIR).filter(n => n.endsWith('.sh'))) {
    const lines = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('sort -V') || /^\s*#/.test(line)) return;
      // The guard belongs to the enclosing block; scan a window above the call.
      const window = lines.slice(Math.max(0, i - 15), i + 1).join('\n');
      sites.push({ file: f, line: i + 1, guarded: SEMVER_GUARD.test(window) });
    });
  }

  assert.ok(sites.length >= 4, `expected >= 4 sort -V sites, found ${sites.length}`);
  const ungated = sites.filter(s => !s.guarded).map(s => `${s.file}:${s.line}`);
  assert.deepEqual(
    ungated, [],
    `ungated version comparison(s): ${ungated.join(', ')} — filter operands with ` +
    `^[0-9]+\\.[0-9]+\\.[0-9]+$ (SEMVER_RE's shape) before comparing, or the bash and ` +
    `JS engines disagree on prerelease/dev strings`
  );
});

test('bash and JS pick the same newer version for strict-semver pairs', () => {
  const pairs = [
    ['0.61.0', '0.61.1'],
    ['0.61.0', '0.62.0'],
    ['0.9.0', '0.10.0'],     // lexical ordering trap
    ['1.0.0', '0.99.99'],
    ['0.61.0', '0.61.0'],
    ['2.0.0', '10.0.0'],     // multi-digit major
    ['0.2.10', '0.2.9'],
  ];

  for (const [a, b] of pairs) {
    assert.ok(SEMVER_RE.test(a) && SEMVER_RE.test(b), `fixture not strict semver: ${a} ${b}`);
    const bashMax = execFileSync('bash', ['-c', `printf '%s\\n%s\\n' "${a}" "${b}" | sort -V | tail -1`], { encoding: 'utf8' }).trim();
    const jsMax = semverCmp(a, b) >= 0 ? a : b;
    assert.equal(bashMax, jsMax, `engines disagree on (${a}, ${b}): bash=${bashMax} js=${jsMax}`);
  }
});
