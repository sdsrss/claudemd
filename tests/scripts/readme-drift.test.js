// readme-drift.test.js — locks README claims that have drifted before
// (QA loop 2026-07-11: 6 of 8 findings were README↔implementation drift).
// Two mechanically checkable classes:
//   1. §Project layout counts (commands/*.md, scripts/*.js) vs the filesystem.
//   2. Opt-in gated hooks (`[[ "${VAR:-0}" == "1" ]] || exit 0`) that appear
//      in the "Hooks (what fires when)" table must say "Opt-in" in their row —
//      the transcript-vocab-scan row shipped without it and read as
//      default-active.
// Sibling of kill-switch-doc-drift.test.js (env-var list) — same philosophy,
// different README surfaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const README = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

test('README §Project layout: commands count matches commands/*.md', () => {
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'commands')).filter(f => f.endsWith('.md')).length;
  const m = README.match(/├── commands\/\s+# (\d+) slash-command/);
  assert.ok(m, 'README §Project layout commands/ line with a count not found');
  assert.equal(Number(m[1]), actual,
    `README says ${m[1]} slash-command files, commands/ has ${actual}`);
});

test('README §Project layout: scripts count matches scripts/*.js', () => {
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'scripts')).filter(f => f.endsWith('.js')).length;
  const m = README.match(/├── scripts\/\s+# (\d+) Node\.js scripts/);
  assert.ok(m, 'README §Project layout scripts/ line with a count not found');
  assert.equal(Number(m[1]), actual,
    `README says ${m[1]} Node.js scripts, scripts/ has ${actual}`);
});

test('README "N shell hooks" count(s) match hooks/*.sh', () => {
  // TEST-2 (roadmap): the "16 shell hooks" claim appears twice (§capabilities
  // table row + §Project layout tree) and was previously guarded only
  // indirectly via HOOK_REGISTRY.length in hook-registry.test.js — the README
  // text itself could drift silently (a hook added without bumping the number).
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'hooks')).filter(f => f.endsWith('.sh')).length;
  const counts = [...README.matchAll(/(\d+) shell hooks/g)].map(m => Number(m[1]));
  assert.ok(counts.length >= 2, `expected ≥2 "N shell hooks" mentions in README, found ${counts.length}`);
  for (const c of counts) {
    assert.equal(c, actual, `README says "${c} shell hooks" but hooks/ has ${actual} .sh files`);
  }
});

test('README §capabilities hook list enumerates exactly the real hooks/*.sh', () => {
  // Stronger than the count alone: the ·-separated enumerated row must name
  // every hook and only real hooks — catches a hook silently dropped from the
  // table (or a renamed/stale entry) even if the number still happens to match.
  const actual = fs.readdirSync(path.join(REPO_ROOT, 'hooks'))
    .filter(f => f.endsWith('.sh')).map(f => f.replace(/\.sh$/, '')).sort();
  const row = README.split('\n').find(l => /\|\s*\d+ shell hooks\s*\|/.test(l));
  assert.ok(row, '§capabilities "N shell hooks" table row not found');
  const listed = [...row.matchAll(/`([a-z0-9-]+)`/g)].map(m => m[1]).sort();
  assert.deepEqual(listed, actual,
    `README hook list ≠ hooks/*.sh.\n  only in README: ${listed.filter(h => !actual.includes(h))}\n  only on disk:   ${actual.filter(h => !listed.includes(h))}`);
});

test('README hooks table: every opt-in gated hook with a table row says Opt-in', () => {
  const hooksDir = path.join(REPO_ROOT, 'hooks');
  const optInHooks = fs.readdirSync(hooksDir).filter(f => f.endsWith('.sh')).filter(f => {
    const src = fs.readFileSync(path.join(hooksDir, f), 'utf8');
    return /\[\[ "\$\{[A-Z0-9_]+:-0\}" == "1" \]\] \|\| exit 0/.test(src);
  }).map(f => f.replace(/\.sh$/, ''));
  assert.ok(optInHooks.length >= 2, `expected ≥2 opt-in gated hooks, found: ${optInHooks}`);

  // "what fires when" table rows: | trigger | `hook-name` ... | description |
  const tableRows = README.split('\n').filter(l => /^\|.+\|.+\|.+\|$/.test(l));
  for (const hook of optInHooks) {
    const row = tableRows.find(l => l.includes(`\`${hook}\``) && !l.includes('DISABLE_'));
    if (!row) continue; // not in the fires-when table (e.g. mid-spine) — nothing to mislead
    assert.match(row, /[Oo]pt-in/,
      `hooks/${hook}.sh is opt-in gated but its README table row does not say "Opt-in":\n${row}`);
  }
});
